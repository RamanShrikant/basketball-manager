import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import styles from "./PlayoffPicture.module.css";

const SCHED_KEY = "bm_schedule_v3";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const POSTSEASON_KEY = "bm_postseason_v2";

function safeJSON(raw, fallback = null) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function safeCompressedJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const decompressed = LZString.decompressFromUTF16(raw);
    return JSON.parse(decompressed || raw);
  } catch { return fallback; }
}

function getAllTeams(leagueData) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  if (leagueData?.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function loadResults() {
  const ids = safeJSON(localStorage.getItem(RESULT_V3_INDEX_KEY), []) || [];
  const out = {};
  for (const id of ids) {
    try {
      const raw = localStorage.getItem(`${RESULT_V3_PREFIX}${id}`);
      if (!raw) continue;
      const decompressed = LZString.decompressFromUTF16(raw);
      out[id] = JSON.parse(decompressed || raw);
    } catch {}
  }
  return out;
}

function computeStandings({ teams, schedule, results, confOf }) {
  const rows = {};
  for (const team of teams) {
    rows[team.name] = { team: team.name, conf: confOf(team.name), wins: 0, losses: 0, pf: 0, pa: 0, diff: 0, confWins: 0, confLosses: 0, h2h: {} };
  }

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id || String(game.id).startsWith("PO_") || String(game.id).startsWith("PI_")) continue;
      const result = results?.[game.id];
      if (!game.played && !result?.totals) continue;
      if (!result?.totals || !rows[game.home] || !rows[game.away]) continue;
      const homePts = Number(result.totals.home || 0);
      const awayPts = Number(result.totals.away || 0);
      if (homePts === awayPts) continue;
      const homeWon = homePts > awayPts;
      const home = rows[game.home];
      const away = rows[game.away];
      home.pf += homePts; home.pa += awayPts;
      away.pf += awayPts; away.pa += homePts;
      if (homeWon) { home.wins += 1; away.losses += 1; } else { away.wins += 1; home.losses += 1; }
      if (home.conf && home.conf === away.conf) {
        if (homeWon) { home.confWins += 1; away.confLosses += 1; } else { away.confWins += 1; home.confLosses += 1; }
      }
      home.h2h[game.away] ||= { w: 0, l: 0 };
      away.h2h[game.home] ||= { w: 0, l: 0 };
      if (homeWon) { home.h2h[game.away].w += 1; away.h2h[game.home].l += 1; }
      else { away.h2h[game.home].w += 1; home.h2h[game.away].l += 1; }
    }
  }

  for (const row of Object.values(rows)) {
    row.diff = row.pf - row.pa;
    const gp = row.wins + row.losses;
    row.winPct = gp ? row.wins / gp : 0;
    const cgp = row.confWins + row.confLosses;
    row.confPct = cgp ? row.confWins / cgp : 0;
  }
  return rows;
}

function sortWithTiebreak(names, standings) {
  return [...names].sort((A, B) => {
    const a = standings[A]; const b = standings[B];
    if (!a || !b) return String(A).localeCompare(String(B));
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    const h2hA = a.h2h?.[B]; const h2hB = b.h2h?.[A];
    if (h2hA && h2hB) {
      const games = h2hA.w + h2hA.l;
      if (games) {
        const aPct = h2hA.w / games; const bPct = h2hB.w / games;
        if (bPct !== aPct) return bPct - aPct;
      }
    }
    if (b.confPct !== a.confPct) return b.confPct - a.confPct;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return String(A).localeCompare(String(B));
  });
}

function teamLogo(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || team?.img || "";
}

function TeamLine({ seed, name, logo, wins = null, record = "", winner = false, placeholder = "TBD" }) {
  const displayName = name || placeholder;
  return (
    <div className={`flex h-10 items-center gap-2 px-3 ${winner ? "bg-orange-500/15" : ""}`}>
      <div className="w-5 text-center text-[11px] font-black text-white/45">{seed || ""}</div>
      {logo ? <img src={logo} alt="" className="h-7 w-7 object-contain" /> : <div className="h-7 w-7 rounded-full bg-white/5" />}
      <div className={`min-w-0 flex-1 truncate text-xs font-black ${name ? "text-white" : "text-white/35"}`}>{displayName}</div>
      {record && <div className="text-[10px] font-bold text-white/40">{record}</div>}
      {wins !== null && <div className="min-w-5 text-right text-sm font-black text-orange-300">{wins}</div>}
    </div>
  );
}

