import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import PlayerRatingRing from "../components/PlayerRatingRing.jsx";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import styles from "../components/TeamHub.module.css";
import { TEAM_HUB_BANNER_LAYOUT as bannerLayout } from "../config/teamHubBannerLayout.js";
import {
  buildConferenceLookup,
  compareCanonicalTeams,
  computeCanonicalStandings,
  loadRegularSeasonResultsV3FromStorage,
  normalizeStandingsTeamName,
} from "../utils/canonicalStandings.js";
import {
  hydrateScheduleTeamMetadata,
  readScheduleFromStorage,
} from "../utils/scheduleStorage.js";
import {
  collectOwnedPicksForTeam,
  formatMoney,
  getPlayerSalary,
  getStandardPlayers,
  playerHeadshotOf,
  playerOverall,
  teamLogoOf,
} from "../utils/teamIntel_v1.js";
import {
  getUpcomingDraftYearForPhase,
  readUpcomingDraftClassForYear,
} from "../utils/upcomingDraftClass.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const POSTSEASON_KEY = "bm_postseason_v2";

function bannerTextStyle(control = {}) {
  return {
    transform: `translate(${Number(control?.x || 0)}px, ${Number(control?.y || 0)}px)`,
    fontSize: Number.isFinite(Number(control?.size)) ? `${Number(control.size)}px` : undefined,
  };
}

function bannerBlockStyle(control = {}) {
  const x = Number(control?.x || 0);
  const y = Number(control?.y || 0);
  return {
    transform: `translate(${Number.isFinite(x) ? x : 0}px, ${Number.isFinite(y) ? y : 0}px)`,
  };
}

function bannerBoxStyle(control = {}) {
  const height = Number(control?.height);
  const safeHeight = Number.isFinite(height) && height > 0 ? height : null;
  return safeHeight
    ? { height: `${safeHeight}px`, minHeight: `${safeHeight}px` }
    : undefined;
}

function bannerWatermarkStyle(control = {}) {
  const safeNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const x = safeNumber(control?.x, 0);
  const y = safeNumber(control?.y, 0);
  const scale = Math.max(0.01, safeNumber(control?.scale, 1));
  const rotation = safeNumber(control?.rotation, -5);
  const opacity = Math.min(1, Math.max(0, safeNumber(control?.opacity, 0.018)));
  return {
    transform: `translate(${x}px, calc(-50% + ${y}px)) rotate(${rotation}deg) scale(${scale})`,
    opacity,
  };
}

function bannerLogoStyle(control = {}) {
  const size = Number(control?.size || 0);
  return {
    transform: `translate(${Number(control?.x || 0)}px, ${Number(control?.y || 0)}px)`,
    width: size > 0 ? `${size}px` : undefined,
    height: size > 0 ? `${size}px` : undefined,
  };
}

function safeJSON(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  return Object.entries(leagueData?.conferences || {}).flatMap(([conference, teams]) =>
    (Array.isArray(teams) ? teams : []).filter(Boolean).map((team) => ({
      ...team,
      conference: team?.conference || team?.conf || conference,
    }))
  );
}

function teamNameOf(team = {}) {
  return String(team?.name || team?.teamName || "").trim();
}

function splitTeamIdentity(team = {}) {
  const fullName = teamNameOf(team);
  const explicitCity = String(
    team?.city || team?.location || team?.market || team?.teamCity || ""
  ).trim();
  const explicitNickname = String(
    team?.nickname || team?.mascot || team?.teamNickname || ""
  ).trim();

  if (explicitCity && explicitNickname) {
    return { city: explicitCity, nickname: explicitNickname };
  }

  if (explicitNickname && fullName.toLowerCase().endsWith(explicitNickname.toLowerCase())) {
    return {
      city: fullName.slice(0, fullName.length - explicitNickname.length).trim(),
      nickname: explicitNickname,
    };
  }

  const knownNicknames = [
    "Trail Blazers",
    "Timberwolves",
    "Mavericks",
    "Cavaliers",
    "Grizzlies",
    "Pelicans",
    "Warriors",
    "Clippers",
    "Lakers",
    "Kings",
    "Spurs",
    "Rockets",
    "Thunder",
    "Suns",
    "Jazz",
    "Nuggets",
    "Hawks",
    "Celtics",
    "Nets",
    "Hornets",
    "Bulls",
    "Pacers",
    "Pistons",
    "Bucks",
    "Heat",
    "Magic",
    "Knicks",
    "76ers",
    "Raptors",
    "Wizards",
  ];

  const nickname = knownNicknames.find((candidate) =>
    fullName.toLowerCase().endsWith(candidate.toLowerCase())
  );

  if (nickname) {
    return {
      city: fullName.slice(0, fullName.length - nickname.length).trim(),
      nickname,
    };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    city: parts.slice(0, -1).join(" "),
    nickname: parts.at(-1) || fullName,
  };
}

