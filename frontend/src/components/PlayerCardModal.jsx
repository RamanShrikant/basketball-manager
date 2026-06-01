import React, { useEffect, useMemo, useRef, useState } from "react";
import LZString from "lz-string";

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

const PLAYER_STATS_KEY = "bm_player_stats_v1";
const ALL_STARS_KEY = "bm_all_stars_v1";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJSON(raw, fallback = {}) {
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

function readCompressedOrJson(key, fallback = {}) {
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

function formatWeight(player) {
  const raw = player?.weight || player?.weightLbs || player?.lbs || player?.meta?.weight;
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `${Math.round(n)} lbs`;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamLogoIndex(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  const map = {};

  for (const team of teams) {
    if (!team?.name) continue;

    map[team.name] =
      team.logo ||
      team.teamLogo ||
      team.newTeamLogo ||
      team.logoUrl ||
      team.image ||
      team.img ||
      "";
  }

  return map;
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
  if (level === "early bird") return "Early Bird";
  if (level === "non_bird") return "Non-Bird";
  if (level === "non-bird") return "Non-Bird";
  if (!level || level === "none" || level === "no rights") return "No Rights";
  return String(level).replaceAll("_", " ");
}

function getContractType(player) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  return String(player?.contractType || player?.rosterStatus || contract?.type || "standard").toLowerCase();
}

function getContractTypeLabel(player) {
  const type = getContractType(player);
  if (type === "two_way" || type === "two-way") return "Two-Way Contract";
  if (type === "rookie_scale") return "Rookie Scale";
  if (type === "minimum") return "Minimum Contract";
  if (type === "extension") return "Extension";
  if (type === "free_agent") return "Free Agent";
  if (type === "unsigned_rookie" || type === "rookie_pending") return "Unsigned Rookie";
  if (type === "draft_rights") return "Draft Rights";
  return "Standard Contract";
}

function getContractTypeTone(player) {
  const type = getContractType(player);
  if (type === "two_way" || type === "two-way") return "orange";
  if (type === "free_agent" || type === "unsigned_rookie" || type === "rookie_pending") return "red";
  return "green";
}

function getAssignmentLabel(player) {
  const status = String(player?.assignmentStatus || "").toLowerCase();
  if (status === "g_league") return "G League";
  if (status === "nba") return "NBA Roster";
  if (status === "free_agent") return "Free Agent";
  if (status === "unsigned_rookie") return "Unsigned Rookie";
  return "";
}

function getPlayerPortraitUrl(player) {
  return player?.headshot || player?.image || player?.img || resolvePortrait(player) || "";
}

function getMoodLabel(value) {
  if (value >= 85) return "Very Happy";
  if (value >= 70) return "Happy";
  if (value >= 50) return "Content";
  if (value >= 35) return "Frustrated";
  return "Unhappy";
}

function getCurrentSeasonDisplayYear(leagueData) {
  const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {});
  const metaStartYear = Number(meta?.seasonYear);

  if (Number.isFinite(metaStartYear) && metaStartYear > 1900) {
    return metaStartYear + 1;
  }

  const leagueYear = Number(
    leagueData?.seasonYear ||
    leagueData?.currentSeasonYear ||
    2025
  );

  return Number.isFinite(leagueYear) && leagueYear > 1900 ? leagueYear + 1 : 2026;
}

function getSimStartDisplayYear(leagueData) {
  const raw = Number(
    leagueData?.simStartYear ||
    leagueData?.seasonStartYear ||
    leagueData?.startSeasonYear ||
    2025
  );

  if (Number.isFinite(raw) && raw > 1900) {
    return raw >= 2026 ? raw : raw + 1;
  }

  return 2026;
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(1));
}

function pct1(made, attempts) {
  const m = Number(made || 0);
  const a = Number(attempts || 0);
  if (!a) return 0;
  return round1((m / a) * 100);
}

function buildSeasonRowFromStats(rec, seasonYear, teamLogoMap) {
  const gp = Number(rec?.gp || 0);
  const safeGp = gp || 1;
  const teamName = rec?.team || "Free Agent";

  return {
    seasonYear,
    teamName,
    teamLogo: teamLogoMap[teamName] || "",
    games: gp,
    ppg: round1(Number(rec?.pts || 0) / safeGp),
    rpg: round1(Number(rec?.reb || 0) / safeGp),
    apg: round1(Number(rec?.ast || 0) / safeGp),
    spg: round1(Number(rec?.stl || 0) / safeGp),
    bpg: round1(Number(rec?.blk || 0) / safeGp),
    fgPct: pct1(rec?.fgm, rec?.fga),
    threePct: pct1(rec?.tpm, rec?.tpa),
    ftPct: pct1(rec?.ftm, rec?.fta),
    source: "live",
  };
}

function buildEmptyLiveSeasonRow(player, seasonYear, teamName, teamLogo) {
  return {
    seasonYear,
    teamName: teamName || player?.teamName || "Free Agent",
    teamLogo: teamLogo || player?.teamLogo || "",
    games: 0,
    ppg: 0,
    rpg: 0,
    apg: 0,
    spg: 0,
    bpg: 0,
    fgPct: 0,
    threePct: 0,
    ftPct: 0,
    source: "live",
  };
}

