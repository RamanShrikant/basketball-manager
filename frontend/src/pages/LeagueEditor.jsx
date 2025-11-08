import { useState, useEffect } from "react";

/* ------------------------------------------------------------
   League Editor v4.4 – Live Recalc Fix + Height/Potential Sync
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
  const [sortedTeams, setSortedTeams] = useState({});
  const [editTeamModal, setEditTeamModal] = useState(null);

  /* ---------------- Player Model ---------------- */
  function initPlayer() {
    return {
      name: "",
      pos: "PG",
      secondaryPos: "",
      age: 25,
      height: 78,
      attrs: Array(15).fill(75),
      overall: 75,
      offRating: 75,
      defRating: 75,
      stamina: 75,
      potential: 75,
      headshot: "",
    };
  }

  /* ---------------- Position Params ---------------- */
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

  /* ---------------- Calculations ---------------- */
  const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

  const calcOverall = (attrs,pos) => {
    const p = posParams[pos]; if (!p) return 0;
    const W = p.weights.reduce((s,w,i)=>s+w*attrs[i],0);
    const prim = p.prim.map(i=>i-1);
    const Peak = Math.max(...prim.map(i=>attrs[i]));
    const B = p.alpha*Peak + (1-p.alpha)*W;
    let overall = 60 + 39*sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = attrs.filter(a=>a>90).length;
    if (num90 >= 3) {
    const bonus = num90 - 2; // +1 for 3, +2 for 4, etc.
    overall = Math.min(99, overall + bonus);
    }
    return overall;
  };

  const calcOffDef = (attrs,pos)=>{
    const p = posParams[pos]; if (!p) return {off:75,def:75};
    const w=p.weights;
    const offScore = OFF_ATTRS.reduce((s,i)=>s+w[i]*attrs[i],0);
    const defScore = DEF_ATTRS.reduce((s,i)=>s+w[i]*attrs[i],0);
    const offWeight = OFF_ATTRS.reduce((s,i)=>s+w[i],0);
    const defWeight = DEF_ATTRS.reduce((s,i)=>s+w[i],0);
    const offScaled = 60 + 39*sigmoid(offScore/offWeight);
    const defScaled = 60 + 39*sigmoid(defScore/defWeight);
    return {off:Math.round(offScaled),def:Math.round(defScaled)};
  };

  const calcStamina = (age,athleticism)=>{
    age=Math.min(45,Math.max(18,age));
    athleticism=Math.min(99,Math.max(25,athleticism));
    let ageFactor;
    if(age<=27) ageFactor=1.0;
    else if(age<=34) ageFactor=0.95-(0.15*(age-28)/6);
    else ageFactor=0.8-(0.45*(age-35)/10);
    ageFactor=Math.min(1.0,Math.max(0.35,ageFactor));
    const raw=(ageFactor*99*0.575)+(athleticism*0.425);
    const norm=(raw-40)/(99-40);
    return Math.round(Math.min(99,Math.max(40,40+norm*59)));
  };

  const formatHeight = (inches)=>{
    const ft=Math.floor(inches/12);
    const ins=inches%12;
    return `${ft}′${ins}″`;
  };

  /* ---------------- Auto-Save + Load ---------------- */
  useEffect(()=>{
    const saved=localStorage.getItem("leagueData");
    if(saved){
      try{
        const data=JSON.parse(saved);
        setLeagueName(data.leagueName||"NBA 2025");
        setConferences(data.conferences||{East:[],West:[]});
      }catch{}
    }
  },[]);

  useEffect(()=>{
    localStorage.setItem("leagueData",JSON.stringify({leagueName,conferences}));
  },[leagueName,conferences]);

  /* ---------------- 🔁 Live Recalculation ---------------- */
  useEffect(() => {
    if (!showPlayerForm) return;
    setPlayerForm(prev => {
      const overall = calcOverall(prev.attrs, prev.pos);
      const { off, def } = calcOffDef(prev.attrs, prev.pos);
      const stamina = calcStamina(prev.age, prev.attrs[7]);
      return { ...prev, overall, offRating: off, defRating: def, stamina };
    });
  }, [showPlayerForm, playerForm.attrs, playerForm.age, playerForm.potential, playerForm.height]);

  /* ---------------- Handlers ---------------- */
  const addTeam=()=>{if(!newTeamName.trim())return;
    const team={name:newTeamName.trim(),logo:newTeamLogo.trim(),players:[]};
    setConferences(prev=>({...prev,[selectedConf]:[...prev[selectedConf],team]}));
    setNewTeamName("");setNewTeamLogo("");
  };

  const openEditTeam=(idx)=>setEditTeamModal({idx,
    ...conferences[selectedConf][idx]});

  const saveEditTeam=()=>{
    setConferences(prev=>{
      const copy=JSON.parse(JSON.stringify(prev));
      copy[selectedConf][editTeamModal.idx].name=editTeamModal.name;
      copy[selectedConf][editTeamModal.idx].logo=editTeamModal.logo;
      return copy;
    });
    setEditTeamModal(null);
  };

  const openPlayerForm=(tIdx,pIdx=null)=>{
    setEditingTeam(tIdx);
    if(pIdx!==null){
      setEditingPlayer(pIdx);
      const ex=conferences[selectedConf][tIdx].players[pIdx];
      const safe={potential:75,height:78,secondaryPos:"",...ex};
      setPlayerForm(JSON.parse(JSON.stringify(safe)));
    }else{setEditingPlayer(null);setPlayerForm(initPlayer());}
    setShowPlayerForm(true);
  };

  const savePlayer=()=>{
    const p={...playerForm};
    const {off,def}=calcOffDef(p.attrs,p.pos);
    p.overall=calcOverall(p.attrs,p.pos);
    p.offRating=off;p.defRating=def;p.stamina=calcStamina(p.age,p.attrs[7]);
    setConferences(prev=>{
      const copy=JSON.parse(JSON.stringify(prev));
      if(editingPlayer!==null)
        copy[selectedConf][editingTeam].players[editingPlayer]=p;
      else copy[selectedConf][editingTeam].players.push(p);
      return copy;
    });
    setShowPlayerForm(false);
  };

  const toggleSort=(idx)=>setSortedTeams(prev=>({...prev,[idx]:!prev[idx]}));
  const toggleAdvanced=(idx)=>setExpandedTeams(prev=>({...prev,[idx]:!prev[idx]}));

  /* ---------------- UI ---------------- */
  return (
  <div className="p-6 space-y-6">
    <h1 className="text-3xl font-bold text-center">League Editor</h1>

    {/* League Info */}
    <div className="flex flex-col md:flex-row items-center justify-center gap-4">
      <input className="border p-2 rounded w-60" value={leagueName}
        onChange={e=>setLeagueName(e.target.value)} placeholder="League Name"/>
      <div className="flex gap-2">
        <label className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 cursor-pointer">
          Import JSON
          <input type="file" accept=".json" className="hidden"
            onChange={e=>{
              const f=e.target.files[0];if(!f)return;
              const r=new FileReader();
              r.onload=x=>{
                try{
                  const d=JSON.parse(x.target.result);
                  if(d.leagueName&&d.conferences){
                    setLeagueName(d.leagueName);setConferences(d.conferences);
                    localStorage.setItem("leagueData",JSON.stringify(d));
                    alert(`✅ Imported ${d.leagueName}`);
                  }else alert("⚠️ Invalid JSON");
                }catch{alert("❌ Failed to parse JSON");}
              };
              r.readAsText(f);
            }}/>
        </label>
        <button onClick={()=>{
          const json={leagueName,conferences};
          const blob=new Blob([JSON.stringify(json,null,2)],{type:"app/json"});
          const url=URL.createObjectURL(blob);
          const a=document.createElement("a");
          a.href=url;a.download=`${leagueName}.json`;a.click();URL.revokeObjectURL(url);
        }}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Export JSON
        </button>
      </div>
    </div>

    {/* Conference Tabs */}
    <div className="flex justify-center gap-4">
      {["East","West"].map(c=>(
        <button key={c} onClick={()=>setSelectedConf(c)}
          className={`px-4 py-2 rounded ${selectedConf===c?"bg-green-600 text-white":"bg-gray-200"}`}>
          {c} Conference
        </button>
      ))}
    </div>

    {/* Add Team */}
    <div className="flex flex-wrap justify-center gap-2">
      <input className="border p-2 rounded w-52" placeholder="Team Name"
        value={newTeamName} onChange={e=>setNewTeamName(e.target.value)}/>
      <input className="border p-2 rounded w-52" placeholder="Logo URL"
        value={newTeamLogo} onChange={e=>setNewTeamLogo(e.target.value)}/>
      <button onClick={addTeam}
        className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700">
        Add Team
      </button>
    </div>

    {/* Teams */}
    <div className="flex flex-col gap-8">
      {conferences[selectedConf].map((team,idx)=>{
        const sorted=sortedTeams[idx];
        const players=sorted?[...team.players].sort((a,b)=>b.overall-a.overall):team.players;
        return (
        <div key={idx} className="border rounded-2xl p-8 bg-white shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
              {team.logo&&<img src={team.logo} alt="" className="w-14 h-14 object-contain"/>}
              <h2 className="text-2xl font-bold">{team.name}</h2>
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={()=>openPlayerForm(idx)}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Add Player</button>
              <button onClick={()=>toggleAdvanced(idx)}
                className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">
                {expandedTeams[idx]?"Hide Advanced":"Show Advanced"}
              </button>
              <button onClick={()=>toggleSort(idx)}
                className={`bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 text-lg ${sorted?"text-green-600":""}`} title="Sort by Overall">⬇️ OVR</button>
              <button onClick={()=>openEditTeam(idx)}
                className="text-blue-600 text-xl hover:opacity-80">✏️</button>
              <button onClick={()=>{
                if(window.confirm("Delete team?")){
                  setConferences(prev=>{
                    const c=JSON.parse(JSON.stringify(prev));
                    c[selectedConf].splice(idx,1);return c;
                  });
                }
              }} className="text-red-600 text-xl hover:opacity-75">🗑️</button>
            </div>
          </div>

          {/* Player Table */}
          <table className="w-full text-base">
            <thead>
              <tr className="border-b">
                <th className="text-left font-semibold">Player</th>
                <th className="text-center font-semibold">Pos</th>
                <th className="text-center font-semibold">Age</th>
                <th className="text-center font-semibold">Height</th>
                <th className="text-center font-semibold">OVR</th>
                <th className="text-center font-semibold">POT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p,i)=>(
                <tr key={i} className="border-b align-middle py-4">
                  <td className="flex items-center gap-4 py-4">
                    {p.headshot&&(
                      <div className="w-16 h-16 rounded-full bg-white border border-slate-200"
                        style={{
                          backgroundImage:`url(${p.headshot})`,
                          backgroundSize:"80%",backgroundPosition:"center 10%",backgroundRepeat:"no-repeat"}}/>
                    )}
                    <div>
                      <div className="font-semibold text-base">{p.name}</div>
                      {expandedTeams[idx]&&(
                        <div className="text-[0.8rem] text-slate-600 grid grid-cols-3 gap-x-2">
                          {attrNames.map((n,j)=><span key={j}>{n.split(" ")[0]} {p.attrs[j]}</span>)}
                          <span>Off {p.offRating}</span><span>Def {p.defRating}</span>
                          <span>Sta {p.stamina}</span><span>Pot {p.potential}</span>
                          <span>Ht {formatHeight(p.height)}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="text-center">{p.pos}{p.secondaryPos?` / ${p.secondaryPos}`:""}</td>
                  <td className="text-center">{p.age}</td>
                  <td className="text-center">{formatHeight(p.height)}</td>
                  <td className="text-center font-bold">{p.overall}</td>
                  <td className="text-center">{p.potential}</td>
                  <td className="text-right">
                    <button onClick={()=>openPlayerForm(idx,i)} className="text-blue-600 text-sm hover:underline mr-2">Edit</button>
                    <button onClick={()=>{
                      setConferences(prev=>{
                        const c=JSON.parse(JSON.stringify(prev));
                        c[selectedConf][idx].players.splice(i,1);return c;
                      });
                    }} className="text-red-600 text-xl hover:opacity-75">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>);
      })}
    </div>

    {/* Player Modal */}
    {showPlayerForm&&(
      <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
        <div className="bg-white rounded-lg p-6 w-[650px] max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4">{editingPlayer!==null?"Edit Player":"Add Player"}</h2>
          <div className="flex flex-col gap-2 mb-3">
            <input className="border p-2 rounded" placeholder="Player Name"
                            value={playerForm.name} 
              onChange={e => setPlayerForm({ ...playerForm, name: e.target.value })}/>
            <input className="border p-2 rounded" placeholder="Headshot URL"
              value={playerForm.headshot} 
              onChange={e => setPlayerForm({ ...playerForm, headshot: e.target.value })}/>
            <select className="border p-2 rounded" value={playerForm.pos}
              onChange={e => {
                const pos = e.target.value;
                setPlayerForm({
                  ...playerForm,
                  pos,
                  secondaryPos: playerForm.secondaryPos === pos ? "" : playerForm.secondaryPos
                });
              }}>
              {["PG","SG","SF","PF","C"].map(p => <option key={p}>{p}</option>)}
            </select>
            <select className="border p-2 rounded" value={playerForm.secondaryPos}
              onChange={e => setPlayerForm({ ...playerForm, secondaryPos: e.target.value })}>
              <option value="">No Secondary</option>
              {["PG","SG","SF","PF","C"].filter(p => p !== playerForm.pos)
                .map(p => <option key={p}>{p}</option>)}
            </select>
          </div>

          {/* Sliders */}
          <div className="space-y-2">
            {attrNames.map((l, i) => (
              <div key={i}>
                <label className="text-sm">{l}: {playerForm.attrs[i]}</label>
                <input 
                  type="range" 
                  min="25" 
                  max="99" 
                  value={playerForm.attrs[i]}
                  onChange={e => 
                    setPlayerForm(p => ({
                      ...p, 
                      attrs: p.attrs.map((a, j) => j === i ? +e.target.value : a)
                    }))
                  }
                  className="w-full accent-blue-600"
                />
              </div>
            ))}
            <div>
              <label className="text-sm">Age: {playerForm.age}</label>
              <input 
                type="range" 
                min="18" 
                max="45" 
                value={playerForm.age}
                onChange={e => setPlayerForm({ ...playerForm, age: +e.target.value })}
                className="w-full accent-green-600"
              />
            </div>
            <div>
              <label className="text-sm">Height: {formatHeight(playerForm.height)}</label>
              <input 
                type="range" 
                min="65" 
                max="90" 
                value={playerForm.height}
                onChange={e => setPlayerForm({ ...playerForm, height: +e.target.value })}
                className="w-full accent-purple-600"
              />
            </div>
            <div>
              <label className="text-sm">Potential: {playerForm.potential}</label>
              <input 
                type="range" 
                min="25" 
                max="99" 
                value={playerForm.potential}
                onChange={e => setPlayerForm({ ...playerForm, potential: +e.target.value })}
                className="w-full accent-pink-600"
              />
            </div>
          </div>

          {/* Live Stat Bar */}
          <p className="mt-4 font-semibold text-lg">
            Overall: {playerForm.overall} | Off: {playerForm.offRating} | 
            Def: {playerForm.defRating} | Sta: {playerForm.stamina} | 
            Pot: {playerForm.potential} | Ht: {formatHeight(playerForm.height)}
          </p>

          {/* Modal Buttons */}
          <div className="flex justify-end gap-2 mt-4">
            <button 
              onClick={() => setShowPlayerForm(false)} 
              className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400">
              Cancel
            </button>
            <button 
              onClick={savePlayer} 
              className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700">
              Save Player
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Edit Team Modal */}
    {editTeamModal && (
      <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
        <div className="bg-white rounded-lg p-6 w-[400px]">
          <h2 className="text-xl font-bold mb-4">Edit Team</h2>
          <input 
            className="border p-2 rounded w-full mb-2"
            placeholder="Team Name" 
            value={editTeamModal.name}
            onChange={e => setEditTeamModal({ ...editTeamModal, name: e.target.value })}
          />
          <input 
            className="border p-2 rounded w-full mb-4"
            placeholder="Logo URL" 
            value={editTeamModal.logo}
            onChange={e => setEditTeamModal({ ...editTeamModal, logo: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <button 
              onClick={() => setEditTeamModal(null)}
              className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400">
              Cancel
            </button>
            <button 
              onClick={saveEditTeam}
              className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700">
              Save
            </button>
          </div>
        </div>
      </div>
    )}
  </div>);
}

