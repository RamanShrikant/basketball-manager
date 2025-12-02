import React from "react";
import "@/api/simEnginePy.js";

import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { GameProvider } from "./context/GameContext.jsx"; // ✅ import provider
import { simulateOneGame as pySimOneGame } from "./api/simEnginePy";

window.simulateOneGame = pySimOneGame;
console.log("✓ simulateOneGame exposed globally");


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* ✅ Wrap your app with GameProvider */}
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>
);
