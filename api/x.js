'use strict';
const { send, session, supabase } = require('../lib/discord-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  const current = session(req);
  if (!current) return send(res, 200, { success: true, connected: false, discordConnected: false });
  try {
    const rows = await supabase('froginalarmy_discord_links?select=wallet_address,x_username,x_connected_at&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
    const row = Array.isArray(rows) ? rows[0] : null;
    return send(res, 200, { success: true, connected: !!row?.x_username, discordConnected: true, username: row?.x_username || null, connectedAt: row?.x_connected_at || null, verified: !!row?.wallet_address });
  } catch (error) {
    console.error('X status:', error.message);
    return send(res, 503, { success: false, error: 'Could not load X connection status. Apply the X profile migration and redeploy.' });
  }
};
