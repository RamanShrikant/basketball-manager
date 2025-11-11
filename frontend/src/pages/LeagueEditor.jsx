import { useState, useEffect, useMemo } from "react";

/* ------------------------------------------------------------
   League Editor v4.6
   - UI/flow identical to your file
   - Overall formula UNCHANGED
   - Off/Def upgraded to match Python 1:1
   - Sort-by-OVR edit-loss bug fixed (stable IDs + restore by ID order)
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
  const [originalOrders, setOriginalOrders] = useState({});
  const [editTeamModal, setEditTeamModal] = useState(null);

  /* ---------------- Player Model ---------------- */
  function initPlayer() {
    return {
      id: genId(),
      name: "",
      pos: "PG",
      secondaryPos: "",
      age: 25,
      height: 78,                // inches
      attrs: Array(15).fill(75), // 0..14 per attrNames
      overall: 75,
      offRating: 75,
      defRating: 75,
      stamina: 75,
      potential: 75,
      headshot: "",
    };
  }

  /* ---------------- Position Params (OVR logic unchanged) ---------------- */
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

  // attribute indices (match attrNames)
  const T3=0, MID=1, CLOSE=2, FT=3, BH=4, PAS=5, SPD=6, ATH=7,
        PERD=8, INTD=9, BLK=10, STL=11, REB=12, OIQ=13, DIQ=14;

  const OFF_ATTRS = [0,1,2,3,4,5,6,7,13];
  const DEF_ATTRS = [7,8,9,10,11,12,14];

  /* ---------------- Helpers ---------------- */
  // Build a fresh snapshot with ratings recomputed using the current baselines
const buildExportSnapshot = () => {
  const clone = JSON.parse(JSON.stringify(conferences));

  const recalcPlayer = (p) => {
    const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
    return {
      ...p,
      overall: calcOverall(p.attrs, p.pos),
      offRating: off,
      defRating: def,
      stamina: calcStamina(p.age, p.attrs[7]),
    };
  };

  ["East","West"].forEach(side => {
    clone[side] = (clone[side] || []).map(team => ({
      ...team,
      players: (team.players || []).map(recalcPlayer),
    }));
  });

  return clone;
};

  function genId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  }
  const clamp = (v, lo=0, hi=99)=> Math.max(lo, Math.min(hi, v));
  const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77))); // OVR uses this (UNCHANGED)

  // Python-style banker’s rounding (ties to even)
  function pyRound(x) {
    const f = Math.floor(x);
    const frac = x - f;
    if (frac > 0.5) return f + 1;
    if (frac < 0.5) return f;
    // exactly .5
    return (f % 2 === 0) ? f : f + 1;
  }

  // sample standard deviation (Bessel correction)
  function sampleStd(arr) {
    const n = arr.length;
    if (n < 2) return 10; // fallback
    const m = arr.reduce((s,v)=>s+v,0)/n;
    const var_ = arr.reduce((s,v)=>s+(v-m)*(v-m),0)/(n-1);
    return Math.sqrt(var_) || 10;
  }
  // Replace your safeStd with this:
