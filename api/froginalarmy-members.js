'use strict';
module.exports = async function handler(req, res) {
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
