// src/components/FinalsMvpReveal.jsx
// FMVP reveal surgical patch v5_REAL - shows MIN/TOV/PF/FGA/3PA/FTA
import React, { useMemo } from "react";
import { getCompletedSeasonYearForArchive } from "../utils/finalsMvpSeasonActions";
import styles from "../pages/FinalsMvp.module.css";
import { getTeamAbbreviation } from "../utils/teamAbbreviations.js";
import PlayerPortraitFrame from "./PlayerPortraitFrame";
import PlayerRatingRing from "./PlayerRatingRing.jsx";

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function statsKey(player, team) {
  return `${player}__${team}`;
}

function buildPlayerIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const idx = {};

  for (const team of teams) {
    for (const p of team.players || []) {
      const key = statsKey(p.name || p.player, team.name);
      idx[key] = {
        portrait: p.portrait || p.image || p.photo || p.headshot || p.img || p.face || null,
        pos: p.pos || p.position || null,
        age: p.age ?? p.playerAge ?? null,
        ovr: p.ovr ?? p.overall ?? p.rating ?? null,
        pot: p.pot ?? p.potential ?? null,
        teamName: team.name,
      };
    }
  }

  return idx;
}

const resolveLogo = (t) =>
  t.logo || t.teamLogo || t.newTeamLogo || t.logoUrl || t.image || t.img || "";

