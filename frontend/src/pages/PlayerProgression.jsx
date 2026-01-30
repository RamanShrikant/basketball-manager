import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

const DELTAS_KEY = "bm_progression_deltas_v1";
const PROG_META_KEY = "bm_progression_meta_v1";
const LEAGUE_KEY = "leagueData";
const META_KEY = "bm_league_meta_v1";

function clamp(n, lo = 0, hi = 99) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolvePortrait(p) {
  return (
    p?.portrait ||
    p?.headshot ||
    p?.photo ||
    p?.image ||
    p?.img ||
    p?.face ||
    p?.playerImage ||
    null
  );
}

const playerKey = (name, team) => `${name}__${team}`;

function generateProgressionDeltasForLeague(leagueData) {
  const out = {};
  const teams = getAllTeamsFromLeague(leagueData);

  for (const t of teams) {
    const teamName = t?.name || "Team";
    for (const p of t.players || []) {
      const name = p?.name;
      if (!name) continue;

      const age = Number(p.age ?? 25);
      const overall = Number(p.overall ?? 60);
      const pot = Number(p.potential ?? overall);

      const room = pot - overall;
      const young = age <= 24 ? 1.0 : age <= 27 ? 0.65 : age <= 30 ? 0.25 : -0.35;

      let seed = 0;
      const seedStr = `${name}__${teamName}`;
      for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;

      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 4294967296) * 2 - 1;
      };

      const jitter = () => Math.round(rand() * 1);

      const base = clamp(room / 10, -2, 4);
      const mag = base + young;

      const dOverall = Math.round(mag + jitter());
      const dOff = Math.round(mag + jitter());
      const dDef = Math.round(mag * 0.75 + jitter());
      const dStam = Math.round(mag * 0.5 + jitter());

      const attrDelta = (scale = 0.6) => Math.round(mag * scale + jitter());

      out[playerKey(name, teamName)] = {
        age: 1, // always +1
        overall: dOverall,
        offRating: dOff,
        defRating: dDef,
        stamina: dStam,
        // tiny POT shift optional
        potential: Math.round((young > 0 ? 1 : -1) * (rand() > 0.6 ? 1 : 0)),

        attr0: attrDelta(0.55),
        attr1: attrDelta(0.50),
        attr2: attrDelta(0.50),
        attr3: attrDelta(0.35),
        attr4: attrDelta(0.45),
        attr5: attrDelta(0.45),
        attr7: attrDelta(0.45),
        attr8: attrDelta(0.45),
        attr9: attrDelta(0.45),
        attr10: attrDelta(0.35),
        attr11: attrDelta(0.35),
        attr12: attrDelta(0.40),
        attr13: attrDelta(0.40),
        attr14: attrDelta(0.40),
      };
    }
  }

  return out;
}

function applyDeltasToLeague(leagueData, deltas) {
  const next = structuredClone(leagueData);
  const teams = getAllTeamsFromLeague(next);

  for (const t of teams) {
    const teamName = t?.name || "Team";
    for (const p of t.players || []) {
      const name = p?.name;
      if (!name) continue;

      const key = playerKey(name, teamName);
      const d = deltas?.[key];
      if (!d) continue;

      p.age = clamp((p.age ?? 0) + (d.age ?? 1), 18, 45);

      if (p.overall != null) p.overall = clamp(p.overall + (d.overall ?? 0));
      if (p.offRating != null) p.offRating = clamp(p.offRating + (d.offRating ?? 0));
      if (p.defRating != null) p.defRating = clamp(p.defRating + (d.defRating ?? 0));
      if (p.stamina != null) p.stamina = clamp(p.stamina + (d.stamina ?? 0));
      if (p.potential != null) p.potential = clamp(p.potential + (d.potential ?? 0));

      if (Array.isArray(p.attrs)) {
        const idxs = [0,1,2,3,4,5,7,8,9,10,11,12,13,14];
        for (const i of idxs) {
          const add = Number(d[`attr${i}`] ?? 0) || 0;
          p.attrs[i] = clamp((p.attrs[i] ?? 0) + add);
        }
      }
    }
  }

  return next;
}

