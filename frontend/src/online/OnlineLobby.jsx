import React,{useCallback,useEffect,useMemo,useState} from "react";
import {Link,useNavigate,useParams} from "react-router-dom";
import {lobbyState,rpc,watchTables} from "./onlineApi.js";
import FriendsPanel from "./FriendsPanel.jsx";

const NBA_IDS={
 "Atlanta Hawks":1610612737,"Boston Celtics":1610612738,"Brooklyn Nets":1610612751,"Charlotte Hornets":1610612766,
 "Chicago Bulls":1610612741,"Cleveland Cavaliers":1610612739,"Dallas Mavericks":1610612742,"Denver Nuggets":1610612743,
 "Detroit Pistons":1610612765,"Golden State Warriors":1610612744,"Houston Rockets":1610612745,"Indiana Pacers":1610612754,
 "Los Angeles Clippers":1610612746,"LA Clippers":1610612746,"Los Angeles Lakers":1610612747,"Memphis Grizzlies":1610612763,
 "Miami Heat":1610612748,"Milwaukee Bucks":1610612749,"Minnesota Timberwolves":1610612750,"New Orleans Pelicans":1610612740,
 "New York Knicks":1610612752,"Oklahoma City Thunder":1610612760,"Orlando Magic":1610612753,"Philadelphia 76ers":1610612755,
 "Phoenix Suns":1610612756,"Portland Trail Blazers":1610612757,"Sacramento Kings":1610612758,"San Antonio Spurs":1610612759,
 "Toronto Raptors":1610612761,"Utah Jazz":1610612762,"Washington Wizards":1610612764
};
function TeamBadge({team}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[team]);
 const id=NBA_IDS[team];
 return <span className="on-team-badge">{id&&!failed?<img alt="" src={`https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`} onError={()=>setFailed(true)}/>:team?.split(" ").slice(-2).map(w=>w[0]).join("").slice(0,2)||"—"}</span>;
}
export default function OnlineLobby({user,onlineProfile,setOnlineProfile}){
 const {id}=useParams();const navigate=useNavigate();
 const [state,setState]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [friendsOpen,setFriendsOpen]=useState(false),[message,setMessage]=useState("");
 const refresh=useCallback(async()=>{try{const s=await lobbyState(id);setState(s);}catch(e){setError(e.message);}},[id]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,4500);const stop=watchTables(["bm_online_lobbies","bm_online_lobby_members","bm_online_lobby_invites"],refresh);return()=>{clearInterval(timer);stop();};},[refresh]);
 async function act(action){setBusy(true);setError("");try{await action();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const lobby=state?.lobby;const members=state?.members||[];const mine=members.find(m=>m.user_id===user.id);
 const isHost=lobby?.host_id===user.id;
 const reserved=useMemo(()=>new Set(members.filter(m=>m.user_id!==user.id).map(m=>m.team_name).filter(Boolean)),[members,user.id]);
 const allReady=members.length>=2&&members.every(m=>m.ready&&m.team_name);
 async function invite(friendId){await act(()=>rpc("bm_send_online_lobby_invite",{p_lobby:id,p_recipient:friendId,p_message:message.trim()}));}
 async function leave(){await act(async()=>{await rpc("bm_leave_online_lobby",{p_lobby:id});navigate("/online");});}
 if(!state)return <main className="on-page"><p className="on-muted">Loading lobby…</p>{error&&<p className="on-error">{error}</p>}</main>;
 if(!lobby||!mine||lobby.status!=="waiting")return <main className="on-page on-empty"><h1>Lobby unavailable</h1><p className="on-muted">The host closed this room, or you are no longer a member.</p><Link className="on-primary" to="/online">Back to Online</Link></main>;
 return <main className="on-page on-lobby-page"><div className="on-between on-lobby-title"><div><Link className="on-link" to="/online">← Online Home</Link><p className="on-kicker">ONLINE FRANCHISE • PRIVATE LOBBY</p><h1>Select Your Team</h1><p className="on-sub">Everyone selects a different franchise and readies up in the same league.</p></div><div className="on-code-box"><small>LOBBY CODE</small><b>{lobby.join_code}</b><button className="on-small" onClick={()=>navigator.clipboard.writeText(lobby.join_code)}>Copy code</button></div></div>
  {error&&<p role="alert" className="on-error">{error}</p>}
  <div className="on-lobby-layout"><section className="on-panel on-team-select"><p className="on-kicker">{lobby.roster_kind==="default"?"CURRENT NBA ROSTERS":"CUSTOM LEAGUE JSON"}</p><h2>Choose your franchise</h2><p className="on-sub">Selected teams are reserved instantly. You can change teams before launching.</p>
   <div className="on-teams-grid">{(lobby.team_names||[]).map(team=><button type="button" className={`on-team-choice ${mine.team_name===team?"picked":""}`} disabled={busy||reserved.has(team)} key={team} onClick={()=>act(()=>rpc("bm_set_online_team",{p_lobby:id,p_team:team}))}>
    <TeamBadge team={team}/><span>{team}</span>{reserved.has(team)?<small>Taken</small>:mine.team_name===team?<small>Selected</small>:null}</button>)}</div>
   <div className="on-ready-bar"><div><b>{mine.team_name||"No team selected"}</b><p className="on-muted">{mine.ready?"You're ready. Unready to change your team.":"When you're happy with your team, mark yourself ready."}</p></div><button className="on-primary" disabled={busy||!mine.team_name} onClick={()=>act(()=>rpc("bm_set_online_ready",{p_lobby:id,p_ready:!mine.ready}))}>{mine.ready?"✓ Ready — click to unready":"Ready Up"}</button></div>
  </section><aside className="on-panel on-lobby-side"><div className="on-between"><h2>Lobby</h2><b className="on-count">{members.length}/4</b></div>
   {[0,1,2,3].map(i=>{const m=members[i],p=state.people[m?.user_id];return <div className="on-player-slot" key={i}>{m?<><TeamBadge team={m.team_name}/><div><b>{p?`${p.display_name}#${p.player_tag}`:"Player"}</b><small>{m.team_name||"Choosing a team"}{m.user_id===lobby.host_id?" • Host":""}</small></div><span className={m.ready?"on-ready on-is-ready":"on-ready"}>{m.ready?"✓":"✕"}</span></>:<><span className="on-team-badge">+</span><div><b>Open Slot</b><small>Waiting for player</small></div></>}</div>})}
   {isHost&&<div className="on-invite-area"><h3>Invite Friends</h3><input maxLength={140} value={message} placeholder="Optional invitation message" onChange={e=>setMessage(e.target.value)}/><button className="on-secondary" onClick={()=>setFriendsOpen(true)}>Open Friends & Invite →</button>
    {state.invites.map(inv=><div key={inv.id} className="on-social-row"><span>{state.people[inv.recipient_id]?.display_name||"Friend"} — invited</span><button className="on-small" disabled={busy} onClick={()=>act(()=>rpc("bm_cancel_online_lobby_invite",{p_invite:inv.id}))}>Cancel</button></div>)}
   </div>}
   <div className="on-lobby-footer"><p className="on-muted">{allReady?"All players ready. Online gameplay unlocks in a later beta patch.":"Waiting for everyone to choose a team and ready up."}</p><button disabled className="on-primary">Start League — Coming Soon</button><button className="on-secondary" disabled={busy} onClick={()=>{if(window.confirm(isHost?"Close this lobby for everyone?":"Leave this lobby?"))leave();}}>{isHost?"Close Lobby":"Leave Lobby"}</button></div>
  </aside></div>
  {friendsOpen&&<FriendsPanel user={user} onlineProfile={onlineProfile} onProfileChange={setOnlineProfile} onClose={()=>setFriendsOpen(false)} onInviteFriend={invite} inviteStatus={state.invites}/>}
 </main>;
}