function teamAbbr(team = {}) {
  const explicit = team?.abbreviation || team?.abbr || team?.code || team?.shortName;
  if (explicit) return String(explicit).toUpperCase();
  const words = teamNameOf(team).split(/\s+/).filter(Boolean);
  return words.slice(-2).map((word) => word[0]).join("").toUpperCase() || "—";
}

function seasonLabel(leagueData = {}) {
  const start = Number(
    leagueData?.seasonStartYear ??
      leagueData?.seasonYear ??
      leagueData?.currentSeasonYear ??
      2026
  );
  if (!Number.isFinite(start)) return "Season";
  return `Season ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function phaseLabel() {
  const offseason = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {});
  const postseason = safeJSON(localStorage.getItem(POSTSEASON_KEY), null);
  if (offseason?.active) return "Offseason";
  if (postseason) return "Playoffs";
  return "Regular Season";
}

function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function parseGameScore(game, results = {}) {
  const result = results?.[String(game?.id || "")];
  if (!result) return null;

  const home = Number(
    result?.totals?.home ??
      result?.finalScore?.home ??
      result?.score?.home ??
      result?.homeScore
  );
  const away = Number(
    result?.totals?.away ??
      result?.finalScore?.away ??
      result?.score?.away ??
      result?.awayScore
  );

  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function formatGameDate(value) {
  const raw = String(value || "");
  if (!raw) return "—";
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function readGameplanOrder(team = {}) {
  const roster = getStandardPlayers(team);
  const byName = new Map(roster.map((player) => [player?.name, player]));

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(`gameplan_${teamNameOf(team)}`) || "null");
  } catch {}

  const rotationCandidates = [
    saved?.rotationOrder?.home,
    saved?.rotationOrder?.away,
    Array.isArray(saved?.rotationOrder) ? saved.rotationOrder : null,
    saved?.order,
    saved?.players,
  ];

  for (const candidate of rotationCandidates) {
    if (!Array.isArray(candidate) || !candidate.length) continue;
    const resolved = candidate
      .map((entry) => {
        const name = typeof entry === "string" ? entry : entry?.name || entry?.player;
        return byName.get(name);
      })
      .filter(Boolean);
    if (resolved.length >= 5) return resolved;
  }

  const minutes =
    saved?.minutes && typeof saved.minutes === "object" && !Array.isArray(saved.minutes)
      ? saved.minutes
      : saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};

  return [...roster].sort((a, b) => {
    const minuteDiff = Number(minutes?.[b?.name] || 0) - Number(minutes?.[a?.name] || 0);
    if (minuteDiff) return minuteDiff;
    return playerOverall(b) - playerOverall(a);
  });
}

function getProspectHeadshot(player = {}) {
  return player?.headshot || player?.image || player?.img || player?.portrait || "";
}

// TEAM HUB GLOBAL SEARCH HELPERS PASS 25
function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function searchMatchScore(value, query) {
  const text = normalizeSearchText(value);
  const q = normalizeSearchText(query);
  if (!text || !q) return Number.POSITIVE_INFINITY;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (text.includes(q)) return 3;
  return Number.POSITIVE_INFINITY;
}

function playerNameOf(player = {}) {
  return String(player?.name || player?.playerName || player?.player || "").trim();
}

function collectSearchablePlayers(leagueData = {}, teams = []) {
  const rows = [];
  const seen = new Set();

  const addPlayer = (player, team = null, teamName = "Free Agent") => {
    if (!player || typeof player !== "object") return;
    const name = playerNameOf(player);
    if (!name) return;
    const resolvedTeamName = team ? teamNameOf(team) : String(teamName || "Free Agent");
    const identity = String(player?.id ?? player?.playerId ?? player?.uuid ?? name);
    const key = `${normalizeSearchText(resolvedTeamName)}::${normalizeSearchText(identity)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      player,
      team,
      teamName: resolvedTeamName,
      teamLogo: team ? teamLogoOf(team) : String(player?.teamLogo || ""),
    });
  };

  teams.forEach((team) => {
    const buckets = [
      team?.players,
      team?.roster,
      team?.standardPlayers,
      team?.twoWayPlayers,
      team?.twoWay,
      team?.stashPlayers,
      team?.stashes,
      getStandardPlayers(team),
    ];
    buckets.forEach((bucket) => {
      if (!Array.isArray(bucket)) return;
      bucket.forEach((player) => addPlayer(player, team));
    });
  });

  const freeAgentBuckets = [
    leagueData?.freeAgents,
    leagueData?.freeAgency?.freeAgents,
    leagueData?.freeAgency?.players,
    leagueData?.freeAgencyState?.freeAgents,
    leagueData?.freeAgencyState?.availablePlayers,
  ];
  freeAgentBuckets.forEach((bucket) => {
    if (!Array.isArray(bucket)) return;
    bucket.forEach((player) => addPlayer(player, null, "Free Agent"));
  });

  return rows;
}


