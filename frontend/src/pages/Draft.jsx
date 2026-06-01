  import React, { useEffect, useMemo, useRef, useState } from "react";
  import { useNavigate } from "react-router-dom";
  import { useGame } from "../context/GameContext";
  import * as simEngine from "../api/simEnginePy.js";

  const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
  const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
  const DRAFT_STATE_KEY = "bm_draft_state_v1";
  const CUSTOM_DRAFT_CLASS_KEY = "bm_custom_draft_class_v1";
  const CUSTOM_DRAFT_CLASS_MODE_KEY = "bm_draft_class_mode_v1";
  const CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY = "bm_draft_class_mode_by_year_v1";
  const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";
  const LEAGUE_KEY = "leagueData";

  function safeJSON(raw, fallback = null) {
    try {
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function getSeasonYear(leagueData) {
    const candidates = [];

    const pushYear = (value) => {
      const y = Number(value);
      if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
        candidates.push(y);
      }
    };

    const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {}) || {};
    const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};

    pushYear(offseasonState?.seasonYear);
    pushYear(leagueData?.seasonYear);
    pushYear(leagueData?.currentSeasonYear);
    pushYear(leagueData?.seasonStartYear);
    pushYear(meta?.seasonYear);
    pushYear(meta?.currentSeasonYear);
    pushYear(meta?.seasonStartYear);

    if (candidates.length) return Math.max(...candidates);
    return 2026;
  }

  function readDraftLottery(seasonYear) {
    const saved = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
    if (!saved || typeof saved !== "object") return null;
    if (Number(saved.seasonYear) !== Number(seasonYear)) return null;
    return saved;
  }

  function readDraftState(seasonYear) {
    const saved = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
    if (!saved || typeof saved !== "object") return null;
    if (Number(saved.seasonYear) !== Number(seasonYear)) return null;
    return saved;
  }

  function getRowsFromDraftClassPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.draftClass)) return payload.draftClass;
    if (Array.isArray(payload?.prospects)) return payload.prospects;
    if (Array.isArray(payload?.players)) return payload.players;
    return [];
  }

  function readDraftClassModeForYear(seasonYear, hasCustomClass = false) {
    const yearKey = String(Number(seasonYear || 2026));
    const modesByYear = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), null) || {};
    const explicitYearMode = modesByYear?.[yearKey];

    if (explicitYearMode === "custom" || explicitYearMode === "auto") {
      return explicitYearMode;
    }

    const legacyModeConfig = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_KEY), null) || {};
    if (legacyModeConfig.mode === "custom") return "custom";
    if (legacyModeConfig.mode === "auto") return "auto";

    // If a class exists but no explicit choice exists yet, use it.
    // Play.jsx writes an explicit auto/custom value, so users can still override per year.
    return hasCustomClass ? "custom" : "auto";
  }

  function readCustomDraftClassSetup(seasonYear) {
    const seasonKey = `${CUSTOM_DRAFT_CLASS_PREFIX}${Number(seasonYear || 2026)}`;
    const savedSeasonClass = safeJSON(localStorage.getItem(seasonKey), null);
    const savedDefaultClass = safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_KEY), null);
    const draftClassPayload = savedSeasonClass || savedDefaultClass || null;
    const rows = getRowsFromDraftClassPayload(draftClassPayload);
    const hasCustomClass = rows.length > 0;
    const mode = readDraftClassModeForYear(seasonYear, hasCustomClass);

    if (mode !== "custom") {
      return { mode, draftClassPayload: null, hasCustomClass };
    }

    if (!draftClassPayload || typeof draftClassPayload !== "object" || !hasCustomClass) {
      return { mode, draftClassPayload: null, hasCustomClass: false };
    }

    const classSeasonYear = Number(draftClassPayload.seasonYear || draftClassPayload.draftClassYear || rows?.[0]?.draftClassYear || rows?.[0]?.seasonYear || seasonYear);
    if (classSeasonYear && Number(classSeasonYear) !== Number(seasonYear)) {
      return { mode, draftClassPayload: null, hasCustomClass: false };
    }

    return {
      mode,
      hasCustomClass: true,
      draftClassPayload: {
        ...draftClassPayload,
        seasonYear: Number(seasonYear),
        draftClass: rows.map((row, index) => ({
          ...row,
          draftClassYear: Number(row?.draftClassYear || row?.seasonYear || seasonYear),
          seasonYear: Number(row?.seasonYear || row?.draftClassYear || seasonYear),
          draftProjection: Number(row?.draftProjection || row?.trueRank || row?.rank || index + 1),
          trueRank: Number(row?.trueRank || row?.draftProjection || row?.rank || index + 1),
        })),
      },
    };
  }

  function saveDraftState(draftState) {
    if (!draftState) return;
    localStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(draftState));
  }

  function updateOffseasonState(patch) {
    const current = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
    const next = { ...current, ...patch };
    localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
    return next;
  }

  function persistLeagueData(updated, setLeagueData) {
    if (!updated) return;
    setLeagueData(updated);
    localStorage.setItem(LEAGUE_KEY, JSON.stringify(updated));
  }

  function formatMoney(amount) {
    const value = Number(amount || 0);
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${value}`;
  }

  function getPickTeam(pick = {}) {
    return pick.currentOwnerTeamName || pick.teamName || pick.originalTeamName || "Unknown Team";
  }

  function normalizeTeamName(name = "") {
    return String(name || "").trim().toLowerCase();
  }

  function getAllTeamsFromLeague(leagueData) {
    if (!leagueData) return [];
    if (Array.isArray(leagueData.teams)) return leagueData.teams;
    if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
    return [];
  }

  function resolveTeamLogo(source = {}) {
    return (
      source.logo ||
      source.teamLogo ||
      source.newTeamLogo ||
      source.logoUrl ||
      source.image ||
      source.img ||
      ""
    );
  }

  function resolveDraftRowTeamLogo(source = {}) {
    return (
      source.currentOwnerTeamLogo ||
      source.currentOwnerLogo ||
      source.ownerLogo ||
      source.teamLogo ||
      source.logo ||
      source.logoUrl ||
      source.newTeamLogo ||
      source.originalTeamLogo ||
      ""
    );
  }

  function buildTeamLogoMap(leagueData, draftOrder = []) {
    const map = {};

    for (const team of getAllTeamsFromLeague(leagueData)) {
      const logo = resolveTeamLogo(team);
      if (!logo) continue;

      for (const name of [team.name, team.teamName, team.abbreviation, team.abbr, team.shortName]) {
        const key = normalizeTeamName(name);
        if (key) map[key] = logo;
      }
    }

    for (const row of draftOrder || []) {
      const logo = resolveDraftRowTeamLogo(row);
      if (!logo) continue;

      for (const name of [row.currentOwnerTeamName, row.teamName, row.originalTeamName]) {
        const key = normalizeTeamName(name);
        if (key && !map[key]) map[key] = logo;
      }
    }

    return map;
  }

  function draftTeamLogoRowBackground(logo, controls = {}) {
    if (!logo) return {};

    const safeLogo = String(logo).replaceAll('\"', '\\"');
    const size = Number(controls.size ?? 90);
    const x = Number(controls.x ?? 0);
    const y = Number(controls.y ?? 0);
    const opacity = Math.max(0, Math.min(1, Number(controls.opacity ?? 1)));
    const logoFade = 1 - opacity;
    const rightOffset = Number(controls.rightOffset ?? 34);

    return {
      backgroundImage: `linear-gradient(rgba(10,10,10,${logoFade}), rgba(10,10,10,${logoFade})), url("${safeLogo}")`,
      backgroundRepeat: "no-repeat, no-repeat",
      backgroundSize: `100% 100%, ${size}px ${size}px`,
      backgroundPosition: `center, calc(100% - ${rightOffset - x}px) calc(50% + ${y}px)`,
    };
  }

  function TinyTeamLogo({ src, name }) {
    if (!src) {
      return (
        <div className="h-9 w-9 rounded-full bg-white/5 border border-white/10 shrink-0" />
      );
    }

    return (
      <img
        src={src}
        alt={name || "Team"}
        className="h-9 w-9 object-contain shrink-0 drop-shadow-[0_6px_12px_rgba(0,0,0,0.45)]"
        loading="lazy"
      />
    );
  }

  function getHeadshot(source = {}) {
    return source.headshot || source.image || source.img || "";
  }

  function getDraftSource(source = {}) {
    return (
      source.college ||
      source.school ||
      source.university ||
      source.academy ||
      source.academyName ||
      source.sourceName ||
      source.draftSource ||
      source.nationality ||
      ""
    );
  }

  function getFullProspectSnapshot(pick = {}) {
    return (
      pick.prospect ||
      pick.prospectSnapshot ||
      pick.fullProspect ||
      pick.draftProspect ||
      pick.originalProspect ||
      {}
    );
  }

  function normalizePlayerName(value = "") {
    return String(value || "").trim().toLowerCase();
  }

  function getTeamPlayers(team = {}) {
    const groups = [
      team.roster,
      team.players,
      team.playerList,
      team.signedPlayers,
    ];

    return groups.flatMap((group) => (Array.isArray(group) ? group : []));
  }

  function findDraftedPlayerInLeague(leagueData, pick = {}) {
    const teams = getAllTeamsFromLeague(leagueData);
    const pickId = String(pick.playerId || pick.id || pick.prospectId || "");
    const pickName = normalizePlayerName(pick.playerName || pick.name);

    for (const team of teams) {
      for (const player of getTeamPlayers(team)) {
        const playerIds = [
          player.id,
          player.playerId,
          player.prospectId,
          player.draftId,
          player.originalProspectId,
        ].map((value) => String(value || ""));

        const playerName = normalizePlayerName(player.name || player.playerName);

        if (pickId && playerIds.includes(pickId)) {
          return player;
        }

        if (pickName && playerName === pickName) {
          return player;
        }
      }
    }

    return {};
  }

  function getDraftIdentityIds(source = {}) {
    return [
      source.id,
      source.playerId,
      source.prospectId,
      source.draftId,
      source.originalProspectId,
    ]
      .map((value) => String(value || ""))
      .filter(Boolean);
  }

  function draftIdentityMatches(candidate = {}, pick = {}) {
    if (!candidate || typeof candidate !== "object") return false;

    const pickIds = getDraftIdentityIds(pick);
    const candidateIds = getDraftIdentityIds(candidate);

    if (pickIds.length && candidateIds.some((id) => pickIds.includes(id))) {
      return true;
    }

    const pickName = normalizePlayerName(pick.playerName || pick.name);
    const candidateName = normalizePlayerName(candidate.playerName || candidate.name);

    return Boolean(pickName && candidateName && pickName === candidateName);
  }

  function findDraftSourceDeep(root, pick = {}) {
    if (!root || typeof root !== "object") return "";

    const stack = [root];
    const seen = new Set();
    let searched = 0;

    while (stack.length && searched < 12000) {
      const current = stack.pop();
      searched += 1;

      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      if (draftIdentityMatches(current, pick)) {
        const source = getDraftSource(current);
        if (source) return source;

        const nestedSource = getDraftSource(getFullProspectSnapshot(current));
        if (nestedSource) return nestedSource;
      }

      if (Array.isArray(current)) {
        for (const item of current) {
          if (item && typeof item === "object") stack.push(item);
        }
      } else {
        for (const value of Object.values(current)) {
          if (value && typeof value === "object") stack.push(value);
        }
      }
    }

    return "";
  }

  function getDraftSourceForPick({ pick = {}, displayPick = {}, fullProspect = {}, leaguePlayer = {}, draftState = null, workingLeagueData = null }) {
    return (
      getDraftSource(displayPick) ||
      getDraftSource(pick) ||
      getDraftSource(fullProspect) ||
      getDraftSource(leaguePlayer) ||
      findDraftSourceDeep(draftState, pick) ||
      findDraftSourceDeep(workingLeagueData, pick) ||
      ""
    );
  }

  function enrichDraftStateWithDraftSources(nextState = {}, previousState = null, leagueData = null) {
    if (!nextState || !Array.isArray(nextState.draftedPicks)) return nextState;

    return {
      ...nextState,
      draftedPicks: nextState.draftedPicks.map((pick) => {
        const fullProspect = getFullProspectSnapshot(pick);
        const leaguePlayer = findDraftedPlayerInLeague(leagueData, pick);
        const source = getDraftSourceForPick({
          pick,
          fullProspect,
          leaguePlayer,
          draftState: previousState,
          workingLeagueData: leagueData,
        }) || getDraftSourceForPick({
          pick,
          fullProspect,
          leaguePlayer,
          draftState: nextState,
          workingLeagueData: leagueData,
        });

        if (!source) return pick;

        return {
          ...pick,
          college: pick.college || source,
          school: pick.school || source,
          university: pick.university || source,
          academy: pick.academy || source,
          academyName: pick.academyName || source,
          sourceName: pick.sourceName || source,
          draftSource: pick.draftSource || source,
          prospectSnapshot: {
            ...fullProspect,
            college: fullProspect.college || source,
            school: fullProspect.school || source,
            university: fullProspect.university || source,
            academy: fullProspect.academy || source,
            academyName: fullProspect.academyName || source,
            sourceName: fullProspect.sourceName || source,
            draftSource: fullProspect.draftSource || source,
          },
        };
      }),
    };
  }

  function getDraftedPickSelectId(pick = {}) {
    return `drafted-${pick.pick || ""}-${pick.playerId || pick.id || pick.playerName || pick.name || ""}`;
  }

  function normalizeDraftedPickForCard(pick = {}) {
    if (!pick) return null;

    const fullProspect = getFullProspectSnapshot(pick);
    const merged = { ...fullProspect, ...pick };

    const attrs =
      Array.isArray(pick.attrs) && pick.attrs.length
        ? pick.attrs
        : Array.isArray(pick.attributes) && pick.attributes.length
        ? pick.attributes
        : Array.isArray(fullProspect.attrs) && fullProspect.attrs.length
        ? fullProspect.attrs
        : Array.isArray(fullProspect.attributes) && fullProspect.attributes.length
        ? fullProspect.attributes
        : [];

    const traits = pick.traits || fullProspect.traits || {};

    return {
      ...merged,
      id: getDraftedPickSelectId(pick),
      name: merged.name || merged.playerName || "Drafted Player",
      playerName: merged.playerName || merged.name || "Drafted Player",
      pos: merged.pos || "-",
      secondaryPos: merged.secondaryPos || "",
      age: merged.age ?? "-",
      overall: merged.overall ?? merged.ovr ?? "-",
      potential: merged.potential ?? merged.pot ?? "-",
      draftProjection: merged.draftProjection || merged.pick || merged.trueRank || "-",
      trueRank: merged.trueRank || merged.pick || merged.draftProjection || "-",
      archetype: merged.archetype || merged.type || "Drafted Prospect",
      tier: merged.tier || (merged.round ? `Round ${merged.round}` : "Drafted"),
      headshot: getHeadshot(merged),
      attrs,
      traits,
      height: merged.height,
      weight: merged.weight,
      college: getDraftSource(merged),
      school: merged.school || "",
      university: merged.university || "",
      academy: merged.academy || "",
      academyName: merged.academyName || "",
      sourceName: merged.sourceName || "",
      draftSource: merged.draftSource || "",
      nationality: merged.nationality || "",
      identityKey: merged.identityKey || "",
      contract: merged.contract || null,
    };
  }

  function ProspectHeadshot({ src, name, size = "sm" }) {
    const sizeClass =
      size === "lg"
        ? "h-32 w-28"
        : size === "md"
        ? "h-16 w-14"
        : "h-28 w-27";

    if (!src) {
      return (
        <div
          className={`${sizeClass} shrink-0 flex items-center justify-center text-[10px] font-black text-white/25`}
        >
          IMG
        </div>
      );
    }

    return (
      <div className={`${sizeClass} shrink-0 overflow-visible flex items-end justify-center`}>
        <img
          src={src}
          alt={name || "Prospect"}
          className="h-full w-full object-contain object-bottom translate-y-5 drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]"
          loading="lazy"
        />
      </div>
    );
  }

  function ProspectHeroHeadshot({ src, name }) {
    return (
      <div className="relative h-40 w-44 shrink-0 self-end overflow-visible flex items-end justify-center">
        <div className="absolute bottom-[2px] left-1/2 z-20 h-[3px] w-40 -translate-x-1/2 rounded-full bg-white/65 shadow-[0_0_16px_rgba(255,255,255,0.16)]" />
        <div className="absolute bottom-0 left-1/2 h-5 w-36 -translate-x-1/2 rounded-full bg-black/35 blur-md" />
        {src ? (
          <img
            src={src}
            alt={name || "Prospect"}
            className="relative z-10 mb-[5px] h-[187px] w-[193px] object-contain object-bottom drop-shadow-[0_18px_18px_rgba(0,0,0,0.55)]"
            loading="lazy"
          />
        ) : (
          <div className="relative z-10 mb-[5px] h-28 w-24 flex items-center justify-center text-[10px] font-black text-white/25">
            IMG
          </div>
        )}
      </div>
    );
  }

  function prospectSort(a, b) {
    return (
      Number(a.draftProjection || 999) - Number(b.draftProjection || 999) ||
      Number(b.potential || 0) - Number(a.potential || 0) ||
      Number(b.overall || 0) - Number(a.overall || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  }

  function attrLetter(value) {
    const n = Number(value || 0);
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
  }

  function SmallPill({ label, value }) {
    return (
      <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
        <div className="text-[10px] text-white/40 uppercase tracking-wide">{label}</div>
        <div className="text-sm font-extrabold text-white mt-1">{value}</div>
      </div>
    );
  }
  function OverallPill({ value }) {
    const overall = Number(value || 0);
    const fillPercent = Math.min(overall / 99, 1);
    const circleCircumference = 2 * Math.PI * 50;
    const strokeOffset = circleCircumference * (1 - fillPercent);

    return (
      <div className="rounded-xl bg-white/5 border border-white/10 px-1 py-1 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <svg width="42" height="42" viewBox="0 0 120 120">
            <defs>
              <linearGradient id="draftOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
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
              stroke="url(#draftOvrGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circleCircumference}
              strokeDashoffset={strokeOffset}
              transform="rotate(-90 60 60)"
            />
          </svg>

          <div className="absolute flex flex-col items-center justify-center text-center">
            <p className="text-[9px] text-gray-300 tracking-wide mb-0.5">OVR</p>
            <p className="text-[14px] font-extrabold text-orange-400 leading-none mt-[-4px]">
              {value ?? "-"}
            </p>
          </div>
        </div>
      </div>
    );
  }
  function DraftBoardPlayerMeta({ overall, potential, age, pos }) {
    const ovr = Number(overall || 0);
    const fillPercent = Math.min(ovr / 99, 1);
    const circleCircumference = 2 * Math.PI * 50;
    const strokeOffset = circleCircumference * (1 - fillPercent);

    return (
      <div className="mt-2 flex items-center gap-4 text-xs text-white/55 translate-y-5">
<div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center">
  <svg width="76" height="76" viewBox="0 0 120 120">
            <defs>
              <linearGradient id="draftBoardOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFA500" />
                <stop offset="100%" stopColor="#FFD54F" />
              </linearGradient>
            </defs>

            <circle
              cx="60"
              cy="60"
              r="50"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="8"
              fill="none"
            />

            <circle
              cx="60"
              cy="60"
              r="50"
              stroke="url(#draftBoardOvrGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circleCircumference}
              strokeDashoffset={strokeOffset}
              transform="rotate(-90 60 60)"
            />
          </svg>

          <div className="absolute flex flex-col items-center justify-center text-center">
           <p className="text-[9px] text-gray-300 tracking-wide leading-none">OVR</p>
<p className="text-[24px] font-extrabold text-orange-400 leading-none mt-[-2px]">
  {overall ?? "-"}
</p>
<p className="text-[9px] text-gray-400 leading-none mt-[1px]">
  POT <span className="text-orange-400 font-bold">{potential ?? "-"}</span>
</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold">
          <span>
            Age <span className="text-white/80">{age ?? "-"}</span>
          </span>
          <span>
            Pos <span className="text-white/80">{pos || "-"}</span>
          </span>
        </div>
      </div>
    );
  }

  function CombinedDraftBoard({
    prospects,
    draftedPicks = [],
    draftOrder = [],
    teamLogoByName = {},
    selectedProspectId,
    onSelect,
    disabled,
    availableStartRef,
    draftCompleted = false,
    workingLeagueData = null,
    draftState = null,
  }) {
    const orderedPicks = [...draftedPicks].sort(
      (a, b) => Number(a.pick || 0) - Number(b.pick || 0)
    );

    const draftOrderByPick = new Map(
      (draftOrder || []).map((row) => [Number(row.pick || 0), row])
    );

    const boardCountText = draftCompleted
      ? `${orderedPicks.length} drafted`
      : `${prospects.length} left`;

    const availableCountText = draftCompleted
      ? `${prospects.length} undrafted`
      : `${prospects.length} left`;

    // Manual team-logo background controls.
    // x: positive = right, negative = left.
    // y: positive = lower, negative = higher.
    // size: normal un-enlarged logo background is around 90.
    // opacity: 1 = current/full strength, 0.5 = half visible, 0 = hidden.
    const draftBoardTeamLogo = {
      x: 155,
      y: 30,
      size: 300,
      opacity: 0.5,
    };

    const nextPick = !draftCompleted ? (draftOrder || [])[orderedPicks.length] || null : null;
    const nextPickTeamName = nextPick ? getPickTeam(nextPick) : "";
    const nextPickLogo = nextPick
      ? teamLogoByName[normalizeTeamName(nextPickTeamName)] || resolveDraftRowTeamLogo(nextPick)
      : "";

    return (
      <div className="bmTablePanel bmDraftBoardPanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl">
        <div className="px-5 py-4 bg-neutral-800/90 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold">Draft Board</h2>
            <p className="text-sm text-white/50">
              Scroll up to review previous picks. Scroll down to choose from available prospects.
            </p>
          </div>
          <div className="text-sm text-white/50 font-bold">{boardCountText}</div>
        </div>

        <div className="bmOrangeScrollbar max-h-[760px] overflow-auto">
          {orderedPicks.length > 0 && (
            <div className="bg-black/10 border-b border-white/10">
              <div className="sticky top-0 z-20 bg-neutral-800/95 px-5 py-3 border-b border-white/10">
                <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                  Drafted Players
                </div>
              </div>

              {orderedPicks.map((pick, index) => {
                const orderPick = draftOrderByPick.get(Number(pick.pick || 0)) || {};
                const leaguePlayer = findDraftedPlayerInLeague(workingLeagueData, pick);
                const fullProspect = getFullProspectSnapshot(pick);
                const displayPick = normalizeDraftedPickForCard({
                  ...leaguePlayer,
                  ...pick,
                  prospectSnapshot: {
                    ...leaguePlayer,
                    ...fullProspect,
                  },
                });
                const displayName = displayPick.playerName || displayPick.name || "Drafted Player";
                const displaySource = getDraftSourceForPick({
                  pick,
                  displayPick,
                  fullProspect,
                  leaguePlayer,
                  draftState,
                  workingLeagueData,
                });
                const teamName = pick.teamName || orderPick.currentOwnerTeamName || orderPick.teamName || "";
                const logo =
                  teamLogoByName[normalizeTeamName(teamName)] ||
                  resolveDraftRowTeamLogo(orderPick) ||
                  resolveDraftRowTeamLogo(pick);
                const headshot =
                  getHeadshot(displayPick) ||
                  getHeadshot(fullProspect) ||
                  getHeadshot(leaguePlayer);
                const draftedSelectId = getDraftedPickSelectId(pick);
                const active = selectedProspectId === draftedSelectId;

                return (
                  <div
                    key={`${pick.pick}-${pick.playerId}`}
                    onClick={() => onSelect(draftedSelectId)}
                    className={`bmRowEnter bmDraftBoardRow grid grid-cols-[22px_minmax(0,1fr)] items-center gap-4 px-5 py-5 border-b border-white/10 transition cursor-pointer ${
                      active
                        ? "bmDraftBoardRowActive"
                        : pick.userControlled
                        ? "bmDraftBoardRowUser"
                        : ""
                    }`}
                    style={{
                      animationDelay: `${Math.min(index, 12) * 22}ms`,
                      ...draftTeamLogoRowBackground(logo, draftBoardTeamLogo),
                    }}
                  >
                    <div className="font-extrabold text-orange-200">#{pick.pick}</div>

                    <div className="flex items-center gap-4 min-w-0">
                      <ProspectHeadshot src={headshot} name={displayName} />
  <div className="min-w-0 -translate-y-1">
    <div className="text-lg font-extrabold text-white truncate">
      {displayName}
      {pick.userControlled ? (
        <span className="ml-2 text-xs text-emerald-300">Your pick</span>
      ) : null}
    </div>
    {displaySource ? (
      <div className="mt-0.5 text-xs text-white/45 truncate">
        {displaySource}
      </div>
    ) : null}

    <DraftBoardPlayerMeta
      overall={displayPick.overall ?? displayPick.ovr}
      potential={displayPick.potential ?? displayPick.pot}
      age={displayPick.age}
      pos={displayPick.pos}
    />
  </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}

          <div ref={availableStartRef} />

          <div className="sticky top-0 z-20 bg-neutral-800/95 px-5 py-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                  Available Prospects
                </div>
                <div className="text-sm text-white/50">
                  Click a prospect when your team is on the clock.
                </div>
              </div>
              <div className="text-xs text-white/45 font-bold">
                {availableCountText}
              </div>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="sticky top-[61px] bg-neutral-800/95 text-white/70 z-10">
              <tr>
                <th className="px-4 py-3 text-left">Rank</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3">Age</th>
                <th className="px-4 py-3 text-left">Type</th>
              </tr>
            </thead>

            <tbody>
              {prospects.map((prospect, index) => {
                const active = selectedProspectId === prospect.id;

                return (
                  <tr
                    key={prospect.id}
                    onClick={() => !disabled && onSelect(prospect.id)}
                    className={`bmRowEnter bmDraftBoardRow border-b border-white/10 transition ${
                      disabled
                        ? "opacity-70"
                        : active
                        ? "bmDraftBoardRowActive cursor-pointer"
                        : "cursor-pointer"
                    }`}
                    style={{
                      animationDelay: `${Math.min(index, 18) * 18}ms`,
                      ...draftTeamLogoRowBackground(nextPickLogo, draftBoardTeamLogo),
                    }}
                  >
                    <td className="px-4 py-5 font-bold text-orange-200">
                      #{prospect.draftProjection || prospect.trueRank || "-"}
                    </td>

                    <td className="px-4 py-5">
                      <div className="flex items-center gap-4 min-w-0">
                        <ProspectHeadshot src={getHeadshot(prospect)} name={prospect.name} />
                        <div className="min-w-0">
                          <div className="text-lg font-extrabold text-white truncate">{prospect.name}</div>
                          <div className="text-xs text-white/45 truncate">
                            {getDraftSource(prospect)}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-5 text-center font-bold text-white/75">{prospect.age}</td>

                    <td className="px-4 py-5 text-left">
                      <div className="font-semibold text-white/80">{prospect.archetype}</div>
                      <div className="text-xs text-white/45">{prospect.tier}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!prospects.length && (
            <div className="p-8 text-white/50 text-center">
              No prospects remaining.
            </div>
          )}
        </div>
      </div>
    );
  }

  function ProspectCard({ prospect }) {
    if (!prospect) {
      return (
        <div className="bmSolidPanel rounded-3xl bg-neutral-900 border border-white/10 p-6 text-white/50">
          Select a prospect to view scouting details.
        </div>
      );
    }

    const attrs = Array.isArray(prospect.attrs) ? prospect.attrs : [];
    const labels = [
      ["3PT", attrs[0]],
      ["MID", attrs[1]],
      ["CLS", attrs[2]],
      ["BALL", attrs[4]],
      ["PASS", attrs[5]],
      ["ATH", attrs[7]],
      ["PER D", attrs[8]],
      ["INS D", attrs[9]],
      ["REB", attrs[12]],
      ["IQ", attrs[13]],
    ];

    const salary = prospect?.contract?.salaryByYear?.[0];
    const headshot = getHeadshot(prospect);

    return (
      <div className="bmSolidPanel bmRowEnter rounded-3xl bg-neutral-900 border border-white/10 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-end gap-5 min-w-0">
            <ProspectHeroHeadshot src={headshot} name={prospect.name} />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Scouting Report</div>
              <h2 className="text-3xl font-extrabold text-white leading-tight">{prospect.name}</h2>
              <p className="text-white/55 mt-1">
                {prospect.pos}{prospect.secondaryPos ? ` / ${prospect.secondaryPos}` : ""} - {prospect.archetype}
              </p>
              {getDraftSource(prospect) && (
                <p className="text-xs text-white/40 mt-1">
                  {getDraftSource(prospect)}
                </p>
              )}
              {(prospect.nationality || prospect.identityKey) && (
                <p className="text-xs text-white/35 mt-1">
                  {prospect.nationality || ""}{prospect.identityKey ? ` - ${String(prospect.identityKey).replaceAll("_", " ")}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-white/40 uppercase">Projection</div>
            <div className="text-2xl font-extrabold text-orange-300">#{prospect.draftProjection || prospect.trueRank}</div>
          </div>
        </div>

  <div className="grid grid-cols-3 gap-3 mb-5">
    <OverallPill value={prospect.overall} />
    <SmallPill label="POT" value={prospect.potential} />
    <SmallPill label="Age" value={prospect.age} />
          <SmallPill label="Height" value={prospect.height ? `${Math.floor(prospect.height / 12)}'${prospect.height % 12}` : "-"} />
          <SmallPill label="Weight" value={prospect.weight || "-"} />
          <SmallPill label="Salary" value={salary ? formatMoney(salary) : "Rookie"} />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {labels.map(([label, value]) => {
            const hasValue = Number.isFinite(Number(value));

            return (
              <div key={label} className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                <span className="text-xs text-white/45 font-semibold">{label}</span>
                <span className="text-sm font-extrabold text-white">
                  {hasValue ? attrLetter(value) : "-"} <span className="text-white/35">{hasValue ? value : ""}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl bg-black/25 border border-white/10 p-4">
          <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Traits</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>NBA Ready: <span className="font-bold">{Math.round(Number(prospect.traits?.nbaReady || 0) * 100)}%</span></div>
            <div>Star Upside: <span className="font-bold">{Math.round(Number(prospect.traits?.starUpside || 0) * 100)}%</span></div>
            <div>Boom/Bust: <span className="font-bold">{Math.round(Number(prospect.traits?.boomBust || 0) * 100)}%</span></div>
            <div>Work Ethic: <span className="font-bold">{Math.round(Number(prospect.traits?.workEthic || 0) * 100)}%</span></div>
          </div>
        </div>
      </div>
    );
  }

  function DraftedPicks({ picks = [] }) {
    const recent = [...picks].slice(-12).reverse();

    return (
      <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl">
        <div className="px-5 py-4 bg-neutral-800/90 border-b border-white/10">
          <h2 className="text-2xl font-extrabold">Draft Log</h2>
          <p className="text-sm text-white/50">Latest selections.</p>
        </div>
        <div className="max-h-[360px] overflow-auto">
          {recent.length ? (
            recent.map((pick, index) => (
              <div key={`${pick.pick}-${pick.playerId}`} className="bmRowEnter px-4 py-3 border-b border-white/10" style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-extrabold text-orange-200">#{pick.pick}</div>
                  <div className="text-right text-xs text-white/45">{pick.teamName}</div>
                </div>
                <div className="mt-1 font-bold text-white">{pick.playerName}</div>
                <div className="text-xs text-white/50">
                  {pick.pos} - {pick.overall} OVR - {pick.potential} POT {pick.userControlled ? "- Your pick" : ""}
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 text-white/50">No picks made yet.</div>
          )}
        </div>
      </div>
    );
  }

  export default function Draft() {
    const navigate = useNavigate();
    const { leagueData, setLeagueData, selectedTeam } = useGame();

    const seasonYear = getSeasonYear(leagueData);
    const savedSelectedTeam = safeJSON(localStorage.getItem("selectedTeam"), "");
    const selectedTeamName =
      selectedTeam?.name ||
      (typeof savedSelectedTeam === "string" ? savedSelectedTeam : savedSelectedTeam?.name) ||
      "";

    const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
    const [draftState, setDraftState] = useState(() => readDraftState(seasonYear));
    const [selectedProspectId, setSelectedProspectId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const availableStartRef = useRef(null);

    useEffect(() => {
      if (leagueData) setWorkingLeagueData(leagueData);
    }, [leagueData]);

    const lottery = useMemo(() => readDraftLottery(seasonYear), [seasonYear]);
    const draftOrder = lottery?.result?.fullDraftOrder || workingLeagueData?.draftState?.draftOrder || [];

    const teamLogoByName = useMemo(() => {
      return buildTeamLogoMap(workingLeagueData, draftOrder);
    }, [workingLeagueData, draftOrder]);

    const currentPick = useMemo(() => {
      if (!draftState || draftState.completed) return null;
      return draftState.draftOrder?.[draftState.currentPickIndex] || null;
    }, [draftState]);

    const currentTeamName = getPickTeam(currentPick || {});
    const userOnClock = Boolean(currentPick && selectedTeamName && currentTeamName === selectedTeamName);

    const availableProspects = useMemo(() => {
      return [...(draftState?.availableProspects || [])].sort(prospectSort);
    }, [draftState]);

    const draftedProspectCards = useMemo(() => {
      return (draftState?.draftedPicks || [])
        .map((pick) => {
          const leaguePlayer = findDraftedPlayerInLeague(workingLeagueData, pick);
          const fullProspect = getFullProspectSnapshot(pick);

          const source = getDraftSourceForPick({
            pick,
            fullProspect,
            leaguePlayer,
            draftState,
            workingLeagueData,
          });

          return normalizeDraftedPickForCard({
            ...leaguePlayer,
            ...pick,
            college: pick.college || leaguePlayer.college || fullProspect.college || source,
            school: pick.school || leaguePlayer.school || fullProspect.school || source,
            university: pick.university || leaguePlayer.university || fullProspect.university || source,
            academy: pick.academy || leaguePlayer.academy || fullProspect.academy || source,
            academyName: pick.academyName || leaguePlayer.academyName || fullProspect.academyName || source,
            sourceName: pick.sourceName || leaguePlayer.sourceName || fullProspect.sourceName || source,
            draftSource: pick.draftSource || leaguePlayer.draftSource || fullProspect.draftSource || source,
            prospectSnapshot: {
              ...leaguePlayer,
              ...fullProspect,
              college: leaguePlayer.college || fullProspect.college || source,
              school: leaguePlayer.school || fullProspect.school || source,
              university: leaguePlayer.university || fullProspect.university || source,
              academy: leaguePlayer.academy || fullProspect.academy || source,
              academyName: leaguePlayer.academyName || fullProspect.academyName || source,
              sourceName: leaguePlayer.sourceName || fullProspect.sourceName || source,
              draftSource: leaguePlayer.draftSource || fullProspect.draftSource || source,
            },
          });
        })
        .filter(Boolean);
    }, [draftState, workingLeagueData]);

    const reportProspects = useMemo(() => {
      return [...draftedProspectCards, ...availableProspects];
    }, [draftedProspectCards, availableProspects]);

    const selectedProspect = useMemo(() => {
      return (
        reportProspects.find((p) => p.id === selectedProspectId) ||
        (draftState?.completed ? draftedProspectCards[0] : availableProspects[0]) ||
        reportProspects[0] ||
        null
      );
    }, [reportProspects, selectedProspectId, draftState?.completed, draftedProspectCards, availableProspects]);

    useEffect(() => {
      const selectedStillExists = reportProspects.some((p) => p.id === selectedProspectId);
      if (selectedStillExists) return;

      const nextDefault =
        draftState?.completed && draftedProspectCards[0]?.id
          ? draftedProspectCards[0].id
          : availableProspects[0]?.id || reportProspects[0]?.id;

      if (nextDefault) {
        setSelectedProspectId(nextDefault);
      }
    }, [reportProspects, selectedProspectId, draftState?.completed, draftedProspectCards, availableProspects]);

    const applyDraftResult = (result) => {
      if (!result?.ok) {
        throw new Error(result?.reason || "Draft action failed.");
      }

      const nextLeague = result.leagueData || workingLeagueData;
      const rawNextState = result.draftState || draftState;
      const nextState = enrichDraftStateWithDraftSources(rawNextState, draftState, nextLeague);

      setWorkingLeagueData(nextLeague);
      setDraftState(nextState);
      saveDraftState(nextState);
      persistLeagueData(nextLeague, setLeagueData);

      if (nextState?.completed) {
        updateOffseasonState({ draftComplete: true });
      }

      return result;
    };

    const initializeDraft = async () => {
      setLoading(true);
      setError("");

      try {
        if (!draftOrder?.length) {
          throw new Error("Draft order is missing. Complete the Draft Lottery first.");
        }
        if (typeof simEngine.initializeDraft !== "function") {
          throw new Error("initializeDraft is not wired in simEnginePy.js yet.");
        }

        const customSetup = readCustomDraftClassSetup(seasonYear);
        if (customSetup.mode === "custom" && !customSetup.draftClassPayload?.draftClass?.length) {
          throw new Error("Custom draft class mode is selected, but no custom class is loaded for this season. Add one in League Editor or switch back to auto-generate rookies.");
        }

        const draftPayload = {
          seasonYear,
          userTeamName: selectedTeamName,
          draftOrder,
        };

        if (customSetup.draftClassPayload?.draftClass?.length) {
          draftPayload.draftClass = customSetup.draftClassPayload.draftClass;
          draftPayload.classType = "custom";
        }

        const result = await simEngine.initializeDraft(workingLeagueData, draftPayload);

        applyDraftResult(result);
      } catch (err) {
        console.error("[Draft] initializeDraft failed", err);
        setError(String(err?.message || err));
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      const saved = readDraftState(seasonYear);
      if (saved?.draftOrder?.length) {
        setDraftState(saved);
        return;
      }

      if (workingLeagueData && draftOrder?.length && !draftState && !loading) {
        initializeDraft();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workingLeagueData, draftOrder?.length, seasonYear]);

    const scrollToAvailableProspects = () => {
      window.setTimeout(() => {
        availableStartRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    };

    const runDraftAction = async (fnName, payload = {}) => {
      setLoading(true);
      setError("");

      try {
        const fn = simEngine[fnName];
        if (typeof fn !== "function") {
          throw new Error(`${fnName} is not wired in simEnginePy.js yet.`);
        }

        const { scrollToAvailable = false, ...backendPayload } = payload || {};

        const result = await fn(workingLeagueData, {
          seasonYear,
          userTeamName: selectedTeamName,
          draftState,
          ...backendPayload,
        });

        const applied = applyDraftResult(result);

        if (scrollToAvailable) {
          scrollToAvailableProspects();
        }

        return applied;
      } catch (err) {
        console.error(`[Draft] ${fnName} failed`, err);
        setError(String(err?.message || err));
      } finally {
        setLoading(false);
      }
    };

    const handleUserPick = async () => {
      if (!selectedProspect?.id) {
        setError("Select a prospect first.");
        return;
      }
      await runDraftAction("makeUserDraftPick", { prospectId: selectedProspect.id });
    };

    const handleFinish = () => {
      updateOffseasonState({ draftComplete: true });
      navigate("/offseason");
    };

    if (!workingLeagueData) {
      return (
        <div className="min-h-screen bmCourtPage text-white flex items-center justify-center">
          Loading draft...
        </div>
      );
    }

    if (!draftOrder?.length) {
      return (
        <div className="min-h-screen bmCourtPage text-white flex items-center justify-center px-4">
          <div className="bmSolidPanel rounded-3xl bg-neutral-900 border border-white/10 p-8 max-w-xl text-center">
            <h1 className="text-3xl font-extrabold text-orange-500 mb-3">Draft Order Missing</h1>
            <p className="text-white/60 mb-6">Complete the Draft Lottery before opening the NBA Draft.</p>
            <button onClick={() => navigate("/draft-lottery")} className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 font-bold">
              Go to Draft Lottery
            </button>
          </div>
        </div>
      );
    }

    const completed = Boolean(draftState?.completed);
    const pickNumber = currentPick?.pick || "-";
    const pickRound = currentPick?.round || "-";
    const picksMade = draftState?.draftedPicks?.length || 0;
    const totalPicks = draftState?.draftOrder?.length || draftOrder.length || 60;

    return (
      <div className="min-h-screen bmCourtPage text-white py-8 px-4">
        <style>{`
          .bmOrangeScrollbar {
            scrollbar-width: thin;
            scrollbar-color: rgba(249, 115, 22, 0.92) rgba(12, 12, 12, 0.78);
          }

          .bmOrangeScrollbar::-webkit-scrollbar {
            width: 12px;
            height: 12px;
          }

          .bmOrangeScrollbar::-webkit-scrollbar-track {
            background: rgba(12, 12, 12, 0.78);
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 999px;
          }

          .bmOrangeScrollbar::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
            border: 3px solid rgba(12, 12, 12, 0.92);
            border-radius: 999px;
            box-shadow: 0 0 14px rgba(249, 115, 22, 0.22);
          }

          .bmOrangeScrollbar::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, #fdba74 0%, #fb923c 45%, #f97316 100%);
          }

          .bmOrangeScrollbar::-webkit-scrollbar-corner {
            background: rgba(12, 12, 12, 0.78);
          }

          .bmDraftBoardPanel {
            background-image:
              radial-gradient(circle at 18% 0%, rgba(249, 115, 22, 0.12), transparent 34%),
              radial-gradient(circle at 92% 16%, rgba(255, 255, 255, 0.06), transparent 28%),
              repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 22px),
              linear-gradient(135deg, rgba(18,18,18,0.97), rgba(8,8,8,0.98));
            background-blend-mode: screen, normal, soft-light, normal;
          }

          .bmDraftBoardRow {
            position: relative;
            isolation: isolate;
            background: rgba(10, 10, 10, 0.64);
          }

          .bmDraftBoardRow > * {
            position: relative;
            z-index: 1;
          }

  .bmDraftBoardRow {
    position: relative;
    isolation: isolate;
    background: rgba(10, 10, 10, 0.72);
  }

  .bmDraftBoardRow:hover {
    background-color: rgba(255, 255, 255, 0.055);
  }

  .bmDraftBoardRowActive {
    background-color: rgba(255, 255, 255, 0.08);
  }

          .bmDraftBoardRowUser:not(.bmDraftBoardRowActive) {
            background: rgba(5, 150, 105, 0.14);
          }
        `}</style>
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-4 mb-8">
            <div>
              <p className="text-xs text-white/40 tracking-[0.25em] uppercase mb-2">Offseason</p>
              <h1 className="text-4xl md:text-5xl font-extrabold text-orange-500">NBA Draft</h1>
              <p className="text-white/60 mt-2">
                {completed ? "Draft complete." : `Pick ${pickNumber} - Round ${pickRound} - ${currentTeamName} is on the clock.`}
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3 shrink-0">
              {completed && (
                <button
                  onClick={handleFinish}
                  className="bmSmoothButton px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-extrabold"
                >
                  Complete Draft and Return
                </button>
              )}

              <button
                onClick={() => navigate("/offseason")}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 font-bold"
              >
                Back to Offseason
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 font-semibold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <SmallPill label="Season" value={seasonYear} />
            <SmallPill label="Progress" value={`${picksMade}/${totalPicks}`} />
            <SmallPill label="Current Pick" value={completed ? "Done" : `#${pickNumber}`} />
            <SmallPill label="On Clock" value={completed ? "-" : currentTeamName} />
            <SmallPill label="Your Team" value={selectedTeamName || "-"} />
          </div>

          {!completed && (
            <div className="flex flex-wrap gap-3 mb-8">
              <button
                disabled={loading || userOnClock}
                onClick={() => runDraftAction("simOneDraftPick")}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Sim One Pick
              </button>

              <button
                disabled={loading || userOnClock}
                onClick={() => runDraftAction("simToUserDraftPick", { scrollToAvailable: true })}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Sim To User Pick
              </button>

              <button
                disabled={loading}
                onClick={() => runDraftAction("simRestOfDraft")}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Sim Rest Of Draft
              </button>

              <button
                disabled={loading || !userOnClock || !selectedProspect?.id}
                onClick={handleUserPick}
                className="bmSmoothButton px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Draft Selected Player
              </button>
            </div>
          )}

          {loading && (
            <div className="mb-6 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-orange-100 font-semibold">
              Processing draft action...
            </div>
          )}

          {userOnClock && !completed && (
            <div className="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-100 font-semibold">
              You are on the clock. Select a prospect and click Draft Selected Player.
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.9fr] gap-6">
            <CombinedDraftBoard
              prospects={availableProspects}
              draftedPicks={draftState?.draftedPicks || []}
              draftOrder={draftState?.draftOrder || draftOrder}
              teamLogoByName={teamLogoByName}
              selectedProspectId={selectedProspect?.id}
              onSelect={setSelectedProspectId}
              disabled={loading}
              availableStartRef={availableStartRef}
              draftCompleted={completed}
              workingLeagueData={workingLeagueData}
              draftState={draftState}
            />

            <div className="flex flex-col gap-6">
              <ProspectCard prospect={selectedProspect} />

              {completed && (
                <div className="bmSolidPanel bmRowEnter rounded-3xl bg-neutral-900 border border-white/10 p-6">
                  <h2 className="text-2xl font-extrabold text-white mb-3">Undrafted Free Agents</h2>
                  <p className="text-white/60 text-sm mb-4">
                    Top undrafted prospects have been added to the free-agent pool.
                  </p>
                  <div className="text-sm text-white/50">
                    Added: {draftState?.undraftedAddedToFreeAgency?.length || 0}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
