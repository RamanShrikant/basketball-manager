import { useEffect, useState } from "react";
import { fetchTeams } from "../api/client.js";

function Home() {
  const [teams, setTeams] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchTeams()
      .then((data) => {
        if (!mounted) return;
        setTeams(data.teams ?? []);
        setStatus("idle");
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
        setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (status === "loading") {
    return <p className="text-slate-500">Loading teams…</p>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load teams: {error}
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">League Overview</h2>
        <p className="text-sm text-slate-600">
          Explore current teams, their coaches, and projected ratings pulled directly from the API
          layer.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => (
          <article key={team.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{team.city} {team.name}</h3>
                <p className="text-sm text-slate-500">Coach: {team.coach}</p>
              </div>
              <span className="rounded-md bg-blue-100 px-2 py-1 text-sm font-medium text-blue-700">
                Rating {team.rating ?? "–"}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{team.playStyle}</p>
            <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Roster
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {(team.players ?? []).map((player) => (
                <li key={player.id} className="flex justify-between">
                  <span>
                    {player.name} · {player.position}
                  </span>
                  <span className="font-medium">OVR {player.overall}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export default Home;
