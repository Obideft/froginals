'use strict';
const { send, cookies, unpack, clearCookie, session, supabase } = require('../lib/discord-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  const base = '/froginalarmy.html';
  const q = req.query || {};
  const saved = unpack(cookies(req).froginal_x_oauth);
  clearCookie(res, 'froginal_x_oauth');
  if (q.error || !q.code || !q.state || !saved || saved.state !== q.state) {
    return res.redirect(302, base + '?x_error=cancelled#join-army');
  }
  const current = session(req);
  if (!current || current.discordUserId !== saved.discordUserId) {
    return res.redirect(302, base + '?x_error=discord_required#join-army');
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
      return res.redirect(302, base + '?x_error=already_linked#join-army');
    }
    const memberRows = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
    if (!Array.isArray(memberRows) || !memberRows.length || !memberRows[0].wallet_address) {
      return res.redirect(302, base + '?x_error=holder_required#join-army');
    }
    await supabase('froginalarmy_discord_links?discord_user_id=eq.' + encodeURIComponent(current.discordUserId), 'PATCH', {
      x_user_id: String(user.id),
      x_username: String(user.username),
      x_connected_at: new Date().toISOString()
    });
    return res.redirect(302, base + '?x_connected=1#join-army');
  } catch (error) {
    console.error('X OAuth callback:', error.message);
    return res.redirect(302, base + '?x_error=setup#join-army');
  }
};
