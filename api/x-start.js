'use strict';
const crypto = require('crypto');
const { send, session, pack, setCookie } = require('../lib/discord-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  const current = session(req);
  if (!current) return res.redirect(302, '/froginalarmy.html?x_error=discord_required#join-army');
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const missing = [];
  if (!clientId) missing.push('X_CLIENT_ID');
  if (!clientSecret) missing.push('X_CLIENT_SECRET');
  if (!redirectUri) missing.push('X_REDIRECT_URI');
  if (missing.length) return send(res, 503, { success: false, error: 'Missing X environment variable(s): ' + missing.join(', ') + '. Check Vercel Environment Variables and redeploy.' });

  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  setCookie(res, 'froginal_x_oauth', pack({ state, verifier, discordUserId: current.discordUserId, exp: Date.now() + 10 * 60 * 1000 }), 600);
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'users.read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return res.redirect(302, url.toString());
};