const safeStd = (x) => (x && x > 1e-6 ? x : 1.0);


  // z → rating map (linear) used in Python
  const zToRating = (z) => clamp(75 + 12*z, 50, 99);

  const threePenaltyMult = (pos) => ({ PG:1.10, SG:1.00, SF:0.75, PF:0.50, C:0.30 }[pos] || 1);
  const closePenaltyMult  = (pos) => ({ PG:0.30, SG:0.45, SF:0.70, PF:1.00, C:1.10 }[pos] || 1);

  // deterministic micro-jitter (±0.35; DEF uses 70% of this)
  function microJitter(attrs, salt="") {
    const s = attrs.reduce((acc,v,i)=>acc+(i+1)*v,0) + [...(salt||"")].reduce((a,c)=>a+c.charCodeAt(0)*0.13,0);
    const r = Math.sin(s*12.9898)*43758.5453;
    const frac = r - Math.floor(r);
    return (frac - 0.5) * 0.7;
  }

  // offense weights on position-relative z
  const OFF_WEIGHTS_POSZ = {
    PG: { [T3]:0.18,[MID]:0.18,[CLOSE]:0.18,[BH]:0.20,[PAS]:0.20,[SPD]:0.04,[ATH]:0.02,[OIQ]:0.00 },
    SG: { [T3]:0.18,[MID]:0.18,[CLOSE]:0.18,[BH]:0.14,[PAS]:0.14,[SPD]:0.06,[ATH]:0.06,[OIQ]:0.02 },
    SF: { [T3]:0.18,[MID]:0.18,[CLOSE]:0.18,[BH]:0.10,[PAS]:0.10,[SPD]:0.08,[ATH]:0.10,[OIQ]:0.08 },
    PF: { [T3]:0.18,[MID]:0.18,[CLOSE]:0.18,[BH]:0.06,[PAS]:0.08,[SPD]:0.08,[ATH]:0.12,[OIQ]:0.12 },
    C:  { [T3]:0.18,[MID]:0.18,[CLOSE]:0.18,[BH]:0.04,[PAS]:0.10,[SPD]:0.06,[ATH]:0.16,[OIQ]:0.10 }
  };

  // defense weights on position-relative z
  const POS_DEF_WEIGHTS = {
    PG: { [PERD]:0.58,[STL]:0.32,[SPD]:0.06,[ATH]:0.04 },
    SG: { [PERD]:0.46,[STL]:0.26,[INTD]:0.12,[BLK]:0.08,[SPD]:0.04,[ATH]:0.04 },
    SF: { [PERD]:0.28,[STL]:0.18,[INTD]:0.28,[BLK]:0.18,[ATH]:0.05,[SPD]:0.03 },
    PF: { [INTD]:0.45,[BLK]:0.35,[PERD]:0.08,[STL]:0.08,[ATH]:0.04 },
    C:  { [INTD]:0.52,[BLK]:0.40,[ATH]:0.06,[PERD]:0.01,[STL]:0.01 }
  };

  /* ---------------- Overall (UNCHANGED) ---------------- */
  const calcOverall = (attrs,pos) => {
    const p = posParams[pos]; if (!p) return 0;
    const W = p.weights.reduce((s,w,i)=>s+w*attrs[i],0);
    const prim = p.prim.map(i=>i-1);
    const Peak = Math.max(...prim.map(i=>attrs[i]));
    const B = p.alpha*Peak + (1-p.alpha)*W;
    let overall = 60 + 39*sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = attrs.filter(a=>a>= 90).length;
    if (num90 >= 3) {
      const bonus = num90 - 2;
      overall = Math.min(99, overall + bonus);
    }
    return overall;
  };