function MatchupCard({ title, top, bottom }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950/90 shadow-xl">
      <div className="border-b border-white/10 bg-white/[0.035] px-3 py-1 text-[9px] font-black uppercase tracking-[0.17em] text-orange-300/80">{title}</div>
      <TeamLine {...top} />
      <div className="h-px bg-white/[0.07]" />
      <TeamLine {...bottom} />
    </div>
  );
}

function PlayInView({ conferenceKeys, picture, logos, standings, historical }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-auto p-5 lg:grid-cols-2">
      {conferenceKeys.map((confKey) => {
        const conf = picture?.conferences?.[confKey] || {};
        const seeds = conf.seedOrder || [];
        const pi = conf.playIn || {};
        const makeNode = (node, fallbackA, fallbackB, labelA, labelB) => ({
          title: node?.played ? `${node.homeScore}-${node.awayScore}${node.otCount ? ` (${node.otCount}OT)` : ""}` : "Projected Matchup",
          top: { seed: labelA, name: node?.home || fallbackA, logo: logos[node?.home || fallbackA], wins: node?.played ? (node.winner === node.home ? 1 : 0) : null, record: !historical ? recordOf(standings[node?.home || fallbackA]) : "", winner: node?.winner === node?.home },
          bottom: { seed: labelB, name: node?.away || fallbackB, logo: logos[node?.away || fallbackB], wins: node?.played ? (node.winner === node.away ? 1 : 0) : null, record: !historical ? recordOf(standings[node?.away || fallbackB]) : "", winner: node?.winner === node?.away },
        });
        const game78 = makeNode(pi.g78, seeds[6], seeds[7], 7, 8);
        const game910 = makeNode(pi.g910, seeds[8], seeds[9], 9, 10);
        const final = makeNode(pi.gFinal, pi.g78?.loser || "Loser 7/8", pi.g910?.winner || "Winner 9/10", "", "");
        return (
          <section key={confKey} className="rounded-2xl border border-white/10 bg-neutral-900/80 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-black">{confKey}</h2>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">Seeds 7–10</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MatchupCard title="7 vs 8" top={game78.top} bottom={game78.bottom} />
              <MatchupCard title="9 vs 10" top={game910.top} bottom={game910.bottom} />
            </div>
            <div className="my-4 text-center text-[10px] font-black uppercase tracking-[0.15em] text-white/35">Final seed game</div>
            <div className="mx-auto max-w-[430px]"><MatchupCard title={final.title} top={final.top} bottom={final.bottom} /></div>
          </section>
        );
      })}
    </div>
  );
}

function recordOf(row) {
  return row ? `${row.wins}-${row.losses}` : "";
}

function seriesCard(series, title, logos) {
  return {
    title,
    top: { seed: series?.highSeedNum, name: series?.highSeedTeam, logo: logos[series?.highSeedTeam], wins: series ? Number(series.winsHigh || 0) : null, winner: Boolean(series?.complete && Number(series.winsHigh || 0) > Number(series.winsLow || 0)) },
    bottom: { seed: series?.lowSeedNum, name: series?.lowSeedTeam, logo: logos[series?.lowSeedTeam], wins: series ? Number(series.winsLow || 0) : null, winner: Boolean(series?.complete && Number(series.winsLow || 0) > Number(series.winsHigh || 0)) },
  };
}

