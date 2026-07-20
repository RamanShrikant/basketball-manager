import { useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import PlayerEditor from "./pages/PlayerEditor.jsx";
import TradeSimulator from "./pages/TradeSimulator.jsx";
import GameSimulator from "./pages/GameSimulator.jsx";
import LeagueEditor from "./pages/LeagueEditor.jsx";
import Play from "./pages/Play.jsx";
import TeamSelector from "./components/TeamSelector.jsx";
import TeamHub from "./pages/TeamHub.jsx";
import RosterView from "./pages/RosterView.jsx";
import CoachGameplan from "./pages/CoachGameplan.jsx";
import Calendar from "./pages/Calendar.jsx";
import PlayerStats from "./pages/PlayerStats.jsx";
import Standings from "./pages/Standings.jsx";
import Awards from "./pages/Awards";
import Playoffs from "./pages/Playoffs.jsx";
import FinalsMvp from "./pages/FinalsMVP.jsx";
import PlayerProgression from "./pages/PlayerProgression";
import SalaryTable from "./pages/SalaryTable.jsx";
import FreeAgents from "./pages/FreeAgents.jsx";
import OffseasonHub from "./pages/OffseasonHub";
import PlayerRetirements from "./pages/PlayerRetirements";
import PlayerTeamOptions from "./pages/PlayerTeamOptions";
import AwardTracker from "./pages/AwardTracker.jsx";
import ViewingOffers from "./pages/ViewingOffers.jsx";
import DraftLottery from "./pages/DraftLottery.jsx";
import Draft from "./pages/Draft.jsx";
import RookieSignings from "./pages/RookieSignings.jsx";
import RosterFinalization from "./pages/RosterFinalization.jsx";
import PowerRankings from "./pages/PowerRankings.jsx";
import DraftPicks from "./pages/DraftPicks.jsx";
import Trades from "./pages/Trades.jsx";
import ProposeTrade from "./pages/ProposeTrade.jsx";
import TradePlayerSelect from "./pages/TradePlayerSelect.jsx";
import TradePickSelect from "./pages/TradePickSelect.jsx";
import TradeFinder from "./pages/TradeFinder.jsx";
import LockerRoom from "./pages/LockerRoom.jsx";
import Intel from "./pages/Intel_v1.jsx";
import GlobalGameNav from "./components/GlobalGameNav.jsx";

function RouteDensitySync() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const routeName =
      pathname === "/"
        ? "league-editor"
        : pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";

    document.documentElement.dataset.bmRoute = routeName;
    document.body.dataset.bmRoute = routeName;

    return () => {
      if (document.documentElement.dataset.bmRoute === routeName) {
        delete document.documentElement.dataset.bmRoute;
      }
      if (document.body.dataset.bmRoute === routeName) {
        delete document.body.dataset.bmRoute;
      }
    };
  }, [pathname]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <RouteDensitySync />
      <GlobalGameNav />
      <Routes>
        {/* ✅ Routes that use your shared Layout */}
        <Route element={<Layout />}>
          <Route index element={<LeagueEditor />} />
          <Route path="players" element={<PlayerEditor />} />
          <Route path="players/:playerId" element={<PlayerEditor />} />
          <Route path="trade" element={<TradeSimulator />} />
          <Route path="simulate" element={<GameSimulator />} />
          <Route path="league-editor" element={<LeagueEditor />} />
          <Route path="awards" element={<Awards />} />
          <Route path="/finals-mvp" element={<FinalsMvp />} />
        </Route>

        {/* ✅ Standalone full-screen routes */}
        <Route path="/play" element={<Play />} />
        <Route path="/team-selector" element={<TeamSelector />} />
        <Route path="/team-hub" element={<TeamHub />} />
        <Route path="/roster-view" element={<RosterView />} />
        <Route path="/coach-gameplan" element={<CoachGameplan />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/player-stats" element={<PlayerStats scope="regular" />} />
        <Route path="/playoff-stats" element={<PlayerStats scope="playoffs" />} />
        <Route path="/draft-lottery" element={<DraftLottery />} />
        <Route path="/draft" element={<Draft />} />
        <Route path="/rookie-signings" element={<RookieSignings />} />
        <Route path="/roster-finalization" element={<RosterFinalization />} />
        <Route path="/standings" element={<Standings />} />
        <Route path="/power-rankings" element={<PowerRankings />} />
        <Route path="/draft-picks" element={<DraftPicks />} />
        <Route path="/trades" element={<Trades />} />
        <Route path="/propose-trade" element={<ProposeTrade />} />
        <Route path="/trade-player-select" element={<TradePlayerSelect />} />
        <Route path="/trade-pick-select" element={<TradePickSelect />} />
        <Route path="/trade-finder" element={<TradeFinder />} />
        <Route path="/locker-room" element={<LockerRoom />} />
        <Route path="/intel" element={<Intel />} />
        <Route path="/playoffs" element={<Playoffs />} />
        <Route path="/player-progression" element={<PlayerProgression />} />
        <Route path="salary-table" element={<SalaryTable />} />
        <Route path="/free-agents" element={<FreeAgents />} />
        <Route path="/award-tracker" element={<AwardTracker />} />
        <Route path="/offseason" element={<OffseasonHub />} />
        <Route path="/offseason-hub" element={<Navigate to="/offseason" replace />} />
        <Route path="/player-team-options" element={<PlayerTeamOptions />} />
        <Route path="/player-retirements" element={<PlayerRetirements />} />
        <Route path="/viewing-offers" element={<ViewingOffers />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
