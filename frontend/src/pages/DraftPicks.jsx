import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import styles from "./RosterView.module.css";
import {
  getAllTeamsFromLeague,
  getTeamLogoMap,
  getDraftPickProtectionLabel,
  normalizeDraftPicks,
  normalizeTeamName,
  sortDraftPickAssets,
} from "../utils/draftPicks.js";
import "../styles/BMAnimations.css";

const TEAM_CODES = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
  "Multiple Teams": "",
};

const CODE_ALIASES = {
  BRK: "BKN",
  BKN: "BKN",
  PHL: "PHI",
  PHI: "PHI",
  PHO: "PHX",
  PHX: "PHX",
  SA: "SAS",
  SAS: "SAS",
  GS: "GSW",
  GSW: "GSW",
  WSH: "WAS",
  WAS: "WAS",
  CHO: "CHA",
  CHA: "CHA",
  NO: "NOP",
  NOP: "NOP",
  UTH: "UTA",
  UTA: "UTA",
};

const KNOWN_CODES = new Set([
  ...Object.values(TEAM_CODES).filter(Boolean),
  ...Object.keys(CODE_ALIASES),
  ...Object.values(CODE_ALIASES),
]);

function canonicalTeamCode(code) {
  const upper = String(code || "").trim().toUpperCase();
  return CODE_ALIASES[upper] || upper;
}