function projectedConference(seeds = []) {
  const make = (highIndex, lowName, label) => ({ label, highSeedTeam: seeds[highIndex], lowSeedTeam: lowName, highSeedNum: highIndex + 1, lowSeedNum: Number(String(label).split("v")[1]) || null, winsHigh: 0, winsLow: 0, complete: false });
  return {
    seedOrder: seeds,
    rounds: {
      r1: { s1v8: make(0, "Play-In 8 Seed", "1v8"), s4v5: make(3, seeds[4], "4v5"), s3v6: make(2, seeds[5], "3v6"), s2v7: make(1, "Play-In 7 Seed", "2v7") },
      r2: { top: null, bot: null },
      r3: { confFinals: null },
    },
    playIn: { g78: null, g910: null, gFinal: null },
  };
}

function BracketView({ conferenceKeys, picture, logos }) {
  return (
    <div className={`${styles.scroll} min-h-0 flex-1 overflow-auto px-5 pb-5`}>
      <div className="mx-auto grid min-w-[1260px] max-w-[1560px] grid-cols-[1fr_260px_1fr] gap-5 pt-4">
        {conferenceKeys.map((confKey, conferenceIndex) => {
          const conf = picture?.conferences?.[confKey] || {};
          const r1 = conf?.rounds?.r1 || {};
          const r2 = conf?.rounds?.r2 || {};
          const r3 = conf?.rounds?.r3 || {};
          const content = (
            <section className="rounded-2xl border border-white/10 bg-neutral-900/65 p-4">
              <h2 className={`mb-3 text-xl font-black ${conferenceIndex ? "text-right" : ""}`}>{confKey}</h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-3">
                  {[[r1.s1v8,"First Round"],[r1.s4v5,"First Round"],[r1.s3v6,"First Round"],[r1.s2v7,"First Round"]].map(([series,title], i) => { const card=seriesCard(series,title,logos); return <MatchupCard key={i} {...card}/>; })}
                </div>
                <div className="flex flex-col justify-around gap-4 py-10">
                  {[r2.top,r2.bot].map((series,i)=>{ const card=seriesCard(series,"Conference Semifinals",logos); return <MatchupCard key={i} {...card}/>; })}
                </div>
                <div className="flex items-center"><div className="w-full"><MatchupCard {...seriesCard(r3.confFinals,"Conference Finals",logos)} /></div></div>
              </div>
            </section>
          );
          return (
            <div key={confKey} className={conferenceIndex === 0 ? "col-start-1 row-start-1" : "col-start-3 row-start-1"}>
              {content}
            </div>
          );
        })}
        <div className="col-start-2 row-start-1 flex items-center">
          <div className="w-full rounded-2xl border border-orange-400/20 bg-neutral-900/85 p-3">
            <div className="mb-2 text-center text-xs font-black uppercase tracking-[0.2em] text-orange-300">NBA Finals</div>
            <MatchupCard {...seriesCard(picture?.finals,"Finals",logos)} />
            {picture?.champion && <div className="mt-3 text-center text-sm font-black text-orange-300">Champion: {picture.champion}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlayoffPicture() {
  const navigate = useNavigate();
  const { leagueData } = useGame();
  const [view, setView] = useState("playoffs");
  const teams = useMemo(() => getAllTeams(leagueData), [leagueData]);
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const livePostseason = safeCompressedJSON(POSTSEASON_KEY, null);
  const isOffseason = Boolean(offseasonState?.active || offseasonState?.inOffseason || offseasonState?.offseason);
  const isActivePostseason = Boolean(livePostseason && !isOffseason);

  useEffect(() => {
    if (isActivePostseason) navigate("/playoffs", { replace: true });
  }, [isActivePostseason, navigate]);

  const logos = useMemo(() => Object.fromEntries(teams.map((team) => [team.name, teamLogo(team)])), [teams]);
  const historicalEntry = useMemo(() => {
    const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
    return [...history].filter((row) => row?.postseasonBracket).sort((a,b)=>Number(b.seasonYear||0)-Number(a.seasonYear||0))[0] || null;
  }, [leagueData]);

  const schedule = useMemo(() => safeJSON(localStorage.getItem(SCHED_KEY), {}) || {}, []);
  const results = useMemo(() => loadResults(), []);
  const conferenceKeys = useMemo(() => {
    const keys = Object.keys(leagueData?.conferences || {});
    if (keys.length) return keys.slice(0,2);
    return [...new Set(teams.map((team)=>team.conference || team.conf).filter(Boolean))].slice(0,2);
  }, [leagueData, teams]);
  const teamByName = useMemo(() => Object.fromEntries(teams.map((team)=>[team.name,team])), [teams]);
  const confOf = (name) => {
    for (const [key, list] of Object.entries(leagueData?.conferences || {})) if ((list || []).some((team)=>team.name===name)) return key;
    return teamByName[name]?.conference || teamByName[name]?.conf || null;
  };
  const standings = useMemo(() => computeStandings({ teams, schedule, results, confOf }), [teams, schedule, results]);
  const gamesPlayed = useMemo(() => Object.values(standings).reduce((sum,row)=>sum+row.wins+row.losses,0)/2, [standings]);
  const seedOrder = useMemo(() => Object.fromEntries(conferenceKeys.map((key)=>{
    const names=Object.values(standings).filter((row)=>row.conf===key).map((row)=>row.team);
    return [key,sortWithTiebreak(names,standings).slice(0,10)];
  })), [conferenceKeys, standings]);

  const historical = Boolean(isOffseason && historicalEntry?.postseasonBracket);
  const picture = useMemo(() => {
    if (historical) return historicalEntry.postseasonBracket;
    return {
      version: "projected_playoff_picture_v1",
      seasonYear: Number(leagueData?.seasonYear || 2025),
      conferences: Object.fromEntries(conferenceKeys.map((key)=>[key,projectedConference(seedOrder[key] || [])])),
      finals: null,
      champion: null,
    };
  }, [historical, historicalEntry, leagueData, conferenceKeys, seedOrder]);
  const displayConferenceKeys = Object.keys(picture?.conferences || {}).slice(0,2);
  const seasonYear = Number(picture?.seasonYear || historicalEntry?.seasonYear || leagueData?.seasonYear || 2025);

  if (isActivePostseason) return null;

  return (
    <PageFade>
      <div className={styles.page}>
        <div className={`${styles.stage} flex h-full min-h-0 flex-col`}>
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
            <button onClick={()=>navigate("/team-hub", { state: isOffseason ? { offseasonMode:true, returnTo:"/offseason" } : undefined })} className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-black hover:bg-neutral-700">Team Hub</button>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-orange-300/70">{historical ? "Most Recent Completed Postseason" : "If the season ended today"}</div>
              <h1 className="text-2xl font-black">PLAYOFF PICTURE</h1>
            </div>
            <div className="flex w-[220px] justify-end gap-2">
              <button onClick={()=>setView("playin")} className={`rounded-lg px-3 py-2 text-xs font-black ${view==="playin"?"bg-orange-600":"bg-neutral-800 hover:bg-neutral-700"}`}>Play-In</button>
              <button onClick={()=>setView("playoffs")} className={`rounded-lg px-3 py-2 text-xs font-black ${view==="playoffs"?"bg-orange-600":"bg-neutral-800 hover:bg-neutral-700"}`}>Playoffs</button>
            </div>
          </header>
          <div className="shrink-0 border-b border-white/10 bg-black/20 px-5 py-2 text-center text-xs font-bold text-white/45">
            {seasonYear}-{String(seasonYear + 1).slice(-2)}{historical && picture?.champion ? ` · ${picture.champion}` : ""}
          </div>
          {!historical && gamesPlayed <= 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div className="max-w-xl rounded-2xl border border-white/10 bg-neutral-900/85 p-8">
                <h2 className="text-2xl font-black text-orange-300">No standings yet</h2>
                <p className="mt-2 text-sm font-bold text-white/45">Simulate at least one regular-season game to generate a meaningful playoff picture.</p>
              </div>
            </div>
          ) : view === "playin" ? (
            <PlayInView conferenceKeys={displayConferenceKeys} picture={picture} logos={logos} standings={standings} historical={historical} />
          ) : (
            <BracketView conferenceKeys={displayConferenceKeys} picture={picture} logos={logos} />
          )}
        </div>
      </div>
    </PageFade>
  );
}