// Completely replace your ratingBaselines useMemo with this:
const ratingBaselines = useMemo(() => {
  const POS = ["PG","SG","SF","PF","C"];
  const need = [BH,PAS,T3,MID,CLOSE,SPD,ATH,OIQ,PERD,INTD,BLK,STL];

  // gather per-position values
  const buckets = Object.fromEntries(POS.map(p => [p, Object.fromEntries(need.map(k => [k, []]))]));
  const allPlayers = [...(conferences.East||[]), ...(conferences.West||[])]
    .flatMap(t => (t.players||[]).map(p => ({
      pos: POS.includes(p.pos) ? p.pos : "SF",
      attrs: p.attrs || [],
    })));

  for (const pl of allPlayers) {
    const b = buckets[pl.pos];
    for (const k of need) b[k].push(Number.isFinite(pl.attrs[k]) ? pl.attrs[k] : 75);
  }

  // sample means/std (Bessel) per position
  const posMean = {};
  const posStd  = {};
  for (const pos of POS) {
    posMean[pos] = {}; posStd[pos] = {};
    for (const k of need) {
      const arr = buckets[pos][k];
      if (arr.length) {
        const m = arr.reduce((s,v)=>s+v,0)/arr.length;
        const v = arr.reduce((s,v)=>s+(v-m)*(v-m),0)/Math.max(1, arr.length-1);
        posMean[pos][k] = m;
        posStd[pos][k]  = safeStd(Math.sqrt(v));
      } else {
        posMean[pos][k] = 75;
        posStd[pos][k]  = 1.0;
      }
    }
  }

  // --- Python preview functions (NO jitter here) ---
  const z = (attrs, pos, idx) =>
    (attrs[idx] - (posMean[pos]?.[idx] ?? 75)) / (posStd[pos]?.[idx] ?? 1.0);

  const previewOff = (attrs, pos) => {
    const w = OFF_WEIGHTS_POSZ[pos] || OFF_WEIGHTS_POSZ.SF;
    let zsum = 0;
    for (const [k, wt] of Object.entries(w)) zsum += wt * z(attrs, pos, +k);
    let base = zToRating(zsum);
    // penalties (buffered thresholds)
    const t3Gap    = Math.max(0, 50 - (attrs[T3]||0)   - 2); // only if T3 < 48
    const closeGap = Math.max(0, 60 - (attrs[CLOSE]||0) - 2); // only if CLOSE < 58
    const t3Ded = Math.min(6, 0.07 * threePenaltyMult(pos) * t3Gap);
    const cDed  = Math.min(6, 0.07 * closePenaltyMult(pos)  * closeGap);
    return clamp(base - t3Ded - cDed, 50, 99);
  };

  const previewDef = (attrs, pos) => {
    const w = POS_DEF_WEIGHTS[pos] || POS_DEF_WEIGHTS.SF;
    let zsum = 0;
    for (const [k, wt] of Object.entries(w)) zsum += wt * z(attrs, pos, +k);
    let base = zToRating(zsum);
    // athleticism penalties
    const ath = attrs[ATH] ?? 75;
    const absPen = Math.max(0, 78 - ath) * 0.08;
    const relPen = Math.max(0, (posMean[pos]?.[ATH] ?? 75) - ath) * 0.05;
    const pen = Math.min(4, absPen + relPen);
    let val = base - pen;
    // positional caps (same as Python preview_def)
    const cap = pos === "C" ? 99 : pos === "PF" ? 98 : 96;
    return clamp(val, 50, cap);
  };

  // league means (OVR vs preview Off/Def)
  let sumOV=0, n=0, sumOFF=0, sumDEF=0;
  for (const t of [...(conferences.East||[]), ...(conferences.West||[])]) {
    for (const p of (t.players||[])) {
      const a = p.attrs || Array(15).fill(75);
      sumOV  += calcOverall(a, p.pos); n++;
      sumOFF += previewOff(a, p.pos);
      sumDEF += previewDef(a, p.pos);
    }
  }
  const ovMean  = n ? sumOV/n  : 75;
  const offMean = n ? sumOFF/n : 75;
  const defMean = n ? sumDEF/n : 75;

  // Python caps
  const offShift = clamp(ovMean - offMean, -1.5, 1.5);
  const defShift = clamp(ovMean - defMean, -1.5, 1.5);

  return { posMean, posStd, offShift, defShift };
}, [conferences]);


  /* ---------------- Off/Def: Python 1:1 ---------------- */
