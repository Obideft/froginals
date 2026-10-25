'use strict';
const {send,clearCookie}=require('../lib/discord-auth');
module.exports=async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{success:false,error:'Method not allowed.'});}
 clearCookie(res,'froginal_discord_session');clearCookie(res,'froginal_wallet_challenge');
 return send(res,200,{success:true});
};
