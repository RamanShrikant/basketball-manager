import React, {useEffect,useState,useCallback} from "react";
import {friendships,profile,profilesFor,rpc,watchTables} from "./onlineApi.js";
export default function FriendsPanel({user,onlineProfile,onClose,onProfileChange,onInviteFriend=null,inviteStatus=[]}){
 const [data,setData]=useState({friends:[],requests:[],people:{}});
 const [tag,setTag]=useState("");const [nickname,setNickname]=useState(onlineProfile.display_name);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const refresh=useCallback(async()=>{try{setData(await friendships(user.id));}catch(e){setError(e.message);}},[user.id]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,8000);const stop=watchTables(["bm_online_friend_requests","bm_online_friends"],refresh);return()=>{clearInterval(timer);stop();};},[refresh]);
 async function act(fn,success){setBusy(true);setError("");setNotice("");try{await fn();setNotice(success);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const incoming=data.requests.filter(r=>r.recipient_id===user.id),outgoing=data.requests.filter(r=>r.sender_id===user.id);
 const name=id=>data.people[id]?`${data.people[id].display_name}#${data.people[id].player_tag}`:"Unknown player";
 return <div className="on-drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="on-drawer" role="dialog" aria-modal="true" aria-label="Online friends" onMouseDown={e=>e.stopPropagation()}>
  <div className="on-between"><div><p className="on-kicker">SOCIAL</p><h2>Friends & Profile</h2></div><button className="on-small" onClick={onClose}>✕</button></div>
  <div className="on-profile-box"><b>{onlineProfile.display_name}#{onlineProfile.player_tag}</b><p>Friends add you using your four-digit ID. Email isn't shared.</p>
   <div className="on-inline"><input aria-label="Edit display name" value={nickname} maxLength={24} onChange={e=>setNickname(e.target.value)}/><button disabled={busy} className="on-small" onClick={()=>act(async()=>{const p=await profile(nickname);onProfileChange(p);},"Name updated")}>Update</button></div>
  </div>
  <form onSubmit={e=>{e.preventDefault();act(()=>rpc("bm_send_friend_request",{p_tag:tag}),"Friend request sent").then(()=>setTag(""));}}>
   <h3>Add a Friend</h3><p className="on-muted">Enter the player's exact four-digit ID.</p>
   <div className="on-inline"><input aria-label="Four-digit player ID" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={tag} onChange={e=>setTag(e.target.value.replace(/[^0-9]/g,"").slice(0,4))} placeholder="4821" required/><button disabled={busy||tag.length!==4} className="on-primary">Add</button></div>
  </form>
  {error&&<p role="alert" className="on-error">{error}</p>}{notice&&<p role="status" className="on-success">{notice}</p>}
  <h3>Friends <small>{data.friends.length}</small></h3>
  {data.friends.length===0&&<p className="on-muted">No friends yet. Send a request to invite someone into a league.</p>}
  {data.friends.map(id=><div className="on-social-row" key={id}><div><b>{name(id)}</b><small>Friend</small></div><div className="on-inline">
   {onInviteFriend&&<button disabled={busy||inviteStatus.some(s=>s.recipient_id===id)} className="on-small on-accent" onClick={()=>onInviteFriend(id)}>{inviteStatus.some(s=>s.recipient_id===id)?"Invited":"Invite"}</button>}
   <button disabled={busy} className="on-small" onClick={()=>{if(window.confirm(`Remove ${name(id)} from your friends?`))act(()=>rpc("bm_remove_friend",{p_user:id}),"Friend removed");}}>Remove</button>
  </div></div>)}
  <h3>Requests received <small>{incoming.length}</small></h3>
  {incoming.map(r=><div className="on-social-row" key={r.id}><b>{name(r.sender_id)}</b><div className="on-inline"><button disabled={busy} className="on-small on-accent" onClick={()=>act(()=>rpc("bm_answer_friend_request",{p_request:r.id,p_accept:true}),"Friend added")}>Accept</button><button disabled={busy} className="on-small" onClick={()=>act(()=>rpc("bm_answer_friend_request",{p_request:r.id,p_accept:false}),"Declined")}>Decline</button></div></div>)}
  <h3>Requests sent <small>{outgoing.length}</small></h3>
  {outgoing.map(r=><div className="on-social-row" key={r.id}><b>{name(r.recipient_id)}</b><button disabled={busy} className="on-small" onClick={()=>act(()=>rpc("bm_cancel_friend_request",{p_request:r.id}),"Request cancelled")}>Cancel</button></div>)}
 </aside></div>
}
