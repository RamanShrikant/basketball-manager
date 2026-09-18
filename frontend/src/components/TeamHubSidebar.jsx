import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import { playSound, SOUND_KEYS } from "../audio/soundManager.js";
import {
  isAllStarsAvailable,
  readOffseasonState as readAllStarsOffseasonState,
  readSavedAllStars,
} from "../utils/allStarsAvailability";
import {
  getUpcomingDraftYearForPhase,
  isDraftStartedForYear,
} from "../utils/upcomingDraftClass.js";
import styles from "./TeamHubSidebar.module.css";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const POSTSEASON_KEY = "bm_postseason_v2";
const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";
const TEAM_HUB_RETURN_CONTEXT_KEY = "bm_team_hub_return_context_v1";
const TRADE_BUILDER_RESUME_KEY = "bm_trade_builder_resume_v1";
const TRADE_FLOW_ROUTES = new Set([
  "/propose-trade",
  "/trade-player-select",
  "/trade-pick-select",
]);

const LABEL_OVERRIDES = {
  "View Roster": "Roster",
  "Free Agents": "Free Agency",
  Statistics: "Stats",
  "View All-Stars": "All-Stars",
  "Return to Offseason Hub": "Offseason Hub",
  "Return to Playoffs": "Playoffs",
};

const ICON_BY_ITEM = {
  Schedule: "calendar",
  "Return to Offseason Hub": "calendar",
  "Return to Playoffs": "bracket",
  "View Roster": "users",
  "Coach Gameplan": "clipboard",
  Statistics: "chart",
  "Playoff Statistics": "chart",
  Trades: "swap",
  "Free Agents": "userSearch",
  "Draft Picks": "ticket",
  "Salary Table": "wallet",
  "Contract Extensions": "file",
  Standings: "standings",
  "Playoff Picture": "bracket",
  "Power Rankings": "trend",
  "Locker Room": "users",
  "Team Intel": "eye",
  "Upcoming Draft": "search",
  "Award Tracker": "award",
  "View All-Stars": "star",
  "Transaction History": "clock",
  "Award History": "trophy",
  "Past Champions": "crown",
  "League Editor": "edit",
  Settings: "gear",
};

const ACTIVE_ROUTE_ALIASES = {
  "/roster-view": "View Roster",
  "/coach-gameplan": "Coach Gameplan",
  "/calendar": "Schedule",
  "/player-stats": "Statistics",
  "/playoff-stats": "Playoff Statistics",
  "/standings": "Standings",
  "/playoff-picture": "Playoff Picture",
  "/power-rankings": "Power Rankings",
  "/draft-picks": "Draft Picks",
  "/salary-table": "Salary Table",
  "/contract-extensions": "Contract Extensions",
  "/free-agents": "Free Agents",
  "/viewing-offers": "Free Agents",
  "/trades": "Trades",
  "/trade-finder": "Trades",
  "/propose-trade": "Trades",
  "/trade-player-select": "Trades",
  "/trade-pick-select": "Trades",
  "/locker-room": "Locker Room",
  "/intel": "Team Intel",
  "/upcoming-draft": "Upcoming Draft",
  "/draft-lottery": "Upcoming Draft",
  "/draft": "Upcoming Draft",
  "/rookie-signings": "Upcoming Draft",
  "/roster-finalization": "Upcoming Draft",
  "/award-tracker": "Award Tracker",
  "/all-stars": "View All-Stars",
  "/league-history": "Transaction History",
  "/award-history": "Award History",
  "/past-champions": "Past Champions",
  "/league-editor": "League Editor",
  "/settings": "Settings",
};