function combineStatRecords(records, playerName) {
  const total = {
    player: playerName,
    team: "Total",
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
  };

  for (const rec of records) {
    total.gp += Number(rec?.gp || 0);
    total.min += Number(rec?.min || 0);
    total.pts += Number(rec?.pts || 0);
    total.reb += Number(rec?.reb || 0);
    total.ast += Number(rec?.ast || 0);
    total.stl += Number(rec?.stl || 0);
    total.blk += Number(rec?.blk || 0);
    total.fgm += Number(rec?.fgm || 0);
    total.fga += Number(rec?.fga || 0);
    total.tpm += Number(rec?.tpm || 0);
    total.tpa += Number(rec?.tpa || 0);
    total.ftm += Number(rec?.ftm || 0);
    total.fta += Number(rec?.fta || 0);
  }

  return total;
}

function buildPlayerCardSeasonRows({
  player,
  leagueData,
  resolvedTeamName,
  resolvedTeamLogo,
}) {
  const currentSeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const simStartYear = getSimStartDisplayYear(leagueData);
  const teamLogoMap = getTeamLogoIndex(leagueData);
  const statsMap = readCompressedOrJson(PLAYER_STATS_KEY, {});

  const rawHistory = Array.isArray(player?.history?.seasons)
    ? player.history.seasons
    : [];

  const historicalRows = rawHistory.filter((row) => {
    const seasonYear = Number(row?.seasonYear || 0);

    if (row?.rowType === "total") return false;
    if (row?.source === "sim" || row?.simulated === true) return true;

    return seasonYear > 0 && seasonYear < simStartYear;
  });

  const playerName = player?.name || player?.player || "";
  const liveRecords = [];

  for (const [key, rec] of Object.entries(statsMap || {})) {
    const recPlayer = rec?.player || key.split("__")[0];

    if (recPlayer === playerName && Number(rec?.gp || 0) > 0) {
      liveRecords.push(rec);
    }
  }

  let liveRows = [];

  if (liveRecords.length) {
    liveRows = liveRecords.map((rec) =>
      buildSeasonRowFromStats(rec, currentSeasonYear, teamLogoMap)
    );

    if (liveRows.length > 1) {
      const totalRec = combineStatRecords(liveRecords, playerName);

      liveRows.push({
        ...buildSeasonRowFromStats(totalRec, currentSeasonYear, teamLogoMap),
        teamName: "Total",
        teamLogo: "",
        rowType: "total",
      });
    }
  } else {
    liveRows = [
      buildEmptyLiveSeasonRow(
        player,
        currentSeasonYear,
        resolvedTeamName,
        resolvedTeamLogo
      ),
    ];
  }

  const withoutDuplicateCurrent = historicalRows.filter((row) => {
    return Number(row?.seasonYear || 0) !== Number(currentSeasonYear);
  });

  return [...withoutDuplicateCurrent, ...liveRows].sort((a, b) => {
    const ay = Number(a?.seasonYear || 0);
    const by = Number(b?.seasonYear || 0);

    if (ay !== by) return ay - by;
    if (a?.rowType === "total") return 1;
    if (b?.rowType === "total") return -1;

    return String(a?.teamName || "").localeCompare(String(b?.teamName || ""));
  });
}


function getAccoladeSeasonYear(row) {
  return Number(row?.seasonYear || row?.season || row?.year || 0);
}

function getAllStarSeasonYear(data, fallbackYear) {
  const seasonText = String(data?.season || "");
  const match = seasonText.match(/(\d{4})\s*-\s*(\d{4})/);

  if (match) {
    const endYear = Number(match[2]);
    if (Number.isFinite(endYear) && endYear > 1900) return endYear;
  }

  const cutoffYear = Number(String(data?.cutoff_date || "").slice(0, 4));
  if (Number.isFinite(cutoffYear) && cutoffYear > 1900) return cutoffYear;

  return fallbackYear;
}

function addUniqueAccolade(rows, next) {
  const exists = rows.some((row) => {
    return (
      getAccoladeSeasonYear(row) === getAccoladeSeasonYear(next) &&
      String(row?.type || "") === String(next?.type || "") &&
      String(row?.label || "") === String(next?.label || "")
    );
  });

  if (!exists) rows.push(next);
}

function collectLiveAllStarAccolades(playerName, leagueData) {
  if (!playerName) return [];

  const data = readCompressedOrJson(ALL_STARS_KEY, null);
  if (!data) return [];

  const currentSeasonYear = getCurrentSeasonDisplayYear(leagueData);
  const seasonYear = getAllStarSeasonYear(data, currentSeasonYear);

  // Do not let a stale All-Star result from an older/newer season leak into the current player card.
  if (Number(seasonYear) !== Number(currentSeasonYear)) return [];

  const rows = [];
  const addRows = (list, roleLabel) => {
    for (const row of list || []) {
      const rowPlayer = row?.player || row?.name;
      if (rowPlayer !== playerName) continue;

      addUniqueAccolade(rows, {
        seasonYear,
        type: "all_star",
        label: "NBA All-Star",
        details: null,
        team: row?.team || null,
        source: "live",
        simulated: true,
      });
    }
  };

  addRows(data?.east?.starters, "All-Star Starter");
  addRows(data?.west?.starters, "All-Star Starter");
  addRows(data?.east?.reserves, "All-Star Reserve");
  addRows(data?.west?.reserves, "All-Star Reserve");

  return rows;
}

