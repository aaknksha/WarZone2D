import { Router } from 'express';
import argon2 from 'argon2';

const usernameValid = s => typeof s === 'string' && /^[a-zA-Z0-9_]{3,30}$/.test(s);
const emailValid = s => typeof s === 'string' && s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const passwordValid = s => typeof s === 'string' && s.length >= 12 && s.length <= 256;
const userFields = 'id, username, email';

export function createAuthRouter(pool) {
  const router = Router();
  router.post('/register', async (req,res) => {
    const { username, email, password } = req.body ?? {};
    if (!usernameValid(username) || !emailValid(email) || !passwordValid(password))
      return res.status(400).json({error:'Username must be 3-30 letters, numbers or underscores; email must be valid; password must be 12-256 characters.'});
    const client = await pool.connect();
    try {
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING ${userFields}`, [username,email.toLowerCase(),hash]);
      await client.query('INSERT INTO player_stats(user_id) VALUES($1)',[result.rows[0].id]);
      await client.query('COMMIT');
      res.status(201).json({message:'Registration successful',user:result.rows[0]});
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({error:'Username or email already registered'});
      console.error('Register failed:',error); res.status(500).json({error:'Registration failed'});
    } finally {client.release();}
  });
  router.post('/login', async (req,res) => {
    const { email, password } = req.body ?? {};
    if (!emailValid(email) || typeof password !== 'string') return res.status(400).json({error:'Invalid credentials'});
    try {
      const result = await pool.query('SELECT id,username,email,password_hash FROM users WHERE LOWER(email)=LOWER($1)',[email]);
      const user = result.rows[0];
      if (!user || !(await argon2.verify(user.password_hash,password))) return res.status(401).json({error:'Invalid credentials'});
      req.session.regenerate(err => {
        if (err) return res.status(500).json({error:'Unable to start session'});
        req.session.userId = user.id;
        req.session.save(err => {
          if (err) return res.status(500).json({error:'Unable to save session'});
          res.json({message:'Login successful',user:{id:user.id,username:user.username,email:user.email}});
        });
      });
    } catch(error) {console.error('Login failed:',error);res.status(500).json({error:'Login failed'});}
  });
  const requireUser = (req,res,next) => req.session?.userId ? next() : res.status(401).json({error:'Not authenticated'});
  router.get('/me',requireUser,async(req,res)=>{
    try {
      const r=await pool.query(`SELECT ${userFields} FROM users WHERE id=$1`,[req.session.userId]);
      if(!r.rows[0]) return res.status(401).json({error:'Not authenticated'});
      res.json({user:r.rows[0]});
    } catch(error){console.error(error);res.status(500).json({error:'Unable to load user'});}
  });
  router.get('/profile',requireUser,async(req,res)=>{
    try {
      const r=await pool.query(`SELECT u.id,u.username,u.email,u.created_at,
        COALESCE(s.matches_played,0) AS matches_played,COALESCE(s.wins,0) AS wins,
        COALESCE(s.losses,0) AS losses,COALESCE(s.total_score,0) AS total_score,
        COALESCE(s.total_deaths,0) AS total_deaths FROM users u
        LEFT JOIN player_stats s ON s.user_id=u.id WHERE u.id=$1`,[req.session.userId]);
      if(!r.rows[0]) return res.status(401).json({error:'Not authenticated'});
      res.json({profile:r.rows[0]});
    } catch(error){console.error(error);res.status(500).json({error:'Unable to load profile'});}
  });
  router.post('/logout',(req,res)=>{
    if(!req.session) return res.json({message:'Logout successful',ok:true});
    req.session.destroy(err=>{
      if(err) return res.status(500).json({error:'Logout failed'});
      res.clearCookie('warzone.sid',{path:'/'});
      res.json({message:'Logout successful',ok:true});
    });
  });
  return router;
}
