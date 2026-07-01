// src/components/FinalsMvpReveal.jsx
// FMVP reveal surgical patch v5_REAL - shows MIN/TOV/PF/FGA/3PA/FTA
import React, { useMemo } from "react";
import { getCompletedSeasonYearForArchive } from "../utils/finalsMvpSeasonActions";
import styles from "../pages/FinalsMvp.module.css";

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
      <div className={`relative ${isModal ? "bg-transparent px-5 pt-3 pb-0" : "bg-neutral-800 rounded-t-xl shadow-lg px-8 pt-7 pb-3"}`}>
        <div className={`absolute left-0 right-0 bottom-0 ${isModal ? "h-[2px] opacity-55" : "h-[3px] opacity-60"} bg-white`} />

        <div className="flex items-end justify-between gap-4">
          <div className={`flex items-end ${isModal ? "gap-4" : "gap-6"}`}>
            <div className={`relative z-10 ${isModal ? "mb-0 -translate-y-[1.7px]" : "-mb-[8px]"}`}>
              {portraitSrc && (
                <img
                  src={portraitSrc}
                  alt={winner?.player}
                  className={`${isModal ? "h-[165px]" : "h-[170px]"} w-auto object-contain`}
                />
              )}
            </div>

            <div className={isModal ? "mb-5" : "mb-2"}>
              <h2 className={`${isModal ? "text-[31px]" : "text-[42px]"} font-bold leading-tight`}>{winner?.player}</h2>
              <p className={`text-gray-400 ${isModal ? "text-[16px]" : "text-[22px]"} mt-1`}>
                {playerMeta?.pos} • Age {playerMeta?.age}
              </p>
            </div>
          </div>

          <div className={`relative flex items-center justify-center ${isModal ? "mr-8 mb-5 scale-[1.1]" : "mr-4 mb-2"}`}>
            <svg width="105" height="105" viewBox="0 0 120 120">
              <defs>
                <linearGradient id="ovrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFA500" />
                  <stop offset="100%" stopColor="#FFD54F" />
                </linearGradient>
              </defs>
              <circle
                cx="60"
                cy="60"
                r="50"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="8"
                fill="none"
              />
              <circle
                cx="60"
                cy="60"
                r="50"
                stroke="url(#ovrGradient)"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circleCircumference}
                strokeDashoffset={strokeOffset}
                transform="rotate(-90 60 60)"
              />
            </svg>

            <div className="absolute text-center">
              <p className="text-sm text-gray-300">OVR</p>
              <p className="text-[44px] font-extrabold text-orange-400 leading-none mt-[-6px]">
                {playerMeta?.ovr}
              </p>
              <p className="text-[10px] text-gray-400">
                POT <span className="text-orange-400 font-semibold">{playerMeta?.pot}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`${styles.tablePanel} overflow-x-auto mt-[-1px] ${isModal ? "" : "rounded-b-xl"}`} style={isModal ? { background: "transparent" } : undefined}>
        <table className={`w-full min-w-[980px] border-collapse text-center ${isModal ? "text-[13px]" : "text-[15px]"} font-medium`} style={isModal ? { background: "transparent" } : undefined}>
          <thead className={`${isModal ? "bg-neutral-900/35" : "bg-neutral-800"} text-gray-300 font-semibold`}>
            <tr>
              <th className="w-[68px] py-2">TEAM</th>
              <th className="py-2">POS</th>
              <th className="py-2">GP</th>
              <th className="py-2">MIN</th>
              <th className="py-2">PTS</th>
              <th className="py-2">REB</th>
              <th className="py-2">AST</th>
              <th className="py-2">STL</th>
              <th className="py-2">BLK</th>
              <th className="py-2">TOV</th>
              <th className="py-2">PF</th>
              <th className="py-2">FGA</th>
              <th className="py-2">3PA</th>
              <th className="py-2">FTA</th>
              <th className="py-2">FG%</th>
              <th className="py-2">3P%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-orange-600 text-white">
              <td className="py-2 text-center">
                {winner?.team && teamLogoMap[winner.team] ? (
                  <img
                    src={teamLogoMap[winner.team]}
                    alt={winner.team}
                    className="mx-auto h-7 w-7 object-contain"
                  />
                ) : (
                  "—"
                )}
              </td>

              <td className="py-2">{playerMeta?.pos}</td>
              <td className="py-2">{finalsRow?.gp}</td>
              <td className="py-2">{fmt1(finalsRow?.mpg)}</td>
              <td className="py-2">{fmt1(finalsRow?.ppg)}</td>
              <td className="py-2">{fmt1(finalsRow?.rpg)}</td>
              <td className="py-2">{fmt1(finalsRow?.apg)}</td>
              <td className="py-2">{fmt1(finalsRow?.spg)}</td>
              <td className="py-2">{fmt1(finalsRow?.bpg)}</td>
              <td className="py-2">{fmt1(finalsRow?.tov)}</td>
              <td className="py-2">{fmt1(finalsRow?.pf)}</td>
              <td className="py-2">{fmt1(finalsRow?.fga)}</td>
              <td className="py-2">{fmt1(finalsRow?.tpa)}</td>
              <td className="py-2">{fmt1(finalsRow?.fta)}</td>
              <td className="py-2">{fmt1(finalsRow?.fg)}</td>
              <td className="py-2">{fmt1(finalsRow?.tp)}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
  