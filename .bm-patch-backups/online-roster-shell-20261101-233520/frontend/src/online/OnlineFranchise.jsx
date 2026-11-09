// PHASE 2C1 AUTHORITATIVE RUNTIME
// PHASE 2B5 ONLINE SEASON VIEWS
// // PHASE 2B4A ONLINE STATS AND POWER RANKINGS
import React, {useCallback, useEffect, useMemo, useState} from "react";
import {Link, useLocation, useParams} from "react-router-dom";
import {teamsInSnapshot} from "./onlineFranchiseApi.js";
import {initializeOnlineRuntime, readOnlineRuntime, readOnlineRuntimeRevision, isNewerRevision} from "./onlineRuntimeClient.js";
import {lobbyState} from "./onlineApi.js";
import {OnlineReadOnlyProvider} from "./onlineReadOnlyContext.jsx";
import OnlineBmSidebar from "./OnlineBmSidebar.jsx";
import OnlineGmPanel from "./OnlineGmPanel.jsx";
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
import OnlineSeasonSchedule from "./OnlineSeasonSchedule.jsx";
import OnlinePlayoffPicturePreview from "./OnlinePlayoffPicturePreview.jsx";

const ONLINE_READ_ONLY_SCREENS = {
  "/roster-view":OnlineRosterView,
  "/standings":OnlineStandings,
  "/draft-picks":OnlineDraftPicks,
  "/salary-table":OnlineSalaryTable,
  "/player-stats":OnlinePlayerStats,
  "/power-rankings":OnlinePowerRankings,
  "/coach-gameplan":OnlineCoachGameplanPreview,
  "/free-agents":OnlineFreeAgencyPreview,
  "/calendar":OnlineSeasonSchedule,
  "/playoff-picture":OnlinePlayoffPicturePreview,
};

const DISPLAY_NAMES = new Map([
  ["/roster-view","Roster"],["/coach-gameplan","Coach Gameplan"],["/trades","Trades"],
  ["/free-agents","Free Agency"],["/draft-picks","Draft Picks"],["/salary-table","Salary Table"],
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

  useEffect(()=>{
    if(!franchise)return;
    let active=true,checking=false;
    const check=async()=>{
      if(checking)return;
      checking=true;
      try {
        // Only poll revision metadata; a full NBA roster download happens on change.
        const meta=await readOnlineRuntimeRevision(id);
        if(!active)return;
        if(isNewerRevision(meta.revision,franchise.revision)){
          const latest=await readOnlineRuntime(id);
          if(!active)return;
          setFranchise(current=>current&&isNewerRevision(latest.revision,current.revision)
            ?{seed_state:latest.state,revision:latest.revision,updated_at:latest.updated_at}:current);
          setRefreshError("");
        }
      } catch(e){if(active)setRefreshError(e.message||String(e));}
      finally{checking=false;}
    };
    const timer=setInterval(check,20000);
    return()=>{active=false;clearInterval(timer);};
  },[id,franchise?.revision]);
  const mine=room?.members?.find(m=>m.user_id===user.id);
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
      <OnlineReadOnlyProvider seed={franchise.seed_state} selectedTeam={selectedTeam} revision={franchise.revision} lobbyId={id} onAccepted={refreshSharedState}>
        {!view?<OnlineTeamHubMirror/>:ViewComponent?<div className="bmOnlineReadOnlyScreen" key={view}>
          <div className="bmOnlineReadOnlyNotice" role="status">{view==="/free-agents" ? "Online franchise · Cap-room free agent signing beta; other actions locked" : "Online franchise · Read-only preview — league changes and simulation remain locked"}</div>
          <div className="bmOnlineReadOnlyScreenBody"><ViewComponent/></div>
        </div>:<div className="bmOnlinePendingPage" role="status">
          <div className="bmOnlinePendingTag">BASKETBALL MANAGER ONLINE</div>
          <h1>{DISPLAY_NAMES.get(view)||"Online Feature"}</h1>
          <p>The normal Basketball Manager screen will appear here once its data access has been isolated from local single-player saves.</p>
          <p>Transactions, simulation, and other league edits are locked until the authoritative multiplayer engine supports them.</p>
          <Link to={`/online/franchise/${id}`}>← Return to Team Hub</Link>
        </div>}
      </OnlineReadOnlyProvider>
    </div>
    <OnlineGmPanel room={room} user={user} revision={franchise.revision} onRefresh={refreshSharedState} refreshing={refreshBusy} syncError={refreshError}/>
  </div>;
}
