// PHASE 2C1 AUTHORITATIVE RUNTIME
// PHASE 2B5 ONLINE SEASON VIEWS
// // PHASE 2B4A ONLINE STATS AND POWER RANKINGS
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useParams} from "react-router-dom";
import {teamsInSnapshot} from "./onlineFranchiseApi.js";
import {initializeOnlineRuntime, readOnlineRuntime, readOnlineRuntimeRevision, isNewerRevision} from "./onlineRuntimeClient.js";
import {lobbyState} from "./onlineApi.js";
import {supabase} from "../auth/supabaseClient.js";
import {initializeOnlineCalendar} from "./onlineCalendarBootstrap.js";
import {OnlineReadOnlyProvider} from "./onlineReadOnlyContext.jsx";
import OnlineBmSidebar from "./OnlineBmSidebar.jsx";
import OnlineGmPanel from "./OnlineGmPanel.jsx";
import OnlineTransactionAlerts from "./OnlineTransactionAlerts.jsx";
// Generated verbatim from your CURRENT single-player TeamHub.jsx by the installer,
// with only the storage and navigation adapters substituted.
import OnlineTeamHubMirror from "./OnlineTeamHubMirror.jsx";
import OnlineRosterView from "./OnlineRosterView.jsx";
import OnlineStandings from "./OnlineStandings.jsx";
import OnlineDraftPicks from "./OnlineDraftPicks.jsx";
import OnlineSalaryTable from "./OnlineSalaryTable.jsx";
import OnlinePlayerStats from "./OnlinePlayerStats.jsx";
import OnlinePowerRankings from "./OnlinePowerRankings.jsx";
import OnlineCoachGameplanPreview from "./OnlineCoachGameplanPreview.jsx";
import OnlineFreeAgencyPreview from "./OnlineFreeAgencyPreview.jsx";
import OnlineTrades from "./OnlineTrades.jsx";
import OnlineHumanTradeRoom from "./OnlineHumanTradeRoom.jsx";
import OnlineHumanTradeFinder from "./OnlineHumanTradeFinder.jsx";
import OnlineCpuTradeRoom from "./OnlineCpuTradeRoom.jsx";
import OnlineCpuTradeFinder from "./OnlineCpuTradeFinder.jsx";
import OnlineSeasonSchedule from "./OnlineSeasonSchedule.jsx";
import OnlineContractExtensions from "./OnlineContractExtensions.jsx";
import OnlinePlayoffPicturePreview from "./OnlinePlayoffPicturePreview.jsx";
import OnlineDraftLottery from "./OnlineDraftLottery.jsx";
import OnlineDraftRoom from "./OnlineDraftRoom.jsx";
import OnlineRookieSignings from "./OnlineRookieSignings.jsx";
import OnlineRetirements from "./OnlineRetirements.jsx";
import OnlineOffseasonOptions from "./OnlineOffseasonOptions.jsx";
import OnlineOffseasonRights from "./OnlineOffseasonRights.jsx";
import OnlinePlayerProgression from "./OnlinePlayerProgression.jsx";
import OnlineNextSeason from "./OnlineNextSeason.jsx";
import {isOnlinePendingView} from "./onlineNavigationAvailability.mjs";

const ONLINE_READ_ONLY_SCREENS = {
  "/roster-view":OnlineRosterView,
  "/standings":OnlineStandings,
  "/draft-picks":OnlineDraftPicks,
  "/salary-table":OnlineSalaryTable,
  "/player-stats":OnlinePlayerStats,
  "/power-rankings":OnlinePowerRankings,
  "/coach-gameplan":OnlineCoachGameplanPreview,
  "/free-agents":OnlineFreeAgencyPreview,
  "/trades":OnlineTrades,
  "/trade-proposal":OnlineHumanTradeRoom,
  "/trade-finder":OnlineHumanTradeFinder,
  "/cpu-trades":OnlineCpuTradeRoom,
  "/cpu-trade-finder":OnlineCpuTradeFinder,
  "/calendar":OnlineSeasonSchedule,
  "/contract-extensions":OnlineContractExtensions,
  "/playoff-picture":OnlinePlayoffPicturePreview,
  "/draft-lottery":OnlineDraftLottery,
  "/nba-draft":OnlineDraftRoom,
  "/rookie-signings":OnlineRookieSignings,
  "/retirements":OnlineRetirements,
  "/player-team-options":OnlineOffseasonOptions,
  "/free-agent-rights":OnlineOffseasonRights,
  "/player-progression":OnlinePlayerProgression,
  "/next-season":OnlineNextSeason,
};

