// Phase 2D.1 — backend-authoritative initialization of single-player's NBA schedule.
// The browser sends no games, results, teams, season, or host identity.
import { generateFullSeasonSchedule } from './onlineSeasonSchedule.js';
import { getSeasonStartYear, getSeasonCalendarConfig } from '../frontend/src/utils/seasonContext.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isPlain = x => x && typeof x==='object' && !Array.isArray(x);
const requestBudget=new Map();
const sendError = (status,msg) => {const e=new Error(msg);e.status=status;throw e;};
const settings=()=>{
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9.-]+$/i.test(url))sendError(503,'Online simulation service is not configured.');
  return {url:url.replace(/\/$/,''),key};
};
async function query(c,path,bearer=c.key){
  const response=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)sendError(response.status===401?401:503,'Could not verify the current online franchise.');
  return response.json();
}
async function rpc(c,payload){
  const response=await fetch(`${c.url}/rest/v1/rpc/bm_online_initialize_calendar_phase2d1`,{
    method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)sendError(409,'The calendar was not committed. Refresh your franchise; no schedule was replaced.');
  return data;
}
export function compactSchedule(state){
  if(!isPlain(state))sendError(409,'Shared franchise data is invalid.');
  const teams=Array.isArray(state.teams)?state.teams:[...(state.conferences?.East||[]),...(state.conferences?.West||[])];
  if(teams.length!==30||teams.some(t=>!t?.name)||new Set(teams.map(t=>t.name)).size!==30)
    sendError(409,'An NBA 30-team franchise is required for schedule initialization.');
  const year=getSeasonStartYear(state);
  if(!Number.isInteger(year)||year<2025||year>2095)sendError(409,'Unsupported online season.');
  const conf=getSeasonCalendarConfig({...state,seasonYear:year,currentSeasonYear:year,seasonStartYear:year});
  const parseDate=(s,year,month,day)=>{
    if(typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)){
      const [y,m,d]=s.split('-').map(Number);const date=new Date(y,m-1,d);
      if(date.getFullYear()===y&&date.getMonth()+1===m&&date.getDate()===d)return date;
    }
    return new Date(year,month-1,day);
  };
  const start=parseDate(conf.regularSeasonStart,year,10,21);
  const end=parseDate(conf.regularSeasonEnd,year+1,4,12);
  const built=generateFullSeasonSchedule(teams,start,end,conf);
  if(built.list.length!==1230||new Set(built.list.map(g=>g.id)).size!==1230)
    sendError(409,'Original NBA scheduler did not produce a safe 1,230-game season.');
  const byDate=Object.fromEntries(Object.entries(built.byDate).map(([date,games])=>[date,games.map(g=>({
    id:g.id,date,home:g.home,away:g.away
  }))]));
  return {year,byDate,gameCount:built.list.length};
}
export async function initializeOnlineCalendarRequest(req,res){
  res.set('Cache-Control','no-store');
  try{
    const body=req.body||{};
    if(!UUID.test(String(body.lobbyId||''))||!UUID.test(String(body.requestId||''))||
      !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||Object.keys(body).some(k=>!['lobbyId','requestId','expectedRevision'].includes(k)))
      sendError(400,'Invalid Online calendar request.');
    const token=String(req.get('authorization')||'').match(/^Bearer ([A-Za-z0-9_.-]{20,5000})$/)?.[1];
    if(!token)sendError(401,'Sign in to create the league calendar.');
    const c=settings();
    const response=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(!response.ok)sendError(401,'Your Online session expired.');
    const user=await response.json();
    if(!UUID.test(String(user?.id||'')))sendError(401,'Invalid online account.');
    const now=Date.now();
    for(const [id,bucket] of requestBudget){if(now-bucket.started>60000)requestBudget.delete(id);}
    const bucket=requestBudget.get(user.id);
    if(bucket?.count>=3)sendError(429,'Too many calendar requests. Try again shortly.');
    requestBudget.set(user.id,{started:bucket?.started??now,count:(bucket?.count??0)+1});
    const lobbies=await query(c,`/rest/v1/bm_online_lobbies?id=eq.${body.lobbyId}&select=id,host_id,status`);
    if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id)
      sendError(403,'Only the host of a started franchise can initialize its season.');
    const runtimes=await query(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${body.lobbyId}&select=revision,state`);
    if(runtimes.length!==1)sendError(409,'Shared league is not initialized.');
    if(runtimes[0].state?.onlineSchedule?.byDate)sendError(409,'This league already has a schedule. Refresh instead of recreating it.');
    if(Number(runtimes[0].revision)!==body.expectedRevision)sendError(409,'Shared franchise changed. Refresh and retry.');
    const schedule=compactSchedule(runtimes[0].state);
    const result=await rpc(c,{p_lobby:body.lobbyId,p_actor:user.id,p_request:body.requestId,
      p_expected_revision:body.expectedRevision,p_season_year:schedule.year,p_by_date:schedule.byDate});
    if(!result?.ok)sendError(409,'The server did not confirm the calendar.');
    return res.json({ok:true,revision:result.revision,gameCount:schedule.gameCount,seasonYear:schedule.year});
  }catch(e){return res.status(e.status||503).json({ok:false,error:e.status===503?'Online calendar service temporarily unavailable.':e.message});}
}