function pickNum(obj, keys, fallback = null) {
  for (const k of keys) {
    const v = Number(obj?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function pct(m, a) {
  if (!Number.isFinite(m) || !Number.isFinite(a) || a <= 0) return null;
  return (m / a) * 100;
}

function fmt1(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  return Number(x).toFixed(1);
}

export default function FinalsMvpReveal({
  leagueData,
  fmvpRaw,
  onContinue,
  continueLabel = "Continue",
  onBack,
  backLabel = "Back",
  mode = "page",
}) {
  const playerIndex = useMemo(() => buildPlayerIndex(leagueData), [leagueData]);

  const teamLogoMap = useMemo(() => {
    const teams = getAllTeamsFromLeague(leagueData);
    const map = {};
    for (const t of teams) map[t.name] = resolveLogo(t);
    return map;
  }, [leagueData]);

  const winner = fmvpRaw?.finals_mvp || null;
  const season = getCompletedSeasonYearForArchive(leagueData, fmvpRaw);
  const championTeam = fmvpRaw?.champion_team ?? winner?.team ?? null;

  const playerMeta = useMemo(() => {
    if (!winner?.player || !winner?.team) return null;
    const key = statsKey(winner.player, winner.team);
    return playerIndex[key] || null;
  }, [winner, playerIndex]);

  const portraitSrc = playerMeta?.portrait || null;

  const finalsRow = useMemo(() => {
    if (!winner) return null;

    const gp = pickNum(winner, ["gp"], 0);

    const pts = pickNum(winner, ["pts", "points"], 0);
    const reb = pickNum(winner, ["reb", "rebounds"], 0);
    const ast = pickNum(winner, ["ast", "assists"], 0);
    const stl = pickNum(winner, ["stl", "steals"], 0);
    const blk = pickNum(winner, ["blk", "blocks"], 0);
    const min = pickNum(winner, ["min", "minutes"], 0);
    const tov = pickNum(winner, ["to", "tov", "turnovers"], 0);
    const pf = pickNum(winner, ["pf", "fouls", "personalFouls"], 0);

    const fgm = pickNum(winner, ["fgm", "fg_m"], 0);
    const fga = pickNum(winner, ["fga", "fg_a"], 0);
    const tpm = pickNum(winner, ["tpm", "tp_m", "fg3m", "three_m"], 0);
    const tpa = pickNum(winner, ["tpa", "tp_a", "fg3a", "three_a"], 0);
    const ftm = pickNum(winner, ["ftm", "ft_m"], 0);
    const fta = pickNum(winner, ["fta", "ft_a"], 0);

    const perGame = (total) => (gp > 0 ? total / gp : null);

    const normalizePct = (v) => {
      if (!Number.isFinite(v)) return null;
      return v <= 1 ? v * 100 : v;
    };

    const fgPctRaw = pickNum(winner, ["fg_pct", "fgPct"], null);
    const tpPctRaw = pickNum(winner, ["tp_pct", "tpPct"], null);

    return {
      gp: gp || null,
      mpg: winner.mpg ?? perGame(min),
      ppg: winner.ppg ?? perGame(pts),
      rpg: winner.rpg ?? perGame(reb),
      apg: winner.apg ?? perGame(ast),
      spg: winner.spg ?? perGame(stl),
      bpg: winner.bpg ?? perGame(blk),
      tov: winner.tov ?? perGame(tov),
      pf: winner.pf_pg ?? winner.fouls_pg ?? perGame(pf),
      fga: winner.fga_pg ?? perGame(fga),
      tpa: winner.tpa_pg ?? perGame(tpa),
      fta: winner.fta_pg ?? perGame(fta),
      fg: normalizePct(fgPctRaw) ?? pct(fgm, fga),
      tp: normalizePct(tpPctRaw) ?? pct(tpm, tpa),
    };
  }, [winner]);

  const fillPercent = Math.min((playerMeta?.ovr || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  const isModal = mode === "modal";

  const titleButtonClass = `${isModal ? "px-4 py-2 text-[12px]" : "px-5 py-2 text-sm"} rounded-lg font-bold shadow-lg transition-all duration-200 hover:-translate-y-1 active:translate-y-0`;

  const modalBackgroundStyle = isModal
    ? {
        backgroundImage: `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 28px),
          repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 22px),
          radial-gradient(circle at 50% 25%, rgba(62,62,62,0.98) 0%, rgba(35,35,35,0.97) 78%)
        `,
        backgroundRepeat: "repeat, repeat, no-repeat",
        backgroundSize: "auto, auto, cover",
        backgroundPosition: "center",
      }
    : undefined;

  if (!winner) {
    return (
      <div
        className={`text-white ${
          isModal
            ? "w-[min(520px,92vw)] rounded-xl bg-neutral-950/92 p-5 text-center shadow-[0_24px_70px_rgba(0,0,0,0.65)]"
            : "max-w-5xl mx-auto px-4 text-center"
        }`}
      >
        <h1 className="text-3xl font-extrabold text-orange-500">FINALS MVP</h1>
        <p className="mt-3 text-sm text-neutral-300">Finals MVP data is not ready yet.</p>
      </div>
    );
  }

  return (
    <div
      className={`text-white ${
        isModal
          ? "bmFmvpPanelIn w-[min(820px,94vw)] max-h-[84vh] overflow-hidden rounded-xl bg-neutral-800/95 p-0 shadow-[0_22px_65px_rgba(0,0,0,0.62)]"
          : "bmFmvpPanelIn max-w-5xl mx-auto px-4"
      }`}
      style={modalBackgroundStyle}
    >
      <style>{`
        @keyframes bmFmvpPanelIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .bmFmvpPanelIn { animation: bmFmvpPanelIn 220ms ease-out both; }
      `}</style>

      {/* Title + actions */}
      <div className={`relative ${isModal ? "px-5 pt-5 pb-1" : "mb-5 pt-1"} flex items-center justify-center`}>
        {onContinue && (
          <button
            className={`absolute left-0 ${isModal ? "left-5 top-5" : "top-1"} ${titleButtonClass} bg-orange-600 hover:bg-orange-500 text-white`}
            onClick={onContinue}
          >
            {continueLabel}
          </button>
        )}

        <h1 className={`${isModal ? "text-[28px]" : "text-4xl"} font-extrabold leading-tight text-orange-500`}>FINALS MVP</h1>

        {onBack && (
          <button
            className={`absolute right-0 ${isModal ? "right-5 top-5" : "top-1"} ${titleButtonClass} bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10`}
            onClick={onBack}
          >
            {backLabel}
          </button>
        )}
      </div>

      {/* Header Card */}
      <div className={`relative border-b border-white/45 ${isModal ? "bg-transparent px-5 pt-3 pb-3" : "bg-neutral-800 rounded-t-xl shadow-lg px-8 pt-7 pb-5"}`}>
        <div className="flex items-center justify-between gap-4">
          <div className={`flex items-end ${isModal ? "gap-4" : "gap-6"}`}>
            <PlayerPortraitFrame
              src={portraitSrc}
              alt={winner?.player || "Finals MVP"}
              className={isModal ? "h-[146px] w-[174px]" : "h-[154px] w-[184px]"}
              bottomInset={10}
            />

            <div className="self-center pb-1">
              <h2 className={`${isModal ? "text-[31px]" : "text-[42px]"} font-bold leading-tight`}>{winner?.player}</h2>
              <p className={`text-gray-400 ${isModal ? "text-[16px]" : "text-[22px]"} mt-1`}>
                {playerMeta?.pos} • Age {playerMeta?.age}
              </p>
            </div>
          </div>

          <PlayerRatingRing
            overall={playerMeta?.ovr}
            potential={playerMeta?.pot}
            size={105}
            className={`self-center ${isModal ? "mr-8 scale-[1.1]" : "mr-4"}`}
          />
        </div>
      </div>

      {/* Compact stat strip: all Finals MVP information fits without horizontal scrolling. */}
      <div className={`${styles.tablePanel} mt-3 ${isModal ? "px-5 pb-5" : "rounded-b-xl p-3"}`} style={isModal ? { background: "transparent" } : undefined}>
        <div className={`grid grid-cols-4 gap-2 ${isModal ? "sm:grid-cols-8" : "md:grid-cols-8"}`}>
          {[
            ["GP", finalsRow?.gp],
            ["MIN", fmt1(finalsRow?.mpg)],
            ["PTS", fmt1(finalsRow?.ppg)],
            ["REB", fmt1(finalsRow?.rpg)],
            ["AST", fmt1(finalsRow?.apg)],
            ["STL", fmt1(finalsRow?.spg)],
            ["BLK", fmt1(finalsRow?.bpg)],
            ["TOV", fmt1(finalsRow?.tov)],
            ["TEAM", getTeamAbbreviation(winner?.team)],
            ["POS", playerMeta?.pos || "—"],
            ["PF", fmt1(finalsRow?.pf)],
            ["FGA", fmt1(finalsRow?.fga)],
            ["3PA", fmt1(finalsRow?.tpa)],
            ["FTA", fmt1(finalsRow?.fta)],
            ["FG%", fmt1(finalsRow?.fg)],
            ["3P%", fmt1(finalsRow?.tp)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-w-0 rounded-lg border border-white/10 bg-neutral-900/45 px-2 py-2 text-center"
            >
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/45">{label}</div>
              <div
                className={`mt-1 truncate font-black ${label === "TEAM" ? "text-[11px]" : "text-base"}`}
                title={String(value ?? "—")}
              >
                {value ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
  