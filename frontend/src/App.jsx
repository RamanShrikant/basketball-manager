import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import PlayerEditor from "./pages/PlayerEditor.jsx";
import TradeSimulator from "./pages/TradeSimulator.jsx";
import GameSimulator from "./pages/GameSimulator.jsx";

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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