const DISPLAY_NAMES = new Map([
  ["/roster-view","Roster"],["/coach-gameplan","Coach Gameplan"],["/trades","Trades"],
  ["/free-agents","Free Agency"],["/draft-picks","Draft Picks"],["/draft-lottery","Draft Lottery"],["/nba-draft","NBA Draft"],["/rookie-signings","Rookie Signings"],["/retirements","Player Retirements"],["/player-team-options","Player & Team Options"],["/free-agent-rights","Free Agent Rights"],["/player-progression","Player Progression"],["/next-season","Next Season"],["/salary-table","Salary Table"],
  ["/contract-extensions","Contract Extensions"],["/calendar","Schedule"],["/standings","Standings"],
  ["/power-rankings","Power Rankings"],["/playoff-picture","Playoff Picture"],["/player-stats","Stats"],
  ["/playoff-stats","Playoff Statistics"],["/locker-room","Locker Room"],["/intel","Team Intel"],
  ["/upcoming-draft","Upcoming Draft"],["/award-tracker","Award Tracker"],["/all-stars","All-Stars"],
  ["/league-history","Transaction History"],["/award-history","Award History"],["/past-champions","Past Champions"],
]);

export default function OnlineFranchise({user}) {
  const {id}=useParams();
  const location=useLocation();
  const [franchise,setFranchise]=useState(null);
  const [room,setRoom]=useState(null);
  const [pending,setPending]=useState(true);
  const [error,setError]=useState("");
  const [refreshBusy,setRefreshBusy]=useState(false);
  const [refreshError,setRefreshError]=useState("");
  const [calendarSetup,setCalendarSetup]=useState({pending:false,error:''});
  const [calendarRetry,setCalendarRetry]=useState(0);
  const calendarAttemptRef=useRef({key:'',promise:null});
  const retryCalendarSetup=useCallback(()=>{calendarAttemptRef.current={key:'',promise:null};setCalendarRetry(n=>n+1);},[]);
  const [realtimeStatus,setRealtimeStatus]=useState("connecting");
  const latestRevision=useRef("1");
  latestRevision.current=franchise?.revision||"1";
  const load=useCallback(async()=>{
    setPending(true);
    try {
      // Idempotent server initialization: no browser can mutate the runtime directly.
      await initializeOnlineRuntime(id);
      const [runtime,lobby]=await Promise.all([readOnlineRuntime(id),lobbyState(id)]);
      if(lobby?.lobby?.status!=="started") throw new Error("Shared franchise not available.");
      if(!lobby.members?.some(m=>m.user_id===user.id)) throw new Error("This account is not a member of the franchise.");
      setFranchise({seed_state:runtime.state,revision:runtime.revision,updated_at:runtime.updated_at});
      setRoom(lobby);setError("");setRefreshError("");
    } catch(e){setError(e.message||String(e));}
    finally{setPending(false);}
  },[id,user.id]);
  useEffect(()=>{load();},[load]);

  const refreshSharedState=useCallback(async()=>{
    setRefreshBusy(true);
    try {
      const latest=await readOnlineRuntime(id);
      setFranchise(current=>!current||isNewerRevision(latest.revision,current.revision)
        ?{seed_state:latest.state,revision:latest.revision,updated_at:latest.updated_at}:current);
      setRefreshError("");
    } catch(e){setRefreshError(e.message||String(e));}
    finally{setRefreshBusy(false);}
  },[id]);

  // Every started online franchise gets exactly one server-owned schedule.
  // Host requests it automatically; SQL enforces host authorization, revision and idempotence.
  // Other GMs never initialize a season and only read the committed runtime.
  useEffect(()=>{
    const isCurrentHost=room?.lobby?.host_id===user.id;
    const hasSchedule=franchise?.seed_state?.onlineSchedule?.byDate != null;
    if(!franchise||!room||!isCurrentHost||hasSchedule){
      if(hasSchedule)setCalendarSetup(old=>old.pending||old.error?{pending:false,error:''}:old);
      return;
    }
    const key=`${id}:${franchise.revision}`;
    // Reuse the same in-flight promise across React StrictMode effect replays.
    // This prevents duplicate host requests without swallowing completion/errors.
    if(calendarAttemptRef.current.key!==key){
      calendarAttemptRef.current={key,promise:initializeOnlineCalendar({
        lobbyId:id,expectedRevision:Number(franchise.revision),requestId:crypto.randomUUID()
      })};
    }
    const promise=calendarAttemptRef.current.promise;
    let active=true;
    setCalendarSetup({pending:true,error:''});
    promise.then(async()=>{if(active)await refreshSharedState();})
      .catch(async err=>{
        if(!active)return;
        if(err?.status===409){
          // A conflicting transaction may have changed the revision, or the
          // calendar may have been created elsewhere. Never assume either.
          try{
            const latest=await readOnlineRuntime(id);
            if(!active)return;
            await refreshSharedState();
            if(!latest.state?.onlineSchedule?.byDate)
              setCalendarSetup({pending:false,error:'The league changed while setting up its schedule. Refresh the league and retry setup.'});
          }catch(refreshError){
            if(active)setCalendarSetup({pending:false,error:refreshError?.message||String(refreshError)});
          }
        }else setCalendarSetup({pending:false,error:err?.message||String(err)});
      })
      .finally(()=>{if(active)setCalendarSetup(old=>({...old,pending:false}));});
    return ()=>{active=false;};
  },[id,user.id,room?.lobby?.host_id,franchise?.revision,!!franchise?.seed_state?.onlineSchedule?.byDate,calendarRetry,refreshSharedState]);

  // 2C.3: listen for small, RLS-protected journal INSERTs. Never subscribe to
  // large roster JSON; always reload the authoritative runtime on a new event.
  // Poll + focus/network recovery handle publication outages, missed events,
  // suspended browser tabs and websocket reconnect races.
  useEffect(()=>{
    if(!franchise)return;
    let active=true,checking=false;
    const check=async(force=false)=>{
      if(!active||checking)return;
      checking=true;
      try {
        if(!force){
          const meta=await readOnlineRuntimeRevision(id);
          if(!active)return;
          // No full snapshot transfer when only the metadata is unchanged.
          // Use functional setState inside refresh to avoid stale closures.
          if(!isNewerRevision(meta.revision,latestRevision.current))return;
        }
        const latest=await readOnlineRuntime(id);
        if(!active)return;
        setFranchise(current=>!current||isNewerRevision(latest.revision,current.revision)
          ?{seed_state:latest.state,revision:latest.revision,updated_at:latest.updated_at}:current);
        setRefreshError("");
      }catch(error){if(active)setRefreshError(error?.message||String(error));}
      finally{checking=false;}
    };
    const channel=supabase.channel(`bm-online-runtime-${id}-${crypto.randomUUID()}`)
      .on("postgres_changes",{
        event:"INSERT",schema:"public",table:"bm_online_franchise_events",filter:`lobby_id=eq.${id}`
      },payload=>{
        if(!active)return;
        const revision=payload?.new?.revision;
        if(revision==null||isNewerRevision(revision,latestRevision.current))void check(true);
      });
    channel.subscribe(status=>{
      if(!active)return;
      if(status==="SUBSCRIBED"){
        setRealtimeStatus("connected");
        void check(true); // catch revisions that occurred before subscription
      }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){
        setRealtimeStatus("polling");
      }
    });
    const onFocus=()=>{if(document.visibilityState==="visible")void check(true);};
    const onOnline=()=>void check(true);
    document.addEventListener("visibilitychange",onFocus);
    window.addEventListener("focus",onFocus);
    window.addEventListener("online",onOnline);
    const timer=setInterval(()=>void check(false),20000);
    return()=>{
      active=false;clearInterval(timer);
      document.removeEventListener("visibilitychange",onFocus);
      window.removeEventListener("focus",onFocus);
      window.removeEventListener("online",onOnline);
      void supabase.removeChannel(channel);
    };
  },[id,Boolean(franchise)]);
  // Commissioner changes do not increment the shared roster revision. Subscribe
  // separately and poll as a fallback so host-only UI never stays stale.
  const refreshCommissioner = useCallback(async()=>{
    const latestRoom = await lobbyState(id);
    if(latestRoom?.lobby?.status==="started" && latestRoom.members?.some(m=>m.user_id===user.id)) {
      setRoom(latestRoom);
    }
  },[id,user.id]);
  useEffect(()=>{
    const refreshRole=()=>{ if(document.visibilityState==="visible") void refreshCommissioner().catch(()=>{}); };
    const timer=setInterval(refreshRole,15000);
    const channel=supabase.channel(`bm-online-host-${id}-${crypto.randomUUID()}`)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"bm_online_lobbies",filter:`id=eq.${id}`},refreshRole);
    channel.subscribe();
    window.addEventListener("focus",refreshRole);
    return()=>{clearInterval(timer);window.removeEventListener("focus",refreshRole);void supabase.removeChannel(channel);};
  },[id,refreshCommissioner]);
  const mine=room?.members?.find(m=>m.user_id===user.id);
  const humanTeamNames=useMemo(()=>room?.members?.map(m=>m.team_name).filter(Boolean)||[],[room]);
  const teams=useMemo(()=>teamsInSnapshot(franchise?.seed_state),[franchise]);
  const selectedTeam=teams.find(t=>t?.name===mine?.team_name)||null;
  const view=new URLSearchParams(location.search).get("view")||"";
  const ViewComponent=ONLINE_READ_ONLY_SCREENS[view]||null;
  if(pending)return <main className="on-center">Loading your shared NBA universe…</main>;
  if(error||!franchise||!selectedTeam)return <main className="on-center"><div className="on-panel"><h1>Online franchise unavailable</h1><p className="on-error" role="alert">{error||"Your assigned team could not be found in the franchise."}</p>
    <button type="button" className="on-secondary" onClick={load}>Retry</button> <Link to="/online">Online Home</Link></div></main>;
  return <div className="bmOnlineGameShell" data-online-read-only="true">
    <OnlineBmSidebar/>
    <div className="bmOnlineGameCanvas">
      <OnlineReadOnlyProvider seed={franchise.seed_state} selectedTeam={selectedTeam} revision={franchise.revision} lobbyId={id} onAccepted={refreshSharedState} isHost={room?.lobby?.host_id===user.id} humanTeamNames={humanTeamNames} calendarSetup={calendarSetup} retryCalendarSetup={retryCalendarSetup}>
        {!view?<OnlineTeamHubMirror/>:ViewComponent?<div className="bmOnlineReadOnlyScreen" data-online-view={view} key={view}>
          <div className="bmOnlineReadOnlyNotice" role="status">{view==="/free-agents" ? "Online franchise · Server-authorized 1–4 year cap-room offers (eligibility rules apply)" : view==="/roster-view" ? "Online franchise · Server-authorized roster releases; other roster edits locked" : view==="/trades" ? "Online Trade Center · Human GM offers and eligible CPU player negotiations available" : view==="/trade-proposal" ? "Online GM Trades · Server-authorized player and eligible draft-pick packages; recipient approval required" : view==="/cpu-trade-finder" ? "Online CPU Trade Finder · Original Python evaluator · Offers are provisional" : view==="/cpu-trades" ? "Online CPU trading · Trusted single-player Python evaluator; server-authorized player trades" : view==="/trade-finder" ? "Online Trade Finder · Human-GM ideas only; no automatic approvals" : view==="/coach-gameplan" ? "Online Coach Gameplan · Control your starting five and minutes; shared server-authorized saves" : view==="/contract-extensions" ? "Online Contract Extensions · Original Python player negotiations · Shared server-authorized contracts" : view==="/draft-lottery" ? "Online Draft Lottery · Original Python draw · Official ownership follows separately" : view==="/nba-draft" ? "Online NBA Draft · Original single-player rookie generation and GM/CPU selections" : view==="/rookie-signings" ? "Online Rookie Signings · Original single-player contracts · Your GM controls your rookies" : view==="/retirements" ? "Online Retirements · Original Python model · Host-authorized and shared across all GMs" : view==="/free-agent-rights" ? "Online Free Agent Rights · Original Bird-rights engine · Human GM qualifying offers and cap holds" : view==="/next-season" ? "Online Season Rollover · Official shared transition, season archive and new NBA schedule" : view==="/player-progression" ? "Online Player Progression · Original Python development engine · One shared host-authorized result" : view==="/calendar" ? "Online Calendar · Host-authorized game-day simulation; shared results and box scores" : "Online franchise · Read-only preview — feature changes remain locked"}</div>
          <div className="bmOnlineReadOnlyScreenBody"><ViewComponent/></div>
        </div>:<div className="bmOnlinePendingPage" role="status">
          <div className="bmOnlinePendingTag">BASKETBALL MANAGER ONLINE</div>
          <h1>{DISPLAY_NAMES.get(view)||"Online Page Unavailable"}</h1>
          <p>{isOnlinePendingView(view)
            ? "This feature is not yet available in online franchises. It remains accessible only after a dedicated multiplayer implementation is added."
            : "This online route does not exist. Your shared franchise has not been changed."}</p>
          <p>Your online franchise remains saved on the server. Choose a working section from the sidebar, or return to your Team Hub.</p>
          <Link to={`/online/franchise/${id}`}>← Return to Team Hub</Link>
          <Link className="bmOnlinePendingHomeLink" to="/online">Online Home</Link>
        </div>}
      </OnlineReadOnlyProvider>
    </div>
    <OnlineTransactionAlerts key={id} lobbyId={id} revision={franchise.revision} leagueData={franchise.seed_state} currentUserId={user.id} members={room.members} people={room.people}/>
    <OnlineGmPanel room={room} user={user} revision={franchise.revision} onRefresh={refreshSharedState} onGovernanceChange={refreshCommissioner} refreshing={refreshBusy} syncError={refreshError} realtimeStatus={realtimeStatus}/>
  </div>;
}