function buildPlayerCardAccolades({ player, leagueData }) {
  const simStartYear = getSimStartDisplayYear(leagueData);
  const playerName = player?.name || player?.player || "";

  const rawAccolades = Array.isArray(player?.history?.accolades)
    ? player.history.accolades
    : [];

  const filtered = rawAccolades.filter((row) => {
    const seasonYear = getAccoladeSeasonYear(row);

    if (row?.source === "sim" || row?.source === "live" || row?.simulated === true) {
      return true;
    }

    // Keep real-life/preloaded accolades only before the sim's first display season.
    return seasonYear > 0 && seasonYear < simStartYear;
  });

  const merged = [...filtered];

  for (const row of collectLiveAllStarAccolades(playerName, leagueData)) {
    addUniqueAccolade(merged, row);
  }

  return merged.sort((a, b) => {
    const ay = getAccoladeSeasonYear(a);
    const by = getAccoladeSeasonYear(b);
    if (ay !== by) return ay - by;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  });
}


const ACCOLADE_FILTERS = [
  { key: "all", label: "All" },
  { key: "major", label: "Major" },
  { key: "all_nba", label: "All-NBA" },
  { key: "all_star", label: "All-Star" },
  { key: "stat_titles", label: "Stat Titles" },
  { key: "misc", label: "Miscellaneous" },
  { key: "voting_top_3", label: "Voting Top 3" },
  { key: "voting_top_5", label: "Voting Top 5" },
  { key: "voting_top_10", label: "Voting Top 10" },
];

function accoladeText(row) {
  return `${row?.label || ""} ${row?.type || ""} ${row?.details || ""}`.toLowerCase();
}

function getVotingPlacement(row) {
  const text = accoladeText(row);

  const ordinalMatch = text.match(/(?:^|[^0-9])(\d+)(st|nd|rd|th)\b/);
  if (ordinalMatch) {
    const place = Number(ordinalMatch[1]);
    return Number.isFinite(place) && place > 0 ? place : null;
  }

  const plainVotingMatch = text.match(/(?:voting|ranked|finished|finish|place|placing)\s*[-:]?\s*(\d+)\b/);
  if (plainVotingMatch) {
    const place = Number(plainVotingMatch[1]);
    return Number.isFinite(place) && place > 0 ? place : null;
  }

  if (text.includes("finalist")) return 3;

  return null;
}

function isVotingAccolade(row) {
  const text = accoladeText(row);
  return text.includes("voting") || text.includes("finalist") || !!getVotingPlacement(row);
}

function isVotingOrFinalistText(text) {
  return text.includes("voting") || text.includes("finalist") || !!getVotingPlacement({ label: text });
}

function getVotingBucket(row) {
  if (!isVotingAccolade(row)) return null;

  const place = getVotingPlacement(row);
  if (!place) return "voting_other";

  if (place <= 3) return "voting_top_3";
  if (place <= 5) return "voting_top_5";
  if (place <= 10) return "voting_top_10";

  return "voting_other";
}

function getVotingDisplayType(row) {
  const bucket = getVotingBucket(row);

  if (bucket === "voting_top_3") return "Voting Top 3";
  if (bucket === "voting_top_5") return "Voting Top 5";
  if (bucket === "voting_top_10") return "Voting Top 10";
  if (isVotingAccolade(row)) return "Voting";

  return null;
}

function isMvpAccolade(row) {
  const text = accoladeText(row);
  return text.includes("mvp") && !text.includes("finals") && !isVotingOrFinalistText(text);
}

function isDpoyAccolade(row) {
  const text = accoladeText(row);
  const isDpoyText = text.includes("dpoy") || text.includes("defensive player of the year");
  return isDpoyText && !isVotingOrFinalistText(text);
}

function isFinalsMvpAccolade(row) {
  const text = accoladeText(row);
  return (text.includes("finals mvp") || text.includes("finals_mvp")) && !isVotingOrFinalistText(text);
}

function isAllNbaAccolade(row) {
  const text = accoladeText(row);
  return text.includes("all-nba") || text.includes("all nba") || text.includes("all_nba");
}

function isAllDefensiveAccolade(row) {
  const text = accoladeText(row);
  return text.includes("all-defensive") || text.includes("all defensive") || text.includes("all_defensive");
}

function isAllRookieAccolade(row) {
  const text = accoladeText(row);
  return text.includes("all-rookie") || text.includes("all rookie") || text.includes("all_rookie");
}

function isAllStarAccolade(row) {
  const text = accoladeText(row);
  return text.includes("all-star") || text.includes("all star") || text.includes("all_star");
}

function isRookieAccolade(row) {
  const text = accoladeText(row);
  return (text.includes("roty") || text.includes("rookie of the year")) && !isVotingOrFinalistText(text);
}

function isSixthManAccolade(row) {
  const text = accoladeText(row);
  return (text.includes("6moy") || text.includes("sixth man")) && !isVotingOrFinalistText(text);
}

