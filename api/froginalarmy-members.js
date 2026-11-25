'use strict';

const giveawayAttempts = new Map();
const GIVEAWAY_WINDOW_MS = 60_000;
const GIVEAWAY_MAX_ATTEMPTS = 5;

function giveawayRateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const prior = giveawayAttempts.get(ip);
  if (!prior || now - prior.start >= GIVEAWAY_WINDOW_MS) {
    giveawayAttempts.set(ip, { start: now, count: 1 });
    return false;
  }
  prior.count += 1;
  return prior.count > GIVEAWAY_MAX_ATTEMPTS;
}

function normalizeGiveawayAnswer(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function submitGiveawayEntry(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  if (giveawayRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Please wait a minute and try again.' });
  }

  const wallet = typeof req.body?.wallet_address === 'string' ? req.body.wallet_address.trim() : '';
  const rawHandle = typeof req.body?.x_username === 'string' ? req.body.x_username.trim() : '';
  const handle = rawHandle.replace(/^@/, '');
  const answer = typeof req.body?.quiz_answer === 'string' ? req.body.quiz_answer.trim() : '';

  if (!/^[D9][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(wallet)) {
    return res.status(400).json({ success: false, error: 'Enter a valid Dogecoin mainnet receiving address.' });
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return res.status(400).json({ success: false, error: 'Enter a valid X username (up to 15 letters, numbers or underscores).' });
  }
  if (!answer || answer.length > 180) {
    return res.status(400).json({ success: false, error: 'Please answer the video question.' });
  }
  if (!normalizeGiveawayAnswer(answer).includes('stuffed animal')) {
    return res.status(400).json({ success: false, error: 'That answer is not quite right. Rewatch the episode and try again.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ success: false, error: 'Giveaway entries are not configured yet. Please try again later.' });
  }

  try {
    const endpoint = process.env.SUPABASE_URL.replace(/\\/$/, '') + '/rest/v1/froginal_dogs_giveaway_entries';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        wallet_address: wallet,
        x_username: handle,
        quiz_answer: answer.slice(0, 180)
      })
    });
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 409 || (response.status === 400 && /duplicate|unique/i.test(body))) {
        return res.status(409).json({ success: false, error: 'An entry already exists for this wallet or X username.' });
      }
      console.error('FROGINAL DOGS giveaway insert failed:', response.status, body.slice(0, 400));
      return res.status(502).json({ success: false, error: 'The entry service is temporarily unavailable. Please try again.' });
    }
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('FROGINAL DOGS giveaway error:', error.message);
    return res.status(502).json({ success: false, error: 'The entry service is temporarily unavailable. Please try again.' });
  }
}

module.exports = async function handler(req, res) {
  if (req.query?.action === 'giveaway-entry') return submitGiveawayEntry(req, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'Method not allowed.' }); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ success: false, error: 'Member directory is not configured.' });
  try {
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/froginalarmy_members?select=wallet_address,nft_mint,nft_name,nft_image_url,verified_at,last_checked_at&approved=eq.true&order=verified_at.desc&limit=500`;
    const response = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected Supabase response');
    const members = rows.filter(m => m && m.approved !== false && typeof m.wallet_address === 'string').map(m => ({
      wallet_address: m.wallet_address,
      nft_mint: m.nft_mint,
      nft_name: typeof m.nft_name === 'string' ? m.nft_name : 'FROGINAL DOGS',
      nft_image_url: typeof m.nft_image_url === 'string' && /^https:\/\//i.test(m.nft_image_url) ? m.nft_image_url : null,
      verified_at: m.verified_at,
      last_checked_at: m.last_checked_at
    }));
    return res.status(200).json({ success: true, count: members.length, members });
  } catch (error) {
    console.error('FROGINALARMY directory failed:', error.message);
    return res.status(502).json({ success: false, error: 'The shared member directory is temporarily unavailable.' });
  }
};
