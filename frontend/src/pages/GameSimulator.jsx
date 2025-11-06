import { useEffect, useState } from "react";
import { fetchTeams, runGameSimulation } from "../api/client.js";

function GameSimulator() {
  const [teams, setTeams] = useState([]);
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    let mounted = true;
    fetchTeams()
      .then((data) => {
        if (!mounted) return;
        setTeams(data.teams ?? []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!homeTeamId || !awayTeamId) {
      setError("Choose two teams to simulate the matchup.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await runGameSimulation({ homeTeamId, awayTeamId });
      setResult(response.result);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">Game Simulator</h2>
        <p className="text-sm text-slate-600">
          Pit two teams against each other to see a projected score based on roster ratings and a
          touch of randomness.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Home team</span>
            <select
              value={homeTeamId}
              onChange={(event) => {
                setHomeTeamId(event.target.value);
                setResult(null);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.city} {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Away team</span>
            <select
              value={awayTeamId}
              onChange={(event) => {
                setAwayTeamId(event.target.value);
                setResult(null);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.city} {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          disabled={status === "loading"}
        >
          Simulate Game
        </button>
      </form>

      {result && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-6 text-indigo-900">
          <h3 className="text-lg font-semibold">Projected Result</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {[result.homeTeam, result.awayTeam].map((team) => (
              <div key={team.id} className="space-y-2">
                <p className="text-sm font-medium uppercase text-indigo-700">
                  {team.city} {team.name}
                </p>
                <p className="text-3xl font-semibold">{team.score}</p>
                <p className="text-xs text-slate-600">
                  Rating {team.rating} · Coach {team.coach}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm">
            Winner: <span className="font-semibold">{result.winner}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}
    </section>
  );
}

export default GameSimulator;
