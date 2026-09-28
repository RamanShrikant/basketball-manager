// src/pages/Awards.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import AllNbaTeams from "./AllNbaTeams";
import LZString from "lz-string";
import styles from "./Awards.module.css";
import PageFade from "../components/PageFade";
import PlayerPortraitFrame from "../components/PlayerPortraitFrame.jsx";
import "../styles/BMAnimations.css";
console.log("✅ Awards.jsx NEW loaded");



/* -------------------------------------------------------------------------- */
/*                               AWARD CONSTANTS                              */
/* -------------------------------------------------------------------------- */

const AWARD_ORDER = ["mvp", "dpoy", "sixth_man", "mip", "clutch_player", "roty"];
const PARTY_AWARD_KEYS = [...AWARD_ORDER];
const AWARD_DISPLAY_STATS_KEY = "bm_award_display_stats_v1";

const AWARD_META = {
  mvp: {
    label: "Most Valuable Player",
    short: "MVP",
    description: "Awarded to the most valuable player of the regular season.",
  },
  dpoy: {
    label: "Defensive Player of the Year",
    short: "DPOY",
    description:
      "Awarded to the top defensive player of the NBA regular season.",
  },
  sixth_man: {
    label: "Sixth Man of the Year",
    short: "6MOY",
    description:
      "Awarded to the league's most valuable player coming off the bench.",
  },
  mip: {
    label: "Most Improved Player",
    short: "MIP",
    description:
      "Awarded to the player with the strongest season-to-season breakout.",
  },
  clutch_player: {
    label: "Clutch Player of the Year",
    short: "CPOTY",
    description:
      "Awarded to the league's top late-game performer during the regular season.",
  },
  roty: {
    label: "Rookie of the Year",
    short: "ROTY",
    description:
      "Awarded to the most outstanding rookie during the regular season.",
  },
};

/* -------------------------------------------------------------------------- */
/*                               NORMALIZATION                                */
/* -------------------------------------------------------------------------- */

function fromEntriesMaybe(arr) {
  if (!Array.isArray(arr)) return arr;
  return Object.fromEntries(arr);
}

function normalizeAwards(raw) {
  if (!raw) return null;

  let awards = raw;

  // LocalStorage format: array of [key, value] pairs.
  if (Array.isArray(raw)) {
    awards = Object.fromEntries(raw);
  }

  // Winners (single objects)
  for (const key of ["mvp", "dpoy", "roty", "sixth_man", "mip", "clutch_player"]) {
    if (awards[key] && Array.isArray(awards[key])) {
      awards[key] = fromEntriesMaybe(awards[key]);
    }
  }

  // Races (arrays of objects)
  for (const key of ["mvp_race", "dpoy_race", "roty_race", "sixth_man_race", "mip_race", "clutch_player_race"]) {
    if (Array.isArray(awards[key])) {
      awards[key] = awards[key].map((entry) =>
        Array.isArray(entry) ? Object.fromEntries(entry) : entry
      );
    }
  }

  // 🔥 NEW: All-NBA teams (arrays of objects)
  for (const key of ["all_nba_first", "all_nba_second", "all_nba_third"]) {
    if (Array.isArray(awards[key])) {
      awards[key] = awards[key].map((entry) =>
        Array.isArray(entry) ? Object.fromEntries(entry) : entry
      );
    }
  }

  return awards;
}



/* -------------------------------------------------------------------------- */
/*                               STATS HELPERS                                */
/* -------------------------------------------------------------------------- */

