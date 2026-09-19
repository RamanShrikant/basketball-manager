// src/components/Layout.jsx
import React from "react";
import { Outlet, Link, NavLink, useLocation } from "react-router-dom";
import samsaraSymbol from "../assets/samsara-studios-symbol.png";
import "./Layout.css";

export default function Layout() {
  const location = useLocation();
  const pathname = location.pathname;

  // Pages where you do NOT want the white header/nav showing
  const hideHeaderRoutes = [
    "/team-selector",
    "/team-hub",
    "/calendar",
    "/awards",
    "/all-nba-teams",
    "/player-stats",
    "/roster-view",
    "/coach-gameplan",
    "/standings",
    "/playoffs",
    "/trade-simulator",
    "/game-simulator",
    "/finals-mvp",
  ];

  const hideHeader = hideHeaderRoutes.some((route) => pathname.startsWith(route));

  return (
    <div className={hideHeader ? "bm-layout bm-layout--immersive" : "bm-layout"}>
      {!hideHeader && (
        <header className="bm-game-header">
          <Link to="/" className="bm-studio-link" aria-label="Back to Samsara Studios home">
            <img src={samsaraSymbol} alt="" className="bm-studio-mark" />
            <span>Samsara Studios</span>
          </Link>

          <div className="bm-game-title">Basketball Manager</div>

          <nav className="bm-game-nav" aria-label="Basketball Manager navigation">
            <NavLink to="/play" className={({ isActive }) => `bm-game-nav-link bm-play-link${isActive ? " is-active" : ""}`}>
              Play
            </NavLink>
          </nav>
        </header>
      )}

      <main className="bm-layout-main">
        <Outlet />
      </main>
    </div>
  );
}