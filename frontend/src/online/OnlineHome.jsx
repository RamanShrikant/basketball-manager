import React,{useCallback,useEffect,useState} from "react";
import {useNavigate} from "react-router-dom";
import {defaultTeams,uploadCustomRoster,inbox,profilesFor,rpc,watchTables} from "./onlineApi.js";
import FriendsPanel from "./FriendsPanel.jsx";

export default function OnlineHome({user,onlineProfile,setOnlineProfile}){
 const navigate=useNavigate();
 const [friendsOpen,setFriendsOpen]=useState(false),[roster,setRoster]=useState("default");
 const [file,setFile]=useState(null),[code,setCode]=useState("");
 const [invites,setInvites]=useState({invites:[],people:{}});
 const [hosting,setHosting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const refresh=useCallback(async()=>{try{setInvites(await inbox(user.id));}catch(e){setError(e.message);}},[user.id]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,8500);const stop=watchTables(["bm_online_lobby_invites"],refresh);return()=>{clearInterval(timer);stop();};},[refresh]);
 async function run(fn){setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function create(){await run(async()=>{
  const uploaded=roster==="custom"?await uploadCustomRoster(file,user.id):{teams:await defaultTeams(),path:null};
  const id=await rpc("bm_create_online_lobby",{p_roster_kind:roster,p_team_names:uploaded.teams,p_roster_path:uploaded.path});
  navigate(`/online/lobby/${id}`);
 });}
 async function join(){await run(async()=>{const id=await rpc("bm_join_online_lobby",{p_code:code.trim().toUpperCase()});navigate(`/online/lobby/${id}`);});}
 return <main className="on-page"><div className="on-hero"><p className="on-kicker">BASKETBALL MANAGER • ONLINE BETA</p><div className="on-between"><div><h1>Your Online Franchise</h1><p className="on-sub">Host a private NBA universe, invite friends, and prepare to control rival teams together.</p></div><button className="on-social-trigger" onClick={()=>setFriendsOpen(true)}>👤 Friends & Profile <span>#{onlineProfile.player_tag}</span></button></div></div>
  {error&&<p className="on-error" role="alert">{error}</p>}
  <div className="on-grid"><section className="on-panel"><p className="on-kicker">CREATE</p><h2>Host a League</h2><p className="on-sub">Set your roster and open a waiting lobby for up to four people.</p>
   <div className="on-options"><button className={roster==="default"?"on-option active":"on-option"} onClick={()=>setRoster("default")}>Current NBA Rosters<small>Bundled default league</small></button>
    <button className={roster==="custom"?"on-option active":"on-option"} onClick={()=>setRoster("custom")}>Custom League<small>Upload League Editor JSON</small></button></div>
   {roster==="custom"&&<label className="on-file">League JSON file<input type="file" accept=".json,application/json" onChange={e=>setFile(e.target.files?.[0]||null)}/><small>{file?.name||"Choose a valid League Editor roster"}</small></label>}
   <button className="on-primary" disabled={busy||roster==="custom"&&!file} onClick={create}>{busy?"Setting up…":"Create Lobby →"}</button>
  </section><section className="on-panel"><p className="on-kicker">JOIN</p><h2>Join a League</h2><p className="on-sub">Enter an eight-character lobby code, or accept an invitation from a friend.</p>
   <label>Lobby code<input maxLength={8} value={code} placeholder="A1B2C3D4" onChange={e=>setCode(e.target.value.replace(/[^0-9a-f]/gi,"").toUpperCase().slice(0,8))}/></label>
   <button className="on-primary" disabled={busy||code.length!==8} onClick={join}>Join Lobby →</button>
   <div className="on-invite-list"><h3>Invitations <small>{invites.invites.length}</small></h3>{!invites.invites.length&&<p className="on-muted">No outstanding invitations.</p>}
    {invites.invites.map(x=><div className="on-invite" key={x.id}><div><b>{invites.people[x.sender_id]?.display_name||"Friend"} invited you</b><small>{x.message||"Join their private franchise lobby"}</small></div><div className="on-inline"><button className="on-small on-accent" disabled={busy} onClick={()=>run(async()=>{const id=await rpc("bm_answer_online_lobby_invite",{p_invite:x.id,p_accept:true});navigate(`/online/lobby/${id}`);})}>Join</button><button className="on-small" disabled={busy} onClick={()=>run(()=>rpc("bm_answer_online_lobby_invite",{p_invite:x.id,p_accept:false}))}>Decline</button></div></div>)}
   </div>
  </section></div>
  <div className="on-info"><b>Waiting-room beta</b><p>Live friends, invitations, team selection and ready states are available in this phase. Shared franchise gameplay and host simulation remain locked until the authoritative Online game state is implemented.</p></div>
  {friendsOpen&&<FriendsPanel user={user} onlineProfile={onlineProfile} onClose={()=>setFriendsOpen(false)} onProfileChange={setOnlineProfile}/>}
 </main>;
}
