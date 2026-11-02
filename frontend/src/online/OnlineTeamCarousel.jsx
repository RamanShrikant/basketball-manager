import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../components/TeamSelector.module.css";
import { playSound, SOUND_KEYS } from "../audio/soundManager.js";
import { supabase } from "../auth/supabaseClient.js";

// The original TeamSelector.jsx markup and CSS-module classes are deliberately
// reproduced here. The online-only callbacks submit selections to Supabase;
// the single-player GameContext and TeamSelector.jsx are never imported.
const NBA_LOGO_SRC = "/nba_PNG20.png";
const NBA_IDS = {
  "Atlanta Hawks":1610612737,"Boston Celtics":1610612738,"Brooklyn Nets":1610612751,"Charlotte Hornets":1610612766,
  "Chicago Bulls":1610612741,"Cleveland Cavaliers":1610612739,"Dallas Mavericks":1610612742,"Denver Nuggets":1610612743,
  "Detroit Pistons":1610612765,"Golden State Warriors":1610612744,"Houston Rockets":1610612745,"Indiana Pacers":1610612754,
  "Los Angeles Clippers":1610612746,"LA Clippers":1610612746,"Los Angeles Lakers":1610612747,"Memphis Grizzlies":1610612763,
  "Miami Heat":1610612748,"Milwaukee Bucks":1610612749,"Minnesota Timberwolves":1610612750,"New Orleans Pelicans":1610612740,
  "New York Knicks":1610612752,"Oklahoma City Thunder":1610612760,"Orlando Magic":1610612753,"Philadelphia 76ers":1610612755,
  "Phoenix Suns":1610612756,"Portland Trail Blazers":1610612757,"Sacramento Kings":1610612758,"San Antonio Spurs":1610612759,
  "Toronto Raptors":1610612761,"Utah Jazz":1610612762,"Washington Wizards":1610612764
};
function getTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  const teams = Array.isArray(leagueData.teams) ? leagueData.teams : [
    ...(leagueData.conferences?.East || []), ...(leagueData.conferences?.West || []),
  ];
  return teams.filter(team => team?.name).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
}
function nbaLogo(name) {
  const id = NBA_IDS[name];
  return id ? `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg` : "";
}
function getSlotItem(slot, allTeams, cycleSize) {
  const normalized = ((slot % cycleSize) + cycleSize) % cycleSize;
  if (normalized === 0) return {key:"select-placeholder",isPlaceholder:true,name:"Select Your Team",logo:NBA_LOGO_SRC,slot:normalized};
  const team = allTeams[normalized - 1];
  return {key:team?.name || `team-${normalized}`,isPlaceholder:false,name:team?.name||"Team",logo:team?.logo||nbaLogo(team?.name),slot:normalized};
}

