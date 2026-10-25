'use strict';
const crypto=require('crypto');
const {send,session,setCookie,pack,isSolanaPublicKey,supabase}=require('../lib/discord-auth');
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{success:false,error:'Method not allowed.'});}
 const s=session(req); if(!s)return send(res,401,{success:false,error:'Connect Discord first.'});
 const wallet=typeof req.body?.wallet_address==='string'?req.body.wallet_address.trim():'';
 if(!isSolanaPublicKey(wallet))return send(res,400,{success:false,error:'Enter a valid Solana wallet address.'});
 try{
  const linked=await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.'+encodeURIComponent(s.discordUserId)+',wallet_address.eq.'+encodeURIComponent(wallet)+')','GET');
  if(Array.isArray(linked)&&linked.some(x=>x.discord_user_id!==s.discordUserId||x.wallet_address!==wallet))
    return send(res,409,{success:false,error:'This Discord account or wallet is already linked to a different member. Contact an administrator if you need help.'});
  const nonce=crypto.randomBytes(24).toString('base64url');
  const issued=Date.now();
  const message=['FROGINALS ARMY — DISCORD HOLDER VERIFICATION','', 'Discord user ID: '+s.discordUserId,'Solana wallet: '+wallet,'Nonce: '+nonce,'Issued at: '+new Date(issued).toISOString(),'Expires at: '+new Date(issued+5*60*1000).toISOString(),'Purpose: Prove wallet control and verify current FROGINAL DOGS ownership.'].join('\n');
  setCookie(res,'froginal_wallet_challenge',pack({discordUserId:s.discordUserId,wallet,nonce,message,exp:issued+5*60*1000}),300);
  return send(res,200,{success:true,wallet,message,expires_in:300});
 }catch(e){console.error('Wallet challenge:',e.message);return send(res,503,{success:false,error:'Could not prepare verification. Please try again.'});}
};
