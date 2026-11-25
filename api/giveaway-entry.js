'use strict';

const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const prior = attempts.get(ip);
  if (!prior || now - prior.start >= WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 });
    return false;
  }
  prior.count += 1;
  return prior.count > MAX_ATTEMPTS;
}

function normalizeAnswer(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { success: false, error: 'Method not allowed.' });
  }
  if (rateLimited(req)) return send(res, 429, { success: false, error: 'Too many attempts. Please wait a minute and try again.' });

  const wallet = typeof req.body?.wallet_address === 'string' ? req.body.wallet_address.trim() : '';
  const rawHandle = typeof req.body?.x_username === 'string' ? req.body.x_username.trim() : '';
  const handle = rawHandle.replace(/^@/, '');
  const answer = typeof req.body?.quiz_answer === 'string' ? req.body.quiz_answer.trim() : '';

  if (!/^[DA][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(wallet)) {
    return send(res, 400, { success: false, error: 'Enter a valid Dogecoin mainnet receiving address.' });
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return send(res, 400, { success: false, error: 'Enter a valid X username (up to 15 letters, numbers or underscores).' });
  }
  if (!answer || answer.length > 180) {
    return send(res, 400, { success: false, error: 'Please answer the video question.' });
  }

  const normalized = normalizeAnswer(answer);
  if (!normalized.includes('stuffed animal')) {
    return send(res, 400, { success: false, error: 'That answer is not quite right. Rewatch the episode and try again.' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 503, { success: false, error: 'Giveaway entries are not configured yet. Please try again later.' });
  }

  try {
    const endpoint = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/froginal_dogs_giveaway_entries';
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
    if (response.status === 409 || response.status === 23505) {
      return send(res, 409, { success: false, error: 'An entry already exists for this wallet or X username.' });
    }
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 400 && /duplicate|unique/i.test(body)) {
        return send(res, 409, { success: false, error: 'An entry already exists for this wallet or X username.' });
      }
      console.error('FROGINAL DOGS giveaway insert failed:', response.status, body.slice(0, 400));
      return send(res, 502, { success: false, error: 'The entry service is temporarily unavailable. Please try again.' });
    }
    return send(res, 201, { success: true });
  } catch (error) {
    console.error('FROGINAL DOGS giveaway error:', error.message);
    return send(res, 502, { success: false, error: 'The entry service is temporarily unavailable. Please try again.' });
  }
};
