import React, { useEffect, useMemo, useRef, useState } from "react";

const ATTR_LABELS = [
  "3PT",
  "MID",
  "CLOSE",
  "FT",
  "BALL",
  "PASS",
  "SPEED",
  "ATH",
  "PER D",
  "INS D",
  "BLK",
  "STL",
  "REB",
  "OIQ",
  "DIQ",
];

const MOOD_COLORS = {
  "Very Happy": "from-emerald-400 to-green-500 text-emerald-100 border-emerald-400/30",
  Happy: "from-green-400 to-lime-500 text-green-100 border-green-400/30",
  Content: "from-orange-400 to-amber-500 text-orange-100 border-orange-400/30",
  Frustrated: "from-yellow-400 to-orange-500 text-yellow-100 border-yellow-400/30",
  Unhappy: "from-red-400 to-red-600 text-red-100 border-red-400/30",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "mood", label: "Mood" },
  { key: "career", label: "Career Stats" },
  { key: "accolades", label: "Accolades" },
  { key: "transactions", label: "Transactions" },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDollars(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMillions(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0.0M";
  return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatHeight(inches) {
  const n = Number(inches || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const feet = Math.floor(n / 12);
  const rem = n % 12;
  return `${feet}'${rem}\"`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getLatestTeamHistory(leagueData, teamName) {
  const seasons = Array.isArray(leagueData?.seasonHistory)
    ? leagueData.seasonHistory
    : [];

  for (const season of [...seasons].reverse()) {
    const row = (season?.teams || []).find((team) => team?.teamName === teamName);
    if (row) return row;
  }

  return null;
}

function getPrimaryTeamName(player, teamName) {
  if (teamName) return teamName;
  if (player?.teamName) return player.teamName;
  if (player?.rights?.heldByTeam) return player.rights.heldByTeam;

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latest = [...seasons].reverse().find((row) => row?.rowType !== "total" && row?.teamName);
  return latest?.teamName || "Free Agent";
}

function getPrimaryTeamLogo(player, teamLogo, leagueData, teamName) {
  if (teamLogo) return teamLogo;
  if (player?.teamLogo) return player.teamLogo;

  const teams = getAllTeamsFromLeague(leagueData);
  const team = teams.find((row) => row?.name === teamName);
  if (team?.logo) return team.logo;

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latest = [...seasons].reverse().find((row) => row?.rowType !== "total" && row?.teamLogo);
  return latest?.teamLogo || "";
}

function getContractYears(contract) {
  const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  return salaryByYear.length;
}

function getContractAav(contract) {
  const salaryByYear = Array.isArray(contract?.salaryByYear) ? contract.salaryByYear : [];
  if (!salaryByYear.length) return 0;
  return salaryByYear.reduce((sum, salary) => sum + Number(salary || 0), 0) / salaryByYear.length;
}

function formatBirdLevel(level) {
  if (level === "bird") return "Bird";
  if (level === "early_bird") return "Early Bird";
  if (level === "non_bird") return "Non-Bird";
  if (!level || level === "none") return "No Rights";
  return String(level).replaceAll("_", " ");
}

function getMoodLabel(value) {
  if (value >= 85) return "Very Happy";
  if (value >= 70) return "Happy";
  if (value >= 50) return "Content";
  if (value >= 35) return "Frustrated";
  return "Unhappy";
}

function computeMood(player, leagueData, teamName, currentStats) {
  const explicit = player?.mood;
  if (explicit && typeof explicit === "object") {
    const value = clamp(safeNumber(explicit.value, 65), 0, 100);
    return {
      value,
      label: explicit.label || getMoodLabel(value),
      trend: explicit.trend || "stable",
      reasons: Array.isArray(explicit.reasons) && explicit.reasons.length
        ? explicit.reasons
        : ["Mood is coming from the saved player profile."],
      source: "saved",
    };
  }

  let score = 66;
  const reasons = [];
  const ovr = safeNumber(player?.overall, 0);
  const pot = safeNumber(player?.potential, 0);
  const age = safeNumber(player?.age, 0);
  const aav = getContractAav(player?.contract);
  const yearsWithTeam = safeNumber(player?.meta?.yearsWithCurrentTeam, 0);
  const latestTeam = getLatestTeamHistory(leagueData, teamName);

  if (latestTeam) {
    const wins = safeNumber(latestTeam.wins, 0);
    if (latestTeam.champion) {
      score += 15;
      reasons.push("Fresh championship glow.");
    } else if (latestTeam.finals) {
      score += 12;
      reasons.push("Coming off a Finals run.");
    } else if (latestTeam.conferenceFinals) {
      score += 9;
      reasons.push("Team made a deep playoff run.");
    } else if (wins >= 50) {
      score += 8;
      reasons.push("Team won 50+ games.");
    } else if (wins >= 42 || latestTeam.madePlayoffs) {
      score += 4;
      reasons.push("Team is competitive.");
    } else if (wins < 28) {
      score -= 9;
      reasons.push("Team struggled badly in the standings.");
    } else if (wins < 35) {
      score -= 5;
      reasons.push("Team missed winning-level results.");
    }
  } else {
    reasons.push("No recent team-results snapshot found yet.");
  }

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const latestSeason = [...seasons]
    .reverse()
    .find((row) => row?.rowType !== "total" && Number(row?.games || 0) > 0);

  const gp = safeNumber(currentStats?.GP ?? latestSeason?.games, 0);
  const ppg = safeNumber(currentStats?.PTS ?? latestSeason?.ppg, 0);

  if (gp >= 70) {
    score += 4;
    reasons.push("Played a major role across the season.");
  } else if (gp >= 55) {
    score += 2;
    reasons.push("Had steady rotation usage.");
  } else if (gp > 0 && gp < 35) {
    score -= 5;
    reasons.push("Limited games played could affect his outlook.");
  }

  if (ovr >= 88 && ppg < 18) {
    score -= 5;
    reasons.push("Star-level rating with lower scoring role.");
  } else if (ovr >= 82 && ppg < 10) {
    score -= 4;
    reasons.push("Starter-level talent with a smaller offensive role.");
  } else if (ppg >= 20) {
    score += 4;
    reasons.push("Getting strong offensive touches.");
  }

  if (aav > 0) {
    if (ovr >= 90 && aav < 30_000_000) {
      score -= 8;
      reasons.push("May feel underpaid for superstar value.");
    } else if (ovr >= 84 && aav < 18_000_000) {
      score -= 6;
      reasons.push("Contract looks light for his rating tier.");
    } else if (aav >= 30_000_000) {
      score += 4;
      reasons.push("Has a major long-term contract.");
    } else if (aav >= 12_000_000) {
      score += 2;
      reasons.push("Contract is respectable for his role.");
    }
  } else {
    score -= 3;
    reasons.push("No active contract security shown.");
  }

  if (yearsWithTeam >= 5) {
    score += 4;
    reasons.push("Strong continuity with current team.");
  } else if (yearsWithTeam >= 3) {
    score += 2;
    reasons.push("Established with current team.");
  } else if (yearsWithTeam <= 1 && teamName !== "Free Agent") {
    score -= 1;
    reasons.push("Still settling into the organization.");
  }

  if (age <= 24 && pot - ovr >= 5) {
    score += 3;
    reasons.push("Young player with a clear growth runway.");
  }

  const accolades = Array.isArray(player?.history?.accolades) ? player.history.accolades : [];
  const recentAccolades = accolades.filter((row) => safeNumber(row?.seasonYear, 0) >= 2024).length;
  if (recentAccolades >= 2) {
    score += 4;
    reasons.push("Recent accolades boost confidence and status.");
  } else if (recentAccolades === 1) {
    score += 2;
    reasons.push("Recent recognition helps morale.");
  }

  const value = clamp(Math.round(score), 0, 100);
  return {
    value,
    label: getMoodLabel(value),
    trend: value >= 72 ? "up" : value <= 45 ? "down" : "stable",
    reasons: reasons.slice(0, 6),
    source: "generated",
  };
}

function StatPill({ label, value, accent = false }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 shadow-inner shadow-black/20">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-black ${accent ? "text-orange-300" : "text-white"}`}>{value ?? "-"}</div>
    </div>
  );
}

function Chip({ children, tone = "neutral" }) {
  const classes =
    tone === "green"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : tone === "red"
      ? "border-red-400/25 bg-red-400/10 text-red-200"
      : tone === "orange"
      ? "border-orange-400/25 bg-orange-400/10 text-orange-200"
      : "border-white/10 bg-white/[0.05] text-zinc-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${classes}`}>
      {children}
    </span>
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
      <div className="text-lg font-black text-white">{title}</div>
      {subtitle && <div className="mt-2 text-sm text-zinc-400">{subtitle}</div>}
    </div>
  );
}

export default function PlayerCardModal({
  open,
  player,
  team,
  teamName,
  teamLogo,
  leagueData,
  currentStats,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const contentScrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab("overview");
  }, [open, player?.id, player?.name]);

  useEffect(() => {
    if (!open) return;
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [activeTab, open]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const resolvedTeamName = useMemo(() => {
    return getPrimaryTeamName(player, team?.name || teamName);
  }, [player, team?.name, teamName]);

  const resolvedTeamLogo = useMemo(() => {
    return getPrimaryTeamLogo(player, team?.logo || teamLogo, leagueData, resolvedTeamName);
  }, [player, team?.logo, teamLogo, leagueData, resolvedTeamName]);

  const mood = useMemo(() => {
    return computeMood(player, leagueData, resolvedTeamName, currentStats);
  }, [player, leagueData, resolvedTeamName, currentStats]);

  if (!open || !player) return null;

  const seasons = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  const accolades = Array.isArray(player?.history?.accolades) ? player.history.accolades : [];
  const transactions = Array.isArray(player?.history?.transactions) ? player.history.transactions : [];
  const salaryByYear = Array.isArray(player?.contract?.salaryByYear) ? player.contract.salaryByYear : [];
  const contractYears = getContractYears(player?.contract);
  const contractAav = getContractAav(player?.contract);
  const moodTheme = MOOD_COLORS[mood.label] || MOOD_COLORS.Content;
  const option = player?.contract?.option;
  const optionType = option?.type ? String(option.type).replaceAll("_", " ") : null;
  const rights = player?.rights || {};
  const fillPercent = clamp(safeNumber(player?.overall, 0) / 99, 0, 1);
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - fillPercent);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-3 py-5 sm:px-6">
      <style>{`
        .pc-modal-scroll {
          scrollbar-width: thin;
          scrollbar-color: #f97316 #111111;
        }
        .pc-modal-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .pc-modal-scroll::-webkit-scrollbar-track { background: #111111; border-radius: 9999px; }
        .pc-modal-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #fb923c, #c2410c);
          border-radius: 9999px;
          border: 2px solid #111111;
        }
        .pc-glow-card {
          box-shadow: 0 28px 90px rgba(0,0,0,0.64), 0 0 70px rgba(249,115,22,0.12);
        }
        .pc-shimmer {
          background: linear-gradient(110deg, rgba(255,255,255,0.05), rgba(251,146,60,0.16), rgba(255,255,255,0.05));
          background-size: 260% 100%;
          animation: pc-shimmer 7s ease-in-out infinite;
        }
        @keyframes pc-shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pc-pop {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .pc-pop { animation: pc-pop 180ms ease-out both; }
      `}</style>

      <button
        type="button"
        aria-label="Close player card"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
      />

      <div className="pc-pop pc-glow-card relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[#090909] text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-44 w-[70%] -translate-x-1/2 bg-orange-500/5 blur-3xl" />
        </div>

        <div className="relative overflow-hidden border-b border-white/10 bg-zinc-950/95">
          <div className="pc-shimmer absolute inset-x-0 top-0 h-[3px]" />

          <div className="grid gap-6 px-5 pt-5 pb-4 sm:px-7 sm:pt-7 sm:pb-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="flex min-w-0 gap-5 sm:gap-6">
              <div className="relative flex h-40 w-32 shrink-0 items-end justify-center overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-zinc-800 to-zinc-950 sm:h-52 sm:w-40">
                {resolvedTeamLogo && (
                  <img
                    src={resolvedTeamLogo}
                    alt={resolvedTeamName}
                    className="absolute inset-0 m-auto h-28 w-28 object-contain opacity-10 blur-[1px] sm:h-36 sm:w-36"
                  />
                )}

                {player?.headshot ? (
                  <img
                    src={player.headshot}
                    alt={player.name}
                    className="relative z-10 h-full w-full object-contain object-bottom drop-shadow-2xl"
                    style={{
                      transform: "translateY(-22px) scale(1.06)",
                      transformOrigin: "bottom center",
                    }}
                  />
                ) : (
                  <div className="relative z-10 flex h-full w-full items-center justify-center text-sm font-bold text-zinc-500">
                    No Image
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 self-end pb-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Chip tone="orange">{resolvedTeamName}</Chip>
                  <Chip>{player?.pos || "-"}{player?.secondaryPos ? ` / ${player.secondaryPos}` : ""}</Chip>
                  <Chip>Age {player?.age ?? "-"}</Chip>
                  {rights?.restrictedFreeAgent && <Chip tone="green">RFA</Chip>}
                </div>

                <h2 className="truncate text-4xl font-black leading-none tracking-tight sm:text-6xl">
                  {player?.name || "Unknown Player"}
                </h2>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatPill label="OVR" value={player?.overall ?? "-"} accent />
                  <StatPill label="POT" value={player?.potential ?? "-"} />
                  <StatPill label="OFF" value={player?.offRating ?? "-"} />
                  <StatPill label="DEF" value={player?.defRating ?? "-"} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 lg:justify-end">
              <div className="hidden min-w-0 flex-col items-end lg:flex">
                <div className="text-sm font-black uppercase tracking-[0.24em] text-zinc-500">Player Card</div>
                <div className="mt-2 max-w-sm text-right text-sm text-zinc-400">
                  Career history, accolades, contract context, and generated mood in one clean profile.
                </div>
              </div>

              <div className="relative grid h-32 w-32 shrink-0 place-items-center rounded-full bg-white/[0.03] sm:h-40 sm:w-40">
                <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                  <circle cx="64" cy="64" r="54" stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    stroke="url(#playerCardOvrGradient)"
                    strokeWidth="10"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                  />
                  <defs>
                    <linearGradient id="playerCardOvrGradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#fb923c" />
                      <stop offset="55%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#fef08a" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute text-center">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Overall</div>
                  <div className="-mt-1 text-5xl font-black text-orange-300 sm:text-6xl">{player?.overall ?? "-"}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-xl font-black text-zinc-300 transition hover:border-orange-400/40 hover:bg-orange-500/15 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

        </div>

        <div ref={contentScrollRef} className="pc-modal-scroll relative min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 sm:px-7 sm:pt-3 sm:pb-7">
          <div className="mb-5 rounded-[24px] border border-white/10 bg-black/30 p-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {TABS.map((tab) => {
                const badge =
                  tab.key === "career"
                    ? seasons.length
                    : tab.key === "accolades"
                    ? accolades.length
                    : tab.key === "transactions"
                    ? transactions.length
                    : null;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`shrink-0 rounded-2xl border px-4 py-3 text-sm font-black transition ${
                      activeTab === tab.key
                        ? "border-orange-400/40 bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                        : "border-white/10 bg-white/[0.05] text-zinc-300 hover:border-orange-400/25 hover:bg-orange-500/10 hover:text-white"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {badge !== null && (
                      <span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[11px] text-white/80">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {activeTab === "overview" && (
            <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
              <div className="space-y-5">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-xl font-black">Ratings Snapshot</h3>
                    <Chip tone="orange">Stamina {player?.stamina ?? "-"}</Chip>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <StatPill label="Height" value={formatHeight(player?.height)} />
                    <StatPill label="Age" value={player?.age ?? "-"} />
                    <StatPill label="Scoring" value={Math.round(safeNumber(player?.scoringRating, 0)) || "-"} />
                    <StatPill label="Pro Yrs" value={player?.meta?.proSeasons ?? "-"} />
                    <StatPill label="Team Yrs" value={player?.meta?.yearsWithCurrentTeam ?? "-"} />
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <h3 className="mb-4 text-xl font-black">Attributes</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ATTR_LABELS.map((label, index) => {
                      const value = safeNumber(player?.attrs?.[index], 0);
                      return (
                        <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400">{label}</span>
                            <span className="text-sm font-black text-white">{value || "-"}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-400 to-amber-300"
                              style={{ width: `${clamp(value, 0, 99)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-xl font-black">Contract</h3>
                    <Chip tone={contractYears ? "green" : "neutral"}>{contractYears ? `${contractYears} years` : "No deal"}</Chip>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <StatPill label="AAV" value={formatMillions(contractAav)} accent />
                    <StatPill label="Start" value={player?.contract?.startYear || "-"} />
                  </div>

                  {salaryByYear.length ? (
                    <div className="mt-4 space-y-2">
                      {salaryByYear.map((salary, index) => {
                        const seasonYear = safeNumber(player?.contract?.startYear, 0) + index;
                        const optionYear = Array.isArray(option?.yearIndices) && option.yearIndices.includes(index);
                        return (
                          <div key={`${seasonYear}-${index}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                            <span className="font-bold text-zinc-300">
                              {seasonYear || `Year ${index + 1}`}
                              {optionYear && optionType ? ` (${optionType} option)` : ""}
                            </span>
                            <span className="font-black text-white">{formatDollars(salary)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title="No active contract" subtitle="This player is currently showing without salary years." />
                  )}
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <h3 className="mb-4 text-xl font-black">Rights & Bio</h3>
                  <div className="flex flex-wrap gap-2">
                    <Chip tone="orange">{formatBirdLevel(rights?.birdLevel)}</Chip>
                    {rights?.heldByTeam && <Chip>Held by {rights.heldByTeam}</Chip>}
                    {rights?.rookieScale && <Chip tone="green">Rookie Scale</Chip>}
                    {rights?.restrictedFreeAgent && <Chip tone="green">Restricted FA</Chip>}
                    {player?.meta?.acquiredVia && <Chip>Via {String(player.meta.acquiredVia).replaceAll("_", " ")}</Chip>}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <StatPill label="Draft Year" value={player?.meta?.draftYear || "-"} />
                    <StatPill label="Draft Pick" value={player?.meta?.draftPick || "-"} />
                    <StatPill label="Bird Yrs" value={rights?.seasonsTowardBird ?? "-"} />
                    <StatPill label="Birthday" value={player?.birthMonth && player?.birthDay ? `${player.birthMonth}/${player.birthDay}` : "-"} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "mood" && (
            <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
              <div className={`rounded-[32px] border bg-gradient-to-br ${moodTheme} p-[1px]`}>
                <div className="rounded-[31px] bg-zinc-950/90 p-6">
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-zinc-500">Mood</div>
                  <div className="mt-4 text-5xl font-black text-white">{mood.label}</div>
                  <div className="mt-2 text-sm text-zinc-400">
                    {mood.source === "saved" ? "Saved from player profile" : "Generated from team context, role, contract, and history"}
                  </div>

                  <div className="mt-8 grid place-items-center">
                    <div className="relative grid h-52 w-52 place-items-center rounded-full bg-white/[0.04]">
                      <svg viewBox="0 0 150 150" className="h-full w-full -rotate-90">
                        <circle cx="75" cy="75" r="62" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
                        <circle
                          cx="75"
                          cy="75"
                          r="62"
                          fill="none"
                          stroke="#fb923c"
                          strokeWidth="14"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 62}
                          strokeDashoffset={(2 * Math.PI * 62) * (1 - mood.value / 100)}
                        />
                      </svg>
                      <div className="absolute text-center">
                        <div className="text-6xl font-black text-orange-300">{mood.value}</div>
                        <div className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500">out of 100</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-center">
                    <Chip tone={mood.trend === "down" ? "red" : mood.trend === "up" ? "green" : "orange"}>
                      Trend: {mood.trend}
                    </Chip>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6">
                <h3 className="text-xl font-black">Why he feels this way</h3>
                <div className="mt-5 space-y-3">
                  {mood.reasons.map((reason, index) => (
                    <div key={`${reason}-${index}`} className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500/15 text-sm font-black text-orange-300">
                        {index + 1}
                      </div>
                      <div className="text-sm font-semibold leading-relaxed text-zinc-200">{reason}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4 text-sm text-orange-100">
                  Later, this same mood score can drive trade requests, extension willingness, and free-agency loyalty.
                </div>
              </div>
            </div>
          )}

          {activeTab === "career" && (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-xl font-black">Season History</h3>
                <Chip>{seasons.length} rows</Chip>
              </div>

              {seasons.length ? (
                <div className="pc-modal-scroll overflow-auto rounded-2xl border border-white/10">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                      <tr>
                        {["Season", "Team", "GP", "PPG", "RPG", "APG", "SPG", "BPG", "FG%", "3P%", "FT%"].map((head) => (
                          <th key={head} className="px-4 py-3 text-left font-black uppercase tracking-[0.12em] text-[11px]">{head}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {seasons.map((row, index) => {
                        const isTotal = row?.rowType === "total" || row?.teamName === "Total";
                        return (
                          <tr key={`${row?.seasonYear}-${row?.teamName}-${index}`} className={isTotal ? "bg-orange-500/10 text-orange-100" : "border-t border-white/5 text-zinc-200"}>
                            <td className="px-4 py-3 font-black">{row?.seasonYear || "-"}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {row?.teamLogo ? <img src={row.teamLogo} alt={row.teamName} className="h-7 w-7 object-contain" /> : <div className="h-7 w-7" />}
                                <span className="font-bold">{row?.teamName || "-"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">{row?.games ?? "-"}</td>
                            <td className="px-4 py-3">{row?.ppg ?? "-"}</td>
                            <td className="px-4 py-3">{row?.rpg ?? "-"}</td>
                            <td className="px-4 py-3">{row?.apg ?? "-"}</td>
                            <td className="px-4 py-3">{row?.spg ?? "-"}</td>
                            <td className="px-4 py-3">{row?.bpg ?? "-"}</td>
                            <td className="px-4 py-3">{row?.fgPct ?? "-"}</td>
                            <td className="px-4 py-3">{row?.threePct ?? "-"}</td>
                            <td className="px-4 py-3">{row?.ftPct ?? "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No season history yet" subtitle="Generated rookies or custom players can start building history after simulated seasons." />
              )}
            </div>
          )}

          {activeTab === "accolades" && (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="text-xl font-black">Accolades</h3>
                <Chip tone="orange">{accolades.length} total</Chip>
              </div>

              {accolades.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[...accolades]
                    .sort((a, b) => safeNumber(b?.seasonYear, 0) - safeNumber(a?.seasonYear, 0))
                    .map((row, index) => (
                      <div key={`${row?.seasonYear}-${row?.label}-${index}`} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">{row?.seasonYear || "-"}</div>
                        <div className="mt-1 text-lg font-black text-white">{row?.label || "Accolade"}</div>
                        {row?.type && <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{String(row.type).replaceAll("_", " ")}</div>}
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState title="No accolades yet" subtitle="Awards, All-Star selections, and custom voting finishes will appear here." />
              )}
            </div>
          )}

          {activeTab === "transactions" && (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="text-xl font-black">Transaction Log</h3>
                <Chip>{transactions.length} entries</Chip>
              </div>

              {transactions.length ? (
                <div className="space-y-3">
                  {[...transactions].reverse().map((row, index) => (
                    <div key={`${row?.seasonYear || row?.date || index}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-lg font-black text-white">{row?.label || row?.type || "Transaction"}</div>
                        <Chip tone="orange">{row?.seasonYear || row?.date || "-"}</Chip>
                      </div>
                      {row?.details && <div className="mt-2 text-sm text-zinc-400">{row.details}</div>}
                      {(row?.fromTeam || row?.toTeam) && (
                        <div className="mt-3 text-sm font-semibold text-zinc-300">
                          {row?.fromTeam || "-"} → {row?.toTeam || "-"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No transactions logged" subtitle="Trades, signings, releases, and draft events can be written here as the save develops." />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
