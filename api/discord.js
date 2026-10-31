'use strict';
const crypto = require('crypto');
const {
  send, session, cookies, unpack, setCookie, clearCookie, pack,
  isSolanaPublicKey, verifyWalletSignature, heliusFindAsset, supabase, grantRole
} = require('../lib/discord-auth');
const { normalizeEvmAddress, verifyEvmWalletSignature, findRobinhoodFroginal } = require('../lib/evm-auth');
const { sendFirstTimeWelcome } = require('../lib/discord-holder-welcome');
const welcomeHandler = require('../lib/welcome');

function imageOf(asset) {
  const candidates = [asset?.content?.links?.image, ...(Array.isArray(asset?.content?.files) ? asset.content.files.map(f => f?.uri) : [])];
  for (const value of candidates) {
    try { const url = new URL(value); if (url.protocol === 'https:') return url.href; } catch {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'welcome-challenge' || action === 'welcome-claim') return welcomeHandler(req, res, action);
  if (action === 'status') {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 200, { success: true, connected: false });
    try {
      const rows = await supabase('froginalarmy_discord_links?select=wallet_address,nft_name,discord_user_id,chain,nft_contract&discord_user_id=eq.' + encodeURIComponent(current.discordUserId) + '&limit=1', 'GET');
      const row = Array.isArray(rows) ? rows[0] : null;
      return send(res, 200, { success: true, connected: true, username: current.username || 'Discord member', verified: !!row, wallet_address: row?.wallet_address || null, nft_name: row?.nft_name || null, chain: row?.chain || 'solana', nft_contract: row?.nft_contract || null });
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
      let welcome = { sent: false, already_sent: false };
      try {
        welcome = await sendFirstTimeWelcome(current.discordUserId, { chain: 'solana', wallet_address: wallet });
      } catch (error) {
        console.error('Discord holder welcome failed:', error.message);
        welcome = { sent: false, failed: true };
      }
      return send(res, 200, { success: true, verified: true, username: current.username || 'Discord member', wallet_address: wallet, chain: 'solana', nft_name: record.nft_name, welcome, message: 'NFT ownership verified and the FROGINAL HOLDER role was assigned.' });
    } catch (error) {
      console.error('Discord NFT verification failed:', error.message);
      return send(res, 502, { success: false, error: 'Verification service temporarily unavailable. No successful role assignment was confirmed. Please try again.' });
    }
  }


  if (action === 'evm-challenge') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 401, { success: false, error: 'Connect Discord first.' });
    const wallet = normalizeEvmAddress(req.body?.wallet_address);
    if (!wallet) return send(res, 400, { success: false, error: 'Enter a valid EVM wallet address.' });
    try {
      const linked = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.' + encodeURIComponent(current.discordUserId) + ',wallet_address.eq.' + encodeURIComponent(wallet) + ')', 'GET');
      if (Array.isArray(linked) && linked.some(row => row.discord_user_id !== current.discordUserId || String(row.wallet_address).toLowerCase() !== wallet))
        return send(res, 409, { success: false, error: 'This Discord account or wallet is already linked to a different member. Contact an administrator if you need help.' });
      const nonce = crypto.randomBytes(24).toString('base64url');
      const issued = Date.now();
      const message = [
        'FROGINALS ARMY — ROBINHOOD CHAIN HOLDER VERIFICATION', '',
        'Discord user ID: ' + current.discordUserId,
        'Robinhood Chain ID: 4663',
        'EVM wallet: ' + wallet,
        'Nonce: ' + nonce,
        'Issued at: ' + new Date(issued).toISOString(),
        'Expires at: ' + new Date(issued + 5 * 60 * 1000).toISOString(),
        'Purpose: Prove wallet control and verify current FROGINAL DOGS ERC-721 ownership.',
        'This signature does not authorize a transaction.'
      ].join('\n');
      setCookie(res, 'froginal_evm_challenge', pack({ discordUserId: current.discordUserId, wallet, nonce, message, chain: 'robinhood', exp: issued + 5 * 60 * 1000 }), 300);
      return send(res, 200, { success: true, wallet, message, chain_id: 4663, expires_in: 300 });
    } catch (error) {
      console.error('Robinhood wallet challenge:', error.message);
      return send(res, 503, { success: false, error: 'Could not prepare Robinhood Chain verification. Please try again.' });
    }
  }

  if (action === 'evm-verify') {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
    const current = session(req);
    if (!current) return send(res, 401, { success: false, error: 'Your Discord session expired. Connect Discord again.' });
    const wallet = normalizeEvmAddress(req.body?.wallet_address);
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : '';
    const challenge = unpack(cookies(req).froginal_evm_challenge);
    clearCookie(res, 'froginal_evm_challenge');
    if (!wallet || !challenge || challenge.discordUserId !== current.discordUserId || challenge.wallet !== wallet || challenge.chain !== 'robinhood' || typeof challenge.message !== 'string')
      return send(res, 400, { success: false, error: 'Robinhood verification request expired or changed. Start again.' });
    if (!verifyEvmWalletSignature(wallet, challenge.message, signature))
      return send(res, 403, { success: false, error: 'EVM wallet signature could not be verified. No role was assigned.' });
    try {
      const existing = await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.' + encodeURIComponent(current.discordUserId) + ',wallet_address.eq.' + encodeURIComponent(wallet) + ')', 'GET');
      if (Array.isArray(existing) && existing.some(row => row.discord_user_id !== current.discordUserId || String(row.wallet_address).toLowerCase() !== wallet))
        return send(res, 409, { success: false, error: 'This Discord account or wallet is already linked to a different member. Contact an administrator.' });

      const holder = await findRobinhoodFroginal(wallet);
      if (!holder) return send(res, 403, { success: false, error: 'No FROGINAL DOGS NFT from the configured official Robinhood Chain collection is currently owned by this wallet. No role was assigned.' });
      const now = new Date().toISOString();
      const record = {
        discord_user_id: current.discordUserId,
        wallet_address: wallet,
        chain: 'robinhood',
        nft_contract: holder.contract_address,
        nft_balance: holder.balance,
        nft_mint: 'robinhood:4663:' + holder.contract_address + ':' + wallet,
        nft_name: 'FROGINAL DOGS',
        nft_image_url: null,
        verified_at: now,
        last_checked_at: now
      };
      await supabase('froginalarmy_discord_links?on_conflict=discord_user_id', 'POST', record);
      try {
        await grantRole(current.discordUserId);
      } catch (error) {
        console.error('Discord role assignment failed:', error.message, error.discordStatus || '');
        if (error.discordStatus === 404) return send(res, 502, { success: false, error: 'NFT verified, but the Discord role could not be assigned. Join the FROGINALS server and try again.' });
        return send(res, 502, { success: false, error: 'NFT verified, but Discord could not assign the holder role. Check bot permissions and role order.' });
      }
      let welcome = { sent: false, already_sent: false };
      try {
        welcome = await sendFirstTimeWelcome(current.discordUserId, { chain: 'robinhood', wallet_address: wallet });
      } catch (error) {
        console.error('Discord holder welcome failed:', error.message);
        welcome = { sent: false, failed: true };
      }
      return send(res, 200, {
        success: true, verified: true, chain: 'robinhood',
        username: current.username || 'Discord member',
        wallet_address: wallet, nft_name: record.nft_name,
        nft_balance: holder.balance, welcome,
        message: 'Robinhood Chain NFT ownership verified and the FROGINAL HOLDER role was assigned.'
      });
    } catch (error) {
      console.error('Robinhood NFT verification failed:', error.message);
      return send(res, 502, { success: false, error: 'Robinhood Chain ownership verification is temporarily unavailable. No successful role assignment was confirmed.' });
    }
  }

  return send(res, 404, { success: false, error: 'Unknown Discord action.' });
};
