import React from "react";
import ReactDOM from "react-dom/client";
import AccountRoot from "./auth/AccountRoot.jsx";
import "./index.css";
import "./styles/BMResponsiveDensity.css";

// Deliberately do NOT statically import GameContext, the simulator, or any
// game storage systems here. They may read local data at module evaluation.
// AccountRoot selects/restores the correct local franchise universe FIRST.
let GameComponent = null;
async function prepareAuthenticatedGame() {
  const module = await import("./game/BasketballManagerGame.jsx");
  await module.initializeGameAfterLogin();
  GameComponent = module.default;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <AccountRoot onInitialize={prepareAuthenticatedGame}>
    {(user) => GameComponent ? <GameComponent user={user} /> : null}
  </AccountRoot>
);
