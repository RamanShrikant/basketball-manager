// src/components/Layout.jsx
import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";

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
    <div
      className={`min-h-screen flex flex-col ${
        hideHeader ? "bg-neutral-900 text-white" : "bg-white text-black"
      }`}
    >
      {!hideHeader && (
        <header className="w-full bg-gray-100 border-b border-gray-300 px-6 py-3 flex items-center gap-4">
          <h1 className="text-xl font-bold">Basketball Manager</h1>

          <nav className="flex gap-3 text-sm">
            <Link to="/" className="hover:underline">
              Home
            </Link>
            <Link to="/league-editor" className="hover:underline">
              League Editor
            </Link>
            <Link to="/play" className="hover:underline">
              Play
            </Link>
          </nav>
        </header>
      )}

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
