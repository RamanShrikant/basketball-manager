import React from "react";
import {playerHeadshotOf, playerOverall} from "../utils/teamIntel_v1.js";

// Intentionally never imports PlayerCardModal: its single-player trends and
// save-specific display helpers can read localStorage. Online modal is pure.
export default function OnlinePlayerQuickView({open,player,teamName,onClose}) {
  if(!open||!player)return null;
  return <div className="bmOnlinePlayerBackdrop" role="presentation" onMouseDown={onClose}>
    <section className="bmOnlinePlayerCard" role="dialog" aria-modal="true" aria-label="Online player details" onMouseDown={e=>e.stopPropagation()}>
      <button type="button" aria-label="Close player details" onClick={onClose} className="bmOnlinePlayerClose">×</button>
      {playerHeadshotOf(player)&&<img src={playerHeadshotOf(player)} alt=""/>}
      <h2>{player.name||player.player||"Player"}</h2>
      <p>{teamName} · {player.pos||player.position||"—"}</p>
      <strong>{playerOverall(player)||"—"} OVR</strong>
      <small>Read-only shared franchise snapshot</small>
    </section>
  </div>;
}
