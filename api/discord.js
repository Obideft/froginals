'use strict';
const crypto = require('crypto');
const {
  send, session, cookies, unpack, setCookie, clearCookie, pack,
  isSolanaPublicKey, verifyWalletSignature, heliusFindAsset, supabase, grantRole, discordConfig
} = require('../lib/discord-auth');
const welcomeHandler = require('../lib/welcome');

function imageOf(asset) {
  const candidates = [asset?.content?.links?.image, ...(Array.isArray(asset?.content?.files) ? asset.content.files.map(f => f?.uri) : [])];
  for (const value of candidates) {
    try { const url = new URL(value); if (url.protocol === 'https:') return url.href; } catch {}
  }
  return null;
}


async function discordStart(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  try {
    const id = process.env.DISCORD_CLIENT_ID;
    const redirect = process.env.DISCORD_REDIRECT_URI;
    const missing = [];
    if (!id) missing.push('DISCORD_CLIENT_ID');
    if (!redirect) missing.push('DISCORD_REDIRECT_URI');
    if (missing.length) return send(res, 503, { success: false, error: 'Missing Preview runtime environment variable(s): ' + missing.join(', ') + '. Check Vercel Environment Variables for the feature branch and redeploy.' });
    const state = crypto.randomBytes(32).toString('base64url');
    setCookie(res, 'froginal_discord_oauth_state', pack({ state, exp: Date.now() + 10 * 60 * 1000 }), 600);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    return res.redirect(302, url.toString());
  } catch (error) {
    console.error('Discord OAuth start:', error.message);
    return send(res, 503, { success: false, error: 'Discord sign-in is not configured. Please contact the site administrator.' });
  }
}

