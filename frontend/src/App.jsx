import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import PlayerEditor from "./pages/PlayerEditor.jsx";
import TradeSimulator from "./pages/TradeSimulator.jsx";
import GameSimulator from "./pages/GameSimulator.jsx";
import LeagueEditor from "./pages/LeagueEditor.jsx";
import Play from "./pages/Play.jsx"; // ✅ new
import TeamSelector from "./components/TeamSelector.jsx"; // ✅ will add next
import TeamHub from "./pages/TeamHub.jsx";
import RosterView from "./pages/RosterView.jsx";
import CoachGameplan from "./pages/CoachGameplan.jsx";
import Calendar from "./pages/Calendar.jsx";
import PlayerStats from "./pages/PlayerStats.jsx";
import Standings from "./pages/Standings.jsx";
import Awards from "./pages/Awards"; // ⬅️ add this
import Playoffs from "./pages/Playoffs.jsx";
import FinalsMvp from "./pages/FinalsMVP.jsx";





function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Routes that use your shared Layout */}
        <Route element={<Layout />}>
          <Route index element={<LeagueEditor  />} />
          <Route path="players" element={<PlayerEditor />} />
          <Route path="players/:playerId" element={<PlayerEditor />} />
          <Route path="trade" element={<TradeSimulator />} />
          <Route path="simulate" element={<GameSimulator />} />
          <Route path="league-editor" element={<LeagueEditor />} />
          <Route path="awards" element={<Awards />} />  {/* ✅ no leading slash */}
          <Route path="/finals-mvp" element={<FinalsMvp />} />

        </Route>

        {/* ✅ Standalone full-screen routes */}
        <Route path="/play" element={<Play />} />
        <Route path="/team-selector" element={<TeamSelector />} />
        <Route path="/team-hub" element={<TeamHub />} />
        <Route path="/roster-view" element={<RosterView />} />
        <Route path="/coach-gameplan" element={<CoachGameplan />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/player-stats" element={<PlayerStats />} />
        <Route path="/standings" element={<Standings />} />
        <Route path="/playoffs" element={<Playoffs />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
