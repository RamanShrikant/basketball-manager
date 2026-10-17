import React from "react";
import ReactDOM from "react-dom/client";
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

// HARD ROUTE BOUNDARY: Online does not import the game, vault, league saves,
// GameContext, player simulation worker or singleplayer bootstraps.
// The online UI shares only Supabase Auth and public styling.
const root = ReactDOM.createRoot(document.getElementById("root"));
if (window.location.pathname === "/online" || window.location.pathname.startsWith("/online/")) {
  import("./online/OnlineApp.jsx").then(({ default: OnlineApp }) => {
    root.render(<OnlineApp />);
  }).catch(error => { console.error("Online failed to load", error); root.render(<div role="alert">Online could not start. Check the console and reload.</div>); });
} else {
  import("./auth/AccountRoot.jsx").then(({ default: AccountRoot }) => {
    root.render(
      <AccountRoot onInitialize={prepareAuthenticatedGame}>
        {(user) => GameComponent ? <GameComponent user={user} /> : null}
      </AccountRoot>
    );
  }).catch(error => { console.error("Basketball Manager startup failed", error); });
}