async function discordCallback(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  const base = '/froginalarmy.html';
  try {
    const q = req.query || {};
    const saved = unpack(cookies(req).froginal_discord_oauth_state);
    clearCookie(res, 'froginal_discord_oauth_state');
    if (q.error || !q.code || !q.state || !saved || saved.state !== q.state) {
      return res.redirect(302, base + '?discord_error=oauth_cancelled#join-army');
    }
    const cfg = discordConfig();
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        client_id: cfg.DISCORD_CLIENT_ID,
        client_secret: cfg.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(q.code),
        redirect_uri: cfg.DISCORD_REDIRECT_URI
      }),
      signal: AbortSignal.timeout(12000)
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) throw new Error('Discord OAuth token exchange failed.');
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    const user = await userRes.json();
    if (!userRes.ok || !/^[0-9]{17,20}$/.test(String(user.id || ''))) throw new Error('Discord identity lookup failed.');
    setCookie(res, 'froginal_discord_session', pack({
      discordUserId: String(user.id),
      username: String(user.global_name || user.username || 'Discord member').slice(0, 100),
      exp: Date.now() + 8 * 60 * 60 * 1000
    }), 8 * 60 * 60);
    return res.redirect(302, base + '?discord_connected=1#join-army');
  } catch (error) {
    console.error('Discord OAuth callback:', error.message);
    return res.redirect(302, base + '?discord_error=setup#join-army');
  }
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'start') return discordStart(req, res);
  if (action === 'callback') return discordCallback(req, res);
  if (action === 'welcome-challenge' || action === 'welcome-claim') return welcomeHandler(req, res, action);
  if (action === 'status') {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 200, { success: true, connected: false });
    try {
      const rows = await supabase('froginalarmy_discord_links?select=wallet_address,nft_name,discord_user_id&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
      const row = Array.isArray(rows) ? rows[0] : null;
      return send(res, 200, { success: true, connected: true, username: current.username || 'Discord member', verified: !!row, wallet_address: row?.wallet_address || null, nft_name: row?.nft_name || null });
    } catch (error) {
      console.error('Discord status:', error.message);
      return send(res, 503, { success: false, error: 'Could not load Discord verification status. Run the Supabase migration and try again.' });
    }
  }

  if (action === 'logout') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    clearCookie(res, 'froginal_discord_session');
    clearCookie(res, 'froginal_wallet_challenge');
    return send(res, 200, { success: true });
  }

  if (action === 'challenge') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 401, { success: false, error: 'Connect Discord first.' });
    const wallet = typeof req.body?.wallet_address === 'string' ? req.body.wallet_address.trim() : '';
    if (!isSolanaPublicKey(wallet)) return send(res, 400, { success: false, error: 'Enter a valid Solana wallet address.' });
    try {
      const linked = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.' + encodeURIComponent(current.discordUserId) + ',wallet_address.eq.' + encodeURIComponent(wallet) + ')', 'GET');
      if (Array.isArray(linked) && linked.some(row => row.discord_user_id !== current.discordUserId || row.wallet_address !== wallet))
        return send(res, 409, { success: false, error: 'This Discord account or wallet is already linked to a different member. Contact an administrator if you need help.' });
      const nonce = crypto.randomBytes(24).toString('base64url');
      const issued = Date.now();
      const message = [
        'FROGINALS ARMY — DISCORD HOLDER VERIFICATION', '',
        'Discord user ID: ' + current.discordUserId,
        'Solana wallet: ' + wallet,
        'Nonce: ' + nonce,
        'Issued at: ' + new Date(issued).toISOString(),
        'Expires at: ' + new Date(issued + 5 * 60 * 1000).toISOString(),
        'Purpose: Prove wallet control and verify current FROGINAL DOGS ownership.'
      ].join('\n');
      setCookie(res, 'froginal_wallet_challenge', pack({ discordUserId: current.discordUserId, wallet, nonce, message, exp: issued + 5 * 60 * 1000 }), 300);
      return send(res, 200, { success: true, wallet, message, expires_in: 300 });
    } catch (error) {
      console.error('Wallet challenge:', error.message);
      return send(res, 503, { success: false, error: 'Could not prepare verification. Please try again.' });
    }
  }

  if (action === 'verify') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 401, { success: false, error: 'Your Discord session expired. Connect Discord again.' });
    const wallet = typeof req.body?.wallet_address === 'string' ? req.body.wallet_address.trim() : '';
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : '';
    const challenge = unpack(cookies(req).froginal_wallet_challenge);
    clearCookie(res, 'froginal_wallet_challenge');
    if (!challenge || challenge.discordUserId !== current.discordUserId || challenge.wallet !== wallet || typeof challenge.message !== 'string')
      return send(res, 400, { success: false, error: 'Verification request expired or changed. Start verification again.' });
    if (!verifyWalletSignature(wallet, challenge.message, signature))
      return send(res, 403, { success: false, error: 'Wallet signature could not be verified. No role was assigned.' });
    try {
      const existing = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.' + encodeURIComponent(current.discordUserId) + ',wallet_address.eq.' + encodeURIComponent(wallet) + ')', 'GET');
      if (Array.isArray(existing) && existing.some(row => row.discord_user_id !== current.discordUserId || row.wallet_address !== wallet))
        return send(res, 409, { success: false, error: 'This Discord account or wallet is already linked to a different member. Contact an administrator.' });
      const asset = await heliusFindAsset(wallet);
      if (!asset) return send(res, 403, { success: false, error: 'No currently owned NFT from the official verified FROGINAL DOGS collection was found. No Discord role was assigned.' });
      const now = new Date().toISOString();
      const record = {
        discord_user_id: current.discordUserId,
        wallet_address: wallet,
        nft_mint: asset.id,
        nft_name: String(asset.content?.metadata?.name || asset.content?.metadata?.symbol || 'FROGINAL DOGS').slice(0, 160),
        nft_image_url: imageOf(asset),
        verified_at: now,
        last_checked_at: now
      };
      await supabase('froginalarmy_discord_links?on_conflict=discord_user_id', 'POST', record);
      try {
        await grantRole(current.discordUserId);
      } catch (error) {
        console.error('Discord role assignment failed:', error.message, error.discordStatus || '');
        if (error.discordStatus === 404) return send(res, 502, { success: false, error: 'NFT verified, but the Discord role could not be assigned. Make sure you joined the FROGINALS server and the bot is still in it, then try again.' });
        return send(res, 502, { success: false, error: 'NFT verified, but Discord could not assign the holder role. Check the bot permissions and role order, then retry verification.' });
      }
      return send(res, 200, { success: true, verified: true, username: current.username || 'Discord member', wallet_address: wallet, nft_name: record.nft_name, message: 'NFT ownership verified and the FROGINAL HOLDER role was assigned.' });
    } catch (error) {
      console.error('Discord NFT verification failed:', error.message);
      return send(res, 502, { success: false, error: 'Verification service temporarily unavailable. No successful role assignment was confirmed. Please try again.' });
    }
  }

  return send(res, 404, { success: false, error: 'Unknown Discord action.' });
};
