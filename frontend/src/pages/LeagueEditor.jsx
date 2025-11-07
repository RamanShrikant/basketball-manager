import { useState } from "react";

/* ------------------------------------------------------------
   League Editor v3.1 – Visual Refinement
   ------------------------------------------------------------ */

export default function LeagueEditor() {
  const [leagueName, setLeagueName] = useState("NBA 2025");
  const [conferences, setConferences] = useState({ East: [], West: [] });
  const [selectedConf, setSelectedConf] = useState("East");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamLogo, setNewTeamLogo] = useState("");
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [playerForm, setPlayerForm] = useState(initPlayer());
  const [expandedTeams, setExpandedTeams] = useState({});

  /* ---------------- Player Model ---------------- */
  function initPlayer() {
    return {
      name: "",
      pos: "PG",
      age: 25,
      attrs: Array(15).fill(75),
      overall: 75,
      offRating: 75,
      defRating: 75,
      stamina: 75,
      headshot: ""
    };
  }

  /* ---------------- Position Parameters ---------------- */
  const posParams = {
    PG: { weights: [0.11,0.05,0.03,0.05,0.17,0.17,0.10,0.07,0.10,0.02,0.01,0.07,0.05,0.01,0.01], prim:[5,6,1,7], alpha:0.25 },
    SG: { weights: [0.15,0.08,0.05,0.05,0.12,0.07,0.11,0.07,0.11,0.03,0.02,0.08,0.06,0.01,0.01], prim:[1,5,7], alpha:0.28 },
    SF: { weights: [0.12,0.09,0.07,0.04,0.08,0.07,0.10,0.10,0.10,0.06,0.04,0.08,0.05,0.01,0.01], prim:[1,8,9], alpha:0.22 },
    PF: { weights: [0.07,0.07,0.12,0.03,0.05,0.05,0.08,0.12,0.07,0.13,0.08,0.08,0.05,0.01,0.01], prim:[3,10,8], alpha:0.24 },
    C:  { weights: [0.04,0.06,0.17,0.03,0.02,0.04,0.07,0.12,0.05,0.16,0.13,0.06,0.08,0.01,0.01], prim:[3,10,11,13], alpha:0.30 },
  };

  const attrNames = [
    "Three Point","Mid Range","Close Shot","Free Throw",
    "Ball Handling","Passing","Speed","Athleticism",
    "Perimeter Defense","Interior Defense","Block","Steal",
    "Rebounding","Offensive IQ","Defensive IQ"
  ];

  const OFF_ATTRS = [0,1,2,3,4,5,6,7,13];
  const DEF_ATTRS = [7,8,9,10,11,12,14];

  /* ---------------- Rating Calculations ---------------- */
  function sigmoid(x) {
    return 1 / (1 + Math.exp(-0.12 * (x - 77)));
  }

  function calcOverall(attrs, pos) {
    const p = posParams[pos];
    if (!p) return 0;
    const W = p.weights.reduce((s,w,i)=>s+w*attrs[i],0);
    const prim = p.prim.map(i=>i-1);
    const Peak = Math.max(...prim.map(i=>attrs[i]));
    const B = p.alpha*Peak + (1-p.alpha)*W;
    let overall = 60 + 39*sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = attrs.filter(a=>a>90).length;
    if (num90>=3) overall = Math.min(99, overall + 1 + (num90-3));
    return overall;
  }

  function calcOffDef(attrs, pos) {
    const p = posParams[pos];
    if (!p) return { off: 75, def: 75 };
    const w = p.weights;
    const offScore = OFF_ATTRS.reduce((s,i)=>s+w[i]*attrs[i],0);
    const defScore = DEF_ATTRS.reduce((s,i)=>s+w[i]*attrs[i],0);
    const offWeight = OFF_ATTRS.reduce((s,i)=>s+w[i],0);
    const defWeight = DEF_ATTRS.reduce((s,i)=>s+w[i],0);
    const offScaled = 60 + 39*sigmoid(offScore/offWeight);
    const defScaled = 60 + 39*sigmoid(defScore/defWeight);
    return { off: Math.round(offScaled), def: Math.round(defScaled) };
  }

  function calcStamina(age, athleticism) {
    age = Math.min(45, Math.max(18, age));
    athleticism = Math.min(99, Math.max(25, athleticism));
    let ageFactor;
    if (age <= 27) ageFactor = 1.0;
    else if (age <= 34) ageFactor = 0.95 - (0.15 * (age - 28) / 6);
    else ageFactor = 0.8 - (0.45 * (age - 35) / 10);
    ageFactor = Math.min(1.0, Math.max(0.35, ageFactor));
    const staminaRaw = (ageFactor * 99 * 0.575) + (athleticism * 0.425);
    const norm = (staminaRaw - 40) / (99 - 40);
    const stamina = 40 + norm * 59;
    return Math.round(Math.min(99, Math.max(40, stamina)));
  }

  /* ---------------- Event Handlers ---------------- */
  const addTeam = () => {
    if (!newTeamName.trim()) return;
    const newTeam = { name: newTeamName.trim(), logo: newTeamLogo.trim(), players: [] };
    setConferences(prev => ({
      ...prev,
      [selectedConf]: [...prev[selectedConf], newTeam]
    }));
    setNewTeamName(""); setNewTeamLogo("");
  };

  const deleteTeam = (idx) => {
    if (!window.confirm("Are you sure you want to delete this team?")) return;
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy[selectedConf].splice(idx,1);
      return copy;
    });
  };

  const moveTeam = (idx, dir) => {
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const list = copy[selectedConf];
      const newIndex = idx + dir;
      if (newIndex < 0 || newIndex >= list.length) return prev;
      [list[idx], list[newIndex]] = [list[newIndex], list[idx]];
      return copy;
    });
  };

  const openPlayerForm = (teamIndex, playerIndex = null) => {
    setEditingTeam(teamIndex);
    if (playerIndex !== null) {
      setEditingPlayer(playerIndex);
      setPlayerForm(JSON.parse(JSON.stringify(conferences[selectedConf][teamIndex].players[playerIndex])));
    } else {
      setEditingPlayer(null);
      setPlayerForm(initPlayer());
    }
    setShowPlayerForm(true);
  };

  const deletePlayer = (teamIdx, playerIdx) => {
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy[selectedConf][teamIdx].players.splice(playerIdx,1);
      return copy;
    });
  };

  const savePlayer = () => {
    const player = { ...playerForm };
    const overall = calcOverall(player.attrs, player.pos);
    const { off, def } = calcOffDef(player.attrs, player.pos);
    const stamina = calcStamina(player.age, player.attrs[7]);
    player.overall = overall; player.offRating = off; player.defRating = def; player.stamina = stamina;

    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (editingPlayer !== null) {
        copy[selectedConf][editingTeam].players[editingPlayer] = player;
      } else {
        copy[selectedConf][editingTeam].players.push(player);
      }
      return copy;
    });
    setShowPlayerForm(false);
  };

  const updateAttr = (idx, val) => {
    setPlayerForm(prev => {
      const attrs = [...prev.attrs];
      attrs[idx] = Number(val);
      const overall = calcOverall(attrs, prev.pos);
      const { off, def } = calcOffDef(attrs, prev.pos);
      const stamina = calcStamina(prev.age, attrs[7]);
      return { ...prev, attrs, overall, offRating: off, defRating: def, stamina };
    });
  };

  const updateAge = (val) => {
    setPlayerForm(prev => {
      const stamina = calcStamina(val, prev.attrs[7]);
      return { ...prev, age: Number(val), stamina };
    });
  };

  const toggleAdvanced = (teamIdx) => {
    setExpandedTeams(prev => ({ ...prev, [teamIdx]: !prev[teamIdx] }));
  };

  const exportJSON = () => {
    const json = { leagueName, conferences };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${leagueName.replace(/\s+/g,"_").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

    const importJSON = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.leagueName && data.conferences) {
          setLeagueName(data.leagueName);
          setConferences(data.conferences);
          alert(`✅ League "${data.leagueName}" imported successfully!`);
        } else {
          alert("⚠️ Invalid file format – missing leagueName or conferences.");
        }
      } catch {
        alert("❌ Failed to import league file. Please check JSON validity.");
      }
    };
    reader.readAsText(file);
  };


  /* ---------------- UI ---------------- */
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">League Editor</h1>

