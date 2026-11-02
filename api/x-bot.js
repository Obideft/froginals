'use strict';
const crypto = require('crypto');
const { send, setCookie, cookies, unpack, clearCookie, pack } = require('../lib/discord-auth');
function encrypt(value) {
  const key=Buffer.from(process.env.X_TOKEN_ENCRYPTION_KEY||'','base64');
  if(key.length!==32) throw new Error('X_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 random bytes.');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv.toString('base64'),data.toString('base64'),cipher.getAuthTag().toString('base64')].join('.');
}
async function db(path,method,body,prefer) {
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key) throw new Error('Supabase server configuration is missing.');
  const r=await fetch(base.replace(/\/$/,'')+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  const raw=await r.text(); if(!r.ok) throw new Error('Supabase request failed (HTTP '+r.status+').');
  try{return raw?JSON.parse(raw):null}catch{return null}
}
async function start(req,res) {
  const expected=process.env.X_BOT_SETUP_KEY||'',supplied=req.body&&req.body.setupKey;
  if(expected.length<32||typeof supplied!=='string'||supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return send(res,403,{success:false,error:'Invalid setup key.'});
  const {X_CLIENT_ID,X_CLIENT_SECRET,X_REDIRECT_URI,X_TOKEN_ENCRYPTION_KEY}=process.env;
  if(!X_CLIENT_ID||!X_CLIENT_SECRET||!X_REDIRECT_URI||!X_TOKEN_ENCRYPTION_KEY) return send(res,503,{success:false,error:'X OAuth or token encryption environment variables are missing.'});
  const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  setCookie(res,'froginal_x_bot_oauth',pack({state,verifier,exp:Date.now()+600000}),600);
  const url=new URL('https://x.com/i/oauth2/authorize');
  for(const [k,v] of Object.entries({response_type:'code',client_id:X_CLIENT_ID,redirect_uri:X_REDIRECT_URI,scope:'tweet.read tweet.write users.read offline.access',state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(k,v);
  return send(res,200,{success:true,authorizeUrl:url.toString()});
}
async function callback(req,res) {
  const q=req.query||{},saved=unpack(cookies(req).froginal_x_bot_oauth);clearCookie(res,'froginal_x_bot_oauth');
  if(q.error||!q.code||!q.state||!saved||saved.state!==q.state)return res.redirect(302,'/x-bot-connect.html?status=cancelled');
  try{
    const {X_CLIENT_ID,X_CLIENT_SECRET,X_REDIRECT_URI}=process.env;
    if(!X_CLIENT_ID||!X_CLIENT_SECRET||!X_REDIRECT_URI)throw new Error('X OAuth configuration incomplete.');
    const tokenRes=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(X_CLIENT_ID+':'+X_CLIENT_SECRET).toString('base64'),Accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code:String(q.code),redirect_uri:X_REDIRECT_URI,code_verifier:saved.verifier}),signal:AbortSignal.timeout(12000)});
    const token=await tokenRes.json();if(!tokenRes.ok||!token.access_token)throw new Error('X token exchange failed.');
    const meRes=await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,name,username',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const me=await meRes.json();if(!meRes.ok||!me.data?.id||!me.data?.username)throw new Error('X profile lookup failed.');
    const payload={access_token:token.access_token,refresh_token:token.refresh_token||null,expires_at:Date.now()+Number(token.expires_in||7200)*1000,scope:token.scope||'tweet.read tweet.write users.read offline.access'};
    await db('froginals_x_bot_tokens?on_conflict=id','POST',{id:'primary',x_user_id:String(me.data.id),username:String(me.data.username),display_name:String(me.data.name||''),token_ciphertext:encrypt(payload),connected_at:new Date().toISOString(),updated_at:new Date().toISOString()},'resolution=merge-duplicates,return=minimal');
    return res.redirect(302,'/x-bot-connect.html?status=connected&user='+encodeURIComponent(me.data.username));
  }catch(e){console.error('X bot OAuth callback:',e.message);return res.redirect(302,'/x-bot-connect.html?status=error')}
}
async function status(res) {
  try{const rows=await db('froginals_x_bot_tokens?select=username,display_name,connected_at&id=eq.primary&limit=1','GET');const row=rows&&rows[0];return send(res,200,{success:true,connected:!!row,username:row?.username||null,displayName:row?.display_name||null,connectedAt:row?.connected_at||null})}
  catch(e){console.error('X bot status:',e.message);return send(res,503,{success:false,error:'X connection status is temporarily unavailable.'})}
}
module.exports=async function handler(req,res){
 const action=(req.query||{}).action||'status';
 if(action==='callback'){if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{success:false,error:'Method not allowed.'})}return callback(req,res)}
 if(action==='start'){if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{success:false,error:'Method not allowed.'})}return start(req,res)}
 if(action==='status'){if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{success:false,error:'Method not allowed.'})}return status(res)}
 return send(res,404,{success:false,error:'Unknown action.'});
};