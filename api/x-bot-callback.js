'use strict';
const crypto = require('crypto');
const { send, cookies, unpack, clearCookie } = require('../lib/discord-auth');
function encrypt(value) {
  const key = Buffer.from(process.env.X_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('X_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 random bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv.toString('base64'),ciphertext.toString('base64'),cipher.getAuthTag().toString('base64')].join('.');
}
async function supabaseUpsert(row) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase server configuration is missing.');
  const response = await fetch(base.replace(/\/$/,'')+'/rest/v1/froginals_x_bot_tokens?on_conflict=id',{
    method:'POST',
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify(row),signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Could not securely save X connection (HTTP '+response.status+').');
}
module.exports = async function handler(req,res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return send(res,405,{success:false,error:'Method not allowed.'}); }
  const q=req.query||{};
  const saved=unpack(cookies(req).froginal_x_bot_oauth);
  clearCookie(res,'froginal_x_bot_oauth');
  if(q.error || !q.code || !q.state || !saved || saved.state!==q.state) return res.redirect(302,'/x-bot-connect.html?status=cancelled');
  try {
    const {X_CLIENT_ID,X_CLIENT_SECRET,X_REDIRECT_URI}=process.env;
    if(!X_CLIENT_ID||!X_CLIENT_SECRET||!X_REDIRECT_URI) throw new Error('X OAuth configuration is incomplete.');
    const basic=Buffer.from(X_CLIENT_ID+':'+X_CLIENT_SECRET).toString('base64');
    const tokenRes=await fetch('https://api.x.com/2/oauth2/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+basic,Accept:'application/json'},
      body:new URLSearchParams({grant_type:'authorization_code',code:String(q.code),redirect_uri:X_REDIRECT_URI,code_verifier:saved.verifier}),
      signal:AbortSignal.timeout(12000)
    });
    const token=await tokenRes.json();
    if(!tokenRes.ok||!token.access_token) throw new Error('X token exchange failed (HTTP '+tokenRes.status+').');
    const meRes=await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,name,username',{
      headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},signal:AbortSignal.timeout(12000)
    });
    const me=await meRes.json();
    if(!meRes.ok||!me.data||!me.data.id||!me.data.username) throw new Error('Could not read the authorised X profile.');
    const payload={access_token:token.access_token,refresh_token:token.refresh_token||null,expires_at:Date.now()+Number(token.expires_in||7200)*1000,scope:token.scope||'tweet.read tweet.write users.read offline.access'};
    await supabaseUpsert({id:'primary',x_user_id:String(me.data.id),username:String(me.data.username),display_name:String(me.data.name||''),token_ciphertext:encrypt(payload),connected_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    return res.redirect(302,'/x-bot-connect.html?status=connected&user='+encodeURIComponent(me.data.username));
  } catch(e) {
    console.error('X bot callback:',e.message);
    return res.redirect(302,'/x-bot-connect.html?status=error');
  }
};