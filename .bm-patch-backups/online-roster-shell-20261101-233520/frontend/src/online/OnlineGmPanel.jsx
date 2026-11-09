import React, {useState} from "react";
import {Link} from "react-router-dom";

export default function OnlineGmPanel({room, user, revision, onRefresh, refreshing=false, syncError=""}) {
  const [open,setOpen] = useState(true);
  const members = room?.members || [];
  return <>
    <button type="button" className={`bmOnlineGmToggle ${open?"bmOnlineGmToggleOpen":""}`}
      aria-label={open?"Hide multiplayer players panel":"Show multiplayer players panel"}
      aria-expanded={open} onClick={()=>setOpen(x=>!x)}>{open?"❯":"❮"}</button>
    <aside className={`bmOnlineGmPanel ${open?"bmOnlineGmPanelOpen":""}`} aria-label="Multiplayer players">
      <div className="bmOnlineGmHeader"><strong>Multiplayer</strong><small>{members.length}/4</small></div>
      <div className="bmOnlineGmSub">Online franchise · Revision {revision}</div>
      {members.map(m=>{
        const p=room?.people?.[m.user_id];
        return <div className="bmOnlineGmPlayer" key={m.user_id}>
          <span className="bmOnlineGmDot" aria-hidden="true">{m.user_id===room?.lobby?.host_id?"★":"•"}</span>
          <div><b>{p?.display_name || "Player"}<em>#{p?.player_tag || "----"}</em>{m.user_id===user.id?" (You)":""}</b>
            <small>{m.team_name || "Team not assigned"}{m.user_id===room?.lobby?.host_id?" · Host":""}</small></div>
        </div>;
      })}
      {Array.from({length:Math.max(0,4-members.length)}).map((_,i)=><div key={i} className="bmOnlineGmPlayer bmOnlineGmOpenSlot"><span>+</span><div><b>Open Slot</b><small>Private league</small></div></div>)}
      <div className="bmOnlineRuntimeControls">
        <button type="button" onClick={onRefresh} disabled={refreshing || !onRefresh}>
          {refreshing?"Refreshing…":"↻ Refresh shared state"}
        </button>
        {syncError&&<small role="status" className="bmOnlineRuntimeError">Sync check failed: {syncError}. Showing last loaded league.</small>}
      </div>
      <div className="bmOnlineGmFooter"><span>Authoritative shared snapshot · Read-only actions</span><Link to="/online/library">My Shared Leagues</Link><Link to="/online">← Exit to Online Home</Link><a href="/game-modes">← Game Modes</a></div>
    </aside>
  </>;
}
