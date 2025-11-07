import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import PlayerEditor from "./pages/PlayerEditor.jsx";
import TradeSimulator from "./pages/TradeSimulator.jsx";
import GameSimulator from "./pages/GameSimulator.jsx";
import LeagueEditor from "./pages/LeagueEditor";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="players" element={<PlayerEditor />} />
          <Route path="players/:playerId" element={<PlayerEditor />} />
          <Route path="trade" element={<TradeSimulator />} />
          <Route path="simulate" element={<GameSimulator />} />
          <Route path="/league-editor" element={<LeagueEditor />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
