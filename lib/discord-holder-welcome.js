'use strict';

const { supabase, discordConfig } = require('./discord-auth');

const DASHBOARD_URL = 'https://obideft.github.io/froginals-prize-wheel-/';

async function discordRequest(path, method, body) {
  const config = discordConfig();
  const response = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: {
      Authorization: 'Bot ' + config.DISCORD_BOT_TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const error = new Error('Discord welcome delivery failed (' + response.status + ').');
    error.discordStatus = response.status;
    throw error;
  }
  return data;
}

async function deliverWelcome(discordUserId) {
  const config = discordConfig();
  const channelId = process.env.DISCORD_MISSION_BRIEFING_CHANNEL_ID || '';
  const briefing = channelId
    ? '<#' + channelId + '> — open your first mission briefing: https://discord.com/channels/' + config.DISCORD_GUILD_ID + '/' + channelId
    : '#mission-briefing';
  const content = [
    '🐸 **WELCOME TO THE FROGINALS, HOLDER!**',
    '',
    'Your FROGINAL DOG ownership has been verified and the **🐸 FROGINAL HOLDER** role is yours.',
    '',
    '**1. MISSION BRIEFING**',
    'Head to ' + briefing + ' to meet the community and get your first instructions.',
    '',
    '**2. THE FROGINALS COMMUNITY MISSION**',
    'Join the army, take part in community missions, and help build the FROGINALS universe.',
    '',
    '**3. OG REWARDS — 50 RECRUITMENT BADGES**',
    'Open the OG Rewards dashboard and work toward collecting all 50 unique Recruitment Badges:',
    DASHBOARD_URL,
    '',
    '**ONE SWAMP. ONE ARMY. ONE MISSION.** 🐸🔥'
  ].join('\n');

  const dm = await discordRequest('/users/@me/channels', 'POST', { recipient_id: discordUserId });
  if (!dm?.id) throw new Error('Discord did not return a DM channel.');
  await discordRequest('/channels/' + encodeURIComponent(dm.id) + '/messages', 'POST', {
    content,
    allowed_mentions: { parse: [] }
  });
}

async function sendFirstTimeWelcome(discordUserId, details) {
  const base = 'froginalarmy_discord_welcomes';
  const filter = '?discord_user_id=eq.' + encodeURIComponent(discordUserId);
  const record = {
    discord_user_id: discordUserId,
    status: 'pending',
    chain: details.chain,
    wallet_address: details.wallet_address,
    updated_at: new Date().toISOString()
  };

  let rows = await supabase(base + '?on_conflict=discord_user_id', 'POST', record,
    'resolution=ignore-duplicates,return=representation');

  if (!Array.isArray(rows) || rows.length === 0) {
    const prior = await supabase(base + '?select=status' + filter, 'GET');
    const status = Array.isArray(prior) ? prior[0]?.status : null;
    if (status === 'sent') return { sent: false, already_sent: true };
    if (status !== 'failed') return { sent: false, pending: true };
    rows = await supabase(base + filter + '&status=eq.failed', 'PATCH', {
      status: 'pending', chain: details.chain, wallet_address: details.wallet_address,
      last_error: null, updated_at: new Date().toISOString()
    });
    if (!Array.isArray(rows) || rows.length === 0) return { sent: false, pending: true };
  }

  try {
    await deliverWelcome(discordUserId);
    await supabase(base + filter, 'PATCH', {
      status: 'sent', sent_at: new Date().toISOString(), last_error: null,
      updated_at: new Date().toISOString()
    });
    return { sent: true };
  } catch (error) {
    await supabase(base + filter, 'PATCH', {
      status: 'failed', last_error: String(error.message || 'Discord delivery failed').slice(0, 240),
      updated_at: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = { sendFirstTimeWelcome };
