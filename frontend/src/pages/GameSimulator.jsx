// frontend/src/pages/GameSimulator.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "../context/GameContext";
import { useNavigate } from "react-router-dom";
import { simulateOneGame } from "@/api/simEnginePy";

export default function GameSimulator() {
  const { leagueData, selectedTeam } = useGame();
  const navigate = useNavigate();

  const teams = useMemo(() => {
    if (!leagueData) return [];
    return Object.values(leagueData.conferences).flat();
  }, [leagueData]);

  const [home, setHome] = useState(selectedTeam?.name || "");
  const [away, setAway] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!home && selectedTeam?.name) setHome(selectedTeam.name);
    if (!away && teams.length) {
      const firstOther = teams.find(t => t.name !== home)?.name || "";
      setAway(firstOther);
    }
  }, [selectedTeam, teams, home, away]);

  if (!leagueData) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center justify-center">
        <p className="mb-4">No league data loaded.</p>
        <button onClick={() => navigate("/")} className="px-6 py-3 bg-orange-600 rounded-lg hover:bg-orange-500">
          Back Home
        </button>
      </div>
    );
  }

  const handleSim = () => {
    if (!home || !away || home === away) return;
    setRunning(true);
    try {
      simulateOneGame({
  homeTeam: window.leagueData.conferences.East[0],
  awayTeam: window.leagueData.conferences.West[0]
})

      setResult(out);
    } catch (e) {
      console.error(e);
      alert(e.message || "Simulation failed");
    } finally {
      setRunning(false);
    }
  };

  const teamLogo = (name) => teams.find(t => t.name === name)?.logo;

  return (
    <div className="min-h-screen bg-neutral-900 text-white px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-extrabold text-orange-500">Game Simulator</h1>
          <button onClick={() => navigate("/team-hub")}
                  className="px-4 py-2 bg-neutral-700 rounded-lg hover:bg-neutral-600">
            Back to Team Hub
          </button>
        </div>

        <div className="bg-neutral-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Home</label>
              <select value={home} onChange={e => setHome(e.target.value)}
                      className="w-full bg-neutral-900 text-white rounded p-2">
                <option value="" disabled>Select team…</option>
                {teams.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div className="text-center text-gray-400">vs</div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Away</label>
              <select value={away} onChange={e => setAway(e.target.value)}
                      className="w-full bg-neutral-900 text-white rounded p-2">
                <option value="" disabled>Select team…</option>
                {teams.filter(t => t.name !== home).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between mt-5">
            <div className="flex items-center gap-3">
              {home && <img alt="home" src={teamLogo(home)} className="h-8" />}
              <span className="text-lg">{home || "—"}</span>
              <span className="mx-2 text-gray-400">vs</span>
              <span className="text-lg">{away || "—"}</span>
              {away && <img alt="away" src={teamLogo(away)} className="h-8" />}
            </div>
            <button onClick={handleSim}
                    disabled={!home || !away || home === away || running}
                    className={`px-5 py-2 rounded-lg font-semibold ${running ? "bg-neutral-700" : "bg-orange-600 hover:bg-orange-500"}`}>
              {running ? "Simulating…" : "Simulate Game"}
            </button>
          </div>
        </div>

        {result && (
          <div className="space-y-6">
            {/* Scoreboard */}
            <div className="bg-neutral-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <img src={teamLogo(home)} className="h-6" />
                <span className="text-xl font-bold">{home}</span>
                <span className="text-gray-400">vs</span>
                <span className="text-xl font-bold">{away}</span>
                <img src={teamLogo(away)} className="h-6" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-center">
                  <thead className="text-gray-300">
                    <tr>
                      <th className="px-2 py-1 text-left">Team</th>
                      <th className="px-2 py-1">Q1</th>
                      <th className="px-2 py-1">Q2</th>
                      <th className="px-2 py-1">Q3</th>
                      <th className="px-2 py-1">Q4</th>
                      <th className="px-2 py-1">OT</th>
                      <th className="px-2 py-1">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-left">Home</td>
                      {result.periods.home.slice(0,4).map((v,i)=><td key={i}>{v}</td>)}
                      <td>{result.periods.otCount>0 ? (result.periods.otBreakdown.home ?? "--") : "--"}</td>
                      <td className="font-bold">{result.totals.home}</td>
                    </tr>
                    <tr>
                      <td className="text-left">Away</td>
                      {result.periods.away.slice(0,4).map((v,i)=><td key={i}>{v}</td>)}
                      <td>{result.periods.otCount>0 ? (result.periods.otBreakdown.away ?? "--") : "--"}</td>
                      <td className="font-bold">{result.totals.away}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-sm text-gray-300">
                {result.winner.side === "home" ? "🏆 Home wins " : "🏆 Away wins "}
                {result.winner.score}{result.winner.ot ? " (OT)" : ""}
              </div>
            </div>

            {/* Box Scores */}
            <div className="grid md:grid-cols-2 gap-6">
              {[{title:"Home", rows: result.box.home}, {title:"Away", rows: result.box.away}].map(section => (
                <div key={section.title} className="bg-neutral-800 rounded-xl p-5 overflow-x-auto">
                  <h3 className="text-lg font-semibold mb-3">{section.title}</h3>
                  <table className="w-full text-center min-w-[720px]">
                    <thead className="text-gray-300">
                      <tr>
                        {["Player","MIN","PTS","REB","AST","STL","BLK","FG","3P","FT","TO","PF"].map(h=>(
                          <th key={h} className={`px-2 py-1 ${h==="Player"?"text-left":""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {section.rows.map((r,idx)=>(
                        <tr key={idx} className="odd:bg-neutral-850">
                          <td className="text-left px-2 py-1">{r.player}</td>
                          <td>{r.min}</td><td>{r.pts}</td><td>{r.reb}</td><td>{r.ast}</td>
                          <td>{r.stl}</td><td>{r.blk}</td>
                          <td>{r.fg}</td><td>{r["3p"]}</td><td>{r.ft}</td>
                          <td>{r.to}</td><td>{r.pf}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
