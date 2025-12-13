// src/pages/Awards.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

/* -------------------------------------------------------------------------- */
/*                               AWARD CONSTANTS                              */
/* -------------------------------------------------------------------------- */

const AWARD_ORDER = ["mvp", "dpoy", "sixth_man", "roty"];

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

  if (Array.isArray(raw)) {
    awards = Object.fromEntries(raw);
  }

  for (const key of ["mvp", "dpoy", "roty", "sixth_man"]) {
    if (awards[key] && Array.isArray(awards[key])) {
      awards[key] = fromEntriesMaybe(awards[key]);
    }
  }

  for (const key of ["mvp_race", "dpoy_race", "roty_race", "sixth_man_race"]) {
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
    () => JSON.parse(localStorage.getItem("bm_player_stats_v1") || "{}"),
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
  const currentKey = AWARD_ORDER[awardIndex];
  const meta = AWARD_META[currentKey];
  const season = awards?.season || "Season";

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

  const goPrev = () =>
    setAwardIndex((i) => (i - 1 + AWARD_ORDER.length) % AWARD_ORDER.length);
  const goNext = () => setAwardIndex((i) => (i + 1) % AWARD_ORDER.length);

  const hasWinner = !!winner && !!winnerRow;

  /* ------- WINNER STATS BULLETS (font-size / spacing controlled here) ----- */
  function renderWinnerStatsBullets() {
    if (!hasWinner) return null;

    const bullets = [];

    bullets.push({ label: "GP", value: winnerRow.gp });
    bullets.push({ label: "MIN", value: winnerRow.min });
    bullets.push({ label: "PPG", value: winnerRow.pts });
    bullets.push({ label: "RPG", value: winnerRow.reb });
    bullets.push({ label: "APG", value: winnerRow.ast });
    bullets.push({ label: "SPG", value: winnerRow.stl });
    bullets.push({ label: "BPG", value: winnerRow.blk });

    if (currentKey === "dpoy") {
      const stocks = Number((winnerRow.stl + winnerRow.blk).toFixed(1));
    }

    bullets.push({ label: "FG%", value: `${winnerRow.fgPct}%` });
    bullets.push({ label: "3P%", value: `${winnerRow.tpPct}%` });
    bullets.push({ label: "FT%", value: `${winnerRow.ftPct}%` });

    return (
      // STATS FONT SIZE + LINE SPACING:
      // - text-base  => change to text-sm, text-lg, etc. to shrink / grow stats
      // - space-y-2  => vertical gap between each stat row
      <ul className="space-y-2 text-base text-neutral-200 text-right">
        {bullets.map((b, idx) => (
          <li key={idx}>
            {/* LABEL STYLE:
                 - font-semibold / text-white → boldness / color of label
                 - min-w-[3.5rem] → width of label column
                 - you can bump to min-w-[4rem] if labels wrap */}
            <span className="font-semibold text-white mr-2 inline-block min-w-[3.5rem] text-right">
              {b.label}:
            </span>
            {/* VALUE STYLE:
                 - currently inherits from <ul> (text-base)
                 - if you want bigger numbers, wrap in <span className="text-lg"> */}
            <span>{b.value}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        {/* TITLE (global page title) 
            - text-3xl: change to text-4xl to make "2025 Season Awards" bigger */}
        <h1 className="text-3xl font-extrabold text-center text-orange-500 mb-10">
          {season} Season Awards
        </h1>

        {/* TOP ROW */}
        <div className="flex flex-col lg:flex-row gap-6 mb-6">
          {/* WINNER CARD ----------------------------------------------------- */}
          {/* CARD SIZE / PADDING / BORDER:
               - flex-1 lg:flex-[1.6]   → relative width vs ladder card
               - px-6 pt-3 pb-2        → inner padding; increase/decrease to move content away from edges
               - border-orange-500/80  → change thickness/color here (add border-2, etc.) */}
          <div className="flex-1 lg:flex-[1.6] bg-neutral-900 border border-orange-500/80 rounded-xl px-6 pt-3 pb-0 shadow-lg flex flex-col h-full">
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

            {/* Bottom: headshot + stats */}
            {/* POSITIONING OF HEADSHOT VS STATS:
                - mt-auto pushes this block to the bottom of the card
                - items-end keeps headshot & stats aligned on their bottom edges
                - gap-6 is spacing between headshot and stats column */}
<div className="mt-auto pt-4 flex items-end justify-between gap-6">
  {/* HEADSHOT BLOCK
     - max-h-72 = controls how tall the portrait can be
     - object-contain = show full image without cropping
     - remove overflow-hidden so we don't clip anything */}
  <div className="flex-shrink-0 flex items-end">
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

  {/* Stats block stays the same */}
  <div className="flex-1 flex justify-end">
    <div className="max-w-[260px] w-full">
      {renderWinnerStatsBullets()}
    </div>
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
                              className="w-6 h-6 rounded-full object-contain bg-neutral-900 flex-shrink-0"
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

                        <div className="flex gap-2 text-[10px] text-neutral-400 flex-shrink-0 ml-3">
                          {currentKey === "dpoy" ? (
                            <>
                              <span className="w-16 text-right">
                                REB {row.reb}
                              </span>
                              <span className="w-16 text-right">
                                STL {row.stl}
                              </span>
                              <span className="w-16 text-right">
                                BLK {row.blk}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="w-16 text-right">
                                PTS {row.pts}
                              </span>
                              <span className="w-16 text-right">
                                REB {row.reb}
                              </span>
                              <span className="w-16 text-right">
                                AST {row.ast}
                              </span>
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
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-xs"
              onClick={() => navigate("/calendar")}
            >
              Back to Calendar
            </button>
            <button
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded text-xs"
              onClick={goNext}
            >
              Next Award ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
