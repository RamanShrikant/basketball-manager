// Online-only host-authorized Play-In initialization and game simulation.
// Scores/box scores are produced by the trusted original Python game engine.
import {randomBytes} from 'node:crypto';
import {nextOnlinePlayoffGame,buildOnlinePlayoffBatch,integrateOnlinePlayoffGame} from './onlinePlayoffSeries.mjs';
import {simulatePythonBatch} from './onlineSimulation.js';
import {
  seedOnlinePostseason,nextOnlinePlayInGame,buildOnlinePlayInBatch,integrateOnlinePlayInGame
} from './onlinePostseasonCore.mjs';

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const allowed=['lobbyId','requestId','expectedRevision'];
const budgets=new Map();
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function config(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||!/^https:\/\/[\w.-]+$/i.test(url))fail(503,'Trusted postseason backend is not configured.');
  return {url:url.replace(/\/$/,''),key};
}
async function read(c,path){
  const r=await fetch(`${c.url}${path}`,{headers:{apikey:c.key,Authorization:`Bearer ${c.key}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok)fail(503,'Could not verify the current online league.');
  return r.json();
}
async function commit(c,name,payload){
  const r=await fetch(`${c.url}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)
  });
  const data=await r.json().catch(()=>null);
  if(!r.ok||!data?.ok)fail(409,'Postseason operation was not committed. Refresh the shared league before retrying.');
  return data;
}
async function authorize(req,actionType){
  const b=req.body||{};
  if(Object.keys(b).some(k=>!allowed.includes(k))||!UUID.test(String(b.lobbyId||''))||
    !UUID.test(String(b.requestId||''))||!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1)
    fail(400,'Invalid Online postseason request.');
  const token=String(req.get('authorization')||'').match(/^Bearer ([a-zA-Z\d_.-]{20,5000})$/)?.[1];
  if(!token)fail(401,'Sign in to the shared online league.');
  const c=config();
  const auth=await fetch(`${c.url}/auth/v1/user`,{
    headers:{apikey:c.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)
  });
  if(!auth.ok)fail(401,'Online session expired.');
  const user=await auth.json();
  if(!UUID.test(String(user?.id||'')))fail(401,'Invalid online account.');
  const now=Date.now();for(const [id,r] of budgets)if(now-r.started>=60000)budgets.delete(id);
  const previous=budgets.get(user.id);
  if(previous?.count>=15)fail(429,'Too many postseason actions.');
  budgets.set(user.id,{started:previous?.started??now,count:(previous?.count??0)+1});
  const lobbies=await read(c,`/rest/v1/bm_online_lobbies?id=eq.${b.lobbyId}&select=host_id,status`);
  if(lobbies.length!==1||lobbies[0].status!=='started'||lobbies[0].host_id!==user.id)
    fail(403,'Only the current online host can advance the postseason.');
  const membership=await read(c,`/rest/v1/bm_online_lobby_members?lobby_id=eq.${b.lobbyId}&user_id=eq.${user.id}&select=user_id`);
  if(membership.length!==1)fail(403,'The host must be a member of this league.');
  const events=await read(c,`/rest/v1/bm_online_franchise_events?lobby_id=eq.${b.lobbyId}&request_id=eq.${b.requestId}&select=actor_id,action_type,revision,details`);
  if(events.length){
    const event=events[0];
    if(event.actor_id!==user.id||event.action_type!==actionType)
      fail(409,'The request ID belongs to another operation.');
    return {replay:{ok:true,replayed:true,revision:event.revision,date:event.details?.date,gameId:event.details?.gameId},c,b,user};
  }
  const rows=await read(c,`/rest/v1/bm_online_franchise_runtime?lobby_id=eq.${b.lobbyId}&select=state,revision`);
  if(rows.length!==1||Number(rows[0].revision)!==b.expectedRevision)
    fail(409,'Shared league changed. Refresh before advancing.');
  return {c,b,user,state:rows[0].state};
}
function httpError(error,res){
  const status=error.status||503;
  res.status(status).json({ok:false,error:status===503?'Trusted postseason service is unavailable. No games were committed.':error.message});
}
export async function initializeOnlinePostseasonRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const session=await authorize(req,'postseason_seeded');
    if(session.replay)return res.json(session.replay);
    const bracket=seedOnlinePostseason(session.state);
    const result=await commit(session.c,'bm_online_seed_postseason_phase2d3a',{
      p_lobby:session.b.lobbyId,p_actor:session.user.id,p_request:session.b.requestId,
      p_expected_revision:session.b.expectedRevision,p_postseason:bracket
    });
    return res.json({ok:true,revision:result.revision,seasonYear:bracket.seasonYear,
      playInGames:6,replayed:!!result.replayed});
  }catch(e){return httpError(e,res);}
}
export async function simulateNextOnlinePlayInRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const session=await authorize(req,'play_in_game_simulated');
    if(session.replay)return res.json(session.replay);
    const game=nextOnlinePlayInGame(session.state);
    if(!game)fail(409,'The Play-In is complete. The playoff series are the next stage.');
    const {batch}=buildOnlinePlayInBatch(session.state);
    const seed=randomBytes(4).readUInt32BE(0);
    const output=await simulatePythonBatch(batch.inputs,{seed});
    const delta=integrateOnlinePlayInGame(session.state,game,output,seed^0xA3B19E52);
    const result=await commit(session.c,'bm_online_simulate_playin_phase2d3a',{
      p_lobby:session.b.lobbyId,p_actor:session.user.id,p_request:session.b.requestId,
      p_expected_revision:session.b.expectedRevision,p_game_id:game.id,p_result:delta.result,
      p_postseason:delta.bracket,p_postseason_stats:delta.stats,
      p_rosters:delta.rosters,p_injury_events:delta.injuryEvents
    });
    return res.json({ok:true,revision:result.revision,date:game.date,gameId:game.id,
      winner:delta.result.homeScore>delta.result.awayScore?game.home:game.away,replayed:!!result.replayed});
  }catch(e){return httpError(e,res);}
}

// 2D.3-B — trusted best-of-seven execution. Browser supplies no matchup or scores.
export async function simulateNextOnlinePlayoffRequest(req,res){
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  try{
    const session=await authorize(req,'playoff_game_simulated');
    if(session.replay)return res.json(session.replay);
    const game=nextOnlinePlayoffGame(session.state);
    if(!game)fail(409,'The NBA Finals are complete. The championship is final.');
    const {batch}=buildOnlinePlayoffBatch(session.state);
    const seed=randomBytes(4).readUInt32BE(0);
    const output=await simulatePythonBatch(batch.inputs,{seed});
    const delta=integrateOnlinePlayoffGame(session.state,game,output,seed^0x7C31DA0B);
    const result=await commit(session.c,'bm_online_simulate_playoffs_phase2d3b',{
      p_lobby:session.b.lobbyId,p_actor:session.user.id,p_request:session.b.requestId,
      p_expected_revision:session.b.expectedRevision,p_game_id:game.id,p_result:delta.result,
      p_postseason:delta.bracket,p_postseason_stats:delta.stats,p_rosters:delta.rosters,
      p_injury_events:delta.injuryEvents
    });
    return res.json({ok:true,revision:result.revision,date:game.date,gameId:game.id,
      round:game.round,champion:delta.bracket.champion||null,replayed:!!result.replayed});
  }catch(e){return httpError(e,res);}
}
