'use strict';

// Read-only eligibility check for SWAMP SPIN.
// This endpoint verifies current ownership of a verified FROGINAL DOGS NFT.
// It does not write to Supabase, approve membership, or mint a badge.

const COLLECTION_ADDRESS = process.env.FROGINAL_COLLECTION_ADDRESS || 'DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh';
const ALLOWED_ORIGINS = new Set([
  'https://obideft.github.io',
  'https://froginals-nu.vercel.app'
]);
const MAX_PAGES = 10;
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 12000;
const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
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
  return typeof value === 'string' && value.length >= 32 &&
    value.length <= 44 && decodeBase58Length(value) === 32;
}

function rateLimit(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const now = Date.now();
  const old = attempts.get(key);
  if (!old || now - old.start >= WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return false;
  }
  old.count += 1;
  return old.count > MAX_ATTEMPTS;
}

async function heliusRpc(apiKey, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'swamp-spin-eligibility', method, params }),
        signal: controller.signal
      }
    );
    if (!response.ok) throw new Error(`Helius HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error || !payload.result) throw new Error('Helius returned an unsuccessful DAS response');
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

function isVerifiedCollectionAsset(asset, wallet) {
  const groups = Array.isArray(asset?.grouping) ? asset.grouping : [];
  const collection = groups.find(group => group?.group_key === 'collection');
  return asset && asset.burnt !== true &&
    asset.ownership?.owner === wallet &&
    collection?.group_value === COLLECTION_ADDRESS &&
    collection?.verified === true;
}

async function findEligibleAsset(apiKey, wallet) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await heliusRpc(apiKey, 'getAssetsByOwner', {
      ownerAddress: wallet,
      page,
      limit: PAGE_SIZE,
      displayOptions: {
        showFungible: false,
        showUnverifiedCollections: true,
        showCollectionMetadata: true
      }
    });
    const items = Array.isArray(result.items)
      ? result.items
      : (Array.isArray(result) ? result : null);
    if (!items) throw new Error('Unexpected Helius DAS response shape');
    const asset = items.find(item => isVerifiedCollectionAsset(item, wallet));
    if (asset) return asset;
    if (items.length < PAGE_SIZE ||
      (Number.isFinite(result.total) && page * PAGE_SIZE >= result.total)) return null;
  }
  throw new Error('Wallet asset pagination limit reached; eligibility result is incomplete');
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return send(res, 403, { success: false, eligible: false, error: 'Origin not allowed.' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { success: false, eligible: false, error: 'Method not allowed.' });
  }
  if (rateLimit(req)) {
    return send(res, 429, {
      success: false,
      eligible: false,
      error: 'Too many eligibility checks. Please wait a minute and try again.'
    });
  }

  const wallet = typeof req.body?.wallet_address === 'string'
    ? req.body.wallet_address.trim()
    : '';
  if (!isSolanaPublicKey(wallet)) {
    return send(res, 400, {
      success: false,
      eligible: false,
      error: 'Enter a valid Solana public wallet address.'
    });
  }
  if (!process.env.HELIUS_API_KEY) {
    return send(res, 503, {
      success: false,
      eligible: false,
      error: 'Eligibility verification is not configured. No approval or mint was made.'
    });
  }

  try {
    const asset = await findEligibleAsset(process.env.HELIUS_API_KEY, wallet);
    if (!asset) {
      return send(res, 200, {
        success: true,
        eligible: false,
        message: 'No currently owned NFT from the verified FROGINAL DOGS collection was found.'
      });
    }
    return send(res, 200, {
      success: true,
      eligible: true,
      wallet_address: wallet,
      nft_mint: asset.id,
      nft_name: String(asset.content?.metadata?.name || asset.content?.metadata?.symbol || 'FROGINAL DOGS').slice(0, 160),
      nft_image_url: (() => {
        const raw = asset.content?.links?.image ||
          asset.content?.files?.find(file => file?.mime?.startsWith('image/'))?.uri ||
          asset.content?.metadata?.image;
        try {
          const url = new URL(raw);
          return url.protocol === 'https:' ? url.href : null;
        } catch {
          return null;
        }
      })()
    });
  } catch (error) {
    console.error('SWAMP SPIN eligibility check failed:', error.message);
    return send(res, 502, {
      success: false,
      eligible: false,
      error: 'Ownership verification is temporarily unavailable. No approval or mint was made.'
    });
  }
};