export default function PlayerProgression() {
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  const [showLetters, setShowLetters] = useState(localStorage.getItem("showLetters") === "true");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [featuredKey, setFeaturedKey] = useState(null);

  const attrColumns = [
    { key: "attr0", label: "3PT", index: 0 },
    { key: "attr1", label: "MID", index: 1 },
    { key: "attr2", label: "CLOSE", index: 2 },
    { key: "attr3", label: "FT", index: 3 },
    { key: "attr4", label: "BALL", index: 4 },
    { key: "attr5", label: "PASS", index: 5 },
    { key: "attr8", label: "PER D", index: 8 },
    { key: "attr9", label: "INS D", index: 9 },
    { key: "attr10", label: "BLK", index: 10 },
    { key: "attr11", label: "STL", index: 11 },
    { key: "attr12", label: "REB", index: 12 },
    { key: "attr7", label: "ATH", index: 7 },
    { key: "attr13", label: "OIQ", index: 13 },
    { key: "attr14", label: "DIQ", index: 14 },
  ];

  const toLetter = (num) => {
    const n = Number(num) || 0;
    if (n >= 94) return "A+";
    if (n >= 87) return "A";
    if (n >= 80) return "A-";
    if (n >= 77) return "B+";
    if (n >= 73) return "B";
    if (n >= 70) return "B-";
    if (n >= 67) return "C+";
    if (n >= 63) return "C";
    if (n >= 60) return "C-";
    if (n >= 57) return "D+";
    if (n >= 53) return "D";
    if (n >= 50) return "D-";
    return "F";
  };

  const handleCellDoubleClick = () => {
    const next = !showLetters;
    setShowLetters(next);
    localStorage.setItem("showLetters", String(next));
  };

  // restore selectedTeam if missing (not required for all-teams view, but keep it)
  useEffect(() => {
    if (!selectedTeam) {
      const saved = localStorage.getItem("selectedTeam");
      if (saved) setSelectedTeam(JSON.parse(saved));
    }
  }, [selectedTeam, setSelectedTeam]);

  // Apply progression ONCE per season if deltas exist (or generate them once)
  useEffect(() => {
    if (!leagueData) return;

    let seasonYear = null;
    try {
      const meta = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (Number.isFinite(Number(meta?.seasonYear))) seasonYear = Number(meta.seasonYear);
    } catch {}
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    let progMeta = null;
    try {
      progMeta = JSON.parse(localStorage.getItem(PROG_META_KEY) || "null");
    } catch {}

    if (progMeta?.appliedForSeasonYear === seasonYear) return;

    let deltas = {};
    try {
      deltas = JSON.parse(localStorage.getItem(DELTAS_KEY) || "{}") || {};
    } catch {
      deltas = {};
    }

    if (!deltas || Object.keys(deltas).length === 0) {
      deltas = generateProgressionDeltasForLeague(leagueData);
      localStorage.setItem(DELTAS_KEY, JSON.stringify(deltas));
    }

    const updatedLeague = applyDeltasToLeague(leagueData, deltas);
    localStorage.setItem(LEAGUE_KEY, JSON.stringify(updatedLeague));
    setLeagueData(updatedLeague);

    // keep selectedTeam pointer valid
    const teams = getAllTeamsFromLeague(updatedLeague);
    const updatedTeam = teams.find((t) => t?.name === selectedTeam?.name);
    if (updatedTeam) setSelectedTeam(updatedTeam);

    localStorage.setItem(PROG_META_KEY, JSON.stringify({ appliedForSeasonYear: seasonYear, ts: Date.now() }));
  }, [leagueData, selectedTeam, setLeagueData, setSelectedTeam]);

  const deltas = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(DELTAS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }, []);

  // Build league-wide rows
  const teams = useMemo(() => getAllTeamsFromLeague(leagueData), [leagueData]);

  const allRows = useMemo(() => {
    const rows = [];
    for (const t of teams || []) {
      const teamName = t?.name || "Team";
      for (const p of t.players || []) {
        rows.push({ ...p, team: teamName, __key: playerKey(p?.name, teamName) });
      }
    }
    return rows;
  }, [teams]);

  const teamOptions = useMemo(() => {
    const names = Array.from(new Set((teams || []).map((t) => t?.name).filter(Boolean))).sort();
    return ["ALL", ...names];
  }, [teams]);

  const rows = useMemo(() => {
    if (teamFilter === "ALL") return allRows;
    return allRows.filter((r) => r.team === teamFilter);
  }, [allRows, teamFilter]);

  // Featured player
  useEffect(() => {
    if (!featuredKey && rows.length) setFeaturedKey(rows[0].__key);
  }, [rows, featuredKey]);

  const featured = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.__key === featuredKey) || rows[0];
  }, [rows, featuredKey]);

  const deltaFor = (row, key) => {
    const d = deltas?.[row.__key] || {};
    return Number(d?.[key] ?? 0) || 0;
  };

  const DeltaBadge = ({ d }) => {
    if (!d) return null;
    const up = d > 0;
    return (
      <span className="ml-2 inline-flex items-center gap-1">
        <span className={up ? "text-green-400 font-extrabold" : "text-red-400 font-extrabold"}>
          {up ? "▲" : "▼"}
        </span>
        <span className="text-yellow-300 font-extrabold">{up ? `+${d}` : `${d}`}</span>
      </span>
    );
  };

  const portraitSrc = resolvePortrait(featured);

  const fillPercent = Math.min((featured?.overall || 0) / 99, 1);
  const circleCircumference = 2 * Math.PI * 50;
  const strokeOffset = circleCircumference * (1 - fillPercent);

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center">
        Loading progression...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10">
      <div className="max-w-6xl mx-auto px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-4xl font-extrabold text-orange-500">Player Progression</h1>
          <div className="flex items-center gap-3">
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value);
                setFeaturedKey(null);
              }}
              className="px-3 py-2 bg-neutral-800 rounded border border-neutral-700"
            >
              {teamOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => navigate("/calendar")}
              className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
            >
              Return to Calendar
            </button>
          </div>
        </div>

        {/* Featured header */}
        {featured && (
          <div className="relative bg-neutral-800 rounded-xl shadow-lg px-8 pt-7 pb-4 mb-6">
            <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-white opacity-20" />

            <div className="flex items-end justify-between gap-6">
              <div className="flex items-end gap-6">
                <div className="relative -mb-[8px]">
                  {portraitSrc ? (
                    <img src={portraitSrc} alt={featured.name} className="h-[170px] w-auto object-contain" />
                  ) : (
                    <div className="h-[170px] w-[120px] bg-neutral-700 rounded-lg flex items-center justify-center text-neutral-300">
                      No Photo
                    </div>
                  )}
                </div>

                <div className="mb-2">
                  <h2 className="text-[42px] font-bold leading-tight">{featured.name}</h2>
                  <p className="text-gray-400 text-[22px] mt-1">
                    {featured.pos} • {featured.team} • Age {featured.age}
                  </p>
                </div>
              </div>

              <div className="relative flex items-center justify-center mr-2 mb-2">
                <svg width="105" height="105" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ovrGradientProg" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#FFA500" />
                      <stop offset="100%" stopColor="#FFD54F" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    stroke="url(#ovrGradientProg)"
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
                    {featured.overall}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    POT <span className="text-orange-400 font-semibold">{featured.potential}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <div className="min-w-[1300px] max-w-max mx-auto">
            <table className="w-full border-collapse text-center">
              <thead className="bg-neutral-800 text-gray-300 text-[16px] font-semibold">
                <tr>
                  {[
                    { key: "name", label: "Name" },
                    { key: "team", label: "TEAM" },
                    { key: "pos", label: "POS" },
                    { key: "age", label: "AGE" },
                    { key: "overall", label: "OVR" },
                    { key: "offRating", label: "OFF" },
                    { key: "defRating", label: "DEF" },
                    { key: "stamina", label: "STAM" },
                    { key: "potential", label: "POT" },
                    ...attrColumns,
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`py-3 px-3 min-w-[95px] ${
                        col.key === "name" ? "min-w-[200px] text-left pl-4" : "text-center"
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="text-[17px] font-medium">
                {rows.map((p, idx) => {
                  const active = p.__key === featured?.__key;
                  return (
                    <tr
                      key={`${p.__key}-${idx}`}
                      className={`transition cursor-pointer ${active ? "bg-orange-600/25" : "hover:bg-neutral-800"}`}
                      onClick={() => setFeaturedKey(p.__key)}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-left pl-4 font-semibold">{p.name}</td>
                      <td className="py-2 px-3">{p.team}</td>
                      <td className="py-2 px-3">{p.pos}</td>

                      <td className="py-2 px-3">
                        <span>{p.age}</span>
                        <DeltaBadge d={deltaFor(p, "age")} />
                      </td>

                      {["overall", "offRating", "defRating", "stamina"].map((k) => (
                        <td key={k} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                          <span>{showLetters ? toLetter(p[k]) : p[k]}</span>
                          <DeltaBadge d={deltaFor(p, k)} />
                        </td>
                      ))}

                      <td className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                        {showLetters ? toLetter(p.potential) : p.potential}
                      </td>

                      {attrColumns.map((a) => {
                        const val = p.attrs?.[a.index] ?? 0;
                        const d = deltaFor(p, a.key);
                        return (
                          <td key={a.key} className="py-2 px-3" onDoubleClick={handleCellDoubleClick}>
                            <span>{showLetters ? toLetter(val) : val}</span>
                            <DeltaBadge d={d} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="text-xs text-neutral-400 mt-3">
              ▲/▼ shows change from last season. Double-click any rating cell to toggle numbers/letters.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
