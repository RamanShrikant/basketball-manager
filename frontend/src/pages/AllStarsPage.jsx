import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import PageFade from "../components/PageFade";
import { AllStarsContent } from "./AllStars";
import {
  isAllStarsAvailable,
  readOffseasonState,
  readSavedAllStars,
} from "../utils/allStarsAvailability";
import "../styles/BMPageBackground.css";

export default function AllStarsPage() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();
  const data = useMemo(() => readSavedAllStars(), []);
  const offseasonState = useMemo(() => readOffseasonState(), []);
  const available = isAllStarsAvailable({ leagueData, offseasonState, data });

  return (
    <PageFade>
      <div className="bmCourtPage h-full overflow-auto px-4 py-4 text-white">
        <div className="mx-auto max-w-7xl">
          {!leagueData || !selectedTeam ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
              <h1 className="text-3xl font-black text-orange-400">All-Star Teams</h1>
              <p className="text-neutral-400">Select a team before viewing league All-Star teams.</p>
              <button onClick={() => navigate("/team-selector")} className="rounded-xl bg-orange-600 px-5 py-3 font-black hover:bg-orange-500">Team Select</button>
            </div>
          ) : available ? (
            <div className="rounded-2xl border border-white/15 bg-neutral-900/90 p-6 shadow-2xl">
              <AllStarsContent data={data} leagueData={leagueData} />
            </div>
          ) : (
            <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/80 p-8 text-center">
              <h1 className="text-3xl font-black text-orange-400">All-Star Teams</h1>
              <p className="max-w-xl text-neutral-300">All-Star starters and reserves will become available after selections are revealed at All-Star Weekend.</p>
            </div>
          )}
        </div>
      </div>
    </PageFade>
  );
}
