'use strict';
const { send } = require('../lib/discord-auth');
module.exports = async function handler(req,res) {
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{success:false,error:'Method not allowed.'});}
  try {
    const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!base||!key) throw new Error('Server storage is not configured.');
    const r=await fetch(base.replace(/\/$/,'')+'/rest/v1/froginals_x_bot_tokens?select=username,display_name,connected_at&id=eq.primary&limit=1',{
      headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(10000)
    });
    if(!r.ok) throw new Error('Could not read connection status.');
    const rows=await r.json(),row=rows&&rows[0];
    return send(res,200,{success:true,connected:!!row,username:row&&row.username||null,displayName:row&&row.display_name||null,connectedAt:row&&row.connected_at||null});
  }catch(e){console.error('X bot status:',e.message);return send(res,503,{success:false,error:'X connection status is temporarily unavailable.'});}
};