'use strict';
const crypto = require('crypto');
const COOKIE_SECURE = '; Secure';
function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}
function secret() {
  const value = process.env.DISCORD_SESSION_SECRET || '';
  if (value.length < 32) throw new Error('DISCORD_SESSION_SECRET must be at least 32 characters.');
  return value;
}
function b64url(value) {
  return Buffer.from(value).toString('base64url');
}
function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}
function pack(payload) {
  const encoded = b64url(JSON.stringify(payload));
  return encoded + '.' + sign(encoded);
}
function unpack(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(sign(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setCookie(res, name, value, maxAge) {
  const cookie = name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + COOKIE_SECURE;
  const old = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', old ? [].concat(old, cookie) : cookie);
}
function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}
function session(req) {
  const payload = unpack(cookies(req).froginal_discord_session);
  return payload && typeof payload.discordUserId === 'string' ? payload : null;
}
function isSolanaPublicKey(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of value) { const d = alphabet.indexOf(ch); if (d < 0) return false; n = n * 58n + BigInt(d); }
  let bytes = 0;
  while (n > 0n) { n >>= 8n; bytes++; }
  for (const ch of value) { if (ch !== '1') break; bytes++; }
  return bytes === 32;
}
function decodeBase58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of value) { const d = alphabet.indexOf(ch); if (d < 0) throw new Error('Invalid base58'); n = n * 58n + BigInt(d); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of value) { if (ch !== '1') break; bytes.unshift(0); }
  return Buffer.from(bytes);
}
function verifyWalletSignature(wallet, message, signatureBase64) {
  try {
    const pub = decodeBase58(wallet);
    const sig = Buffer.from(signatureBase64, 'base64');
    if (pub.length !== 32 || sig.length !== 64 || sig.toString('base64') !== signatureBase64) return false;
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const key = crypto.createPublicKey({ key: Buffer.concat([derPrefix, pub]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch { return false; }
}
async function heliusFindAsset(wallet) {
  const apiKey = process.env.HELIUS_API_KEY;
  const collection = process.env.FROGINAL_COLLECTION_ADDRESS || 'DEADY34TucemEebp6PJwmggAGDUmpSMoS4CcESKNBPRh';
  if (!apiKey) throw new Error('HELIUS_API_KEY is not configured.');
  for (let page = 1; page <= 10; page++) {
    const response = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'froginal-discord-verify', method: 'getAssetsByOwner',
        params: { ownerAddress: wallet, page, limit: 1000, displayOptions: { showFungible: false, showUnverifiedCollections: true, showCollectionMetadata: true } } }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Helius request failed.');
    const payload = await response.json();
    if (payload.error || !payload.result) throw new Error('Helius DAS response failed.');
    const result = payload.result;
    const items = Array.isArray(result.items) ? result.items : (Array.isArray(result) ? result : null);
    if (!items) throw new Error('Unexpected Helius DAS response.');
    const asset = items.find(a => a && a.burnt !== true && a.ownership?.owner === wallet &&
      Array.isArray(a.grouping) && a.grouping.some(g => g?.group_key === 'collection' && g.group_value === collection && g.verified === true));
    if (asset) return asset;
    if (items.length < 1000 || (Number.isFinite(result.total) && page * 1000 >= result.total)) return null;
  }
  throw new Error('Asset scan limit reached; retry later.');
}
async function supabase(path, method, body) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase server configuration is missing.');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      Accept: 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) { const error = new Error('Supabase request failed with HTTP ' + response.status); error.status = response.status; throw error; }
  return data;
}
function discordConfig() {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_HOLDER_ROLE_ID } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_HOLDER_ROLE_ID) throw new Error('Discord environment variables are incomplete.');
  return { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_HOLDER_ROLE_ID };
}
async function grantRole(discordUserId) {
  const c = discordConfig();
  const response = await fetch('https://discord.com/api/v10/guilds/' + encodeURIComponent(c.DISCORD_GUILD_ID) +
    '/members/' + encodeURIComponent(discordUserId) + '/roles/' + encodeURIComponent(c.DISCORD_HOLDER_ROLE_ID), {
      method: 'PUT', headers: { Authorization: 'Bot ' + c.DISCORD_BOT_TOKEN },
      signal: AbortSignal.timeout(12000)
    });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error('Discord role assignment failed (' + response.status + ').');
    error.discordStatus = response.status;
    error.detail = detail.slice(0, 300);
    throw error;
  }
}
module.exports = { send, pack, unpack, cookies, setCookie, clearCookie, session, isSolanaPublicKey,
  verifyWalletSignature, heliusFindAsset, supabase, discordConfig, grantRole };