{/* League Info */}
<div className="flex flex-col md:flex-row items-center justify-center gap-4">
  <input
    className="border p-2 rounded w-60"
    value={leagueName}
    onChange={(e) => setLeagueName(e.target.value)}
    placeholder="League Name"
  />

  <div className="flex gap-2">
    {/* Import League JSON */}
    <label className="bg-gray-200 text-black px-4 py-2 rounded hover:bg-gray-300 cursor-pointer">
      Import League JSON
      <input
        type="file"
        accept=".json"
        onChange={importJSON}
        className="hidden"
      />
    </label>

    {/* Export League JSON */}
    <button
      onClick={exportJSON}
      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
    >
      Export League JSON
    </button>
  </div>
</div>


      {/* Conference Switch */}
      <div className="flex justify-center gap-4">
        {["East","West"].map(conf=>(
          <button key={conf} onClick={()=>setSelectedConf(conf)}
            className={`px-4 py-2 rounded ${selectedConf===conf?"bg-green-600 text-white":"bg-gray-200"}`}>
            {conf} Conference
          </button>
        ))}
      </div>

      {/* Add Team */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <input className="border p-2 rounded w-52"
          placeholder="Team Name" value={newTeamName} onChange={(e)=>setNewTeamName(e.target.value)}/>
        <input className="border p-2 rounded w-52"
          placeholder="Logo URL" value={newTeamLogo} onChange={(e)=>setNewTeamLogo(e.target.value)}/>
        <button onClick={addTeam}
          className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700">
          Add Team
        </button>
      </div>

      {/* Teams */}
      <div className="flex flex-col gap-8">
        {conferences[selectedConf].map((team, idx)=>(
          <div key={idx} className="border rounded-2xl p-8 bg-white shadow-lg">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-3">
                {team.logo && <img src={team.logo} alt="" className="w-14 h-14 object-contain" />}
                <h2 className="text-2xl font-bold">{team.name}</h2>
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={()=>openPlayerForm(idx)}
                  className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
                  Add Player
                </button>
                <button onClick={()=>toggleAdvanced(idx)}
                  className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">
                  {expandedTeams[idx] ? "Hide Advanced Stats" : "Show Advanced Stats"}
                </button>
                <button onClick={()=>moveTeam(idx,-1)} className="bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 text-lg">⬆️</button>
                <button onClick={()=>moveTeam(idx,1)} className="bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 text-lg">⬇️</button>
                <button onClick={()=>deleteTeam(idx)} className="text-red-600 text-xl hover:opacity-75">🗑️</button>
              </div>
            </div>

            {/* Player Table */}
            <table className="w-full text-base">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-semibold">Player</th>
                  <th className="text-center font-semibold">Pos</th>
                  <th className="text-center font-semibold">Age</th>
                  <th className="text-center font-semibold">OVR</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((p,i)=>(
                  <tr key={i} className="border-b align-middle py-4">
                    <td className="flex items-center gap-4 py-4">
{p.headshot && (
  <div
    className="w-16 h-16 rounded-full bg-white border border-slate-200"
    style={{
      backgroundImage: `url(${p.headshot})`,
      backgroundSize: "80%",          // zoom: smaller = zoom out, larger = zoom in
      backgroundPosition: "center 10%", // move up/down: increase % to move down
      backgroundRepeat: "no-repeat",
    }}
  />
)}

                      <div>
                        <div className="font-semibold text-base">{p.name}</div>
                        {expandedTeams[idx] && (
                          <div className="text-[0.8rem] text-slate-600 grid grid-cols-3 gap-x-2">
                            {attrNames.map((name,j)=><span key={j}>{name.split(" ")[0]} {p.attrs[j]}</span>)}
                            <span>Off {p.offRating}</span>
                            <span>Def {p.defRating}</span>
                            <span>Sta {p.stamina}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="text-center">{p.pos}</td>
                    <td className="text-center">{p.age}</td>
                    <td className="text-center font-bold">{p.overall}</td>
                    <td className="text-right">
                      <button onClick={()=>openPlayerForm(idx,i)} className="text-blue-600 text-sm hover:underline mr-2">Edit</button>
                      <button onClick={()=>deletePlayer(idx,i)} className="text-red-600 text-xl hover:opacity-75">🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Player Modal */}
      {showPlayerForm && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[650px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingPlayer !== null ? "Edit Player" : "Add Player"}</h2>
            <div className="flex flex-col gap-2 mb-3">
              <input className="border p-2 rounded" placeholder="Player Name"
                value={playerForm.name} onChange={(e)=>setPlayerForm({...playerForm,name:e.target.value})}/>
              <input className="border p-2 rounded" placeholder="Headshot URL"
                value={playerForm.headshot} onChange={(e)=>setPlayerForm({...playerForm,headshot:e.target.value})}/>
              <select className="border p-2 rounded" value={playerForm.pos}
                onChange={(e)=>setPlayerForm({
                  ...playerForm,
                  pos:e.target.value,
                  overall:calcOverall(playerForm.attrs,e.target.value)
                })}>
                {["PG","SG","SF","PF","C"].map(pos=><option key={pos}>{pos}</option>)}
              </select>
            </div>

            {/* Sliders */}
            <div className="space-y-2">
              {attrNames.map((label,i)=>(
                <div key={i}>
                  <label className="text-sm">{label}: {playerForm.attrs[i]}</label>
                  <input type="range" min="25" max="99" value={playerForm.attrs[i]}
                    onChange={(e)=>updateAttr(i,e.target.value)} className="w-full accent-blue-600"/>
                </div>
              ))}
              <div>
                <label className="text-sm">Age: {playerForm.age}</label>
                <input type="range" min="18" max="45" value={playerForm.age}
                  onChange={(e)=>updateAge(e.target.value)} className="w-full accent-green-600"/>
              </div>
            </div>

            <p className="mt-4 font-semibold text-lg">
              Overall: {playerForm.overall} | Off: {playerForm.offRating} | Def: {playerForm.defRating} | Sta: {playerForm.stamina}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setShowPlayerForm(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400">
                Cancel
              </button>
              <button onClick={savePlayer}
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700">
                Save Player
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