function isChampionAccolade(row) {
  const text = accoladeText(row);
  return text.includes("champion") && !text.includes("scoring") && !text.includes("assist") && !text.includes("rebound") && !text.includes("steal") && !text.includes("block");
}

function getStatTitleKey(row) {
  const text = accoladeText(row);

  if (text.includes("scoring champion") || text.includes("points champion") || text.includes("ppg leader")) return "ppg";
  if (text.includes("assist champion") || text.includes("assists champion") || text.includes("assist leader") || text.includes("apg leader")) return "apg";
  if (text.includes("rebound champion") || text.includes("rebounds champion") || text.includes("rebounding champion") || text.includes("rpg leader")) return "rpg";
  if (text.includes("steals champion") || text.includes("steal champion") || text.includes("steals leader") || text.includes("spg leader")) return "spg";
  if (text.includes("blocks champion") || text.includes("block champion") || text.includes("blocks leader") || text.includes("bpg leader")) return "bpg";

  return null;
}

function isStatTitleAccolade(row) {
  return !!getStatTitleKey(row);
}

function classifyAccolade(row) {
  if (isMvpAccolade(row) || isDpoyAccolade(row) || isFinalsMvpAccolade(row)) return "major";
  if (isAllNbaAccolade(row)) return "all_nba";
  if (isAllStarAccolade(row)) return "all_star";
  if (isStatTitleAccolade(row)) return "stat_titles";

  const votingBucket = getVotingBucket(row);
  if (votingBucket && votingBucket !== "voting_other") return votingBucket;

  if (
    isAllDefensiveAccolade(row) ||
    isAllRookieAccolade(row) ||
    isChampionAccolade(row) ||
    accoladeText(row).includes("conference finals")
  ) {
    return "misc";
  }

  return "other";
}

function matchesAccoladeFilter(row, filter) {
  if (filter === "all") return true;

  const votingBucket = getVotingBucket(row);

  if (filter === "voting_top_3") return votingBucket === "voting_top_3";
  if (filter === "voting_top_5") return votingBucket === "voting_top_5";
  if (filter === "voting_top_10") return votingBucket === "voting_top_10";

  return classifyAccolade(row) === filter;
}

function getAccoladeDisplayType(row) {
  const votingType = getVotingDisplayType(row);
  if (votingType) return votingType;

  const raw = String(row?.type || "").replaceAll("_", " ").trim();
  if (isMvpAccolade(row)) return "MVP";
  if (isDpoyAccolade(row)) return "DPOY";
  if (isFinalsMvpAccolade(row)) return "Finals MVP";
  if (isAllNbaAccolade(row)) return "All-NBA";
  if (isAllDefensiveAccolade(row)) return "All-Defensive";
  if (isAllRookieAccolade(row)) return "All-Rookie";
  if (isAllStarAccolade(row)) return "All-Star";
  if (isRookieAccolade(row)) return "ROTY";
  if (isSixthManAccolade(row)) return "Sixth Man";
  if (isStatTitleAccolade(row)) return "Stat Title";
  if (!raw || raw.toLowerCase() === "custom") return "Other";
  return raw;
}

function getAccoladeDisplayLabel(row) {
  if (isAllStarAccolade(row)) return "NBA All-Star";
  return row?.label || "Accolade";
}

function getAccoladePriority(row) {
  const text = accoladeText(row);
  const votingPlace = getVotingPlacement(row);

  if (isMvpAccolade(row)) return 1;
  if (isDpoyAccolade(row)) return 2;
  if (isFinalsMvpAccolade(row)) return 3;
  if (text.includes("all-nba first") || text.includes("all nba first") || text.includes("all_nba_first")) return 4;
  if (text.includes("all-nba second") || text.includes("all nba second") || text.includes("all_nba_second")) return 5;
  if (text.includes("all-nba third") || text.includes("all nba third") || text.includes("all_nba_third")) return 6;
  if (isAllNbaAccolade(row)) return 7;
  if (isAllStarAccolade(row)) return 8;
  if (isChampionAccolade(row)) return 9;
  if (isStatTitleAccolade(row)) return 10;
  if (isAllDefensiveAccolade(row)) return 11;
  if (isAllRookieAccolade(row)) return 12;
  if (isRookieAccolade(row)) return 13;
  if (isSixthManAccolade(row)) return 14;
  if (votingPlace) return 20 + votingPlace;
  if (isVotingAccolade(row)) return 35;

  return 50;
}

function getAccoladeIcon(row) {
  const text = accoladeText(row);

  if (isMvpAccolade(row)) return "🏆";
  if (isDpoyAccolade(row) || text.includes("dpoy") || text.includes("defensive player of the year")) return "🛡️";
  if (text.includes("all-nba first") || text.includes("all nba first") || text.includes("all_nba_first")) return "🥇";
  if (text.includes("all-nba second") || text.includes("all nba second") || text.includes("all_nba_second")) return "🥈";
  if (text.includes("all-nba third") || text.includes("all nba third") || text.includes("all_nba_third")) return "🥉";
  if (isAllNbaAccolade(row)) return "🏅";
  if (isAllDefensiveAccolade(row)) return "🛡️";
  if (isAllRookieAccolade(row)) return "🌱";
  if (isAllStarAccolade(row)) return "⭐";
  if (text.includes("mvp") && isVotingAccolade(row)) return "🏆";
  if ((text.includes("rookie") || text.includes("roty")) && isVotingAccolade(row)) return "🌱";
  if (text.includes("sixth man") && isVotingAccolade(row)) return "6";
  if (text.includes("clutch") && isVotingAccolade(row)) return "⏱️";
  if (isVotingAccolade(row)) return "📊";
  if (isRookieAccolade(row)) return "🌱";
  if (isFinalsMvpAccolade(row)) return "🎖️";
  if (isChampionAccolade(row)) return "💍";
  if (isSixthManAccolade(row)) return "6";
  if (getStatTitleKey(row) === "ppg") return "🔥";
  if (getStatTitleKey(row) === "apg") return "🎯";
  if (getStatTitleKey(row) === "rpg") return "🧲";
  if (getStatTitleKey(row) === "spg") return "🔒";
  if (getStatTitleKey(row) === "bpg") return "🧱";

  return "•";
}