export default function TeamHub() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [showBench, setShowBench] = useState(false);
  // TEAM HUB GLOBAL SEARCH STATE PASS 25
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPlayerCard, setSearchPlayerCard] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    document.body.classList.add("th-no-scroll");
    return () => document.body.classList.remove("th-no-scroll");
  }, []);

  // TEAM HUB GLOBAL SEARCH DISMISS PASS 25
  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const teams = useMemo(() => getAllTeams(leagueData || {}), [leagueData]);

  const teamsSorted = useMemo(
    () => [...teams].sort((a, b) => teamNameOf(a).localeCompare(teamNameOf(b))),
    [teams]
  );

  const teamMap = useMemo(
    () => new Map(teams.map((team) => [teamNameOf(team), team])),
    [teams]
  );

  // TEAM HUB GLOBAL SEARCH INDEX PASS 25
  const searchablePlayers = useMemo(
    () => collectSearchablePlayers(leagueData || {}, teams),
    [leagueData, teams]
  );

  const searchResults = useMemo(() => {
    const query = normalizeSearchText(searchQuery);
    if (!query) return { teams: [], players: [] };

    const teamResults = teamsSorted
      .map((team) => {
        const identity = splitTeamIdentity(team);
        const scores = [
          searchMatchScore(teamNameOf(team), query),
          searchMatchScore(identity.city, query),
          searchMatchScore(identity.nickname, query),
          searchMatchScore(teamAbbr(team), query),
        ];
        return { kind: "team", team, score: Math.min(...scores) };
      })
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || teamNameOf(a.team).localeCompare(teamNameOf(b.team)))
      .slice(0, 4);

    const playerResults = searchablePlayers
      .map((entry) => {
        const nameScore = searchMatchScore(playerNameOf(entry.player), query);
        const teamScore = searchMatchScore(entry.teamName, query);
        const positionScore = searchMatchScore(entry.player?.pos || entry.player?.position || "", query);
        const score = Math.min(
          nameScore,
          Number.isFinite(teamScore) ? teamScore + 4 : Number.POSITIVE_INFINITY,
          Number.isFinite(positionScore) ? positionScore + 6 : Number.POSITIVE_INFINITY
        );
        return { kind: "player", ...entry, score };
      })
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || playerNameOf(a.player).localeCompare(playerNameOf(b.player)) || playerOverall(b.player) - playerOverall(a.player))
      .slice(0, 6);

    return { teams: teamResults, players: playerResults };
  }, [searchQuery, teamsSorted, searchablePlayers]);

  const schedule = useMemo(() => {
    const raw = readScheduleFromStorage() || {};
    return hydrateScheduleTeamMetadata(raw, leagueData || {});
  }, [leagueData, selectedTeam?.name]);

  const results = useMemo(
    () => loadRegularSeasonResultsV3FromStorage(),
    [leagueData, selectedTeam?.name]
  );

  const flatGames = useMemo(
    () =>
      Object.entries(schedule || {})
        .flatMap(([date, games]) =>
          (Array.isArray(games) ? games : []).map((game) => ({
            ...game,
            date: game?.date || date,
          }))
        )
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))),
    [schedule]
  );

  const conferenceLookup = useMemo(
    () => buildConferenceLookup(leagueData || {}, teams),
    [leagueData, teams]
  );

  const standings = useMemo(
    () =>
      computeCanonicalStandings({
        teams,
        scheduleByDate: schedule,
        resultsById: results,
        confOf: (teamName) =>
          conferenceLookup.get(normalizeStandingsTeamName(teamName)) || "",
      }),
    [teams, schedule, results, conferenceLookup]
  );

  const selectedTeamName = selectedTeam?.name || "";
  const teamIdentity = useMemo(() => splitTeamIdentity(selectedTeam || {}), [selectedTeam]);

  const selectedGames = useMemo(
    () =>
      flatGames.filter(
        (game) => game?.home === selectedTeamName || game?.away === selectedTeamName
      ),
    [flatGames, selectedTeamName]
  );

  const completedGames = useMemo(
    () =>
      selectedGames
        .map((game) => ({ game, score: parseGameScore(game, results) }))
        .filter((entry) => entry.score)
        .sort((a, b) => String(b.game.date || "").localeCompare(String(a.game.date || ""))),
    [selectedGames, results]
  );

  const upcomingGames = useMemo(
    () =>
      selectedGames
        .filter((game) => !parseGameScore(game, results))
        .slice(0, 6),
    [selectedGames, results]
  );

  const selectedStanding = useMemo(() => {
    if (!selectedTeamName) return null;
    return (
      standings?.[selectedTeamName] ||
      Object.values(standings || {}).find(
        (row) =>
          normalizeStandingsTeamName(row?.team) ===
          normalizeStandingsTeamName(selectedTeamName)
      ) ||
      null
    );
  }, [standings, selectedTeamName]);

  const conference = useMemo(
    () =>
      conferenceLookup.get(normalizeStandingsTeamName(selectedTeamName)) ||
      selectedStanding?.conf ||
      selectedTeam?.conference ||
      "",
    [conferenceLookup, selectedStanding, selectedTeam, selectedTeamName]
  );

  const conferenceTeams = useMemo(() => {
    const names = teams
      .filter(
        (team) =>
          (conferenceLookup.get(normalizeStandingsTeamName(teamNameOf(team))) ||
            team?.conference ||
            "") === conference
      )
      .map(teamNameOf)
      .filter(Boolean);

    return names.sort((a, b) => compareCanonicalTeams(a, b, standings));
  }, [teams, conferenceLookup, conference, standings]);

  const leagueOrder = useMemo(
    () => teams.map(teamNameOf).filter(Boolean).sort((a, b) => compareCanonicalTeams(a, b, standings)),
    [teams, standings]
  );

  const conferenceRank = conferenceTeams.indexOf(selectedTeamName) + 1;
  const leagueRank = leagueOrder.indexOf(selectedTeamName) + 1;

  const offenseOrder = useMemo(
    () =>
      Object.values(standings || {})
        .filter((row) => Number(row?.games || row?.gp || 0) > 0)
        .sort(
          (a, b) =>
            Number(b?.pf || 0) / Math.max(1, Number(b?.games || b?.gp || 0)) -
            Number(a?.pf || 0) / Math.max(1, Number(a?.games || a?.gp || 0))
        ),
    [standings]
  );

  const defenseOrder = useMemo(
    () =>
      Object.values(standings || {})
        .filter((row) => Number(row?.games || row?.gp || 0) > 0)
        .sort(
          (a, b) =>
            Number(a?.pa || 0) / Math.max(1, Number(a?.games || a?.gp || 0)) -
            Number(b?.pa || 0) / Math.max(1, Number(b?.games || b?.gp || 0))
        ),
    [standings]
  );

  const offenseRank =
    offenseOrder.findIndex(
      (row) =>
        normalizeStandingsTeamName(row?.team) ===
        normalizeStandingsTeamName(selectedTeamName)
    ) + 1;

  const defenseRank =
    defenseOrder.findIndex(
      (row) =>
        normalizeStandingsTeamName(row?.team) ===
        normalizeStandingsTeamName(selectedTeamName)
    ) + 1;

  const last10 = completedGames.slice(0, 10).reduce(
    (acc, entry) => {
      const { game, score } = entry;
      const selectedIsHome = game.home === selectedTeamName;
      const own = selectedIsHome ? score.home : score.away;
      const opp = selectedIsHome ? score.away : score.home;
      if (own > opp) acc.w += 1;
      else acc.l += 1;
      return acc;
    },
    { w: 0, l: 0 }
  );

  const rotation = useMemo(
    () => (selectedTeam ? readGameplanOrder(selectedTeam) : []),
    [selectedTeam]
  );

  const startingFive = rotation.slice(0, 5);
  const benchFive = rotation.slice(5, 10);
  const displayedRotation = showBench ? benchFive : startingFive;

  const payroll = useMemo(
    () =>
      selectedTeam
        ? getStandardPlayers(selectedTeam).reduce(
            (sum, player) => sum + Number(getPlayerSalary(player, leagueData || {}) || 0),
            0
          )
        : 0,
    [selectedTeam, leagueData]
  );

  const salaryCap = Number(
    leagueData?.salaryCap ??
      leagueData?.capLimit ??
      leagueData?.financialRules?.salaryCap ??
      leagueData?.leagueFinancialRules?.salaryCap ??
      0
  );

  const ownedFirsts = useMemo(() => {
    if (!selectedTeamName) return 0;
    try {
      return collectOwnedPicksForTeam(leagueData || {}, selectedTeamName).filter(
        (pick) => Number(pick?.round || 0) === 1
      ).length;
    } catch {
      return 0;
    }
  }, [leagueData, selectedTeamName]);

  const draftYear = getUpcomingDraftYearForPhase(leagueData || {}, {
    isOffseasonMode: phaseLabel() === "Offseason",
  });

  const topProspects = useMemo(() => {
    const preview = readUpcomingDraftClassForYear(draftYear);
    return Array.isArray(preview?.draftClass) ? preview.draftClass.slice(0, 5) : [];
  }, [draftYear, leagueData]);

  const nextGame = upcomingGames[0] || null;
  const nextOpponentName = nextGame
    ? nextGame.home === selectedTeamName
      ? nextGame.away
      : nextGame.home
    : "";
  const nextOpponent = teamMap.get(nextOpponentName);

  // TEAM HUB GLOBAL SEARCH ACTIONS PASS 25
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(""); };
  const openSearchResult = (result) => {
    if (!result) return;
    if (result.kind === "team" && result.team) {
      setSelectedTeam(result.team);
      closeSearch();
      return;
    }
    if (result.kind === "player" && result.player) {
      setSearchPlayerCard(result);
      closeSearch();
    }
  };
  const firstSearchResult = searchResults.teams[0] || searchResults.players[0] || null;

  if (!selectedTeam) {
    return (
      <PageFade>
        <div className={styles.emptyState}>
          <h1>No team selected</h1>
          <button type="button" onClick={() => navigate("/team-selector")}>
            Choose Team
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className={styles.dashboard}>
        <div className={styles.topBar}>
          <div className={styles.seasonContext}>
            <span className={styles.contextItem}>
              {seasonLabel(leagueData || {})}
              <span className={styles.contextChevron}>⌄</span>
            </span>
          </div>

          <div className={styles.topUtilities}>
            <div className={styles.searchWrap} ref={searchRef} data-teamhub-search-pass="25">
              <label className={`${styles.searchShell} ${searchOpen ? styles.searchShellActive : ""}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16l4 4" />
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search players and teams"
                  aria-expanded={searchOpen && Boolean(searchQuery.trim())}
                  aria-controls="team-hub-search-results"
                  placeholder="Search players, teams, etc..."
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && firstSearchResult) {
                      event.preventDefault();
                      openSearchResult(firstSearchResult);
                    }
                  }}
                />
              </label>

              {searchOpen && searchQuery.trim() ? (
                <div id="team-hub-search-results" className={styles.searchResults} role="listbox">
                  {searchResults.teams.length ? (
                    <div className={styles.searchGroup}>
                      <div className={styles.searchGroupLabel}>Teams</div>
                      {searchResults.teams.map((result) => (
                        <button
                          type="button"
                          className={styles.searchResult}
                          key={`team-${teamNameOf(result.team)}`}
                          onClick={() => openSearchResult(result)}
                        >
                          <span className={styles.searchResultMedia}>
                            <img src={teamLogoOf(result.team)} alt="" />
                          </span>
                          <span className={styles.searchResultCopy}>
                            <strong>{teamNameOf(result.team)}</strong>
                            <small>Open Team Hub</small>
                          </span>
                          <span className={styles.searchResultArrow}>→</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {searchResults.players.length ? (
                    <div className={styles.searchGroup}>
                      <div className={styles.searchGroupLabel}>Players</div>
                      {searchResults.players.map((result) => (
                        <button
                          type="button"
                          className={styles.searchResult}
                          key={`player-${result.teamName}-${result.player?.id ?? result.player?.playerId ?? playerNameOf(result.player)}`}
                          onClick={() => openSearchResult(result)}
                        >
                          <span className={`${styles.searchResultMedia} ${styles.searchPlayerMedia}`}>
                            {playerHeadshotOf(result.player) ? (
                              <img src={playerHeadshotOf(result.player)} alt="" />
                            ) : (
                              <span>{playerNameOf(result.player).slice(0, 1)}</span>
                            )}
                          </span>
                          <span className={styles.searchResultCopy}>
                            <strong>{playerNameOf(result.player)}</strong>
                            <small>
                              {result.player?.pos || result.player?.position || "—"}
                              {result.teamName ? ` · ${result.teamName}` : ""}
                            </small>
                          </span>
                          <span className={styles.searchPlayerOverall}>{playerOverall(result.player)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {!searchResults.teams.length && !searchResults.players.length ? (
                    <div className={styles.searchEmpty}>No matching players or teams.</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className={styles.bellButton}
              title="Notifications"
              aria-label="Notifications"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 9a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                <path d="M10 21h4" />
              </svg>
            </button>
          </div>

        </div>

        <section
          className={styles.teamBanner}
          style={bannerBoxStyle(bannerLayout.banner)}
        >
          <img
            className={styles.bannerWatermark}
            src={teamLogoOf(selectedTeam)}
            alt=""
            aria-hidden="true"
            style={bannerWatermarkStyle(bannerLayout.watermark)}
          />

          <div
            className={styles.teamIdentity}
            style={bannerBlockStyle(bannerLayout.identityBlock)}
          >
            <img
              className={styles.teamLogo}
              src={teamLogoOf(selectedTeam)}
              alt=""
              style={bannerLogoStyle(bannerLayout.logo)}
            />
            <div className={styles.teamWordmark}>
              <div
                className={styles.teamCity}
                style={bannerTextStyle(bannerLayout.teamCity)}
              >
                {teamIdentity.city || selectedTeamName}
              </div>
              <h1 style={bannerTextStyle(bannerLayout.teamName)}>
                {teamIdentity.nickname || selectedTeamName}
              </h1>
            </div>
          </div>

          <div
            className={styles.heroMetric}
            style={bannerBlockStyle(bannerLayout.recordBlock)}
          >
            <span style={bannerTextStyle(bannerLayout.recordLabel)}>Record</span>
            <strong style={bannerTextStyle(bannerLayout.recordValue)}>
              {selectedStanding
                ? `${Number(selectedStanding.wins || 0)} - ${Number(selectedStanding.losses || 0)}`
                : "—"}
            </strong>
            <small style={bannerTextStyle(bannerLayout.recordStanding)}>
              {conferenceRank > 0 ? `${ordinal(conferenceRank)} in ${conference || "Conference"}` : "—"}
            </small>
          </div>

          <div
            className={styles.heroMetric}
            style={bannerBlockStyle(bannerLayout.last10Block)}
          >
            <span style={bannerTextStyle(bannerLayout.last10Label)}>Last 10</span>
            <strong style={bannerTextStyle(bannerLayout.last10Value)}>
              {completedGames.length ? `${last10.w} - ${last10.l}` : "—"}
            </strong>
            <small style={bannerTextStyle(bannerLayout.last10Subtext)}>
              {completedGames.length ? `${Math.min(10, completedGames.length)} games` : "No results yet"}
            </small>
          </div>

          <div
            className={styles.nextGame}
            style={bannerBlockStyle(bannerLayout.nextGameBlock)}
          >
            <div>
              <span style={bannerTextStyle(bannerLayout.nextGameLabel)}>Next Game</span>
              <strong style={bannerTextStyle(bannerLayout.nextGameValue)}>
                {nextOpponentName ? `vs ${teamAbbr(nextOpponent || { name: nextOpponentName })}` : "—"}
              </strong>
            </div>
            {nextOpponentName ? (
              <img
                src={teamLogoOf(nextOpponent || {})}
                alt=""
                style={bannerLogoStyle(bannerLayout.nextGameLogo)}
              />
            ) : null}
            <small
              style={bannerTextStyle(nextGame ? bannerLayout.nextGameDate : bannerLayout.nextGameEmpty)}
            >
              {nextGame ? formatGameDate(nextGame.date) : "No game scheduled"}
            </small>
          </div>
        </section>

        <div className={styles.topGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Upcoming Games</h2>
              <button type="button" onClick={() => navigate("/calendar")}>View Calendar →</button>
            </div>
            <div className={styles.gameList}>
              {upcomingGames.length ? upcomingGames.map((game) => {
                const isHome = game.home === selectedTeamName;
                const opponentName = isHome ? game.away : game.home;
                const opponent = teamMap.get(opponentName) || {};
                const opponentStanding = standings?.[opponentName];
                return (
                  <div className={styles.gameRow} key={game.id || `${game.date}-${opponentName}`}>
                    <span>{formatGameDate(game.date)}</span>
                    <span className={styles.homeAway}>{isHome ? "vs" : "@"}</span>
                    <img src={teamLogoOf(opponent)} alt="" />
                    <strong>{teamAbbr(opponent || { name: opponentName })}</strong>
                    <em>
                      {opponentStanding
                        ? `${Number(opponentStanding.wins || 0)} - ${Number(opponentStanding.losses || 0)}`
                        : "—"}
                    </em>
                  </div>
                );
              }) : <div className={styles.emptyPanel}>No upcoming regular-season games.</div>}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Team Overview</h2>
            </div>
            <div className={styles.metricList}>
              <div><span>Record</span><strong>{selectedStanding ? `${selectedStanding.wins}-${selectedStanding.losses}` : "—"}</strong></div>
              <div><span>Conference Rank</span><strong>{conferenceRank > 0 ? ordinal(conferenceRank) : "—"}</strong></div>
              <div><span>Offensive Rank</span><strong>{offenseRank > 0 ? ordinal(offenseRank) : "—"}</strong></div>
              <div><span>Defensive Rank</span><strong>{defenseRank > 0 ? ordinal(defenseRank) : "—"}</strong></div>
              <div><span>Roster Count</span><strong>{getStandardPlayers(selectedTeam).length}</strong></div>
              <div><span>Payroll</span><strong>{formatMoney(payroll)}</strong></div>
              <div><span>Cap Space</span><strong>{salaryCap ? formatMoney(salaryCap - payroll) : "—"}</strong></div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Standings</h2>
              <button type="button" onClick={() => navigate("/standings")}>Full Standings →</button>
            </div>
            <div className={styles.standingsHeader}>
              <span>#</span><span>Team</span><span>W</span><span>L</span><span>GB</span>
            </div>
            <div className={styles.standingsRows}>
              {conferenceTeams.slice(0, 5).map((name, index) => {
                const row = standings?.[name] || {};
                const team = teamMap.get(name) || {};
                const leader = standings?.[conferenceTeams[0]] || {};
                const leaderPct = Number(leader?.wins || 0) - Number(leader?.losses || 0);
                const rowPct = Number(row?.wins || 0) - Number(row?.losses || 0);
                const gb = index === 0 ? "—" : ((leaderPct - rowPct) / 2).toFixed(1);
                return (
                  <div
                    key={name}
                    className={`${styles.standingRow} ${name === selectedTeamName ? styles.selectedStanding : ""}`}
                  >
                    <span>{index + 1}</span>
                    <span className={styles.standingTeam}>
                      <img src={teamLogoOf(team)} alt="" />
                      {name}
                    </span>
                    <span>{Number(row?.wins || 0)}</span>
                    <span>{Number(row?.losses || 0)}</span>
                    <span>{gb}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className={styles.middleGrid}>
          <section className={`${styles.panel} ${styles.rotationPanel}`}>
            <div className={styles.panelHeading}>
              <h2>{showBench ? "Bench" : "Starting Five"}</h2>
              <div className={styles.panelActions}>
                <button type="button" onClick={() => setShowBench((current) => !current)}>
                  {showBench ? "View Starters" : "View Bench"}
                </button>
                <span />
                <button type="button" onClick={() => navigate("/coach-gameplan")}>
                  Coach Gameplan →
                </button>
              </div>
            </div>

            <div className={styles.playerStrip}>
              {displayedRotation.length ? displayedRotation.map((player) => (
                <button
                  type="button"
                  className={styles.playerCard}
                  key={player?.name}
                  onClick={() => navigate("/roster-view")}
                >
                  <div className={styles.playerVisual}>
                    <div className={styles.playerRatingBadge}>
                      <PlayerRatingRing
                        overall={playerOverall(player)}
                        potential={Number(
                          player?.potential ??
                          player?.pot ??
                          player?.POT ??
                          player?.potentialRating ??
                          player?.ratingPotential ??
                          playerOverall(player)
                        ) || playerOverall(player)}
                        size={58}
                      />
                    </div>
                    <small className={styles.playerPositionBadge}>{player?.pos || "—"}</small>
                    <img className={styles.playerPortrait} src={playerHeadshotOf(player)} alt="" />
                  </div>
                  <div className={styles.playerCardMeta}>
                    <strong>{player?.name}</strong>
                  </div>
                </button>
              )) : <div className={styles.emptyPanel}>No saved rotation available.</div>}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Recent Games</h2>
              <button type="button" onClick={() => navigate("/calendar")}>View Schedule →</button>
            </div>
            <div className={styles.recentList}>
              {completedGames.slice(0, 5).map(({ game, score }) => {
                const isHome = game.home === selectedTeamName;
                const opponentName = isHome ? game.away : game.home;
                const opponent = teamMap.get(opponentName) || {};
                const own = isHome ? score.home : score.away;
                const opp = isHome ? score.away : score.home;
                const won = own > opp;
                return (
                  <div className={styles.recentRow} key={game.id}>
                    <span>{formatGameDate(game.date)}</span>
                    <span>{isHome ? "vs" : "@"}</span>
                    <img src={teamLogoOf(opponent)} alt="" />
                    <strong>{teamAbbr(opponent || { name: opponentName })}</strong>
                    <b className={won ? styles.win : styles.loss}>{won ? "W" : "L"}</b>
                    <em>{own} - {opp}</em>
                  </div>
                );
              })}
              {!completedGames.length ? <div className={styles.emptyPanel}>No completed games yet.</div> : null}
            </div>
          </section>
        </div>

        <div className={styles.bottomGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>Top Prospects</h2>
              <button type="button" onClick={() => navigate("/upcoming-draft")}>View Draft Class →</button>
            </div>
            {topProspects.length ? (
              <div className={styles.prospectGrid}>
                {topProspects.map((prospect, index) => (
                  <div className={styles.prospect} key={prospect?.id || prospect?.name}>
                    <span>{index + 1}</span>
                    {getProspectHeadshot(prospect) ? <img src={getProspectHeadshot(prospect)} alt="" /> : <i />}
                    <strong>{prospect?.name || prospect?.playerName || `Prospect ${index + 1}`}</strong>
                    <small>{prospect?.pos || prospect?.position || "—"}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyPanel}>No draft preview has been generated for {draftYear} yet.</div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <h2>League News</h2>
              <button type="button" onClick={() => navigate("/league-history")}>View All →</button>
            </div>
            <div className={styles.newsEmpty}>
              <strong>No persisted league headlines yet.</strong>
              <span>Trades, signings, awards and other recorded events can populate this panel later.</span>
            </div>
          </section>
        </div>
      </div>

      {searchPlayerCard ? (
        <div data-teamhub-player-search-modal="25">
          <PlayerCardModal
            open={Boolean(searchPlayerCard)}
            player={searchPlayerCard.player}
            teamName={searchPlayerCard.teamName || "Free Agent"}
            teamLogo={searchPlayerCard.teamLogo || ""}
            leagueData={leagueData}
            onClose={() => setSearchPlayerCard(null)}
          />
        </div>
      ) : null}
    </PageFade>
  );
}
