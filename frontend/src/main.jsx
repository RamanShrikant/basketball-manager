import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { GameProvider } from "./context/GameContext.jsx"; // ✅ import provider

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* ✅ Wrap your app with GameProvider */}
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>
);
