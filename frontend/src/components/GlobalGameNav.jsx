import React, { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const HIDDEN_ROUTES = new Set(["/", "/league-editor", "/play", "/team-selector", "/team-hub", "/awards"]);

const TEAM_HUB_ROUTES = new Set([
  "/roster-view",
  "/coach-gameplan",
  "/calendar",
  "/player-stats",
  "/playoff-stats",
  "/standings",
  "/power-rankings",
  "/draft-picks",
  "/free-agents",
  "/salary-table",
  "/locker-room",
  "/intel",
  "/trades",
  "/award-tracker",
  "/all-stars",
  "/game-simulator",
  "/simulate",
]);

const OFFSEASON_ROUTES = new Set([
  "/player-team-options",
  "/player-retirements",
  "/draft-lottery",
  "/draft",
  "/rookie-signings",
  "/roster-finalization",
  "/player-progression",
]);


function isOffseasonActive() {
  try {
    const state = JSON.parse(localStorage.getItem("bm_offseason_state_v1") || "{}");
    return Boolean(state?.active);
  } catch {
    return false;
  }
}

function readTradeBuilderReturnPath() {
  try {
    const builder = JSON.parse(localStorage.getItem("bm_trade_builder_v1") || "null");
    if (builder?.returnToTradeFinder || builder?.source === "tradeFinder") return "/trade-finder";
  } catch {}
  return "/trades";
}

function clearTradeBuilderSession() {
  localStorage.removeItem("bm_trade_builder_v1");
  sessionStorage.removeItem("bm_trade_builder_resume_v1");
}

function routeConfig(pathname) {
  if (HIDDEN_ROUTES.has(pathname)) return null;

  if (pathname === "/trade-finder") {
    return { primaryPath: "/trades", primaryLabel: "Trade Center", showHub: true };
  }

  if (pathname === "/propose-trade") {
    const primaryPath = readTradeBuilderReturnPath();
    return {
      primaryPath,
      primaryLabel: primaryPath === "/trade-finder" ? "Trade Finder" : "Trade Center",
      showHub: true,
    };
  }

  if (pathname === "/trade-player-select" || pathname === "/trade-pick-select") {
    return { primaryPath: "/propose-trade", primaryLabel: "Trade Builder", showHub: true };
  }

  if (pathname === "/viewing-offers") {
    return { primaryPath: "/free-agents", primaryLabel: "Free Agency", showHub: true };
  }

  if (pathname === "/free-agents" && isOffseasonActive()) {
    return { primaryPath: "/offseason", primaryLabel: "Offseason Hub", showHub: true };
  }

  if (pathname === "/offseason") {
    return { primaryPath: "/team-hub", primaryLabel: "Team Hub", showHub: false };
  }

  if (OFFSEASON_ROUTES.has(pathname)) {
    return { primaryPath: "/offseason", primaryLabel: "Offseason Hub", showHub: true };
  }

  if (pathname === "/playoffs") {
    return { primaryPath: "/team-hub", primaryLabel: "Team Hub", showHub: false };
  }

  if (pathname === "/finals-mvp") {
    return { primaryPath: "/playoffs", primaryLabel: "Playoffs", showHub: true };
  }

  if (TEAM_HUB_ROUTES.has(pathname) || pathname.startsWith("/players")) {
    return { primaryPath: "/team-hub", primaryLabel: "Team Hub", showHub: false };
  }

  return { primaryPath: "/team-hub", primaryLabel: "Team Hub", showHub: false };
}

function shouldIgnoreShortcut(event) {
  const tag = String(event?.target?.tagName || "").toLowerCase();
  if (["input", "select", "textarea", "button"].includes(tag)) return true;
  if (event?.target?.isContentEditable) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return false;
}

export default function GlobalGameNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const config = useMemo(() => routeConfig(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!config) return undefined;

    const markDuplicateBackControls = () => {
      document.querySelectorAll("button, a").forEach((element) => {
        if (element.closest(".bmGlobalRouteNav")) return;
        const label = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const isBackLabel = /^←?\s*Back(?:\s+to\s+.+)?$/i.test(label);
        const isCompactParentLink = /^←\s*(Team Hub|Trade Center|Trade Finder|Trade Builder|Offseason(?: Hub)?|Playoffs|Free Agency)$/i.test(label);
        if (!isBackLabel && !isCompactParentLink) return;
        if (/save|continue|finalize|advance/i.test(label)) return;
        element.classList.add("bmLegacyRouteBack");
      });
    };

    markDuplicateBackControls();
    const observer = new MutationObserver(markDuplicateBackControls);
    observer.observe(document.getElementById("root") || document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [config, location.pathname]);

  useEffect(() => {
    if (!config) return undefined;

    const onKeyDown = (event) => {
      if (shouldIgnoreShortcut(event)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        if (location.pathname === "/trade-player-select" || location.pathname === "/trade-pick-select") {
          sessionStorage.setItem("bm_trade_builder_resume_v1", String(Date.now()));
          navigate("/propose-trade", { state: { resumeTradeBuilder: true } });
        } else {
          if (location.pathname === "/propose-trade") clearTradeBuilderSession();
          navigate(config.primaryPath);
        }
        return;
      }

      if ((event.key === "h" || event.key === "H") && config.showHub) {
        event.preventDefault();
        navigate("/team-hub");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [config, navigate, location.pathname]);

  if (!config) return null;

  return (
    <nav className={`bmGlobalRouteNav ${location.pathname === "/calendar" ? "bmGlobalRouteNavCalendar" : ""}`} aria-label="Game navigation">
      <div className="bmGlobalRouteNavInner">
        <button
          type="button"
          className="bmGlobalRouteNavButton"
          onClick={() => {
            if (location.pathname === "/trade-player-select" || location.pathname === "/trade-pick-select") {
              sessionStorage.setItem("bm_trade_builder_resume_v1", String(Date.now()));
              navigate("/propose-trade", { state: { resumeTradeBuilder: true } });
              return;
            }
            if (location.pathname === "/propose-trade") clearTradeBuilderSession();
            navigate(config.primaryPath);
          }}
          title={`Back to ${config.primaryLabel}`}
        >
          <span aria-hidden="true">←</span>
          <span>{config.primaryLabel}</span>
        </button>

        {config.showHub && (
          <button
            type="button"
            className="bmGlobalRouteNavButton bmGlobalRouteNavButtonSecondary"
            onClick={() => {
              if (["/propose-trade", "/trade-player-select", "/trade-pick-select"].includes(location.pathname)) {
                clearTradeBuilderSession();
              }
              navigate("/team-hub");
            }}
            title="Open Team Hub"
          >
            <span>Team Hub</span>
          </button>
        )}
      </div>
    </nav>
  );
}