function sortAccoladesForDisplay(rows) {
  return [...rows].sort((a, b) => {
    const ay = getAccoladeSeasonYear(a);
    const by = getAccoladeSeasonYear(b);
    if (ay !== by) return by - ay;

    const ap = getAccoladePriority(a);
    const bp = getAccoladePriority(b);
    if (ap !== bp) return ap - bp;

    return String(a?.label || "").localeCompare(String(b?.label || ""));
  });
}

function buildSeasonHonorIndex(accolades) {
  const map = new Map();

  for (const row of accolades || []) {
    const seasonYear = getAccoladeSeasonYear(row);
    if (!seasonYear) continue;

    if (!map.has(seasonYear)) map.set(seasonYear, []);
    map.get(seasonYear).push(row);
  }

  for (const [seasonYear, rows] of map.entries()) {
    map.set(seasonYear, [...rows].sort((a, b) => getAccoladePriority(a) - getAccoladePriority(b)));
  }

  return map;
}

function getSeasonStatHighlights(honors) {
  const highlights = new Set();

  for (const row of honors || []) {
    const key = getStatTitleKey(row);
    if (key) highlights.add(key);
  }

  return highlights;
}

function filterAccoladesByTab(accolades, filter) {
  return sortAccoladesForDisplay((accolades || []).filter((row) => matchesAccoladeFilter(row, filter)));
}