// Replace your calcOffDef with this exact version:
const calcOffDef = (attrs, pos, name = "", height = 78) => {
  const p = (["PG","SG","SF","PF","C"].includes(pos) ? pos : "SF");
  const { posMean, posStd, offShift, defShift } = ratingBaselines;

  const z = (idx) => ((attrs[idx] - (posMean[p]?.[idx] ?? 75)) / (posStd[p]?.[idx] ?? 1.0));

  // --- Off preview (no jitter here) ---
  const ow = OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF;
  let offZ = 0;
  for (const [k, wt] of Object.entries(ow)) offZ += wt * z(+k);
  let off = zToRating(offZ);
  const t3Gap    = Math.max(0, 50 - (attrs[T3]||0)   - 2);
  const closeGap = Math.max(0, 60 - (attrs[CLOSE]||0) - 2);
  const t3Ded = Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
  const cDed  = Math.min(6, 0.07 * closePenaltyMult(p)  * closeGap);
  off = clamp(off - t3Ded - cDed, 50, 99);

  // --- Def preview (no height bonus in Python) ---
  const dw = POS_DEF_WEIGHTS[p] || POS_DEF_WEIGHTS.SF;
  let defZ = 0;
  for (const [k, wt] of Object.entries(dw)) defZ += wt * z(+k);
  let def = zToRating(defZ);
  const ath = attrs[ATH] ?? 75;
  const absPen = Math.max(0, 78 - ath) * 0.08;
  const relPen = Math.max(0, ((posMean[p]?.[ATH] ?? 75) - ath)) * 0.05;
  const pen = Math.min(4, absPen + relPen);
  def = def - pen;
  const defCap = p==="C" ? 99 : p==="PF" ? 98 : 96;
  def = clamp(def, 50, defCap);

  // --- Apply shifts, then micro-jitter (Python order) ---
  const j = microJitter(attrs, name || p);
  off = clamp(off + offShift + j, 50, 99);
  def = clamp(def + defShift + 0.7*j, 50, defCap);

  // Python-style rounding
  return { off: pyRound(off), def: pyRound(def) };
};


  /* ---------------- Stamina (unchanged) ---------------- */
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
        const addIds = (teams)=>(teams||[]).map(t=>({
          ...t,
          players:(t.players||[]).map(p=>({ id: p.id || genId(), ...p }))
        }));
        setConferences({
          East: addIds(data.conferences?.East),
          West: addIds(data.conferences?.West)
        });
      }catch{}
    }
  },[]);

  useEffect(()=>{
    localStorage.setItem("leagueData",JSON.stringify({leagueName,conferences}));
  },[leagueName,conferences]);

  /* ---------------- Live Recalc (kept) ---------------- */
  useEffect(() => {
    if (!showPlayerForm) return;
    setPlayerForm(prev => {
      const overall = calcOverall(prev.attrs, prev.pos);
      const { off, def } = calcOffDef(prev.attrs, prev.pos, prev.name, prev.height);
      const stamina = calcStamina(prev.age, prev.attrs[7]);
      return { ...prev, overall, offRating: off, defRating: def, stamina };
    });
  }, [showPlayerForm, playerForm.pos, playerForm.attrs, playerForm.age, playerForm.potential, playerForm.height]);

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
      const safe={potential:75,height:78,secondaryPos:"",id: ex.id || genId(), ...ex};
      setPlayerForm(JSON.parse(JSON.stringify(safe)));
    }else{
      setEditingPlayer(null);setPlayerForm(initPlayer());
    }
    setShowPlayerForm(true);
  };

  const savePlayer=()=>{
    const p={...playerForm};
    if (!p.id) p.id = genId();
    const {off,def}=calcOffDef(p.attrs,p.pos,p.name,p.height);
    p.overall=calcOverall(p.attrs,p.pos);
    p.offRating=off;p.defRating=def;p.stamina=calcStamina(p.age,p.attrs[7]);

    const teamKey = `${selectedConf}-${editingTeam}`;
    const isSorted = !!sortedTeams[editingTeam];

    setConferences(prev=>{
      const copy=JSON.parse(JSON.stringify(prev));
      const arr = copy[selectedConf][editingTeam].players;
      copy[selectedConf][editingTeam].players = arr.map(x => ({ id: x.id || genId(), ...x }));

      if(editingPlayer!==null){
        copy[selectedConf][editingTeam].players[editingPlayer]=p;
      }else{
        copy[selectedConf][editingTeam].players.push(p);
        if (isSorted && originalOrders[teamKey]) {
          setOriginalOrders(prevOrders => ({
            ...prevOrders,
            [teamKey]: [...prevOrders[teamKey], p.id]
          }));
        }
      }
      return copy;
    });
    setShowPlayerForm(false);
  };

  // Sort fix: save original ID order; restore by ID so edits made while sorted are preserved
  const toggleSort = (idx) => {
    const teamKey = `${selectedConf}-${idx}`;
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const teamObj = copy[selectedConf][idx];
      teamObj.players = (teamObj.players || []).map(p => ({ id: p.id || genId(), ...p }));

      const isActivating = !sortedTeams[idx];
      if (isActivating) {
        const idOrder = teamObj.players.map(p => p.id);
        setOriginalOrders(prevOrders => ({ ...prevOrders, [teamKey]: idOrder }));
        teamObj.players.sort((a, b) => b.overall - a.overall);
      } else {
        const savedOrder = originalOrders[teamKey] || [];
        const idToPos = new Map(savedOrder.map((id,i)=>[id,i]));
        teamObj.players.sort((a,b)=>{
          const ia = idToPos.has(a.id) ? idToPos.get(a.id) : 1e9;
          const ib = idToPos.has(b.id) ? idToPos.get(b.id) : 1e9;
          return ia - ib;
        });
        setOriginalOrders(prevOrders => {
          const n = { ...prevOrders }; delete n[teamKey]; return n;
        });
      }
      return copy;
    });
    setSortedTeams(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

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
                    const addIds = (teams)=>(teams||[]).map(t=>({
                      ...t,
                      players:(t.players||[]).map(p=>({ id: p.id || genId(), ...p }))
                    }));
                    const cleaned = {
                      leagueName: d.leagueName,
                      conferences: { East: addIds(d.conferences.East), West: addIds(d.conferences.West) }
                    };
                    setLeagueName(cleaned.leagueName);
                    setConferences(cleaned.conferences);
                    localStorage.setItem("leagueData",JSON.stringify(cleaned));
                    alert(`✅ Imported ${cleaned.leagueName}`);
                  }else alert("⚠️ Invalid JSON");
                }catch{alert("❌ Failed to parse JSON");}
              };
              r.readAsText(f);
            }}/>
        </label>
