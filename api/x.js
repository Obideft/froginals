'use strict';
const crypto = require('crypto');
const { send, cookies, unpack, pack, setCookie, clearCookie, session, supabase } = require('../lib/discord-auth');

const BASE = '/froginalarmy.html';

async function start(req, res) {
  const current = session(req);
  if (!current) return res.redirect(302, BASE + '?x_error=discord_required#join-army');
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI;
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
}

async function callback(req, res) {
  const q = req.query || {};
  const saved = unpack(cookies(req).froginal_x_oauth);
  clearCookie(res, 'froginal_x_oauth');
  if (q.error || !q.code || !q.state || !saved || saved.state !== q.state) {
    return res.redirect(302, BASE + '?x_error=cancelled#join-army');
  }
  const current = session(req);
  if (!current || current.discordUserId !== saved.discordUserId) {
    return res.redirect(302, BASE + '?x_error=discord_required#join-army');
  }
  try {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    const redirectUri = process.env.X_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) throw new Error('X OAuth configuration is incomplete.');

    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + basic, 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: redirectUri, code_verifier: saved.verifier }),
      signal: AbortSignal.timeout(12000)
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error('X token exchange failed.');

    const userResponse = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,name,username', {
      headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    const profile = await userResponse.json();
    const user = profile && profile.data;
    if (!userResponse.ok || !user || !/^[0-9]{1,30}$/.test(String(user.id || '')) || !/^[A-Za-z0-9_]{1,15}$/.test(String(user.username || ''))) {
      throw new Error('X profile lookup failed.');
    }

    const existingX = await supabase('froginalarmy_discord_links?select=discord_user_id&x_user_id=eq.' + encodeURIComponent(String(user.id)) + '&limit=1', 'GET');
    if (Array.isArray(existingX) && existingX.some(row => row.discord_user_id !== current.discordUserId)) {
      return res.redirect(302, BASE + '?x_error=already_linked#join-army');
    }
    const memberRows = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
    if (!Array.isArray(memberRows) || !memberRows.length || !memberRows[0].wallet_address) {
      return res.redirect(302, BASE + '?x_error=holder_required#join-army');
    }
    await supabase('froginalarmy_discord_links?discord_user_id=eq.' + encodeURIComponent(current.discordUserId), 'PATCH', {
      x_user_id: String(user.id), x_username: String(user.username), x_connected_at: new Date().toISOString()
    });
    return res.redirect(302, BASE + '?x_connected=1#join-army');
  } catch (error) {
    console.error('X OAuth callback:', error.message);
    return res.redirect(302, BASE + '?x_error=setup#join-army');
  }
}

async function status(req, res) {
  const current = session(req);
  if (!current) return send(res, 200, { success: true, connected: false, discordConnected: false });
  try {
    const rows = await supabase('froginalarmy_discord_links?select=wallet_address,x_username,x_connected_at&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
    const row = Array.isArray(rows) ? rows[0] : null;
    return send(res, 200, { success: true, connected: !!(row && row.x_username), discordConnected: true, username: row && row.x_username || null, connectedAt: row && row.x_connected_at || null, verified: !!(row && row.wallet_address) });
  } catch (error) {
    console.error('X status:', error.message);
    return send(res, 503, { success: false, error: 'Could not load X connection status. Apply the X profile migration and redeploy.' });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  if (req.query && req.query.code !== undefined) return callback(req, res);
  if ((req.query && req.query.action) === 'start') return start(req, res);
  return status(req, res);
};
