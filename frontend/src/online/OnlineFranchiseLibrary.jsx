import React, {useCallback,useEffect,useMemo,useState} from "react";
import {Link,useNavigate} from "react-router-dom";
import {listOnlineFranchiseLibrary,setOnlineFranchiseArchived} from "./onlineFranchiseLibraryApi.js";

function whenCreated(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "Unknown";
}

export default function OnlineFranchiseLibrary({user}) {
  const navigate = useNavigate();
  const [all,setAll]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState("");
  const [showArchived,setShowArchived]=useState(false);
  const load = useCallback(async()=>{
    setLoading(true);
    try{setAll(await listOnlineFranchiseLibrary(user.id));setError("");}
    catch(e){setError(e.message||String(e));}
    finally{setLoading(false);}
  },[user.id]);
  useEffect(()=>{load();},[load]);
  const shown=useMemo(()=>all.filter(x=>showArchived?x.hidden:!x.hidden),[all,showArchived]);
  const activeCount=all.filter(x=>!x.hidden).length;
  const archivedCount=all.length-activeCount;
  async function changeArchived(league) {
    const next=!league.hidden;
    if(next && !window.confirm(`Archive your ${league.myTeam} franchise from your library? This only hides it for you. Other managers retain access, and you can restore it anytime.`))return;
    setBusyId(league.lobby_id);setError("");
    try{
      await setOnlineFranchiseArchived(league.lobby_id,next);
      setAll(current=>current.map(x=>x.lobby_id===league.lobby_id?{...x,hidden:next}:x));
    } catch(e){setError(e.message||String(e));}
    finally{setBusyId(null);}
  }
  return <main className="on-page on-franchise-library" aria-label="Online franchise library">
    <div className="on-library-top">
      <Link className="on-back-link" to="/online">← Online Home</Link>
      <button className="on-secondary" type="button" onClick={load} disabled={loading || busyId!==null}>Refresh</button>
    </div>
    <p className="on-kicker">BASKETBALL MANAGER • ONLINE FRANCHISES</p>
    <div className="on-library-heading"><div><h1>My Shared Leagues</h1>
      <p className="on-sub">Every league your account belongs to, across devices. Online saves are separate from Local and single-player Cloud saves.</p></div>
      <div className="on-library-tally"><b>{activeCount}</b><span>Active</span><b>{archivedCount}</b><span>Archived</span></div>
    </div>
    <div className="on-library-toolbar"><div className="on-library-filter" role="group" aria-label="Franchise visibility">
      <button type="button" aria-pressed={!showArchived} className={!showArchived?"on-secondary is-current":"on-secondary"} onClick={()=>setShowArchived(false)}>My Leagues ({activeCount})</button>
      <button type="button" aria-pressed={showArchived} className={showArchived?"on-secondary is-current":"on-secondary"} onClick={()=>setShowArchived(true)}>Archived ({archivedCount})</button>
    </div><span className="on-library-tip">Archive is personal; it never removes another GM's save.</span></div>
    {error&&<p className="on-error" role="alert">{error}</p>}
    {loading?<div className="on-library-empty">Loading your shared leagues…</div>
    :!shown.length?<div className="on-library-empty"><h2>{showArchived?"No archived leagues":"No shared leagues to display"}</h2>
      <p>{showArchived?"Archived franchises will appear here and can be restored anytime.":archivedCount?"Your franchises are archived. Switch to Archived to restore one.":"Host or join a lobby to create your first shared NBA league."}</p>
      <Link to="/online">← Online Home</Link>
    </div>:<div className="on-library-list">{shown.map((league,index)=><article className="on-library-entry" key={league.lobby_id}>
      <div className="on-library-entry-head"><span className="on-kicker">FRANCHISE {index+1} · {league.roster_kind==="custom"?"CUSTOM ROSTERS":"CURRENT NBA ROSTERS"}</span><span>Revision {league.revision}</span></div>
      <h2>{league.myTeam}</h2>
      <p className="on-library-date">Started {whenCreated(league.created_at)} · {league.members.length}/4 Human GMs</p>
      <div className="on-library-members">{league.members.map(m=><span key={m.user_id}><b>{m.displayName}#{m.playerTag}</b> <small>{m.team_name}{m.user_id===league.host_id?" · Host":""}</small></span>)}</div>
      <div className="on-library-entry-actions">
        {!league.hidden&&<button type="button" className="on-primary" onClick={()=>navigate(`/online/franchise/${league.lobby_id}`)}>Continue League →</button>}
        <button type="button" className="on-secondary" disabled={busyId!==null} onClick={()=>changeArchived(league)}>{busyId===league.lobby_id?"Saving…":league.hidden?"Restore to My Leagues":"Archive for Me"}</button>
      </div>
    </article>)}</div>}
    <p className="on-library-safety">Permanent deletion is not enabled. The shared league and every manager's progress remain stored in Supabase even if you archive it here.</p>
  </main>;
}