<button
  onClick={() => {
    const snapshot = buildExportSnapshot(); // <-- recompute here
    const json = { leagueName, conferences: snapshot };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${leagueName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }}
  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
>
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
        const players = team.players;
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
                  const key = `${selectedConf}-${idx}`;
                  setOriginalOrders(prevOrders => {
                    const next = { ...prevOrders }; delete next[key]; return next;
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
    <th className="text-center font-semibold">OFF</th>
    <th className="text-center font-semibold">DEF</th>
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
                 <td className="text-center font-bold">{p.overall}</td>

{/* OFF */}
<td className="text-center">
  <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-800 text-sm font-semibold px-2 py-0.5">
    {p.offRating}
  </span>
</td>

{/* DEF */}
<td className="text-center">
  <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-800 text-sm font-semibold px-2 py-0.5">
    {p.defRating}
  </span>
</td>

{/* POT (unchanged) */}
<td className="text-center">{p.potential}</td>

                  <td className="text-center">{p.potential}</td>
                  <td className="text-right">
                    <button onClick={()=>openPlayerForm(idx,i)} className="text-blue-600 text-sm hover:underline mr-2">Edit</button>
                    <button onClick={()=>{
                      setConferences(prev=>{
                        const c=JSON.parse(JSON.stringify(prev));
                        const arr = c[selectedConf][idx].players;
                        const victim = arr[i];
                        const victimId = victim?.id;
                        arr.splice(i,1);
                        const key = `${selectedConf}-${idx}`;
                        if (sortedTeams[idx] && originalOrders[key]) {
                          setOriginalOrders(prevOrders => ({
                            ...prevOrders,
                            [key]: prevOrders[key].filter(id => id !== victimId)
                          }));
                        }
                        return c;
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