export default function OnlineTeamCarousel({ lobby, reservedTeams, selectedName, busy, onSelect }) {
  const [leagueData,setLeagueData]=useState(null);
  const [activeSlot,setActiveSlot]=useState(0);
  const [brokenImages,setBrokenImages]=useState({});
  const rosterKey = `${lobby?.id || ""}/${lobby?.roster_path || ""}/${lobby?.roster_kind || ""}`;

  useEffect(() => {
    let alive = true;
    setLeagueData(null);
    setBrokenImages({});
    (async () => {
      try {
        let json;
        if (lobby?.roster_kind === "custom" && lobby?.roster_path) {
          const { data, error } = await supabase.storage.from("bm-online-rosters").download(lobby.roster_path);
          if (error) throw error;
          json = JSON.parse(await data.text());
        } else {
          const response = await fetch("/defaults/default_roster.json");
          if (!response.ok) throw new Error("Roster unavailable");
          json = await response.json();
        }
        if (alive) setLeagueData(json);
      } catch {
        // Lobby team names remain authoritative even if the optional image source
        // cannot be fetched; recognizable NBA logos are used as a fallback.
        if (alive) setLeagueData({ teams: [] });
      }
    })();
    return () => { alive=false; };
  }, [rosterKey]);

  const allTeams = useMemo(() => {
    const byName = new Map(getTeamsFromLeague(leagueData).map(team => [team.name,team]));
    return (lobby?.team_names || []).map(name => ({ ...(byName.get(name) || {}),name,logo:byName.get(name)?.logo || nbaLogo(name) }));
  },[leagueData,lobby?.team_names]);
  const sortedTeams = useMemo(() => allTeams.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))),[allTeams]);
  const cycleSize = sortedTeams.length + 1;
  const normalizeSlot = useCallback(slot => ((slot % cycleSize) + cycleSize) % cycleSize,[cycleSize]);
  const moveCarousel = useCallback(dir => {
    if (cycleSize <= 1) return;
    playSound(SOUND_KEYS.TEAM_SELECTOR_CYCLE);
    setActiveSlot(prev => normalizeSlot(prev + dir));
  },[cycleSize,normalizeSlot]);
  const activeTeam = activeSlot > 0 ? sortedTeams[activeSlot - 1] || null : null;
  const handleAdvance = useCallback(() => {
    if (!activeTeam || busy || reservedTeams.has(activeTeam.name) || activeTeam.name === selectedName) return;
    playSound(SOUND_KEYS.TEAM_SELECTION_ADVANCE);
    onSelect(activeTeam.name);
  },[activeTeam,busy,reservedTeams,selectedName,onSelect]);

  useEffect(() => {
    const handleKey = e => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || e.repeat) return;
      if (e.target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],.on-drawer,.on-real-lobby-panel')) return;
      const key = String(e.key || "").toLowerCase();
      if (key === "arrowright" || key === "d") { e.preventDefault(); moveCarousel(1); return; }
      if (key === "arrowleft" || key === "a") { e.preventDefault(); moveCarousel(-1); return; }
      if (key === "enter") { e.preventDefault(); handleAdvance(); }
    };
    const handleRightClick = e => {
      if (!e.target?.closest?.('[data-online-team-selector]')) return;
      e.preventDefault(); setActiveSlot(0);
    };
    window.addEventListener("keydown",handleKey);
    window.addEventListener("contextmenu",handleRightClick);
    return () => {window.removeEventListener("keydown",handleKey);window.removeEventListener("contextmenu",handleRightClick);};
  },[handleAdvance,moveCarousel]);

  // These are the exact five visible slots, class names and controls used by
  // frontend/src/components/TeamSelector.jsx (the original single-player UI).
  const visibleCards = [-2,-1,0,1,2].map(offset => ({
    ...getSlotItem(activeSlot + offset,sortedTeams,cycleSize),offset,
  }));

  return (
    <div className={styles.wrapper} data-online-team-selector="true">
      <h1 className={styles.title}>Select Your Team</h1>
      <div className={styles.carouselShell} aria-label="Team carousel">
        <button type="button" data-on-sfx-manual="true" onClick={() => moveCarousel(-1)} disabled={cycleSize <= 1}
          className={`${styles.navArrow} ${styles.navArrowLeft}`} title="Previous team" aria-label="Previous team">◄</button>
        <div className={styles.carouselTrack}>
          {visibleCards.map((item,index) => (
            <button type="button" key={`${item.key}-${item.offset}-${index}`}
              data-on-sfx-manual="true"
              onClick={() => {
                if (item.offset !== 0) {
                  playSound(SOUND_KEYS.TEAM_SELECTOR_CYCLE);
                  setActiveSlot(item.slot);
                }
              }}
              disabled={item.offset === 0 && item.isPlaceholder}
              className={`${styles.card} ${item.offset === 0 ? styles.centerCard : styles.sideCard} ${item.isPlaceholder ? styles.placeholderCard : ""} ${activeTeam?.name === item.name && item.offset === 0 ? styles.selected : ""}`}
              data-offset={item.offset}
              title={item.isPlaceholder ? "Pick a team with the arrows" : reservedTeams.has(item.name) ? `${item.name} — taken` : item.name}>
              {item.logo && !brokenImages[item.name] ? <img src={item.logo}
                onError={() => setBrokenImages(previous => ({...previous,[item.name]:true}))}
                alt={item.isPlaceholder ? "NBA logo" : item.name}
                className={item.isPlaceholder ? styles.nbaLogo : styles.logo}/>
                : <span className="on-real-team-monogram" aria-hidden="true">{item.name.split(" ").map(x=>x[0]).slice(-3).join("")}</span>}
              <h2 className={item.isPlaceholder ? styles.placeholderName : styles.name}>{item.name}</h2>
            </button>
          ))}
        </div>
        <button type="button" data-on-sfx-manual="true" onClick={() => moveCarousel(1)} disabled={cycleSize <= 1}
          className={`${styles.navArrow} ${styles.navArrowRight}`} title="Next team" aria-label="Next team">►</button>
      </div>
      <div className={styles.controlsBar}>
        <div>← / A: PREV &nbsp;&nbsp; → / D: NEXT &nbsp;&nbsp; ENTER: ADVANCE &nbsp;&nbsp; R-CLICK: RESET</div>
        <button data-on-sfx-manual="true" onClick={handleAdvance}
          disabled={!activeTeam || busy || reservedTeams.has(activeTeam.name) || activeTeam.name === selectedName}
          className={`${styles.advanceBtn} ${activeTeam && !reservedTeams.has(activeTeam.name) && activeTeam.name !== selectedName ? styles.active : ""}`}>
          {activeTeam && reservedTeams.has(activeTeam.name) ? "Taken" : activeTeam && activeTeam.name === selectedName ? "Selected" : "Advance"}
        </button>
      </div>
    </div>
  );
}
