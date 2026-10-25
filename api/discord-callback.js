'use strict';
const { send, cookies, unpack, setCookie, clearCookie, discordConfig } = require('../lib/discord-auth');
module.exports = async function handler(req,res) {
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{success:false,error:'Method not allowed.'});}
  // Keep the callback on the same deployment so its session cookie works with that deployment's API.
  const base='/froginalarmy.html';
  try {
    const q=req.query||{}, c=cookies(req), saved=unpack(c.froginal_discord_oauth_state);
    clearCookie(res,'froginal_discord_oauth_state');
    if(q.error||!q.code||!q.state||!saved||saved.state!==q.state) return res.redirect(302,base+'?discord_error=oauth_cancelled#join-army');
    const cfg=discordConfig();
    const tokenRes=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
      body:new URLSearchParams({client_id:cfg.DISCORD_CLIENT_ID,client_secret:cfg.DISCORD_CLIENT_SECRET,
        grant_type:'authorization_code',code:String(q.code),redirect_uri:cfg.DISCORD_REDIRECT_URI}),
      signal:AbortSignal.timeout(12000)});
    const token=await tokenRes.json();
    if(!tokenRes.ok||!token.access_token) throw new Error('Discord OAuth token exchange failed.');
    const userRes=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const user=await userRes.json();
    if(!userRes.ok||!/^[0-9]{17,20}$/.test(String(user.id||''))) throw new Error('Discord identity lookup failed.');
    setCookie(res,'froginal_discord_session',require('../lib/discord-auth').pack({discordUserId:String(user.id),username:String(user.global_name||user.username||'Discord member').slice(0,100),exp:Date.now()+8*60*60*1000}),8*60*60);
    return res.redirect(302,base+'?discord_connected=1#join-army');
  } catch(e) { console.error('Discord OAuth callback:',e.message); return res.redirect(302,base+'?discord_error=setup#join-army'); }
};
