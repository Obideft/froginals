'use strict';
const crypto = require('crypto');
const { send, pack, unpack, cookies, setCookie, clearCookie, isSolanaPublicKey, verifyWalletSignature, heliusFindAsset, supabase } = require('../lib/discord-auth');

const attempts = new Map();
function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now(), old = attempts.get(ip);
  if (!old || now - old.start > 60000) { attempts.set(ip,{start:now,count:1}); return false; }
  old.count++; return old.count > 5;
}
function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function sendWelcome(email, name) {
  if (!process.env.RESEND_API_KEY || !process.env.WELCOME_FROM_EMAIL) throw new Error('Email delivery is not configured yet.');
  const discord = process.env.FROGINALS_DISCORD_INVITE || '';
  const dashboard = 'https://obideft.github.io/froginals-prize-wheel-/';
  const html = '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#171717;max-width:620px;margin:auto"><h1>🐸 Welcome to the FROGINAL DOGS SWAMP!</h1><p>Hey FROGINAL!</p><p>Your FROGINAL DOG has officially been verified. Welcome to the pack!</p><h2>1. 🐸 ENTER THE SWAMP — DISCORD</h2><p>Join the FROGINALS community, meet fellow holders, follow the missions and get involved.</p>' +
    (discord ? '<p><a href="' + discord + '">JOIN THE FROGINALS DISCORD</a></p>' : '<p>Find the official FROGINALS Discord invitation on our website.</p>') +
    '<h2>2. 🎖️ ENTER THE OG REWARDS DASHBOARD</h2><p>Complete community missions, collect unique Recruitment Badges and work toward the legendary 50-badge challenge.</p><p><a href="' + dashboard + '">ENTER THE OG REWARDS DASHBOARD</a></p><p>Your journey doesn’t end with the mint. It’s just getting started.</p><p><b>ONE SWAMP. ONE ARMY. ONE MISSION.</b><br>THE FROGINALS TEAM 🐸🔥</p></div>';
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.WELCOME_FROM_EMAIL,to:[email],subject:'🐸 Welcome to the FROGINAL DOGS SWAMP!',html}),
    signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) { const detail=await response.text(); throw new Error('Email provider rejected the message: '+detail.slice(0,240)); }
  return response.json();
}
module.exports = async function handler(req,res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(res,405,{success:false,error:'Method not allowed.'}); }
  if (limited(req)) return send(res,429,{success:false,error:'Too many attempts. Wait a minute and try again.'});
  const action=String(req.query?.action||'');
  if (action==='challenge') {
    const wallet=typeof req.body?.wallet_address==='string'?req.body.wallet_address.trim():'';
    if(!isSolanaPublicKey(wallet)) return send(res,400,{success:false,error:'Enter a valid Solana wallet address.'});
    try {
      const nonce=crypto.randomBytes(24).toString('base64url'), issued=Date.now();
      const message=['FROGINALS — HOLDER WELCOME VERIFICATION','','Solana wallet: '+wallet,'Nonce: '+nonce,'Issued at: '+new Date(issued).toISOString(),'Expires at: '+new Date(issued+5*60*1000).toISOString(),'Purpose: Prove wallet control and verify current ownership of an official FROGINAL DOG.','This signature does not authorize a transaction.'].join('\n');
      setCookie(res,'froginal_welcome_challenge',pack({wallet,message,exp:issued+5*60*1000}),300);
      return send(res,200,{success:true,message,expires_in:300});
    } catch(error) { return send(res,503,{success:false,error:'Secure verification is not configured. No approval was made.'}); }
  }
  if(action==='claim') {
    const wallet=typeof req.body?.wallet_address==='string'?req.body.wallet_address.trim():'';
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    const signature=typeof req.body?.signature==='string'?req.body.signature:'';
    const challenge=unpack(cookies(req).froginal_welcome_challenge);
    clearCookie(res,'froginal_welcome_challenge');
    if(!isSolanaPublicKey(wallet)||!validEmail(email)) return send(res,400,{success:false,error:'Enter a valid wallet and email address.'});
    if(!challenge||challenge.wallet!==wallet||!verifyWalletSignature(wallet,challenge.message,signature))
      return send(res,403,{success:false,error:'Wallet signature is invalid or expired. Start again.'});
    if(!process.env.HELIUS_API_KEY||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return send(res,503,{success:false,error:'Holder verification is not configured. No approval was made.'});
    try {
      const asset=await heliusFindAsset(wallet);
      if(!asset) return send(res,403,{success:false,error:'No currently owned NFT from the verified FROGINAL DOGS collection was found in this wallet.'});
      const prior=await supabase('froginalarmy_welcome_emails?select=id,status,email&nft_mint=eq.'+encodeURIComponent(asset.id)+'&limit=1','GET');
      if(Array.isArray(prior)&&prior.length) {
        if(prior[0].status==='sent') return send(res,200,{success:true,email_sent:false,message:'A welcome email has already been sent for this NFT.'});
        return send(res,409,{success:false,error:'A welcome email claim for this NFT is already being processed. Please contact support if it does not arrive.'});
      }
      const rows=await supabase('froginalarmy_welcome_emails','POST',{
        wallet_address:wallet,nft_mint:asset.id,email,status:'pending',
        nft_name:String(asset.content?.metadata?.name||'FROGINAL DOGS').slice(0,160)
      });
      if(!Array.isArray(rows)||!rows[0]?.id) throw new Error('Could not reserve the welcome email claim.');
      try {
        const sent=await sendWelcome(email,rows[0].nft_name);
        await supabase('froginalarmy_welcome_emails?id=eq.'+encodeURIComponent(rows[0].id),'PATCH',{status:'sent',sent_at:new Date().toISOString(),provider_message_id:sent.id||null});
        return send(res,200,{success:true,email_sent:true,nft_name:rows[0].nft_name});
      } catch(error) {
        await supabase('froginalarmy_welcome_emails?id=eq.'+encodeURIComponent(rows[0].id),'PATCH',{status:'failed'});
        console.error('FROGINAL welcome email failed:',error.message);
        return send(res,503,{success:false,error:'Your holder ownership was verified, but email delivery failed. Please contact support so we can resend it.'});
      }
    } catch(error) {
      console.error('FROGINAL welcome claim failed:',error.message);
      return send(res,502,{success:false,error:'Ownership verification or welcome registration is temporarily unavailable. Please try again.'});
    }
  }
  return send(res,404,{success:false,error:'Unknown welcome action.'});
};