function safeJSON(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {}

  try {
    const source = raw.startsWith("lz:") ? raw.slice(3) : raw;
    const decompressed = LZString.decompressFromUTF16(source);
    if (!decompressed) return fallback;
    const parsed = JSON.parse(decompressed);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getOffseasonFreeAgencyReturnPath(liveLeagueData = null) {
  const lastRoute = localStorage.getItem(FREE_AGENCY_LAST_ROUTE_KEY);
  if (lastRoute !== "/viewing-offers") return "/free-agents";

  // leagueData localStorage is intentionally only an IndexedDB pointer in modern
  // saves. Prefer GameContext's live league so pending FA decisions are visible.
  const fallbackLeagueData = safeJSON(localStorage.getItem("leagueData"), null);
  const resolvedLeagueData =
    liveLeagueData && typeof liveLeagueData === "object"
      ? liveLeagueData
      : fallbackLeagueData;
  const freeAgencyState = resolvedLeagueData?.freeAgencyState || {};

  const pendingUserDecisionCount = Array.isArray(freeAgencyState?.pendingUserDecisions)
    ? freeAgencyState.pendingUserDecisions.length
    : 0;
  const pendingRfaDecisionCount = Array.isArray(freeAgencyState?.pendingRfaMatchDecisions)
    ? freeAgencyState.pendingRfaMatchDecisions.length
    : 0;
  const hasLatestResults = Boolean(freeAgencyState?.latestResults);
  const marketIsActive = Boolean(freeAgencyState?.isActive);
  const currentDay = Number(freeAgencyState?.currentDay || 0);
  const maxDays = Number(freeAgencyState?.maxDays || 0);
  const marketComplete = Boolean(
    freeAgencyState?.marketComplete ||
      freeAgencyState?.freeAgencyComplete ||
      freeAgencyState?.completed ||
      freeAgencyState?.isComplete ||
      freeAgencyState?.status === "complete" ||
      (!marketIsActive && maxDays > 0 && currentDay >= maxDays)
  );

  if (marketComplete && pendingUserDecisionCount === 0 && pendingRfaDecisionCount === 0) {
    return "/free-agents";
  }

  if (pendingUserDecisionCount > 0 || pendingRfaDecisionCount > 0 || hasLatestResults) {
    return "/viewing-offers";
  }

  return "/free-agents";
}

function clearTradeBuilderResumeWhenLeaving(currentPath, nextPath) {
  if (!TRADE_FLOW_ROUTES.has(currentPath) || TRADE_FLOW_ROUTES.has(nextPath)) return;
  try {
    sessionStorage.removeItem(TRADE_BUILDER_RESUME_KEY);
  } catch {}
}

function sectionReturnPayload(section, mode = {}) {
  if (!section) return null;
  return {
    section,
    label: section,
    offseasonMode: Boolean(mode.isOffseasonMode),
    playoffMode: Boolean(mode.isPlayoffMode),
    returnTo: mode.offseasonReturnTo || null,
    playoffReturnTo: mode.playoffReturnTo || null,
    updatedAt: Date.now(),
  };
}

function writeTeamHubReturnContext(payload) {
  try {
    if (!payload?.section) {
      sessionStorage.removeItem(TEAM_HUB_RETURN_CONTEXT_KEY);
      return;
    }
    sessionStorage.setItem(TEAM_HUB_RETURN_CONTEXT_KEY, JSON.stringify(payload));
  } catch {}
}

function SidebarIcon({ type = "dot" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  switch (type) {
    case "home":
      return <svg {...common}><path d="M3.5 10.8 12 3.8l8.5 7" /><path d="M5.5 9.7V20h13V9.7" /><path d="M9.3 20v-6.2h5.4V20" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3.1 2.4-5 5.5-5s5 1.9 5.5 5" /><path d="M15.5 6.2a2.7 2.7 0 0 1 0 5.2" /><path d="M16.5 14.1c2.3.5 3.7 2.1 4 4.4" /></svg>;
    case "clipboard":
      return <svg {...common}><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="M8.5 10h7M8.5 14h7M8.5 18h4.5" /></svg>;
    case "swap":
      return <svg {...common}><path d="M4 7h13" /><path d="m14 4 3 3-3 3" /><path d="M20 17H7" /><path d="m10 14-3 3 3 3" /></svg>;
    case "userSearch":
      return <svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3.8 18.5c.5-3.1 2.2-4.8 5.2-4.8 1.8 0 3.2.6 4.1 1.7" /><circle cx="16.8" cy="16.8" r="3.1" /><path d="m19.1 19.1 2 2" /></svg>;
    case "ticket":
      return <svg {...common}><path d="M4 7.2h16v3a2 2 0 0 0 0 3.6v3H4v-3a2 2 0 0 0 0-3.6z" /><path d="M12 8.8v6.4" /></svg>;
    case "wallet":
      return <svg {...common}><path d="M4 6.5h14.5A1.5 1.5 0 0 1 20 8v9.5H5.5A1.5 1.5 0 0 1 4 16z" /><path d="M4 8.5V6a2 2 0 0 1 2-2h10" /><path d="M15.5 11h4.5v3.5h-4.5a1.75 1.75 0 1 1 0-3.5Z" /></svg>;
    case "file":
      return <svg {...common}><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4" /><path d="M9 12h6M9 15.5h6" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3.5" y="5.2" width="17" height="15" rx="2" /><path d="M7.5 3v4.2M16.5 3v4.2M3.5 9h17" /><path d="M7.5 12.5h2M12 12.5h2M16.5 12.5h.1M7.5 16.5h2M12 16.5h2" /></svg>;
    case "standings":
      return <svg {...common}><path d="M4 20V12h4v8M10 20V7h4v13M16 20V4h4v16" /><path d="M3 20.5h18" /></svg>;
    case "bracket":
      return <svg {...common}><path d="M5 4v5h5M5 20v-5h5M19 7v10M10 9v6h5M15 12h4" /></svg>;
    case "trend":
      return <svg {...common}><path d="M4 18 9 13l3.5 3.5L20 8" /><path d="M15.5 8H20v4.5" /></svg>;
    case "chart":
      return <svg {...common}><path d="M5 20V11M10 20V6M15 20v-7M20 20V4" /><path d="M3 20.5h19" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2.8 12s3.3-5.5 9.2-5.5S21.2 12 21.2 12 17.9 17.5 12 17.5 2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>;
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>;
    case "award":
      return <svg {...common}><circle cx="12" cy="9" r="5" /><path d="m9 13-1.5 7 4.5-2 4.5 2-1.5-7" /></svg>;
    case "star":
      return <svg {...common}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>;
    case "trophy":
      return <svg {...common}><path d="M8 4h8v4.5a4 4 0 0 1-8 0Z" /><path d="M8 6H4v1.5A4.5 4.5 0 0 0 8.5 12M16 6h4v1.5a4.5 4.5 0 0 1-4.5 4.5" /><path d="M12 12.5V17M8.5 20h7M10 17h4" /></svg>;
    case "crown":
      return <svg {...common}><path d="m4 8 4 4 4-7 4 7 4-4-2 10H6Z" /><path d="M6 18h12" /></svg>;
    case "edit":
      return <svg {...common}><path d="M5 19h4l10-10-4-4L5 15z" /><path d="m13.8 6.2 4 4M5 19l-.5-4" /></svg>;
    case "gear":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="7" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
  }
}

function GroupChevron({ collapsed }) {
  return (
    <svg className={styles.groupChevron} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={collapsed ? "M5.5 7.5 10 12l4.5-4.5" : "M5.5 12.5 10 8l4.5 4.5"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function decorate(items, sectionKey) {
  return (items || []).map((item) => ({
    ...item,
    sectionKey,
    sidebarLabel: LABEL_OVERRIDES[item.name] || item.name,
    icon: ICON_BY_ITEM[item.name] || "dot",
  }));
}

export default function TeamHubSidebar() {
  const { leagueData } = useGame();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {});
  const postseasonState = safeJSON(localStorage.getItem(POSTSEASON_KEY), null);

  const isOffseasonMode = Boolean(location.state?.offseasonMode || offseasonState?.active);
  const isPlayoffMode = Boolean(
    !isOffseasonMode && (location.state?.playoffMode || postseasonState)
  );

  const offseasonReturnTo = location.state?.returnTo || "/offseason";
  const playoffReturnTo = location.state?.playoffReturnTo || "/playoffs";
  const offseasonFreeAgentsPath = getOffseasonFreeAgencyReturnPath(leagueData);

  const savedAllStars = readSavedAllStars();
  const upcomingDraftYear = getUpcomingDraftYearForPhase(leagueData || {}, {
    isOffseasonMode,
  });
  const upcomingDraftAvailable = Boolean(
    leagueData && !isDraftStartedForYear(upcomingDraftYear, leagueData)
  );
  const allStarsAvailable = isAllStarsAvailable({
    leagueData,
    offseasonState: readAllStarsOffseasonState(),
    data: savedAllStars,
  });

  const firstMainItem = isOffseasonMode
    ? {
        name: "Return to Offseason Hub",
        path: offseasonReturnTo,
        enabled: true,
        description: "Resume Offseason Flow",
      }
    : isPlayoffMode
    ? {
        name: "Return to Playoffs",
        path: playoffReturnTo,
        enabled: true,
        description: "Resume Playoff Bracket",
      }
    : {
        name: "Schedule",
        path: "/calendar",
        enabled: true,
        description: "Calendar and Season Simulation",
      };

  const sectionTiles = {
    Team: [
      { name: "View Roster", path: "/roster-view", enabled: true },
      { name: "Coach Gameplan", path: "/coach-gameplan", enabled: true },
    ],
    Stats: [
      { name: "Statistics", path: "/player-stats", enabled: true },
      {
        name: "Playoff Statistics",
        path: isPlayoffMode || isOffseasonMode ? "/playoff-stats" : "#",
        enabled: isPlayoffMode || isOffseasonMode,
      },
    ],
    "Front Office": [
      { name: "Trades", path: "/trades", enabled: !isPlayoffMode },
      {
        name: "Free Agents",
        path: isOffseasonMode ? offseasonFreeAgentsPath : "/free-agents",
        enabled: !isPlayoffMode,
      },
      { name: "Draft Picks", path: "/draft-picks", enabled: true },
      { name: "Salary Table", path: "/salary-table", enabled: true },
      {
        name: "Contract Extensions",
        path: "/contract-extensions",
        enabled: !isPlayoffMode && !isOffseasonMode,
        description: isOffseasonMode
          ? "Reopens When the Next Season Starts"
          : "Eligibility, Negotiations, and Future Payroll",
      },
    ],
    Season: [
      { name: "Standings", path: "/standings", enabled: true },
      { name: "Playoff Picture", path: "/playoff-picture", enabled: true },
      { name: "Power Rankings", path: "/power-rankings", enabled: true },
    ],
    Scouting: [
      { name: "Locker Room", path: "/locker-room", enabled: true },
      { name: "Team Intel", path: "/intel", enabled: true },
      {
        name: "Upcoming Draft",
        path: upcomingDraftAvailable ? "/upcoming-draft" : "#",
        enabled: upcomingDraftAvailable,
        description: upcomingDraftAvailable
          ? "Prospects, Rankings, and Scouting Reports"
          : "Reopens When the Next Season Starts",
      },
    ],
    Awards: [
      { name: "Award Tracker", path: "/award-tracker", enabled: true },
      {
        name: "View All-Stars",
        path: allStarsAvailable ? "/all-stars" : "#",
        enabled: allStarsAvailable,
      },
    ],
    "League History": [
      { name: "Transaction History", path: "/league-history", enabled: true },
      { name: "Award History", path: "/award-history", enabled: true },
      { name: "Past Champions", path: "/past-champions", enabled: true },
    ],
  };

  const groups = useMemo(
    () => [
      { key: "team", label: "Team", items: decorate(sectionTiles.Team, "Team") },
      {
        key: "front-office",
        label: "Front Office",
        items: decorate(sectionTiles["Front Office"], "Front Office"),
      },
      {
        key: "season",
        label: "Season",
        items: [
          {
            ...firstMainItem,
            sectionKey: null,
            sidebarLabel: LABEL_OVERRIDES[firstMainItem.name] || firstMainItem.name,
            icon: ICON_BY_ITEM[firstMainItem.name] || "calendar",
          },
          ...decorate(sectionTiles.Season, "Season"),
        ],
      },
      { key: "stats", label: "Stats", items: decorate(sectionTiles.Stats, "Stats") },
      { key: "scouting", label: "Scouting", items: decorate(sectionTiles.Scouting, "Scouting") },
      { key: "awards", label: "Awards", items: decorate(sectionTiles.Awards, "Awards") },
      {
        key: "history",
        label: "History",
        items: decorate(sectionTiles["League History"], "League History"),
      },
      {
        key: "system",
        label: "System",
        items: [
          {
            name: "League Editor",
            sidebarLabel: "League Editor",
            path: "/league-editor",
            enabled: true,
            sectionKey: null,
            icon: "edit",
          },
          {
            name: "Settings",
            sidebarLabel: "Settings",
            path: "/settings",
            enabled: true,
            sectionKey: null,
            icon: "gear",
          },
        ],
      },
    ],
    [
      allStarsAvailable,
      firstMainItem.name,
      firstMainItem.path,
      isOffseasonMode,
      isPlayoffMode,
      offseasonFreeAgentsPath,
      upcomingDraftAvailable,
    ]
  );

  const activeName =
    location.pathname === "/team-hub"
      ? "Team Hub"
      : ACTIVE_ROUTE_ALIASES[location.pathname] || "";

  const navigateItem = (item) => {
    if (!item?.enabled || !item?.path || item.path === "#") return;
    playSound(SOUND_KEYS.SIDEBAR_NAVIGATION);

    const hubReturnContext = item.sectionKey
      ? sectionReturnPayload(item.sectionKey, {
          isOffseasonMode,
          isPlayoffMode,
          offseasonReturnTo,
          playoffReturnTo,
        })
      : null;

    writeTeamHubReturnContext(hubReturnContext);
    clearTradeBuilderResumeWhenLeaving(location.pathname, item.path);

    const navState = {
      ...(isOffseasonMode ? { offseasonMode: true, returnTo: offseasonReturnTo } : {}),
      ...(isPlayoffMode ? { playoffMode: true, playoffReturnTo } : {}),
      ...(hubReturnContext
        ? {
            hubSection: hubReturnContext.section,
            hubSectionLabel: hubReturnContext.label,
          }
        : {}),
    };

    navigate(item.path, {
      state: Object.keys(navState).length ? navState : undefined,
    });
  };

  const navigateHome = () => {
    playSound(SOUND_KEYS.SIDEBAR_NAVIGATION);
    clearTradeBuilderResumeWhenLeaving(location.pathname, "/team-hub");
    writeTeamHubReturnContext(null);
    navigate("/team-hub");
  };

  const toggleGroup = (key) => {
    playSound(SOUND_KEYS.SIDEBAR_NAVIGATION);
    setCollapsedGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  return (
    <aside className={styles.sidebar} aria-label="Basketball Manager navigation">
      <div className={styles.brand}>
        <div className={styles.monogram}>BM</div>
        <div className={styles.brandWords} aria-label="Basketball Manager">
          <span>BASKETBALL</span>
          <span>MANAGER</span>
        </div>
      </div>

      <div className={styles.navViewport}>
        <button
          type="button"
          className={`${styles.navItem} ${activeName === "Team Hub" ? styles.navItemActive : ""}`}
          style={activeName === "Team Hub" ? { borderColor: "rgba(249, 115, 22, 0.55)", boxShadow: "none" } : undefined}
          onClick={navigateHome}
          aria-current={activeName === "Team Hub" ? "page" : undefined}
        >
          <span className={styles.icon}><SidebarIcon type="home" /></span>
          <span>Team Hub</span>
        </button>

        {groups.map((group) => {
          const collapsed = Boolean(collapsedGroups[group.key]);

          return (
            <section key={group.key} className={styles.group}>
              <button
                type="button"
                className={styles.groupHeader}
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!collapsed}
                aria-controls={`bm-sidebar-${group.key}`}
              >
                <span>{group.label}</span>
                <GroupChevron collapsed={collapsed} />
              </button>

              {!collapsed && (
                <div id={`bm-sidebar-${group.key}`} className={styles.groupItems}>
                  {group.items.map((item) => {
                    const enabled = Boolean(item?.enabled && item?.path && item.path !== "#");
                    const active = activeName === item.name;

                    return (
                      <button
                        key={`${group.key}-${item.name}`}
                        type="button"
                        className={`${styles.navItem} ${active ? styles.navItemActive : ""} ${!enabled ? styles.navItemDisabled : ""}`}
                        style={active ? { borderColor: "rgba(249, 115, 22, 0.55)", boxShadow: "none" } : undefined}
                        onClick={() => enabled && navigateItem(item)}
                        disabled={!enabled}
                        aria-current={active ? "page" : undefined}
                        title={!enabled ? (item.description || `${item.sidebarLabel} is unavailable right now`) : item.sidebarLabel}
                      >
                        <span className={styles.icon}><SidebarIcon type={item.icon} /></span>
                        <span className={styles.label}>{item.sidebarLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
