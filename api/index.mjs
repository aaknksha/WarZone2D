import express from 'express';
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from 'redis';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createAuthRouter } from './auth.mjs';
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
await pool.query(fs.readFileSync(new URL('./002_phase2.sql',import.meta.url),'utf8'));
await pool.query(fs.readFileSync(new URL('./003_users.sql',import.meta.url),'utf8'));
const redis = createClient({url:process.env.REDIS_URL});
redis.on('error',err=>console.error('Redis:',err.message));
await redis.connect();
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
app.use(session({
  name:'warzone.sid', store:new RedisStore({client:redis}), secret,
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:24*60*60*1000}
}));
app.use('/api/auth',createAuthRouter(pool));
app.get('/api/health',async (_req,res)=>{
  try {await pool.query('SELECT 1');await redis.ping();res.json({ok:true,postgres:'ready',redis:'ready'});}
  catch(e){res.status(503).json({ok:false,error:'dependency unavailable'});}
});
// Both record views are scoped to the signed-in account, not a display name.
function requireUser(req,res,next) {
  if (!req.session?.userId) return res.status(401).json({error:'Not authenticated'});
  next();
}
app.get('/api/leaderboard',requireUser,async(req,res)=>{
  try {
    // Only players in matches that the signed-in user participated in.
    const q=await pool.query(`WITH my_matches AS (
        SELECT DISTINCT match_id FROM phase2_match_scores WHERE user_id=$1
      )
      SELECT COALESCE(u.username, MAX(s.player_name)) AS display_name,
        COUNT(*)::int AS matches,
        COUNT(*) FILTER (WHERE s.won)::int AS wins,
        COUNT(*) FILTER (WHERE NOT s.won)::int AS losses,
        COALESCE(SUM(s.score),0)::bigint AS total_score,
        COALESCE(SUM(s.deaths),0)::bigint AS total_deaths,
        (s.user_id=$1) AS is_me
      FROM phase2_match_scores s
      JOIN my_matches m ON m.match_id=s.match_id
      LEFT JOIN users u ON u.id=s.user_id
      WHERE s.user_id IS NOT NULL
      GROUP BY s.user_id,u.username
      ORDER BY wins DESC,total_score DESC,display_name ASC`,[req.session.userId]);
    res.json(q.rows);
  }catch(e){console.error(e);res.status(500).json({error:'query failed'});}
});
app.get('/api/matches',requireUser,async(req,res)=>{
  try {
    const q=await pool.query(`SELECT m.*, mine.score AS my_score,
        mine.deaths AS my_deaths, mine.won AS i_won,
        COALESCE((SELECT json_agg(json_build_object(
          'username',COALESCE(u.username,s.player_name),'score',s.score,
          'deaths',s.deaths,'won',s.won,'is_me',s.user_id=$1)
          ORDER BY s.score DESC,s.deaths ASC)
          FROM phase2_match_scores s LEFT JOIN users u ON u.id=s.user_id
          WHERE s.match_id=m.id), '[]'::json) AS players
      FROM phase2_matches m
      JOIN phase2_match_scores mine ON mine.match_id=m.id AND mine.user_id=$1
      ORDER BY m.ended_at DESC LIMIT 20`,[req.session.userId]);
    res.json(q.rows);
  }catch(e){console.error(e);res.status(500).json({error:'query failed'});}
});
app.post('/api/internal/match-result',async(req,res)=>{
  const expected=process.env.INTERNAL_API_SECRET;
  if(!expected || req.get('x-internal-secret')!==expected) return res.status(403).json({error:'forbidden'});
  const {matchId,roomCode,startedAt,endedAt,result}=req.body??{};
  const validUUID=typeof matchId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId);
  if(!validUUID || typeof roomCode!=='string' || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) ||
     !result || typeof result.reason!=='string' || typeof result.draw!=='boolean' ||
     !Array.isArray(result.standings) || result.standings.length<1 || result.standings.length>4 ||
     result.standings.some(p=>typeof p.name!=='string'||p.name.length>40||typeof p.userId!=='string'||!(/^[0-9a-f-]{36}$/i.test(p.userId))||!Number.isInteger(p.score)||p.score<0||!Number.isInteger(p.deaths)||p.deaths<0||!Number.isInteger(p.shots)||p.shots<0||!Number.isInteger(p.hits)||p.hits<0))
     return res.status(400).json({error:'invalid match result'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const winner=result.standings.find(p=>p.id===result.winnerId);
    const insert=await client.query(`INSERT INTO phase2_matches(id,room_code,started_at,ended_at,reason,winner_name,draw)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [matchId,roomCode,new Date(startedAt),new Date(endedAt),result.reason,winner?.name??null,result.draw]);
    if(insert.rowCount){
      for(const p of result.standings){
        await client.query(`INSERT INTO phase2_match_scores(match_id,player_id,player_name,score,deaths,shots,hits,won,user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [matchId,p.id,p.name,p.score,p.deaths,p.shots,p.hits,!result.draw&&p.id===result.winnerId,p.userId]);
        await client.query(`UPDATE player_stats SET matches_played=matches_played+1, wins=wins+$2, losses=losses+$3, total_score=total_score+$4, total_deaths=total_deaths+$5 WHERE user_id=$1`,[p.userId,Number(!result.draw&&p.id===result.winnerId),Number(!result.draw&&p.id!==result.winnerId),p.score,p.deaths]);
      }
    }
    await client.query('COMMIT');
    res.json({ok:true,stored:insert.rowCount===1});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'save failed'});}
  finally{client.release();}
});
app.listen(4000,'0.0.0.0',()=>console.log('API listening on 4000'));