function HonorCell({ honors, honorKey, isOpen, onToggle }) {
  if (!honors?.length) {
    return <span className="text-zinc-700">—</span>;
  }

  const visible = honors.slice(0, 3);
  const extraCount = honors.length - visible.length;

  return (
    <div className="relative inline-flex items-center" data-honor-popup-root="true">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-sm transition hover:border-orange-400/40 hover:bg-orange-500/10"
        aria-expanded={isOpen}
        aria-label={`View ${honors.length} honors for ${honorKey}`}
      >
        {visible.map((row, index) => (
          <span key={`${getAccoladeIcon(row)}-${index}`} title={row?.label || "Honor"}>
            {getAccoladeIcon(row)}
          </span>
        ))}
        {extraCount > 0 && (
          <span className="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-orange-200">
            +{extraCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-9 z-50 w-72 rounded-2xl border border-orange-400/25 bg-zinc-950 p-3 text-left shadow-2xl shadow-black/60">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">
            Season Honors
          </div>
          <div className="pc-modal-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
            {honors.map((row, index) => (
              <div key={`${row?.label}-${index}`} className="flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
                <span className="mt-0.5 w-5 text-center">{getAccoladeIcon(row)}</span>
                <div className="min-w-0">
                  <div className="text-xs font-black text-white">{getAccoladeDisplayLabel(row)}</div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    {getAccoladeDisplayType(row)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ children, highlighted, isTotal }) {
  return (
    <td className={`px-4 py-3 ${highlighted && !isTotal ? "font-black text-amber-300" : ""}`}>
      {children}
    </td>
  );
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

  const accolades = buildPlayerCardAccolades({ player, leagueData });
  const recentAccolades = accolades.filter((row) => safeNumber(getAccoladeSeasonYear(row), 0) >= 2024).length;
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
    <div className="pc-stat-pill rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3">
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

function MiniOverallPill({ value, potential, circumference, offset }) {
  return (
    <div className="relative grid h-[126px] w-[126px] shrink-0 place-items-center rounded-full bg-black/10">
      <svg viewBox="0 0 126 126" className="absolute h-[126px] w-[126px] -rotate-90">
        <circle cx="63" cy="63" r="52" stroke="rgba(255,255,255,0.10)" strokeWidth="9" fill="none" />
        <circle
          cx="63"
          cy="63"
          r="52"
          stroke="url(#miniPlayerCardOvrGradient)"
          strokeWidth="9"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id="miniPlayerCardOvrGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fef08a" />
          </linearGradient>
        </defs>
      </svg>
      <div className="relative text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">OVR</div>
        <div className="-mt-0.5 text-[44px] font-black leading-none text-orange-300">{value ?? "-"}</div>
        <div className="mt-1 text-[10px] font-black uppercase tracking-[0.17em] text-zinc-500">POT {potential ?? "-"}</div>
      </div>
    </div>
  );
}

function HeaderInfoPill({ label, value, children, wide = false }) {
  const normalizedLabel = String(label || "").toLowerCase();
  const sizeClass = wide
    ? "min-w-[350px] flex-[2.1]"
    : normalizedLabel === "pos"
    ? "w-[112px] min-w-[112px] flex-none"
    : "w-[92px] min-w-[92px] flex-none";

  return (
    <div className={`pc-stat-pill flex h-[92px] flex-col justify-center rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-4 ${sizeClass}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 min-w-0 text-xl font-black text-white">{children || value || "-"}</div>
    </div>
  );
}

function HeaderTeamPill({ teamName, teamLogo }) {
  return (
    <HeaderInfoPill label="Team" wide>
      <div className="flex min-w-0 items-center gap-3">
        {teamLogo ? (
          <img src={teamLogo} alt={teamName} className="h-9 w-9 shrink-0 object-contain" />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full bg-white/[0.05]" />
        )}
        <span className="min-w-0 truncate whitespace-nowrap text-[15px] font-black text-white sm:text-base">{teamName || "Free Agent"}</span>
      </div>
    </HeaderInfoPill>
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
  const [accoladeFilter, setAccoladeFilter] = useState("all");
  const [openHonorKey, setOpenHonorKey] = useState(null);
  const contentScrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab("overview");
    setAccoladeFilter("all");
    setOpenHonorKey(null);
  }, [open, player?.id, player?.name]);

  useEffect(() => {
    if (!open) return;
    setOpenHonorKey(null);
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [activeTab, open]);

  useEffect(() => {
    if (!open || !openHonorKey) return undefined;

    const onPointerDown = (event) => {
      if (event.target?.closest?.('[data-honor-popup-root="true"]')) return;
      setOpenHonorKey(null);
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, openHonorKey]);

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

  const seasons = useMemo(() => {
    if (!player) return [];
    return buildPlayerCardSeasonRows({
      player,
      leagueData,
      resolvedTeamName,
      resolvedTeamLogo,
    });
  }, [player, leagueData, resolvedTeamName, resolvedTeamLogo]);

  if (!open || !player) return null;

  const accolades = buildPlayerCardAccolades({ player, leagueData });
  const honorIndex = buildSeasonHonorIndex(accolades);
  const filteredAccolades = filterAccoladesByTab(accolades, accoladeFilter);
  const transactions = Array.isArray(player?.history?.transactions) ? player.history.transactions : [];
  const salaryByYear = Array.isArray(player?.contract?.salaryByYear) ? player.contract.salaryByYear : [];
  const contractYears = getContractYears(player?.contract);
  const contractAav = getContractAav(player?.contract);
  const moodTheme = MOOD_COLORS[mood.label] || MOOD_COLORS.Content;
  const option = player?.contract?.option;
  const optionType = option?.type ? String(option.type).replaceAll("_", " ") : null;
  const rights = player?.rights || {};
  const portraitUrl = getPlayerPortraitUrl(player);
  const contractTypeLabel = getContractTypeLabel(player);
  const contractTypeTone = getContractTypeTone(player);
  const assignmentLabel = getAssignmentLabel(player);
  const fillPercent = clamp(safeNumber(player?.overall, 0) / 99, 0, 1);

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
          box-shadow: 0 28px 90px rgba(0,0,0,0.64), 0 0 42px rgba(229,231,235,0.055);
        }
        .pc-soft-border {
          box-shadow: 0 0 0 1px rgba(255,255,255,0.035), 0 0 16px rgba(229,231,235,0.055);
        }
        .pc-stat-pill {
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 0 13px rgba(229,231,235,0.055);
        }
        .pc-face-card {
          box-shadow: 0 0 18px rgba(229,231,235,0.07), inset 0 1px 0 rgba(255,255,255,0.035);
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

      <div className="pc-pop pc-glow-card relative flex h-[88vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[30px] border border-white/15 bg-[#090909] text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
          <div className="absolute -right-24 top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-44 w-[70%] -translate-x-1/2 bg-orange-500/5 blur-3xl" />
        </div>

        <div className="relative overflow-hidden border-b-2 border-orange-500/45 bg-zinc-950/95 shadow-[0_8px_28px_rgba(249,115,22,0.08)]">
          <div className="pc-shimmer absolute inset-x-0 top-0 h-[3px]" />

          <div className="px-5 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-3 pr-16">
            <div className="flex min-w-0 gap-5 sm:gap-6">
              <div className="pc-face-card relative -mb-[14px] flex h-40 w-32 shrink-0 self-end items-end justify-center overflow-hidden rounded-t-[28px] rounded-b-none border-x-2 border-t-2 border-b-0 border-white/20 bg-gradient-to-b from-zinc-800 to-zinc-950 sm:h-48 sm:w-40">
                {resolvedTeamLogo && (
                  <img
                    src={resolvedTeamLogo}
                    alt={resolvedTeamName}
                    className="absolute inset-0 m-auto h-28 w-28 object-contain opacity-12 blur-[1px] sm:h-40 sm:w-40"
                  />
                )}

                {portraitUrl ? (
                  <img
                    src={portraitUrl}
                    alt={player.name}
                    className="relative z-10 h-full w-full object-contain object-bottom drop-shadow-2xl"
                    style={{
                      transform: "translateY(2px) scale(1.24)",
                      transformOrigin: "bottom center",
                    }}
                  />
                ) : (
                  <div className="relative z-10 flex h-full w-full items-center justify-center text-sm font-bold text-zinc-500">
                    No Image
                  </div>
                )}
              </div>

              <div className="relative top-3 min-w-0 flex-1 self-end pb-1 sm:top-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Chip tone={contractTypeTone}>{contractTypeLabel}</Chip>
                  {assignmentLabel && <Chip>{assignmentLabel}</Chip>}
                  {rights?.restrictedFreeAgent && <Chip tone="green">RFA</Chip>}
                </div>

                <h2
                  className={`max-w-[620px] break-words font-black leading-[0.92] tracking-tight ${
                    String(player?.name || "").length > 24
                      ? "text-3xl sm:text-[42px]"
                      : String(player?.name || "").length > 17
                      ? "text-4xl sm:text-[48px]"
                      : "text-4xl sm:text-5xl"
                  }`}
                >
                  {player?.name || "Unknown Player"}
                </h2>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <MiniOverallPill
                    value={player?.overall ?? "-"}
                    potential={player?.potential ?? "-"}
                    circumference={2 * Math.PI * 52}
                    offset={(2 * Math.PI * 52) * (1 - fillPercent)}
                  />
                  <HeaderTeamPill teamName={resolvedTeamName} teamLogo={resolvedTeamLogo} />
                  <HeaderInfoPill label="POS" value={`${player?.pos || "-"}${player?.secondaryPos ? ` / ${player.secondaryPos}` : ""}`} />
                  <HeaderInfoPill label="AGE" value={player?.age ?? "-"} />
                  <HeaderInfoPill label="HEIGHT" value={formatHeight(player?.height)} />
                </div>
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

        <div ref={contentScrollRef} className="pc-modal-scroll relative min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 sm:px-7 sm:pt-3 sm:pb-7">
          <div className="pc-soft-border mb-5 rounded-[24px] border border-white/15 bg-black/30 p-3">
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
                <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                  <h3 className="mb-4 text-xl font-black">Attributes</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ATTR_LABELS.map((label, index) => {
                      const value = safeNumber(player?.attrs?.[index], 0);
                      return (
                        <div key={label} className="pc-stat-pill rounded-2xl border border-white/15 bg-black/20 p-3">
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
                <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <h3 className="text-xl font-black">Contract</h3>
                    <Chip tone={contractTypeTone}>{contractTypeLabel}</Chip>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <StatPill label="Type" value={contractTypeLabel} accent />
                    <StatPill label="Years" value={contractYears ? `${contractYears}` : "No deal"} />
                    <StatPill label="AAV" value={formatMillions(contractAav)} accent />
                    <StatPill label="Start" value={player?.contract?.startYear || "-"} />
                  </div>

                  {salaryByYear.length ? (
                    <div className="mt-4 space-y-2">
                      {salaryByYear.map((salary, index) => {
                        const seasonYear = safeNumber(player?.contract?.startYear, 0) + index;
                        const optionYear = Array.isArray(option?.yearIndices) && option.yearIndices.includes(index);
                        return (
                          <div key={`${seasonYear}-${index}`} className="pc-stat-pill flex items-center justify-between rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-sm">
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

                <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
                  <h3 className="mb-4 text-xl font-black">Rights & Bio</h3>
                  <div className="flex flex-wrap gap-2">
                    <Chip tone="orange">{formatBirdLevel(rights?.birdLevel)}</Chip>
                    {rights?.heldByTeam && <Chip>Held by {rights.heldByTeam}</Chip>}
                    {rights?.rookieScale && <Chip tone="green">Rookie Scale</Chip>}
                    {rights?.restrictedFreeAgent && <Chip tone="green">Restricted FA</Chip>}
                    {player?.meta?.acquiredVia && <Chip>Via {String(player.meta.acquiredVia).replaceAll("_", " ")}</Chip>}
                    {assignmentLabel && <Chip>{assignmentLabel}</Chip>}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <StatPill label="Bird Yrs" value={rights?.seasonsTowardBird ?? "-"} />
                    <StatPill label="Birthday" value={player?.birthMonth && player?.birthDay ? `${player.birthMonth}/${player.birthDay}` : "-"} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "mood" && (
            <div className="grid items-start gap-5 lg:grid-cols-[0.78fr_1.22fr]">
              <div className={`self-start rounded-[32px] border bg-gradient-to-br ${moodTheme} p-[1px]`}>
                <div className="rounded-[31px] bg-zinc-950/90 p-5">
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-zinc-500">Mood</div>
                  <div className="mt-4 text-5xl font-black text-white">{mood.label}</div>
                  <div className="mt-2 text-sm text-zinc-400">
                    {mood.source === "saved" ? "Saved from player profile" : "Generated from team context, role, contract, and history"}
                  </div>

                  <div className="mt-6 grid place-items-center">
                    <div className="relative grid h-44 w-44 place-items-center rounded-full bg-white/[0.04]">
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
                        <div className="text-5xl font-black text-orange-300">{mood.value}</div>
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

              <div className="pc-soft-border rounded-[32px] border border-white/15 bg-white/[0.04] p-6">
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
            <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-xl font-black">Season History</h3>
                <Chip>{seasons.length} rows</Chip>
              </div>

              {seasons.length ? (
                <div className="pc-soft-border pc-modal-scroll max-h-[calc(88vh-340px)] overflow-auto rounded-2xl border border-white/15">
                  <table className="w-full min-w-[1120px] border-collapse text-sm">
                    <thead className="sticky top-0 z-30 bg-zinc-900/95 text-zinc-400 backdrop-blur-md shadow-[0_1px_0_rgba(255,255,255,0.12),0_8px_18px_rgba(0,0,0,0.35)]">
                      <tr>
                        {[
                          "Season",
                          "Honors",
                          "Team",
                          "GP",
                          "PPG",
                          "RPG",
                          "APG",
                          "SPG",
                          "BPG",
                          "FG%",
                          "3P%",
                          "FT%",
                        ].map((head) => (
                          <th key={head} className="px-4 py-3 text-left font-black uppercase tracking-[0.12em] text-[11px]">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {seasons.map((row, index) => {
                        const isTotal = row?.rowType === "total" || row?.teamName === "Total";
                        const seasonYear = Number(row?.seasonYear || 0);
                        const honors = honorIndex.get(seasonYear) || [];
                        const statHighlights = getSeasonStatHighlights(honors);
                        const honorKey = `${seasonYear}-${row?.teamName || "team"}-${index}`;

                        return (
                          <tr
                            key={`${row?.seasonYear}-${row?.teamName}-${index}`}
                            className={isTotal ? "bg-orange-500/10 text-orange-100" : "border-t border-white/5 text-zinc-200"}
                          >
                            <td className="px-4 py-3 font-black">{row?.seasonYear || "-"}</td>
                            <td className="px-4 py-3">
                              <HonorCell
                                honors={honors}
                                honorKey={honorKey}
                                isOpen={openHonorKey === honorKey}
                                onToggle={() => setOpenHonorKey((prev) => (prev === honorKey ? null : honorKey))}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {row?.teamLogo ? <img src={row.teamLogo} alt={row.teamName} className="h-7 w-7 object-contain" /> : <div className="h-7 w-7" />}
                                <span className="font-bold">{row?.teamName || "-"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">{row?.games ?? "-"}</td>
                            <StatCell highlighted={statHighlights.has("ppg")} isTotal={isTotal}>{row?.ppg ?? "-"}</StatCell>
                            <StatCell highlighted={statHighlights.has("rpg")} isTotal={isTotal}>{row?.rpg ?? "-"}</StatCell>
                            <StatCell highlighted={statHighlights.has("apg")} isTotal={isTotal}>{row?.apg ?? "-"}</StatCell>
                            <StatCell highlighted={statHighlights.has("spg")} isTotal={isTotal}>{row?.spg ?? "-"}</StatCell>
                            <StatCell highlighted={statHighlights.has("bpg")} isTotal={isTotal}>{row?.bpg ?? "-"}</StatCell>
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
            <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black">Accolades</h3>
                  <div className="mt-1 text-sm text-zinc-500">Filter the trophy case by award type.</div>
                </div>
                <Chip tone="orange">{filteredAccolades.length} shown / {accolades.length} total</Chip>
              </div>

              {accolades.length ? (
                <>
                  <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                    {ACCOLADE_FILTERS.map((filter) => {
                      const count = filter.key === "all"
                        ? accolades.length
                        : accolades.filter((row) => matchesAccoladeFilter(row, filter.key)).length;

                      return (
                        <button
                          key={filter.key}
                          type="button"
                          onClick={() => setAccoladeFilter(filter.key)}
                          className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-black transition ${
                            accoladeFilter === filter.key
                              ? "border-orange-400/40 bg-orange-500 text-white shadow-lg shadow-orange-500/15"
                              : "border-white/10 bg-black/25 text-zinc-300 hover:border-orange-400/30 hover:bg-orange-500/10 hover:text-white"
                          }`}
                        >
                          {filter.label}
                          <span className="ml-2 rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-white/80">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {filteredAccolades.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {filteredAccolades.map((row, index) => (
                        <div key={`${getAccoladeSeasonYear(row)}-${row?.label}-${index}`} className="rounded-2xl border border-orange-400/20 bg-orange-500/10 p-4 transition hover:border-orange-300/35 hover:bg-orange-500/15">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">{getAccoladeSeasonYear(row) || "-"}</div>
                              <div className="mt-1 text-lg font-black text-white">{getAccoladeDisplayLabel(row)}</div>
                            </div>
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/25 text-lg">
                              {getAccoladeIcon(row)}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                              {getAccoladeDisplayType(row)}
                            </span>
                            {classifyAccolade(row) === "misc" && (
                              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                                Miscellaneous
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No accolades in this filter" subtitle="Try All, Major, All-NBA, All-Star, Stat Titles, Miscellaneous, Voting Top 3, Voting Top 5, or Voting Top 10." />
                  )}
                </>
              ) : (
                <EmptyState title="No accolades yet" subtitle="Awards, All-Star selections, and miscellaneous voting finishes will appear here." />
              )}
            </div>
          )}

          {activeTab === "transactions" && (
            <div className="pc-soft-border rounded-[28px] border border-white/15 bg-white/[0.04] p-5">
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
