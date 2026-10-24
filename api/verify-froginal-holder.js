'use strict';

const COLLECTION_ADDRESS = process.env.FROGINAL_COLLECTION_ADDRESS || 'DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh';
const MAX_PAGES = 10;
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 12000;

// Per-instance throttle: useful as a small guard, but use an edge/WAF or shared
// rate-limit service for a strict production limit across serverless instances.
const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
function decodeBase58Length(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of value) {
    const digit = alphabet.indexOf(ch);
    if (digit < 0) return -1;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n > 0n) { n >>= 8n; bytes++; }
  for (const ch of value) { if (ch !== '1') break; bytes++; }
  return bytes;
}
function isSolanaPublicKey(value) {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && decodeBase58Length(value) === 32;
}
function rateLimit(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now(); const old = attempts.get(key);
  if (!old || now - old.start >= WINDOW_MS) { attempts.set(key, { start: now, count: 1 }); return false; }
  old.count += 1; return old.count > MAX_ATTEMPTS;
}
async function heliusRpc(apiKey, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'froginalarmy-verify', method, params }), signal: controller.signal
    });
    if (!response.ok) throw new Error(`Helius HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error || !payload.result) throw new Error('Helius returned an unsuccessful DAS response');
    return payload.result;
  } finally { clearTimeout(timer); }
}
function collectionGrouping(asset) {
  return Array.isArray(asset?.grouping) ? asset.grouping.find(g => g?.group_key === 'collection') : null;
}
function httpsImage(asset) {
  const candidates = [];
  if (asset?.content?.links?.image) candidates.push(asset.content.links.image);
  if (Array.isArray(asset?.content?.files)) {
    for (const file of asset.content.files) if (file?.mime?.startsWith('image/') && file.uri) candidates.push(file.uri);
    for (const file of asset.content.files) if (file?.uri) candidates.push(file.uri);
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try { const u = new URL(candidate); if (u.protocol === 'https:') return u.href; } catch {}
  }
  return null;
}
function eligibleAsset(asset, wallet) {
  const group = collectionGrouping(asset);
  return asset && asset.burnt !== true && asset.ownership?.owner === wallet &&
    group && group.group_value === COLLECTION_ADDRESS && group.verified === true;
}
async function findVerifiedAsset(apiKey, wallet) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await heliusRpc(apiKey, 'getAssetsByOwner', {
      ownerAddress: wallet, page, limit: PAGE_SIZE,
      displayOptions: { showFungible: false, showUnverifiedCollections: true, showCollectionMetadata: true }
    });
    const items = Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : null);
    if (!items) throw new Error('Unexpected Helius DAS response shape');
    const found = items.find(asset => eligibleAsset(asset, wallet));
    if (found) return found;
    if (items.length < PAGE_SIZE || (Number.isFinite(result.total) && page * PAGE_SIZE >= result.total)) return null;
  }
  // A wallet with an unusually large number of assets must not be rejected on
  // an incomplete scan, because that could misrepresent the verification result.
  throw new Error('Wallet asset pagination limit reached; retry or increase the configured scan limit');
}
async function supabaseRequest(path, method, body) {
  const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const response = await fetch(url, {
    method, headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'resolution=merge-duplicates,return=representation'
    }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) { const err = new Error(`Supabase HTTP ${response.status}`); err.status = response.status; throw err; }
  return data;
}
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { success: false, error: 'Method not allowed.' }); }
  if (rateLimit(req)) return send(res, 429, { success: false, error: 'Too many verification attempts. Please wait a minute and try again.' });
  const wallet = typeof req.body?.wallet_address === 'string' ? req.body.wallet_address.trim() : '';
  if (!isSolanaPublicKey(wallet)) return send(res, 400, { success: false, error: 'Enter a valid Solana public wallet address.' });
  if (!process.env.HELIUS_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 503, { success: false, error: 'Membership verification is not configured yet. No approval was made.' });
  }
  try {
    const asset = await findVerifiedAsset(process.env.HELIUS_API_KEY, wallet);
    if (!asset) return send(res, 403, { success: false, error: 'No currently owned NFT with verified membership in the official FROGINAL DOGS collection was found.' });
    const mint = asset.id;
    const record = {
      wallet_address: wallet, nft_mint: mint,
      nft_name: String(asset.content?.metadata?.name || asset.content?.metadata?.symbol || 'FROGINAL DOGS').slice(0, 160),
      nft_image_url: httpsImage(asset), approved: true,
      verified_at: new Date().toISOString(), last_checked_at: new Date().toISOString()
    };
    // Find any existing row for this wallet. A same-wallet/same-mint result is a repeat verification.
    const prior = await supabaseRequest(`froginalarmy_members?select=wallet_address,nft_mint&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`, 'GET');
    const alreadyMember = Array.isArray(prior) && prior.some(row => row.wallet_address === wallet && row.nft_mint === mint);
    // If this NFT was transferred, retire the old wallet's record only after the new owner
    // has been independently proven by DAS. The mint has a unique constraint in the SQL schema.
    await supabaseRequest(`froginalarmy_members?nft_mint=eq.${encodeURIComponent(mint)}&wallet_address=neq.${encodeURIComponent(wallet)}`, 'DELETE');
    // Upsert only after the current DAS response independently proves ownership.
    const saved = await supabaseRequest('froginalarmy_members?on_conflict=wallet_address', 'POST', record);
    return send(res, 200, { success: true, already_member: alreadyMember, member: saved?.[0] ? {
      wallet_address: saved[0].wallet_address, nft_name: saved[0].nft_name, nft_image_url: saved[0].nft_image_url
    } : { wallet_address: wallet, nft_name: record.nft_name, nft_image_url: record.nft_image_url } });
  } catch (error) {
    console.error('FROGINALARMY verification failed:', error.message);
    return send(res, 502, { success: false, error: 'Ownership verification is temporarily unavailable. No membership was approved; please try again.' });
  }
};
