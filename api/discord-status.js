'use strict';
const {send,session,supabase}=require('../lib/discord-auth');
module.exports=async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{success:false,error:'Method not allowed.'});}
 const s=session(req); if(!s)return send(res,200,{success:true,connected:false});
 try{
  const rows=await supabase('froginalarmy_discord_links?select=wallet_address,nft_name,discord_user_id&discord_user_id=eq.'+encodeURIComponent(s.discordUserId)+'&limit=1','GET');
  const row=Array.isArray(rows)?rows[0]:null;
  return send(res,200,{success:true,connected:true,username:s.username||'Discord member',verified:!!row,wallet_address:row?.wallet_address||null,nft_name:row?.nft_name||null});
 }catch(e){console.error('Discord status:',e.message);return send(res,503,{success:false,error:'Could not load Discord verification status. Run the Supabase migration and try again.'});}
};
