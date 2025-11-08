import { NavLink, Outlet } from "react-router-dom";

const activeLink = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-blue-50"
  }`;

function Layout() {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-semibold text-slate-900">
            Basketball Manager
          </h1>
          <nav className="flex gap-2">
            <NavLink to="/" end className={activeLink}>
              Home
            </NavLink>
            <NavLink to="/players" className={activeLink}>
              Player Editor
            </NavLink>
            <NavLink to="/trade" className={activeLink}>
              Trade Simulator
            </NavLink>
            <NavLink to="/simulate" className={activeLink}>
              Game Simulator
            </NavLink>
            <NavLink to="/league-editor" className={activeLink}>
              League Editor
            </NavLink>

            {/* ✅ New Play button */}
            <NavLink to="/play" className={activeLink}>
              Play
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