function getLogo(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

function TeamLogo({ src, name, size = 42 }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "Team"}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }

  const initials = String(name || "?")
    .split(" ")
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .slice(0, 3);

  return (
    <div
      className="flex items-center justify-center rounded-full bg-neutral-700 text-xs font-black text-white"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

function roundLabel(round) {
  return Number(round) === 1 ? "1st" : "2nd";
}

function assetTypeLabel(asset) {
  const type = String(asset?.assetType || asset?.type || "pick").toLowerCase();
  return type === "swap" ? "Swap" : "Pick";
}

function getTeamCode(name) {
  const clean = String(name || "").trim();
  if (!clean) return "";
  if (TEAM_CODES[clean]) return TEAM_CODES[clean];

  const upper = clean.toUpperCase();
  if (KNOWN_CODES.has(upper)) return canonicalTeamCode(upper);

  return clean
    .split(" ")
    .map((word) => word[0]?.toUpperCase())
    .join("")
    .slice(0, 4);
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}


function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getDraftOrderPickNumber(row = null) {
  if (!row || typeof row !== "object") return 0;
  const value = Number(row.pick || row.pickNumber || row.overallPick || row.draftPickNumber || row.resolvedPickNumber || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isUsableDraftOrderRow(row = null) {
  if (!row || typeof row !== "object") return false;
  if (getDraftOrderPickNumber(row) > 0) return true;
  return Boolean(row.teamName || row.currentOwnerTeamName || row.ownerTeamName || row.originalTeamName || row.originalPickTeamName);
}

function sanitizeDraftOrderRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(isUsableDraftOrderRow);
}

function getSeasonYearFromLeague(leagueData) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const candidates = [
    offseasonState?.seasonYear,
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);

  return candidates.length ? Math.max(...candidates) : 2026;
}

function readLockedDraftOrder(leagueData, seasonYear) {
  const direct = leagueData?.draftState?.draftOrder;
  if (Array.isArray(direct) && direct.length) return sanitizeDraftOrderRows(direct);

  const lotteryOrder = leagueData?.draftState?.lottery?.fullDraftOrder;
  if (Array.isArray(lotteryOrder) && lotteryOrder.length) return sanitizeDraftOrderRows(lotteryOrder);

  const savedLottery = safeJSON(localStorage.getItem("bm_draft_lottery_v1"), null);
  if (
    savedLottery &&
    Number(savedLottery.seasonYear) === Number(seasonYear) &&
    savedLottery.firstRoundRevealed &&
    savedLottery.secondRoundRevealed &&
    Array.isArray(savedLottery?.result?.fullDraftOrder)
  ) {
    return sanitizeDraftOrderRows(savedLottery.result.fullDraftOrder);
  }

  return [];
}

function isDraftCompleteForSeason(leagueData, seasonYear) {
  const offseasonState = safeJSON(localStorage.getItem("bm_offseason_state_v1"), {}) || {};
  const savedDraftState = safeJSON(localStorage.getItem("bm_draft_state_v1"), null);

  return Boolean(
    (Number(offseasonState?.seasonYear || seasonYear) === Number(seasonYear) && offseasonState?.draftComplete) ||
      (Number(savedDraftState?.seasonYear || 0) === Number(seasonYear) && savedDraftState?.completed) ||
      (Number(leagueData?.draftState?.seasonYear || seasonYear) === Number(seasonYear) && leagueData?.draftState?.completed)
  );
}

function getPickOwnerName(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || row.ownerTeam || "";
}

function getPickOriginalName(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.originalTeam || row.teamName || "";
}

function buildResolvedDraftAsset(row = {}, seasonYear) {
  if (!isUsableDraftOrderRow(row)) return null;

  const pickNumber = getDraftOrderPickNumber(row);
  if (!pickNumber) return null;

  const round = Number(row.round || (pickNumber <= 30 ? 1 : 2));
  const ownerTeam = getPickOwnerName(row);
  const originalTeam = getPickOriginalName(row);
  if (!ownerTeam || !originalTeam) return null;

  return {
    id: `resolved_${seasonYear}_${round}_${pickNumber}_${ownerTeam}_${originalTeam}`,
    assetType: "resolved",
    type: "resolved",
    year: Number(seasonYear),
    round,
    pickNumber,
    overallPick: pickNumber,
    originalTeam,
    ownerTeam,
    displayProtection: "Resolved",
    protections: "Resolved",
    status: "resolved",
    notes: row.draftPickProtection || row.swapProtectionLabel || "Resolved draft pick",
  };
}

function extractCodesFromText(text, teamNames = []) {
  const value = String(text || "").toUpperCase();
  const codes = [];

  for (const code of KNOWN_CODES) {
    const regex = new RegExp(`\\b${code}\\b`, "i");
    if (regex.test(value)) codes.push(code);
  }

  for (const teamName of teamNames) {
    if (value.includes(String(teamName || "").toUpperCase())) {
      codes.push(getTeamCode(teamName));
    }
  }

  return uniqueList(codes);
}

function compactProtectionLabel(asset, teamNames = []) {
  const type = assetTypeLabel(asset);
  if (type === "Swap") {
    const raw = String(asset?.displayProtection || asset?.protections || "").toLowerCase();
    return raw.includes("worst") ? "Swap Worst" : "Swap Best";
  }

  if (String(asset?.assetType || asset?.type || "").toLowerCase() === "resolved") {
    return "Resolved";
  }

  const label = getDraftPickProtectionLabel(asset);
  if (!label || label === "none" || label === "null") return "Unprotected";
  return label;
}

function getOriginLabel(asset, teamNames = []) {
  if (assetTypeLabel(asset) === "Swap") {
    const structuredParticipants = Array.isArray(asset?.realLifeDetails?.swapParticipants)
      ? asset.realLifeDetails.swapParticipants
      : Array.isArray(asset?.swapParticipants)
      ? asset.swapParticipants
      : [];

    const structuredCodes = uniqueList(
      structuredParticipants
        .flatMap((participant) => extractCodesFromText(participant, teamNames))
        .map(canonicalTeamCode)
    ).slice(0, 2);

    if (structuredCodes.length >= 2) return structuredCodes.join(" / ");

    const text = `${asset.originalTeam || ""} ${asset.swapWithTeam || ""} ${structuredParticipants.join(" / ") || ""}`;
    const codes = uniqueList(extractCodesFromText(text, teamNames).map(canonicalTeamCode)).slice(0, 2);
    return codes.length ? codes.join(" / ") : asset.originalTeam || "Swap Rights";
  }

  return asset.originalTeam || "—";
}

function getPickColumnValue(asset) {
  const pickNumber =
    asset?.pickNumber ??
    asset?.pickNo ??
    asset?.overallPick ??
    asset?.draftPickNumber ??
    asset?.resolvedPickNumber ??
    null;

  if (pickNumber !== null && pickNumber !== undefined && pickNumber !== "") {
    return `#${pickNumber}`;
  }

  return "--";
}

function sortValue(asset, key, teamNames = []) {
  if (!asset) return "";
  if (key === "year") return Number(asset.year || 0);
  if (key === "round") return Number(asset.round || 0);
  if (key === "pick") return getPickColumnValue(asset);
  if (key === "protections") return compactProtectionLabel(asset, teamNames);
  if (key === "origin") return getOriginLabel(asset, teamNames);
  return "";
}

export default function DraftPicks() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();

  const [viewIndex, setViewIndex] = useState(0);
  const [sortConfig, setSortConfig] = useState({ key: "year", direction: "asc" });

  useEffect(() => {
    document.body.classList.add("rv-roster-bg");
    return () => document.body.classList.remove("rv-roster-bg");
  }, []);

  const teamsSorted = useMemo(() => {
    return getAllTeamsFromLeague(leagueData)
      .filter((team) => team?.name || team?.teamName)
      .sort((a, b) =>
        String(a.name || a.teamName || "").localeCompare(
          String(b.name || b.teamName || "")
        )
      );
  }, [leagueData]);

  const teamNames = useMemo(
    () => teamsSorted.map((team) => team?.name || team?.teamName).filter(Boolean),
    [teamsSorted]
  );

  const teamByName = useMemo(() => {
    const map = {};
    for (const team of teamsSorted) {
      const name = team?.name || team?.teamName;
      if (name) map[normalizeTeamName(name)] = team;
    }
    return map;
  }, [teamsSorted]);

  const logoMap = useMemo(() => getTeamLogoMap(leagueData), [leagueData]);

  useEffect(() => {
    if (!teamsSorted.length) return;

    const selectedIndex = teamsSorted.findIndex(
      (team) => (team?.name || team?.teamName) === selectedTeam?.name
    );

    setViewIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [teamsSorted, selectedTeam?.name]);

  const activeTeam = useMemo(() => {
    return teamsSorted[viewIndex] || selectedTeam || teamsSorted[0] || null;
  }, [teamsSorted, viewIndex, selectedTeam]);

  const seasonYear = useMemo(() => getSeasonYearFromLeague(leagueData), [leagueData]);
  const draftOrder = useMemo(() => readLockedDraftOrder(leagueData, seasonYear), [leagueData, seasonYear]);
  const draftComplete = useMemo(() => isDraftCompleteForSeason(leagueData, seasonYear), [leagueData, seasonYear]);
  const draftOrderLocked = draftOrder.length >= 50;

  const picks = useMemo(() => {
    return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames)
      .filter((pick) => Number(pick.year || 0) >= Number(seasonYear))
      .filter((pick) => !(draftComplete && Number(pick.year || 0) === Number(seasonYear)))
      .filter((pick) => !(draftOrderLocked && !draftComplete && Number(pick.year || 0) === Number(seasonYear)))
      .sort(sortDraftPickAssets);
  }, [leagueData?.draftPicks, teamNames, seasonYear, draftComplete, draftOrderLocked]);

  const resolvedCurrentYearPicks = useMemo(() => {
    if (!draftOrderLocked || draftComplete) return [];
    return draftOrder.map((row) => buildResolvedDraftAsset(row, seasonYear)).filter(Boolean);
  }, [draftOrder, draftOrderLocked, draftComplete, seasonYear]);

  const ownedPicks = useMemo(() => {
    if (!activeTeam?.name) return [];
    const activeKey = normalizeTeamName(activeTeam.name);
    return [...resolvedCurrentYearPicks, ...picks].filter((pick) => pick && normalizeTeamName(pick.ownerTeam) === activeKey);
  }, [picks, resolvedCurrentYearPicks, activeTeam?.name]);

  const sortedPicks = useMemo(() => {
    const rows = [...ownedPicks];

    if (!sortConfig.key || sortConfig.direction === "default") {
      return rows.sort(sortDraftPickAssets);
    }

    rows.sort((a, b) => {
      const av = sortValue(a, sortConfig.key, teamNames);
      const bv = sortValue(b, sortConfig.key, teamNames);

      let diff = 0;
      if (typeof av === "number" && typeof bv === "number") diff = av - bv;
      else diff = String(av).localeCompare(String(bv));

      return sortConfig.direction === "asc" ? diff : -diff;
    });

    return rows;
  }, [ownedPicks, sortConfig, teamNames]);

  const handleTeamSwitch = (dir) => {
    if (!teamsSorted.length) return;

    setViewIndex((prev) => {
      const next =
        dir === "next"
          ? (prev + 1 + teamsSorted.length) % teamsSorted.length
          : (prev - 1 + teamsSorted.length) % teamsSorted.length;

      return next;
    });
  };

  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    else if (sortConfig.key === key && sortConfig.direction === "desc") direction = "default";
    setSortConfig({ key, direction });
  };

  const renderSortArrow = (key) => {
    if (sortConfig.key !== key) return null;
    if (sortConfig.direction === "asc") return <span className="ml-1 text-orange-400">▲</span>;
    if (sortConfig.direction === "desc") return <span className="ml-1 text-orange-400">▼</span>;
    return null;
  };

  const activeTeamLogo =
    (activeTeam?.name && logoMap[normalizeTeamName(activeTeam.name)]) || getLogo(activeTeam);

  if (!leagueData || !teamsSorted.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-900 text-white">
        <p className="mb-4 text-lg">No league loaded.</p>
        <button
          onClick={() => navigate("/league-editor")}
          className="rounded-lg bg-orange-600 px-6 py-3 font-semibold transition hover:bg-orange-500"
        >
          Back to League Editor
        </button>
      </div>
    );
  }

  return (
    <PageFade>
      <div className={`${styles.rosterPage} min-h-screen text-white flex flex-col items-center py-10`}>
        <div className="w-full max-w-5xl flex items-center justify-between mb-8 select-none">
          <div className="w-24 flex items-center justify-start">
            <button
              onClick={() => handleTeamSwitch("prev")}
              className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
              title="Previous Team"
            >
              ◄
            </button>
          </div>

          <div className="flex items-center justify-center gap-4 text-center">
            <TeamLogo src={activeTeamLogo} name={activeTeam?.name} size={68} />
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.24em] text-white/40">
                Draft Assets
              </div>
              <h1 className="text-4xl font-extrabold text-orange-500">
                {activeTeam?.name || "Team"} Picks
              </h1>
            </div>
          </div>

          <div className="w-24 flex items-center justify-end">
            <button
              onClick={() => handleTeamSwitch("next")}
              className="text-4xl text-white hover:text-orange-400 transition-transform active:scale-90 font-bold"
              title="Next Team"
            >
              ►
            </button>
          </div>
        </div>

        <div className="w-full max-w-5xl overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[860px] border-collapse text-center">
            <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold uppercase">
              <tr>
                {[
                  { key: "year", label: "Year" },
                  { key: "round", label: "Round" },
                  { key: "pick", label: "Pick" },
                  { key: "protections", label: "Protection" },
                  { key: "origin", label: "Origin" },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-4 cursor-pointer select-none ${
                      col.key === "protections" || col.key === "origin" ? "text-left" : "text-center"
                    }`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {renderSortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="text-[17px] font-medium">
              {sortedPicks.map((asset, index) => {
                const originLabel = getOriginLabel(asset, teamNames);
                const originalTeam =
                  asset?.originalTeam ? teamByName[normalizeTeamName(asset.originalTeam)] : null;
                const originalLogo =
                  assetTypeLabel(asset) === "Pick" && asset?.originalTeam
                    ? (logoMap[normalizeTeamName(asset.originalTeam)] || getLogo(originalTeam))
                    : "";

                const zebra = index % 2 === 0 ? "bg-neutral-900/85" : "bg-neutral-950/85";
                const hover = assetTypeLabel(asset) === "Swap" ? "hover:bg-amber-500/10" : "hover:bg-neutral-800";

                return (
                  <tr key={asset.id} className={`${zebra} ${hover} transition`}>
                    <td className="py-3 px-4 font-bold">{asset.year || "—"}</td>
                    <td className="py-3 px-4">{roundLabel(asset.round)}</td>
                    <td className="py-3 px-4 font-bold tracking-wide">{getPickColumnValue(asset)}</td>
                    <td className="py-3 px-4 text-left text-white/90">
                      {compactProtectionLabel(asset, teamNames)}
                    </td>
                    <td className="py-3 px-4 text-left">
                      <div className="flex items-center gap-3">
                        {originalLogo ? <TeamLogo src={originalLogo} name={originLabel} size={28} /> : null}
                        <span>{originLabel}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!sortedPicks.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    No draft assets found for {activeTeam?.name || "this team"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          onClick={() => navigate("/team-hub")}
          className="mt-10 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Back to Team Hub
        </button>
      </div>
    </PageFade>
  );
}
