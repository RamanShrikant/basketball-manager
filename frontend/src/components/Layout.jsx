// src/components/Layout.jsx
import React from "react";
import { Outlet, Link } from "react-router-dom";

export default function Layout() {
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      {/* simple nav just like the old white screen */}
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

      <main className="flex-1">
        {/* 👇 this renders your Home, LeagueEditor, etc */}
        <Outlet />
      </main>
    </div>
  );
}