function buildPerGameRow(name, team, stats) {
  if (!stats) return null;
  const gp = stats.gp || 1;

  const min = (stats.min || 0) / gp;
  const pts = (stats.pts || 0) / gp;
  const reb = (stats.reb || 0) / gp;
  const ast = (stats.ast || 0) / gp;
  const stl = (stats.stl || 0) / gp;
  const blk = (stats.blk || 0) / gp;

  const fgPct =
    stats.fga && stats.fga > 0 ? (stats.fgm / stats.fga) * 100 : 0;
  const tpPct =
    stats.tpa && stats.tpa > 0 ? (stats.tpm / stats.tpa) * 100 : 0;
  const ftPct =
    stats.fta && stats.fta > 0 ? (stats.ftm / stats.fta) * 100 : 0;

  const fmt = (x) => (Number.isFinite(x) ? Number(x.toFixed(1)) : 0);

  return {
    name,
    team,
    gp: stats.gp || 0,
    gs: Number(stats.started ?? stats.gs ?? stats.gamesStarted ?? 0),
    min: fmt(min),
    pts: fmt(pts),
    reb: fmt(reb),
    ast: fmt(ast),
    stl: fmt(stl),
    blk: fmt(blk),
    fgPct: Number.isFinite(fgPct) ? Number(fgPct.toFixed(1)) : 0,
    tpPct: Number.isFinite(tpPct) ? Number(tpPct.toFixed(1)) : 0,
    ftPct: Number.isFinite(ftPct) ? Number(ftPct.toFixed(1)) : 0,
  };
}

function statsKey(player, team) {
  return `${player}__${team}`;
}

function combineAwardStatsMapRows(statsMap, playerName, currentTeamName = "") {
  const name = String(playerName || "").trim();
  if (!name) return null;

  const records = Object.entries(statsMap || {})
    .filter(([key, row]) => (row?.player || key.split("__")[0]) === name && Number(row?.gp || 0) > 0)
    .map(([, row]) => row);

  if (!records.length) return null;

  const total = {
    player: name,
    team: currentTeamName || records[records.length - 1]?.team || "",
    gp: 0,
    min: 0,
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    started: 0,
  };

  for (const row of records) {
    total.gp += Number(row.gp || 0);
    total.min += Number(row.min || 0);
    total.pts += Number(row.pts || 0);
    total.reb += Number(row.reb || 0);
    total.ast += Number(row.ast || 0);
    total.stl += Number(row.stl || 0);
    total.blk += Number(row.blk || 0);
    total.fgm += Number(row.fgm || 0);
    total.fga += Number(row.fga || 0);
    total.tpm += Number(row.tpm || 0);
    total.tpa += Number(row.tpa || 0);
    total.ftm += Number(row.ftm || 0);
    total.fta += Number(row.fta || 0);
    total.started += Number(row.started ?? row.gs ?? row.gamesStarted ?? 0);
  }

  return total;
}

function readCompressedOrJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }

    try {
      return JSON.parse(raw);
    } catch {}

    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function loadPlayerStatsFromStorage() {
  const display = readCompressedOrJson(AWARD_DISPLAY_STATS_KEY, {});
  if (display && Object.keys(display).length) return display;
  return readCompressedOrJson("bm_player_stats_v1", {});
}

function fmtAward1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(1)) : 0;
}

function fmtSignedAward1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "+0.0";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

/* -------------------------------------------------------------------------- */
/*                          LEAGUE / PORTRAIT / LOGOS                         */
/* -------------------------------------------------------------------------- */

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) {
    return Object.values(leagueData.conferences).flat();
  }
  return [];
}

function buildPlayerPortraitIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};

  for (const team of teams) {
    for (const bucket of [team?.players, team?.twoWayPlayers, team?.stashPlayers]) {
      for (const p of bucket || []) {
        const playerName = p?.name || p?.player;
        if (!playerName) continue;
        const key = statsKey(playerName, team.name);
        // Preserve the full player identity. Generated rookies need portraitId /
        // portraitFamilyId so RuntimePlayerPortrait can replace their baked draft
        // attire with the jersey of the team they actually play for.
        idx[key] = {
          ...p,
          teamName: team.name,
          team: team.name,
        };
      }
    }
  }

  return idx;
}

function buildTeamLogoIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};
  for (const t of teams) {
    idx[t.name] =
      t.logo ||
      t.teamLogo ||
      t.logoUrl ||
      t.image ||
      t.img ||
      t.newTeamLogo ||
      null;
  }
  return idx;
}


function getAwardsDisplaySeason(awards) {
  const raw = Number(awards?.season);

  if (Number.isFinite(raw) && raw > 1900) {
    return raw + 1;
  }

  return awards?.season || "Season";
}

/* -------------------------------------------------------------------------- */
/*                                 COMPONENT                                  */
/* -------------------------------------------------------------------------- */

export default function Awards() {
  const navigate = useNavigate();
  const { leagueData } = useGame();

  const awardsRaw = useMemo(
    () => JSON.parse(localStorage.getItem("bm_awards_v1") || "null"),
    []
  );
  const awards = useMemo(() => normalizeAwards(awardsRaw), [awardsRaw]);

  const statsMap = useMemo(
    () => loadPlayerStatsFromStorage(),
    []
  );

  const portraitsIndex = useMemo(
    () => buildPlayerPortraitIndex(leagueData),
    [leagueData]
  );

  const teamLogosIndex = useMemo(
    () => buildTeamLogoIndex(leagueData),
    [leagueData]
  );

const [awardIndex, setAwardIndex] = useState(0);
const [showAllNba, setShowAllNba] = useState(false);
const [mvpPartyActive, setMvpPartyActive] = useState(false);
const [mvpPartyShakeActive, setMvpPartyShakeActive] = useState(false);
const [mvpPartyPieces, setMvpPartyPieces] = useState([]);
  const currentKey = AWARD_ORDER[awardIndex];
  const meta = AWARD_META[currentKey];
  const season = getAwardsDisplaySeason(awards);

  const winner = awards?.[currentKey] || null;
  const race = awards?.[`${currentKey}_race`] || [];

  const winnerRow = useMemo(() => {
    if (!winner?.player || !winner?.team) return null;
    const stats = combineAwardStatsMapRows(statsMap, winner.player, winner.team);
    return buildPerGameRow(winner.player, winner.team, stats);
  }, [winner, statsMap]);

  const winnerPlayer = useMemo(() => {
    if (!winner?.player || !winner?.team) return null;
    return portraitsIndex[statsKey(winner.player, winner.team)] || null;
  }, [winner, portraitsIndex]);

  const portraitSrc = useMemo(() => {
    if (!winnerPlayer) return null;
    return (
      winnerPlayer.headshot ||
      winnerPlayer.portrait ||
      winnerPlayer.image ||
      winnerPlayer.photo ||
      winnerPlayer.img ||
      winnerPlayer.face ||
      null
    );
  }, [winnerPlayer]);

const isLastAward = awardIndex === AWARD_ORDER.length - 1;

const goPrev = () => {
  // if you’re on the All-NBA screen, go back to Awards (last award)
  if (showAllNba) {
    setShowAllNba(false);
    return;
  }
  setAwardIndex((i) => Math.max(0, i - 1));
};

const goNext = () => {
  if (!isLastAward) {
    setAwardIndex((i) => Math.min(AWARD_ORDER.length - 1, i + 1));
  } else {
    // last award -> All-NBA screen
    setShowAllNba(true);
  }
};


  const hasWinner = !!winner && !!winnerRow;

  const mvpPartyLogo = useMemo(() => {
    if (!PARTY_AWARD_KEYS.includes(currentKey) || !winner?.team) return null;
    return teamLogosIndex[winner.team] || null;
  }, [currentKey, winner, teamLogosIndex]);

  useEffect(() => {
    if (!PARTY_AWARD_KEYS.includes(currentKey)) {
      setMvpPartyActive(false);
      setMvpPartyShakeActive(false);
      setMvpPartyPieces([]);
      return;
    }

    if (!hasWinner || !mvpPartyLogo) {
      setMvpPartyActive(false);
      setMvpPartyShakeActive(false);
      setMvpPartyPieces([]);
      return;
    }

    const pieces = Array.from({ length: 48 }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      left: Math.random() * 100,
      xStart: Math.random() * 80 - 40,
      xEnd: Math.random() * 360 - 180,
      delay: Math.random() * 500,
      duration: 1600 + Math.random() * 1100,
      spin: 360 + Math.random() * 900,
      size: 22 + Math.random() * 28,
      opacity: 0.55 + Math.random() * 0.45,
    }));

    const longestPieceMs = Math.max(
      ...pieces.map((piece) => piece.delay + piece.duration)
    );

    setMvpPartyActive(false);
    setMvpPartyShakeActive(false);

    const startTimer = setTimeout(() => {
      setMvpPartyPieces(pieces);
      setMvpPartyActive(true);
      setMvpPartyShakeActive(true);
    }, 20);

    const shakeTimer = setTimeout(() => {
      setMvpPartyShakeActive(false);
    }, 650);

    const stopTimer = setTimeout(() => {
      setMvpPartyActive(false);
      setMvpPartyPieces([]);
    }, longestPieceMs + 350);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(shakeTimer);
      clearTimeout(stopTimer);
    };
  }, [currentKey, hasWinner, mvpPartyLogo]);

  function getAwardStatSpecs(row, awardKey) {
    if (!row) return [];

    const benchGames = Math.max(0, Number(row.gp || 0) - Number(row.gs || 0));

    if (awardKey === "dpoy") {
      return [
        { label: "GP", value: row.gp },
        { label: "RPG", value: row.reb },
        { label: "SPG", value: row.stl },
        { label: "BPG", value: row.blk },
      ];
    }

    if (awardKey === "sixth_man") {
      return [
        { label: "G(B)", value: benchGames },
        { label: "PPG", value: row.pts },
        { label: "RPG", value: row.reb },
        { label: "APG", value: row.ast },
        { label: "SPG", value: row.stl },
        { label: "BPG", value: row.blk },
      ];
    }

    if (awardKey === "mip" || awardKey === "clutch_player") {
      return [
        { label: "GP", value: row.gp },
        { label: "PPG", value: row.pts },
        { label: "RPG", value: row.reb },
        { label: "APG", value: row.ast },
        { label: "SPG", value: row.stl },
        { label: "BPG", value: row.blk },
      ];
    }

    return [
      { label: "GP", value: row.gp },
      { label: "PPG", value: row.pts },
      { label: "RPG", value: row.reb },
      { label: "APG", value: row.ast },
      { label: "SPG", value: row.stl },
      { label: "BPG", value: row.blk },
    ];
  }

  function renderWinnerStatRibbon() {
    if (!hasWinner) return null;
    const statsForAward = getAwardStatSpecs(winnerRow, currentKey);

    return (
      <div
        className="grid gap-2 text-center"
        style={{ gridTemplateColumns: `repeat(${statsForAward.length}, minmax(0, 1fr))` }}
      >
        {statsForAward.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-neutral-950/70 px-2 py-2"
          >
            <div className="text-[10px] font-bold uppercase tracking-wide text-orange-300/85">
              {stat.label}
            </div>
            <div className="truncate text-[17px] font-black leading-tight text-white">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderRaceStat(label, value) {
    return (
      <span className="whitespace-nowrap text-right">
        <span className="font-semibold text-white/70">{label}</span>{" "}
        <span className="font-black text-white">{value}</span>
      </span>
    );
  }
if (showAllNba) {
  return <AllNbaTeams leagueDataProp={leagueData} onBackToAwards={() => setShowAllNba(false)} />;
}


  return (
    <PageFade>
      <div className={`${styles.awardsPage} bmCourtPage h-full min-h-0 overflow-hidden p-3 text-white`}>
        {mvpPartyActive && mvpPartyLogo && (
          <div className={styles.mvpPartyLayer} aria-hidden="true">
            <div className={styles.mvpPartyPulse} />

            {mvpPartyPieces.map((piece) => (
              <img
                key={piece.id}
                src={mvpPartyLogo}
                alt=""
                draggable="false"
                className={styles.mvpPartyLogo}
                style={{
                  left: `${piece.left}%`,
                  "--x-start": `${piece.xStart}px`,
                  "--x-end": `${piece.xEnd}px`,
                  "--delay": `${piece.delay}ms`,
                  "--dur": `${piece.duration}ms`,
                  "--spin": `${piece.spin}deg`,
                  "--size": `${piece.size}px`,
                  "--logo-opacity": piece.opacity,
                }}
              />
            ))}
          </div>
        )}
        <style>{`
          @keyframes bmAwardStepEnter {
            from {
              opacity: 0;
              transform: translateY(10px) scale(0.99);
              filter: blur(2px);
            }

            to {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0px);
            }
          }

          .bmAwardStepEnter {
            animation: bmAwardStepEnter 260ms ease-out both;
          }

          @media (prefers-reduced-motion: reduce) {
            .bmAwardStepEnter {
              animation: none;
            }
          }
        `}</style>

      <div
        className={`max-w-[1420px] mx-auto px-4 ${
          mvpPartyShakeActive ? styles.mvpContentShake : ""
        }`}
      >
        {/* TITLE (global page title) 
            - text-3xl: change to text-4xl to make "2025 Season Awards" bigger */}
        <h1 className="mb-3 text-center text-3xl font-extrabold text-orange-500">
          {season} Season Awards
        </h1>

        <div key={currentKey} className="bmAwardStepEnter">
        {/* TOP ROW */}
        <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          {/* WINNER CARD ----------------------------------------------------- */}
          {/* CARD SIZE / PADDING / BORDER:
               - flex-1 lg:flex-[1.6]   → relative width vs ladder card
               - px-6 pt-3 pb-2        → inner padding; increase/decrease to move content away from edges
               - border-orange-500/80  → change thickness/color here (add border-2, etc.) */}
          <div className="flex h-[430px] flex-col overflow-hidden rounded-xl border border-orange-500/80 bg-neutral-900 px-5 pt-4 pb-0 shadow-lg">
            {/* Header block (award label + player name + team) */}
            <div>
              {/* AWARD LABEL TEXT ("MOST VALUABLE PLAYER")
                  - text-sm           → change to text-xs / text-base / text-lg to resize
                  - tracking-wide    → spacing between letters
                  - text-orange-400  → color */}
              <div className="text-sm font-semibold uppercase tracking-wide text-orange-400">
                {meta.label}
              </div>

              {/* PLAYER NAME TEXT
                  - text-4xl          → main knob for name size
                  - mt-1              → vertical gap between label and name */}
              <div className="mt-1 break-words text-[32px] font-black leading-[0.98]">
                {hasWinner ? winner.player : "No winner determined"}
              </div>

              {/* TEAM NAME TEXT
                  - text-sm           → change if you want team bigger/smaller
                  - mt-1              → gap below name */}
              {hasWinner && (
                <div className="text-sm text-neutral-300 mt-1">
                  {winnerRow.team}
                </div>
              )}
            </div>

            {/* Winner image + bottom stat ribbon */}
            <div className="mt-2 flex min-h-0 flex-1 flex-col justify-end pt-1">
              {/* HEADSHOT BLOCK
                  - max-h-72 controls portrait height
                  - centered so stats no longer feel stuck on one side */}
              <div className="flex min-h-[205px] items-end justify-center">
                {hasWinner && portraitSrc ? (
                  <PlayerPortraitFrame
                    src={portraitSrc}
                    player={winnerPlayer}
                    teamName={winner?.team || winnerPlayer?.teamName || ""}
                    alt={winner.player}
                    layoutPage="individual-awards"
                    className="h-[238px] w-[300px] max-w-full"
                    bottomInset={0}
                  />
                ) : (
                  <span className="text-xs text-neutral-500 flex items-center justify-center w-full h-full">
                    No portrait
                  </span>
                )}
              </div>

              {/* Bottom stat ribbon */}
              <div className="-mx-5 border-t border-orange-500/25 bg-black/25 px-3 py-2">
                {renderWinnerStatRibbon()}
              </div>
            </div>

          </div>

          {/* LADDER CARD ----------------------------------------------------- */}
          {/* Similar pattern: you can tweak ladder card border, padding, etc. here. */}
          <div className="flex h-[430px] min-w-0 flex-col justify-between rounded-xl border border-orange-500/80 bg-neutral-900 px-5 py-4 shadow-lg">
            <div>
              {/* Ladder title ("Most Valuable Player") */}
              <div className="text-lg font-bold mb-1">{meta.label}</div>
              <p className="text-xs text-neutral-400 mb-3">
                {meta.description}
              </p>

              <div className="text-[11px] text-neutral-400 mb-1">
                AWARD RACE
              </div>

              {race && race.length > 0 ? (
                <div className="space-y-1.5">
                  {race.map((p, idx) => {
                    const row = buildPerGameRow(
                      p.player,
                      p.team,
                      combineAwardStatsMapRows(statsMap, p.player, p.team)
                    );
                    if (!row) return null;

                    const isWinner =
                      hasWinner &&
                      p.player === winner.player &&
                      p.team === winner.team;

                    const logoSrc = teamLogosIndex[p.team];

                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                          isWinner
                            ? "bg-orange-500/20 text-orange-200"
                            : "bg-neutral-800 text-neutral-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-4 text-[10px] text-neutral-500">
                            #{idx + 1}
                          </span>

                          {logoSrc && (
                            <img
                              src={logoSrc}
                              alt={p.team}
                              className="w-8 h-8 object-contain flex-shrink-0"
                            />
                          )}

                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold truncate max-w-[230px]">
                              {p.player}
                            </span>
                            <span className="text-[10px] text-neutral-400 truncate max-w-[230px]">
                              {p.team}
                            </span>
                          </div>
                        </div>

                        <div
                          className="ml-3 grid shrink-0 gap-x-2 text-[10.5px]"
                          style={{ gridTemplateColumns: `repeat(${getAwardStatSpecs(row, currentKey).length}, minmax(42px, 1fr))` }}
                        >
                          {getAwardStatSpecs(row, currentKey).map((stat) => (
                            <React.Fragment key={stat.label}>
                              {renderRaceStat(stat.label, stat.value)}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-neutral-500">
                  No race data available.
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500">
              <div className="flex gap-1">
                {AWARD_ORDER.map((key, i) => (
                  <span
                    key={key}
                    className={`w-1.5 h-1.5 rounded-full ${
                      i === awardIndex ? "bg-orange-500" : "bg-neutral-700"
                    }`}
                  />
                ))}
              </div>
              <span>
                {awardIndex + 1} / {AWARD_ORDER.length}
              </span>
            </div>
          </div>
        </div>

        {/* NAV BUTTONS ------------------------------------------------------- */}
        <div className="flex justify-between mt-4">
          <button
            className={`rounded px-4 py-2 text-xs ${awardIndex === 0 ? "cursor-not-allowed bg-neutral-900 text-neutral-600" : "bg-neutral-800 hover:bg-neutral-700"}`}
            onClick={goPrev}
            disabled={awardIndex === 0}
          >
            ◀ Previous Award
          </button>

          <div className="flex gap-2">
<button
  className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded text-xs"
  onClick={goNext}
>
  {isLastAward ? "All-NBA Teams ▶" : "Next Award ▶"}
</button>
          </div>
        </div>
        </div>
      </div>
      </div>
    </PageFade>
  );
}
