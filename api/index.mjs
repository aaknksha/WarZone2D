import express from 'express';
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from 'redis';
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
await pool.query(fs.readFileSync(new URL('./002_phase2.sql',import.meta.url),'utf8'));
const redis = createClient({url:process.env.REDIS_URL});
redis.on('error',err=>console.error('Redis:',err.message));
await redis.connect();
app.get('/api/health',async (_req,res)=>{
  try {await pool.query('SELECT 1');await redis.ping();res.json({ok:true,postgres:'ready',redis:'ready'});}
  catch(e){res.status(503).json({ok:false,error:'dependency unavailable'});}
});
app.get('/api/leaderboard',async (_req,res)=>{
  try {
    const q=await pool.query(`SELECT player_name AS display_name, COUNT(*)::int AS matches,
      COUNT(*) FILTER (WHERE won)::int AS wins,
      COUNT(*) FILTER (WHERE NOT won)::int AS losses,
      SUM(score)::int AS total_score, SUM(deaths)::int AS total_deaths
      FROM phase2_match_scores GROUP BY player_name
      ORDER BY wins DESC,total_score DESC LIMIT 20`);
    res.json(q.rows);
  }catch(e){console.error(e);res.status(500).json({error:'query failed'});}
});
app.get('/api/matches',async (_req,res)=>{
  try {const q=await pool.query('SELECT * FROM phase2_matches ORDER BY ended_at DESC LIMIT 20');res.json(q.rows);}
  catch(e){console.error(e);res.status(500).json({error:'query failed'});}
});
app.post('/api/internal/match-result',async(req,res)=>{
  const expected=process.env.INTERNAL_API_SECRET;
  if(!expected || req.get('x-internal-secret')!==expected) return res.status(403).json({error:'forbidden'});
  const {matchId,roomCode,startedAt,endedAt,result}=req.body??{};
  const validUUID=typeof matchId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId);
  if(!validUUID || typeof roomCode!=='string' || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) ||
     !result || typeof result.reason!=='string' || typeof result.draw!=='boolean' ||
     !Array.isArray(result.standings) || result.standings.length<1 || result.standings.length>4 ||
     result.standings.some(p=>typeof p.name!=='string'||p.name.length>40||!Number.isInteger(p.score)||p.score<0||!Number.isInteger(p.deaths)||p.deaths<0||!Number.isInteger(p.shots)||p.shots<0||!Number.isInteger(p.hits)||p.hits<0))
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
        await client.query(`INSERT INTO phase2_match_scores(match_id,player_id,player_name,score,deaths,shots,hits,won)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [matchId,p.id,p.name,p.score,p.deaths,p.shots,p.hits,!result.draw&&p.id===result.winnerId]);
      }
    }
    await client.query('COMMIT');
    res.json({ok:true,stored:insert.rowCount===1});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'save failed'});}
  finally{client.release();}
});
app.listen(4000,'0.0.0.0',()=>console.log('API listening on 4000'));
