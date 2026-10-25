'use strict';
const {send,session,cookies,unpack,clearCookie,verifyWalletSignature,heliusFindAsset,supabase,grantRole}=require('../lib/discord-auth');
function imageOf(asset){const candidates=[asset?.content?.links?.image,...(Array.isArray(asset?.content?.files)?asset.content.files.map(f=>f?.uri):[])];for(const x of candidates){try{const u=new URL(x);if(u.protocol==='https:')return u.href}catch{}}return null;}
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{success:false,error:'Method not allowed.'});}
 const s=session(req);if(!s)return send(res,401,{success:false,error:'Your Discord session expired. Connect Discord again.'});
 const wallet=typeof req.body?.wallet_address==='string'?req.body.wallet_address.trim():'';
 const signature=typeof req.body?.signature==='string'?req.body.signature:'';
 const c=cookies(req), challenge=unpack(c.froginal_wallet_challenge);
 clearCookie(res,'froginal_wallet_challenge');
 if(!challenge||challenge.discordUserId!==s.discordUserId||challenge.wallet!==wallet||typeof challenge.message!=='string')
   return send(res,400,{success:false,error:'Verification request expired or changed. Start verification again.'});
 if(!verifyWalletSignature(wallet,challenge.message,signature))return send(res,403,{success:false,error:'Wallet signature could not be verified. No role was assigned.'});
 try{
  const existing=await supabase('froginalarmy_discord_links?select=discord_user_id,wallet_address&or=(discord_user_id.eq.'+encodeURIComponent(s.discordUserId)+',wallet_address.eq.'+encodeURIComponent(wallet)+')','GET');
  if(Array.isArray(existing)&&existing.some(x=>x.discord_user_id!==s.discordUserId||x.wallet_address!==wallet))
   return send(res,409,{success:false,error:'This Discord account or wallet is already linked to a different member. Contact an administrator.'});
  const asset=await heliusFindAsset(wallet);
  if(!asset)return send(res,403,{success:false,error:'No currently owned NFT from the official verified FROGINAL DOGS collection was found. No Discord role was assigned.'});
  const record={discord_user_id:s.discordUserId,wallet_address:wallet,nft_mint:asset.id,
    nft_name:String(asset.content?.metadata?.name||asset.content?.metadata?.symbol||'FROGINAL DOGS').slice(0,160),
    nft_image_url:imageOf(asset),verified_at:new Date().toISOString(),last_checked_at:new Date().toISOString()};
  await supabase('froginalarmy_discord_links?on_conflict=discord_user_id','POST',record);
  try{await grantRole(s.discordUserId);}catch(e){
    console.error('Discord role assignment failed:',e.message,e.discordStatus||'');
    if(e.discordStatus===404)return send(res,502,{success:false,error:'NFT verified, but the Discord role could not be assigned. Make sure you joined the FROGINALS server and the bot is still in it, then try again.'});
    return send(res,502,{success:false,error:'NFT verified, but Discord could not assign the holder role. Check the bot permissions and role order, then retry verification.'});
  }
  return send(res,200,{success:true,verified:true,username:s.username||'Discord member',wallet_address:wallet,nft_name:record.nft_name,message:'NFT ownership verified and the FROGINAL HOLDER role was assigned.'});
 }catch(e){console.error('Discord NFT verification failed:',e.message);return send(res,502,{success:false,error:'Verification service temporarily unavailable. No successful role assignment was confirmed. Please try again.'});}
};
