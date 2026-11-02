'use strict';
const crypto = require('crypto');
const { send, setCookie, pack } = require('../lib/discord-auth');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(res,405,{success:false,error:'Method not allowed.'}); }
  try {
    const expected = process.env.X_BOT_SETUP_KEY || '';
    const supplied = req.body && req.body.setupKey;
    if (expected.length < 32 || typeof supplied !== 'string' || supplied.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return send(res,403,{success:false,error:'Invalid setup key.'});
    }
    const { X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI, X_TOKEN_ENCRYPTION_KEY } = process.env;
    if (!X_CLIENT_ID || !X_CLIENT_SECRET || !X_REDIRECT_URI || !X_TOKEN_ENCRYPTION_KEY) {
      return send(res,503,{success:false,error:'X OAuth or token encryption environment variables are missing.'});
    }
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    setCookie(res,'froginal_x_bot_oauth',pack({state,verifier,exp:Date.now()+10*60*1000}),600);
    const url = new URL('https://x.com/i/oauth2/authorize');
    url.searchParams.set('response_type','code');
    url.searchParams.set('client_id',X_CLIENT_ID);
    url.searchParams.set('redirect_uri',X_REDIRECT_URI);
    url.searchParams.set('scope','tweet.read tweet.write users.read offline.access');
    url.searchParams.set('state',state);
    url.searchParams.set('code_challenge',challenge);
    url.searchParams.set('code_challenge_method','S256');
    return send(res,200,{success:true,authorizeUrl:url.toString()});
  } catch (e) {
    console.error('X bot start:',e.message);
    return send(res,500,{success:false,error:'Could not start X authorization.'});
  }
};