import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import styles from "./RosterView.module.css";
import {
  getAllTeamsFromLeague,
  getTeamLogoMap,
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

const KNOWN_CODES = new Set(Object.values(TEAM_CODES).filter(Boolean));

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
  if (KNOWN_CODES.has(upper)) return upper;

  return clean
    .split(" ")
    .map((word) => word[0]?.toUpperCase())
    .join("")
    .slice(0, 4);
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
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
  const raw = String(asset?.displayProtection || asset?.protections || "").trim();
  const lower = raw.toLowerCase();

  if (!raw || lower === "none" || lower === "null") return "Unprotected";

  if (assetTypeLabel(asset) === "Swap") {
    if (lower.includes("swap best") || lower.includes("best")) return "Swap Best";
    if (lower.includes("swap worst") || lower.includes("worst")) return "Swap Worst";

    const text = `${asset.protections || ""} ${asset.displayProtection || ""} ${asset.realLifeDetails?.originalProtections || ""} ${asset.realLifeDetails?.originalNotes || ""}`;
    const textLower = text.toLowerCase();

    if (textLower.includes("least favorable") || textLower.includes("less favorable")) return "Swap Worst";
    return "Swap Best";
  }

  if (lower.includes("unprotected")) return "Unprotected";
  if (lower.includes("lottery")) return "Lottery Protected";
  if (lower.includes("top 10")) return "Top 10 Protected";
  if (lower.includes("top 5")) return "Top 5 Protected";
  if (lower.includes("top 3")) return "Top 3 Protected";

  let clean = raw
    .replace(/protected/gi, "Protected")
    .replace(/unprotected\s*\/\s*none/gi, "Unprotected")
    .replace(/\s+/g, " ")
    .trim();

  const topRangeMatch = clean.match(/\b([A-Z]{2,3})\s+(\d+)\s*-\s*(\d+)\b/i);
  if (topRangeMatch) {
    const start = Number(topRangeMatch[2]);
    const end = Number(topRangeMatch[3]);
    if (start <= 3 && end >= 30) return "Top 3 Protected";
    if (start <= 5 && end >= 30) return "Top 5 Protected";
    if (start <= 10 && end >= 30) return "Top 10 Protected";
    if (start <= 15 && end >= 30) return "Lottery Protected";
  }

  if (clean.length > 34) clean = `${clean.slice(0, 31).trim()}...`;
  return clean;
}

function getOriginLabel(asset, teamNames = []) {
  if (assetTypeLabel(asset) === "Swap") {
    const text = `${asset.originalTeam || ""} ${asset.swapWithTeam || ""} ${asset.protections || ""} ${asset.notes || ""}`;
    const codes = extractCodesFromText(text, teamNames).slice(0, 3);
    return codes.length ? codes.join(" / ") : "Swap Rights";
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
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();

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

    if (selectedIndex >= 0) {
      setViewIndex(selectedIndex);
      return;
    }

    if (!selectedTeam && teamsSorted[0]) {
      setSelectedTeam(teamsSorted[0]);
      setViewIndex(0);
    }
  }, [teamsSorted, selectedTeam, setSelectedTeam]);

  const activeTeam = useMemo(() => {
    return teamsSorted[viewIndex] || selectedTeam || teamsSorted[0] || null;
  }, [teamsSorted, viewIndex, selectedTeam]);

  const picks = useMemo(() => {
    return normalizeDraftPicks(leagueData?.draftPicks || [], teamNames).sort(sortDraftPickAssets);
  }, [leagueData?.draftPicks, teamNames]);

  const ownedPicks = useMemo(() => {
    if (!activeTeam?.name) return [];
    return picks.filter((pick) => pick.ownerTeam === activeTeam.name);
  }, [picks, activeTeam?.name]);

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

      const nextTeam = teamsSorted[next];
      if (nextTeam) setSelectedTeam(nextTeam);
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
