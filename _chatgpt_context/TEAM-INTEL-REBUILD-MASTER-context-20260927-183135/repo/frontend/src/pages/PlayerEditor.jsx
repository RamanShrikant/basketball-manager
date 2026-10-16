// PlayerEditor.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  calculateOverall,
  fetchPlayers,
  fetchTeams,
  savePlayer,
  updateExistingPlayer,
} from "../api/client.js";

const defaultPlayer = {
  name: "",
  position: "PG",
  overall: 75,

  // legacy fields (keep)
  salary: 8,
  contractYears: 2,

  // NEW: birthdays
  birthMonth: 1,
  birthDay: 1,

  // NEW: option
  optionType: "none", // "none" | "team" | "player"
  optionYear: 2, // 1..contractYears (UI clamps)

  teamId: "",
};

const positions = ["PG", "SG", "SF", "PF", "C"];

function PlayerEditor() {
  const navigate = useNavigate();
  const { playerId } = useParams();
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [player, setPlayer] = useState(defaultPlayer);
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerId || "");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const normalizeExisting = (existing) => {
    const birthMonth = Number(existing?.birthMonth ?? 1);
    const birthDay = Number(existing?.birthDay ?? 1);

    // If backend already stores contract object, pull from it.
    const salaryByYear = Array.isArray(existing?.contract?.salaryByYear)
      ? existing.contract.salaryByYear
      : null;

    const contractYears =
      Number(existing?.contractYears ?? (salaryByYear ? salaryByYear.length : 2)) || 2;

    const salary =
      Number(existing?.salary ?? (salaryByYear ? salaryByYear[0] / 1_000_000 : 8)) || 8;

    const optionType =
      existing?.optionType ??
      existing?.contract?.option?.type ??
      "none";

    const optionYear =
      Number(existing?.optionYear ?? (existing?.contract?.option?.yearIndex != null
        ? existing.contract.option.yearIndex + 1
        : contractYears)) || contractYears;

    return {
      name: existing?.name ?? "",
      position: existing?.position ?? "PG",
      overall: Number(existing?.overall ?? 75),

      salary,
      contractYears,

      birthMonth: Math.min(12, Math.max(1, birthMonth)),
      birthDay: Math.min(31, Math.max(1, birthDay)),

      optionType: optionType || "none",
      optionYear: Math.min(contractYears, Math.max(1, optionYear)),

      teamId: existing?.teamId || "",
    };
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchTeams(), fetchPlayers()])
      .then(([teamResponse, playerResponse]) => {
        if (!mounted) return;
        setTeams(teamResponse.teams ?? []);
        setPlayers(playerResponse.players ?? []);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPlayerId) {
      setPlayer(defaultPlayer);
      return;
    }
    const existing = players.find((item) => item.id === selectedPlayerId);
    if (existing) {
      setPlayer(normalizeExisting(existing));
    }
  }, [selectedPlayerId, players]);

  const rosterOptions = useMemo(
    () =>
      players.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.position})`,
      })),
    [players]
  );

  const handleChange = (event) => {
    const { name, value } = event.target;

    setPlayer((prev) => {
      let next = value;

      const numeric = new Set([
        "overall",
        "salary",
        "contractYears",
        "birthMonth",
        "birthDay",
        "optionYear",
      ]);

      if (numeric.has(name)) next = Number(value);

      const updated = { ...prev, [name]: next };

      // clamp option year whenever contractYears changes
      if (name === "contractYears") {
        const yrs = Math.max(1, Math.min(7, Number(value)));
        updated.contractYears = yrs;
        updated.optionYear = Math.min(yrs, Math.max(1, Number(updated.optionYear || yrs)));
      }

      // clamp birthdays
      if (name === "birthMonth") updated.birthMonth = Math.min(12, Math.max(1, Number(next)));
      if (name === "birthDay") updated.birthDay = Math.min(31, Math.max(1, Number(next)));

      // if optionType becomes none, keep optionYear but it will be ignored in payload
      return updated;
    });
  };

  const handlePlayerSelect = (event) => {
    const nextId = event.target.value;
    setSelectedPlayerId(nextId);
    if (nextId) {
      navigate(`/players/${nextId}`, { replace: true });
    } else {
      navigate("/players", { replace: true });
    }
  };

  const buildContractObject = () => {
    const years = Math.max(1, Number(player.contractYears || 1));
    const firstYearSalary = Math.max(0, Number(player.salary || 0)) * 1_000_000;

    const salaryByYear = Array(years).fill(firstYearSalary);

    const option =
      player.optionType && player.optionType !== "none"
        ? {
            yearIndex: Math.min(years, Math.max(1, Number(player.optionYear || years))) - 1,
            type: player.optionType,
            picked: null,
          }
        : null;

    return {
      startYear: new Date().getFullYear(),
      salaryByYear,
      option,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);
    setError(null);

    try {
      const payload = {
        ...player,
        teamId: player.teamId || null,

        // NEW: also send a unified contract object (backend can ignore if not supported)
        contract: buildContractObject(),
      };

      if (selectedPlayerId) {
        await updateExistingPlayer(selectedPlayerId, payload);
        setMessage("Player updated successfully.");
      } else {
        const result = await savePlayer(payload);
        const created = result.player;
        setSelectedPlayerId(created.id);
        setPlayers((prev) => [...prev, created]);
        setMessage("Player created successfully.");
        navigate(`/players/${created.id}`, { replace: true });
      }

      const refreshed = await fetchPlayers();
      setPlayers(refreshed.players ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  };

  const handleReset = () => {
    setSelectedPlayerId("");
    setPlayer(defaultPlayer);
    setMessage(null);
    setError(null);
    navigate("/players", { replace: true });
  };

  const handleOverallRequest = async () => {
    try {
      setStatus("calculating");
      const attrs = Array(13).fill(player.overall);
      const response = await calculateOverall({ attrs, pos: player.position });
      setPlayer((prev) => ({ ...prev, overall: response.overall ?? prev.overall }));
      setMessage("Overall updated using Python bridge.");
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  };

  if (error && !players.length && !teams.length) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
        Unable to load editor data: {error}
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">Player Editor</h2>
        <p className="text-sm text-slate-600">
          Create a new player or update an existing roster member. This editor persists through the API
          layer and can request the Python overall calculator for quick estimates.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">Existing players</label>
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={selectedPlayerId}
          onChange={handlePlayerSelect}
        >
          <option value="">Create a new player</option>
          {rosterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedPlayerId && (
          <button type="button" onClick={handleReset} className="mt-2 text-sm text-blue-600 hover:underline">
            Start a new player instead
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Name</span>
            <input
              type="text"
              name="name"
              required
              value={player.name}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Position</span>
            <select
              name="position"
              value={player.position}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {positions.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Overall</span>
            <input
              type="number"
              name="overall"
              min="25"
              max="99"
              value={player.overall}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Team</span>
            <select
              name="teamId"
              value={player.teamId}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Free Agent</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          {/* NEW: Birthdays */}
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Birth Month</span>
            <input
              type="number"
              name="birthMonth"
              min="1"
              max="12"
              value={player.birthMonth}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Birth Day</span>
            <input
              type="number"
              name="birthDay"
              min="1"
              max="31"
              value={player.birthDay}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          {/* Contract (legacy fields kept) */}
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Salary (millions)</span>
            <input
              type="number"
              name="salary"
              min="0"
              step="0.1"
              value={player.salary}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Contract Years</span>
            <input
              type="number"
              name="contractYears"
              min="1"
              max="7"
              value={player.contractYears}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          {/* NEW: Option */}
          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Option Type</span>
            <select
              name="optionType"
              value={player.optionType}
              onChange={handleChange}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="none">No Option</option>
              <option value="team">Team Option</option>
              <option value="player">Player Option</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-slate-700">
            <span className="font-medium">Option Year (1..N)</span>
            <input
              type="number"
              name="optionYear"
              min="1"
              max={player.contractYears}
              value={player.optionYear}
              onChange={handleChange}
              disabled={player.optionType === "none"}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            disabled={status === "saving"}
          >
            {selectedPlayerId ? "Update Player" : "Create Player"}
          </button>

          <button
            type="button"
            onClick={handleOverallRequest}
            className="rounded-md border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
            disabled={status === "calculating"}
          >
            Calculate Overall via Python
          </button>

          {status !== "idle" && <span className="text-sm text-slate-500">Working…</span>}
        </div>
      </form>

      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">{message}</div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
    </section>
  );
}

export default PlayerEditor;
