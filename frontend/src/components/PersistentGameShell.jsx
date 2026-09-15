import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext";
import TeamHubSidebar from "./TeamHubSidebar.jsx";
import styles from "./PersistentGameShell.module.css";

const NO_SIDEBAR_ROUTES = new Set([
  "/",
  "/play",
  "/team-selector",
  "/league-editor",
]);

export function shouldShowPersistentSidebar(pathname) {
  return !NO_SIDEBAR_ROUTES.has(pathname);
}

export default function PersistentGameShell({ children }) {
  const { pathname } = useLocation();
  const { selectedTeam } = useGame();
  const showSidebar = shouldShowPersistentSidebar(pathname) && Boolean(selectedTeam);

  useEffect(() => {
    const routeKey = pathname.replace(/^\/+|\/+$/g, "") || "root";

    document.body.dataset.bmRoute = routeKey;
    document.documentElement.dataset.bmRoute = routeKey;

    return () => {
      if (document.body.dataset.bmRoute === routeKey) {
        delete document.body.dataset.bmRoute;
      }
      if (document.documentElement.dataset.bmRoute === routeKey) {
        delete document.documentElement.dataset.bmRoute;
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (!showSidebar) {
      document.body.classList.remove("bm-persistent-sidebar-active");
      return undefined;
    }

    document.body.classList.add("bm-persistent-sidebar-active");
    return () => document.body.classList.remove("bm-persistent-sidebar-active");
  }, [showSidebar]);

  if (!showSidebar) return children;

  return (
    <div className={styles.shell}>
      <TeamHubSidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
