// src/pages/Awards.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import AllNbaTeams from "./AllNbaTeams";
import LZString from "lz-string";
import styles from "./Awards.module.css";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
console.log("✅ Awards.jsx NEW loaded");



/* -------------------------------------------------------------------------- */
/*                               AWARD CONSTANTS                              */
/* -------------------------------------------------------------------------- */

const AWARD_ORDER = ["mvp", "dpoy", "sixth_man", "roty"];
const PARTY_AWARD_KEYS = ["mvp", "dpoy", "sixth_man"];

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
  for (const key of ["mvp", "dpoy", "roty", "sixth_man"]) {
    if (awards[key] && Array.isArray(awards[key])) {
      awards[key] = fromEntriesMaybe(awards[key]);
    }
  }

  // Races (arrays of objects)
  for (const key of ["mvp_race", "dpoy_race", "roty_race", "sixth_man_race"]) {
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
  return readCompressedOrJson("bm_player_stats_v1", {});
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
    for (const p of team.players || []) {
      const key = statsKey(p.name || p.player, team.name);
      idx[key] = {
        portrait:
          p.portrait ||
          p.image ||
          p.photo ||
          p.headshot ||
          p.img ||
          p.face ||
          null,
      };
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
    const skey = statsKey(winner.player, winner.team);
    const stats = statsMap[skey];
    return buildPerGameRow(winner.player, winner.team, stats);
  }, [winner, statsMap]);

  const portraitSrc = useMemo(() => {
    if (!winner?.player || !winner?.team) return null;
    const key = statsKey(winner.player, winner.team);
    const entry = portraitsIndex[key];
    return entry?.portrait || null;
  }, [winner, portraitsIndex]);

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

  /* ------- WINNER STAT RIBBON (bottom of winner card) -------------------- */
  function renderWinnerStatRibbon() {
    if (!hasWinner) return null;

    const statsForAward =
      currentKey === "dpoy"
        ? [
            { label: "GP", value: winnerRow.gp },
            { label: "MIN", value: winnerRow.min },
            { label: "RPG", value: winnerRow.reb },
            { label: "SPG", value: winnerRow.stl },
            { label: "BPG", value: winnerRow.blk },
            { label: "FG%", value: `${winnerRow.fgPct}%` },
            { label: "FT%", value: `${winnerRow.ftPct}%` },
          ]
        : [
            { label: "GP", value: winnerRow.gp },
            { label: "PPG", value: winnerRow.pts },
            { label: "RPG", value: winnerRow.reb },
            { label: "APG", value: winnerRow.ast },
            { label: "SPG", value: winnerRow.stl },
            { label: "BPG", value: winnerRow.blk },
            { label: "FG%", value: `${winnerRow.fgPct}%` },
            { label: "3P%", value: `${winnerRow.tpPct}%` },
          ];

    const statGridCols = statsForAward.length >= 8 ? "sm:grid-cols-8" : "sm:grid-cols-7";

    return (
      <div className={`grid grid-cols-4 ${statGridCols} gap-2 text-center`}>
        {statsForAward.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg bg-neutral-950/70 border border-white/10 px-2 py-2"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-300/80">
              {stat.label}
            </div>
            <div className="text-base font-extrabold leading-tight text-white">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderRaceStat(label, value) {
    return (
      <span className="text-right whitespace-nowrap">
        <span className="text-white/75 font-semibold mr-1">
          {label}
        </span>
        <span className="text-white font-extrabold">
          {value}
        </span>
      </span>
    );
  }
if (showAllNba) {
  return <AllNbaTeams leagueDataProp={leagueData} />;
}


  return (
    <PageFade>
      <div className={`${styles.awardsPage} min-h-screen text-white py-10`}>
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
        className={`max-w-6xl mx-auto px-4 ${
          mvpPartyShakeActive ? styles.mvpContentShake : ""
        }`}
      >
        {/* TITLE (global page title) 
            - text-3xl: change to text-4xl to make "2025 Season Awards" bigger */}
        <h1 className="text-3xl font-extrabold text-center text-orange-500 mb-10">
          {season} Season Awards
        </h1>

        <div key={currentKey} className="bmAwardStepEnter">
        {/* TOP ROW */}
        <div className="flex flex-col lg:flex-row gap-6 mb-6">
          {/* WINNER CARD ----------------------------------------------------- */}
          {/* CARD SIZE / PADDING / BORDER:
               - flex-1 lg:flex-[1.6]   → relative width vs ladder card
               - px-6 pt-3 pb-2        → inner padding; increase/decrease to move content away from edges
               - border-orange-500/80  → change thickness/color here (add border-2, etc.) */}
          <div className="flex-1 lg:flex-[1.6] bg-neutral-900 border border-orange-500/80 rounded-xl px-6 pt-3 pb-0 shadow-lg flex flex-col h-full overflow-hidden">
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
              <div className="text-4xl font-extrabold mt-1">
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
            <div className="mt-auto pt-3 flex flex-col">
              {/* HEADSHOT BLOCK
                  - max-h-72 controls portrait height
                  - centered so stats no longer feel stuck on one side */}
              <div className="flex justify-center items-end min-h-[270px]">
                {hasWinner && portraitSrc ? (
                  <img
                    src={portraitSrc}
                    alt={winner.player}
                    className="max-h-72 w-auto object-contain"
                  />
                ) : (
                  <span className="text-xs text-neutral-500 flex items-center justify-center w-full h-full">
                    No portrait
                  </span>
                )}
              </div>

              {/* Bottom stat ribbon */}
              <div className="-mx-6 border-t border-orange-500/25 bg-black/25 px-4 py-3">
                {renderWinnerStatRibbon()}
              </div>
            </div>

          </div>

          {/* LADDER CARD ----------------------------------------------------- */}
          {/* Similar pattern: you can tweak ladder card border, padding, etc. here. */}
          <div className="w-full lg:flex-[1.4] bg-neutral-900 border border-orange-500/80 rounded-xl px-6 py-4 flex flex-col justify-between shadow-lg">
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
                <div className="space-y-2">
                  {race.map((p, idx) => {
                    const row = buildPerGameRow(
                      p.player,
                      p.team,
                      statsMap[statsKey(p.player, p.team)]
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
                        className={`flex items-center justify-between text-xs px-2 py-2.5 rounded ${
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
                            <span className="font-semibold truncate max-w-[190px]">
                              {p.player}
                            </span>
                            <span className="text-[10px] text-neutral-400 truncate max-w-[190px]">
                              {p.team}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-5 gap-x-4 text-[11px] flex-shrink-0 ml-4 w-[400px]">
                          {currentKey === "dpoy" ? (
                            <>
                              {renderRaceStat("REB", row.reb)}
                              {renderRaceStat("STL", row.stl)}
                              {renderRaceStat("BLK", row.blk)}
                              {renderRaceStat("FG%", `${row.fgPct}%`)}
                              {renderRaceStat("3P%", `${row.tpPct}%`)}
                            </>
                          ) : (
                            <>
                              {renderRaceStat("PTS", row.pts)}
                              {renderRaceStat("REB", row.reb)}
                              {renderRaceStat("AST", row.ast)}
                              {renderRaceStat("FG%", `${row.fgPct}%`)}
                              {renderRaceStat("3P%", `${row.tpPct}%`)}
                            </>
                          )}
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

            <div className="mt-4 flex items-center justify-between text-[11px] text-neutral-500">
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
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-xs"
            onClick={goPrev}
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
