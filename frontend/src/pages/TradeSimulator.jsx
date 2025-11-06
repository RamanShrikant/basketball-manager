import { useEffect, useMemo, useState } from "react";
import { fetchTeams, runTradeSimulation } from "../api/client.js";

function TradeSimulator() {
  const [teams, setTeams] = useState([]);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [teamASelection, setTeamASelection] = useState([]);
  const [teamBSelection, setTeamBSelection] = useState([]);
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

  const teamOptions = useMemo(
    () =>
      teams.map((item) => ({
        value: item.id,
        label: `${item.city} ${item.name}`,
      })),
    [teams]
  );

  const rosterForTeam = (teamId) => teams.find((team) => team.id === teamId)?.players ?? [];

  const toggleSelection = (playerId, setter) => {
    setter((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]));
    setResult(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!teamA || !teamB) {
      setError("Please choose two teams to simulate a trade.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await runTradeSimulation({
        teamAId: teamA,
        teamBId: teamB,
        teamAPlayerIds: teamASelection,
        teamBPlayerIds: teamBSelection,
      });
      setResult(response.trade);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">Trade Simulator</h2>
        <p className="text-sm text-slate-600">
          Select two teams, choose the players to exchange, and evaluate how the trade shifts each
          roster's rating.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-6 md:grid-cols-2">
          {[{ label: "Team A", value: teamA, setter: setTeamA, selection: teamASelection, setSelection: setTeamASelection },
            { label: "Team B", value: teamB, setter: setTeamB, selection: teamBSelection, setSelection: setTeamBSelection }].map(
            ({ label, value, setter, selection, setSelection }) => (
              <div key={label} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">{label}</label>
                  <select
                    value={value}
                    onChange={(event) => {
                      setter(event.target.value);
                      setSelection([]);
                      setResult(null);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select team</option>
                    {teamOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700">Players to trade</p>
                  <p className="text-xs text-slate-500">
                    Click players to toggle inclusion in the trade package.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {rosterForTeam(value).map((player) => {
                      const selected = selection.includes(player.id);
                      return (
                        <li key={player.id}>
                          <button
                            type="button"
                            onClick={() => toggleSelection(player.id, setSelection)}
                            className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                              selected
                                ? "border-blue-400 bg-blue-50 text-blue-700"
                                : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"
                            }`}
                          >
                            <span>
                              {player.name} · {player.position}
                            </span>
                            <span className="font-medium">OVR {player.overall}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )
          )}
        </div>

        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          disabled={status === "loading"}
        >
          Simulate Trade
        </button>
      </form>

      {result && (
        <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
          <h3 className="text-lg font-semibold">Trade Impact</h3>
          {[{ key: "teamA", title: "Team A" }, { key: "teamB", title: "Team B" }].map(({ key, title }) => (
            <div key={key}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{title}</h4>
              <p className="text-sm">
                Rating change: <span className="font-semibold">{result[key].ratingDelta}</span>
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-emerald-200 bg-white/60 p-3">
                  <h5 className="text-xs font-semibold uppercase text-emerald-600">Before</h5>
                  <p className="text-sm">Rating {result[key].before.rating}</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {result[key].before.players.map((player) => (
                      <li key={player.id}>
                        {player.name} · {player.position} · OVR {player.overall}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-emerald-200 bg-white/60 p-3">
                  <h5 className="text-xs font-semibold uppercase text-emerald-600">After</h5>
                  <p className="text-sm">Rating {result[key].after.rating}</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {result[key].after.players.map((player) => (
                      <li key={player.id}>
                        {player.name} · {player.position} · OVR {player.overall}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}
    </section>
  );
}

export default TradeSimulator;
