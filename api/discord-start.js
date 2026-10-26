'use strict';
const crypto = require('crypto');
const { send, setCookie, pack } = require('../lib/discord-auth');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return send(res,405,{success:false,error:'Method not allowed.'}); }
  try {
    const id=process.env.DISCORD_CLIENT_ID, redirect=process.env.DISCORD_REDIRECT_URI;
    const missing = [];
    if (!id) missing.push('DISCORD_CLIENT_ID');
    if (!redirect) missing.push('DISCORD_REDIRECT_URI');
    if (missing.length) return send(res,503,{success:false,error:'Missing Preview runtime environment variable(s): '+missing.join(', ')+'. Check Vercel Environment Variables for the feature branch and redeploy.'});
    const state=crypto.randomBytes(32).toString('base64url');
    setCookie(res,'froginal_discord_oauth_state',pack({state,exp:Date.now()+10*60*1000}),600);
    const url=new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id',id); url.searchParams.set('response_type','code');
    url.searchParams.set('redirect_uri',redirect); url.searchParams.set('scope','identify');
    url.searchParams.set('state',state);
    return res.redirect(302,url.toString());
  } catch(e) { console.error('Discord OAuth start:',e.message); return send(res,503,{success:false,error:'Discord sign-in is not configured. Please contact the site administrator.'}); }
};
