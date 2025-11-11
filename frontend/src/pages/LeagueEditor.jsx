import React, { useState, useEffect, useMemo } from "react";

/* ------------------------------------------------------------
   League Editor v5.1 (v19 OFF/DEF parity + live table render)
   - OFF/DEF table cells now compute from live formula (no lag)
   - v19 math: PF absolute mix + PF→SF bridge + SF DEF lift
   - Banker’s rounding; jitter after league-shift
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
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  /* ---------------- Attribute indexes ---------------- */
  const T3 = 0, MID = 1, CLOSE = 2, FT = 3, BH = 4, PAS = 5, SPD = 6, ATH = 7;
  const PERD = 8, INTD = 9, BLK = 10, STL = 11, REB = 12, OIQ = 13, DIQ = 14;

  /* ---------------- Position Params for Overall (unchanged) ---------------- */
  const posParams = {
    PG: { weights: [0.11,0.05,0.03,0.05,0.17,0.17,0.10,0.07,0.10,0.02,0.01,0.07,0.05,0.01,0.01], prim:[5,6,1,7],  alpha:0.25 },
    SG: { weights: [0.15,0.08,0.05,0.05,0.12,0.07,0.11,0.07,0.11,0.03,0.02,0.08,0.06,0.01,0.01], prim:[1,5,7],    alpha:0.28 },
    SF: { weights: [0.12,0.09,0.07,0.04,0.08,0.07,0.10,0.10,0.10,0.06,0.04,0.08,0.05,0.01,0.01], prim:[1,8,9],    alpha:0.22 },
    PF: { weights: [0.07,0.07,0.12,0.03,0.05,0.05,0.08,0.12,0.07,0.13,0.08,0.08,0.05,0.01,0.01], prim:[3,10,8],   alpha:0.24 },
    C : { weights: [0.04,0.06,0.17,0.03,0.02,0.04,0.07,0.12,0.05,0.16,0.13,0.06,0.08,0.01,0.01], prim:[3,10,11,13],alpha:0.30 },
  };

  const attrNames = [
    "Three Point","Mid Range","Close Shot","Free Throw",
    "Ball Handling","Passing","Speed","Athleticism",
    "Perimeter Defense","Interior Defense","Block","Steal",
    "Rebounding","Offensive IQ","Defensive IQ"
  ];

  /* ---------------- v19 OFF weights on position z ---------------- */
  const OFF_WEIGHTS_POSZ = {
    PG: { [T3]:0.18, [MID]:0.18, [CLOSE]:0.18, [BH]:0.20, [PAS]:0.20, [SPD]:0.04, [ATH]:0.02, [OIQ]:0.00 },
    SG: { [T3]:0.18, [MID]:0.18, [CLOSE]:0.18, [BH]:0.14, [PAS]:0.14, [SPD]:0.06, [ATH]:0.06, [OIQ]:0.02 },
    SF: { [T3]:0.18, [MID]:0.18, [CLOSE]:0.18, [BH]:0.10, [PAS]:0.10, [SPD]:0.08, [ATH]:0.10, [OIQ]:0.08 },
    PF: { [T3]:0.18, [MID]:0.18, [CLOSE]:0.18, [BH]:0.10, [PAS]:0.12, [SPD]:0.08, [ATH]:0.08, [OIQ]:0.08 }, // retuned
    C : { [T3]:0.18, [MID]:0.18, [CLOSE]:0.18, [BH]:0.04, [PAS]:0.10, [SPD]:0.06, [ATH]:0.16, [OIQ]:0.10 },
  };

  /* ---------------- v19 penalties ---------------- */
  const threePenaltyMult = (pos) => ({ PG:1.10, SG:1.00, SF:0.75, PF:0.80, C:0.30 }[pos] || 1);
  const closePenaltyMult  = (pos) => ({ PG:0.30, SG:0.45, SF:0.70, PF:0.85, C:1.10 }[pos] || 1);

  /* ---------------- Helpers ---------------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Python-style "banker's" rounding (ties-to-even)
  function bankersRound(n) {
    const f = Math.floor(n);
    const diff = n - f;
    if (Math.abs(diff - 0.5) < 1e-9) return (f % 2 === 0) ? f : f + 1;
    return Math.round(n);
  }

  // v19 jitter: name+attrs → deterministic ~[-0.35, +0.35] (OFF), DEF adds 0.7*j
  function v19Jitter(name = "", attrs = []) {
    // sums similar to python: Σ (i+1)*attr and Σ char codes
    let sA = 0; for (let i = 0; i < attrs.length; i++) sA += (i + 1) * (attrs[i] ?? 0);
    let sN = 0; for (let i = 0; i < name.length; i++) sN += name.charCodeAt(i);
    // match constants from the script flavor
    const seed = (sA + 0.13 * sN) * 12.9898;
    const raw  = Math.sin(seed) * 43758.5453;
    const frac = raw - Math.floor(raw);            // [0,1)
    return (frac - 0.5) * 0.7;                     // ~[-0.35,+0.35]
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

  /* ---------------- Overall & Stamina (unchanged) ---------------- */
  const calcOverall = (attrs, pos) => {
    const p = posParams[pos]; if (!p) return 0;
    const W = p.weights.reduce((s,w,i)=>s+w*(attrs[i]||75),0);
    const prim = p.prim.map(i=>i-1);
    const Peak = Math.max(...prim.map(i=>attrs[i]||75));
    const B = p.alpha*Peak + (1-p.alpha)*W;
    let overall = 60 + 39*sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = (attrs||[]).filter(a=>a>=90).length;
    if (num90 >= 3) {
      const bonus = num90 - 2;
      overall = Math.min(99, overall + bonus);
    }
    return overall;
  };

  const calcStamina = (age, athleticism) => {
    age = clamp(age,18,45); athleticism = clamp(athleticism,25,99);
    let ageFactor;
    if(age<=27) ageFactor=1.0;
    else if(age<=34) ageFactor=0.95-(0.15*(age-28)/6);
    else ageFactor=0.8-(0.45*(age-35)/10);
    ageFactor = clamp(ageFactor,0.35,1.0);
    const raw = (ageFactor*99*0.575)+(athleticism*0.425);
    const norm=(raw-40)/(99-40);
    return Math.round(clamp(40+norm*59,40,99));
  };

  /* ---------------- v19 Baselines (pos means/std + league-absolute means/std) ---------------- */
  const ratingBaselines = useMemo(() => {
    const POS = ["PG","SG","SF","PF","C"];
    const offIdx = [T3,MID,CLOSE,BH,PAS,SPD,ATH,OIQ];
    const defIdx = [PERD,STL,INTD,BLK,SPD,ATH];

    // Gather all players
    const allPlayers = [...(conferences.East||[]), ...(conferences.West||[])]
      .flatMap(t => (t.players||[]).map(p => ({
        pos: POS.includes(p.pos) ? p.pos : "SF",
        attrs: p.attrs || Array(15).fill(75),
      })));

    const posBuckets = Object.fromEntries(POS.map(p => [p, Object.fromEntries(
      [...offIdx, ...defIdx].map(k => [k, []])
    )]));
    const absBuckets = Object.fromEntries(offIdx.map(k => [k, []]));

    for (const pl of allPlayers) {
      const { pos, attrs } = pl;
      for (const k of [...offIdx, ...defIdx]) posBuckets[pos][k].push(attrs[k]);
      for (const k of offIdx) absBuckets[k].push(attrs[k]);
    }

    const sampleStd = (arr) => {
      const n = arr.length; if (n < 2) return 1.0;
      const m = arr.reduce((s,v)=>s+v,0)/n;
      const v = arr.reduce((s,v)=>s+(v-m)*(v-m),0)/(n-1);
      return Math.max(1.0, Math.sqrt(v));
    };

    const posMean = {}, posStd = {};
    for (const p of POS) {
      posMean[p] = {}; posStd[p] = {};
      for (const k of [...offIdx, ...defIdx]) {
        const arr = posBuckets[p][k];
        posMean[p][k] = arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 75;
        posStd[p][k]  = arr.length ? sampleStd(arr) : 1.0;
      }
    }
    const absMean = {}, absStd = {};
    for (const k of offIdx) {
      const arr = absBuckets[k];
      absMean[k] = arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 75;
      absStd[k]  = arr.length ? sampleStd(arr) : 1.0;
    }

    const safe = (v) => (v && v>1e-6 ? v : 1.0);
    const zPos = (attrs, pos, k) => (attrs[k] - (posMean[pos]?.[k] ?? 75)) / safe(posStd[pos]?.[k]);
    const zAbs = (attrs, k)      => (attrs[k] - (absMean[k] ?? 75))       / safe(absStd[k]);

    // PF -> SF 70/30 bridge (weights)
    const pfBridgedWeights = (() => {
      const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
      const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
      const out = {};
      for (const k of keys) out[k] = 0.7*(pf[k]||0) + 0.3*(sf[k]||0);
      return out;
    })();

    const ABS_MIX = { PF:0.70, SF:0.20, PG:0.10, SG:0.10, C:0.10 };
    const zToRating = (z) => clamp(75 + 12*z, 50, 99);

    // --- preview (NO jitter) ---
    const previewOff = (attrs, pos) => {
      const p = ["PG","SG","SF","PF","C"].includes(pos) ? pos : "SF";
      const w = (p === "PF") ? pfBridgedWeights : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);
      const mix = ABS_MIX[p] ?? 0.10;

      let zPosSum = 0, zAbsSum = 0;
      for (const [kStr, wt] of Object.entries(w)) {
        const k = +kStr; zPosSum += wt * zPos(attrs, p, k); zAbsSum += wt * zAbs(attrs, k);
      }
      let off = zToRating((1-mix)*zPosSum + mix*zAbsSum);

      const t3Gap = Math.max(0, 50 - (attrs[T3]||0) - 2); // 48
      const cGap  = Math.max(0, 60 - (attrs[CLOSE]||0) - 2); // 58
      off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
      off -= Math.min(6, 0.07 * closePenaltyMult(p)  * cGap);
      return clamp(off, 50, 99);
    };

    const previewDef = (attrs, pos) => {
      const p = ["PG","SG","SF","PF","C"].includes(pos) ? pos : "SF";
      const DW = {
        PG: { [PERD]:0.58, [STL]:0.32, [SPD]:0.06, [ATH]:0.04 },
        SG: { [PERD]:0.46, [STL]:0.26, [INTD]:0.12, [BLK]:0.08, [SPD]:0.04, [ATH]:0.04 },
        SF: { [PERD]:0.28, [STL]:0.18, [INTD]:0.28, [BLK]:0.18, [ATH]:0.05, [SPD]:0.03 },
        PF: { [INTD]:0.45, [BLK]:0.35, [PERD]:0.08, [STL]:0.08, [ATH]:0.04 },
        C : { [INTD]:0.52, [BLK]:0.40, [ATH]:0.06, [PERD]:0.01, [STL]:0.01 },
      }[p] || {};
      let zsum = 0; for (const [kStr, wt] of Object.entries(DW)) zsum += wt * zPos(attrs, p, +kStr);
      let def = zToRating(zsum);

      const ath = attrs[ATH] ?? 75;
      let absPen = Math.max(0, 78 - ath) * 0.08;
      let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

      if (p === "SF") {
        absPen *= 0.80; relPen *= 0.80;
        def += 2.5;
        const perd = attrs[PERD] ?? 75, intd = attrs[INTD] ?? 75;
        const hi = Math.max(perd, intd), lo = Math.min(perd, intd);
        if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
        let tier = 0;
        if (perd >= 90 || intd >= 90) tier += 0.5;
        if (perd >= 85 && intd >= 85) tier += 0.5;
        if (hi >= 93 && lo >= 84)   tier += 0.5;
        if (hi >= 94 && lo >= 90)   tier += 0.5;
        def += Math.min(2.0, tier);
      }

      def -= Math.min(4, absPen + relPen);
      const cap = p==="C" ? 99 : p==="PF" ? 98 : 96;
      return clamp(def, 50, cap);
    };

    // league mean shifts
    let sumOV=0, sumOFF=0, sumDEF=0, n=0;
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

    const offShift = clamp(ovMean - offMean, -1.5, 1.5);
    const defShift = clamp(ovMean - defMean, -1.5, 1.5);

    return { posMean, posStd, absMean, absStd, offShift, defShift };
  }, [conferences]);

  /* ---------------- v19 Ratings (live) ---------------- */
  const calcOffDef = (attrs, pos, name = "", height = 78) => {
    const p = (["PG","SG","SF","PF","C"].includes(pos) ? pos : "SF");
    const { posMean, posStd, absMean, absStd, offShift, defShift } = ratingBaselines;

    const safe = (v) => (v && v>1e-6 ? v : 1.0);
    const zPos = (k) => ((attrs[k] - (posMean[p]?.[k] ?? 75)) / safe(posStd[p]?.[k]));
    const zAbs = (k) => ((attrs[k] - (absMean[k]     ?? 75)) / safe(absStd[k]));
    const zToRating = (z) => clamp(75 + 12*z, 50, 99);

    // OFF: PF absolute mix + PF→SF bridge
    const ABS_MIX = { PF:0.70, SF:0.20, PG:0.10, SG:0.10, C:0.10 };
    const wBase = (p === "PF")
      ? (() => { const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
                 const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
                 const out = {}; for (const k of keys) out[k] = 0.7*(pf[k]||0) + 0.3*(sf[k]||0); return out; })()
      : (OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF);

    let zPosSum = 0, zAbsSum = 0;
    for (const [kStr, wt] of Object.entries(wBase)) {
      const k = +kStr; zPosSum += wt * zPos(k); zAbsSum += wt * zAbs(k);
    }
    const mix = ABS_MIX[p] ?? 0.10;
    let off = zToRating((1-mix)*zPosSum + mix*zAbsSum);

    const t3Gap = Math.max(0, 50 - (attrs[T3]||0) - 2);
    const cGap  = Math.max(0, 60 - (attrs[CLOSE]||0) - 2);
    off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
    off -= Math.min(6, 0.07 * closePenaltyMult(p)  * cGap);

    // DEF: SF lift and caps
    const DW = {
      PG: { [PERD]:0.58, [STL]:0.32, [SPD]:0.06, [ATH]:0.04 },
      SG: { [PERD]:0.46, [STL]:0.26, [INTD]:0.12, [BLK]:0.08, [SPD]:0.04, [ATH]:0.04 },
      SF: { [PERD]:0.28, [STL]:0.18, [INTD]:0.28, [BLK]:0.18, [ATH]:0.05, [SPD]:0.03 },
      PF: { [INTD]:0.45, [BLK]:0.35, [PERD]:0.08, [STL]:0.08, [ATH]:0.04 },
      C : { [INTD]:0.52, [BLK]:0.40, [ATH]:0.06, [PERD]:0.01, [STL]:0.01 },
    }[p] || {};
    let zsumD = 0; for (const [kStr, wt] of Object.entries(DW)) zsumD += wt * zPos(+kStr);
    let def = zToRating(zsumD);

    const ath = attrs[ATH] ?? 75;
    let absPen = Math.max(0, 78 - ath) * 0.08;
    let relPen = Math.max(0, ((posMean[p]?.[ATH] ?? 75) - ath)) * 0.05;
    if (p === "SF") {
      absPen *= 0.80; relPen *= 0.80;
      def += 2.5;
      const perd = attrs[PERD] ?? 75, intd = attrs[INTD] ?? 75;
      const hi = Math.max(perd, intd), lo = Math.min(perd, intd);
      if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
      let tier = 0;
      if (perd >= 90 || intd >= 90) tier += 0.5;
      if (perd >= 85 && intd >= 85) tier += 0.5;
      if (hi >= 93 && lo >= 84)   tier += 0.5;
      if (hi >= 94 && lo >= 90)   tier += 0.5;
      def += Math.min(2.0, tier);
    }
    def -= Math.min(4, absPen + relPen);

    // league-shift → jitter → clamp → banker’s round
    const j = v19Jitter(name, attrs);
    off = clamp(off + offShift + j, 50, 99);
    const defCap = p==="C" ? 99 : p==="PF" ? 98 : 96;
    def = clamp(def + defShift + 0.7*j, 50, defCap);

    return { off: bankersRound(off), def: bankersRound(def) };
  };

  /* ---------------- Auto-Save + Load ---------------- */
  useEffect(() => {
    const saved = localStorage.getItem("leagueData");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setLeagueName(data.leagueName || "NBA 2025");
        setConferences(data.conferences || { East: [], West: [] });
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("leagueData", JSON.stringify({ leagueName, conferences }));
  }, [leagueName, conferences]);

  /* ---------------- Live Recalc in Modal ---------------- */
  useEffect(() => {
    if (!showPlayerForm) return;
    setPlayerForm(prev => {
      const overall = calcOverall(prev.attrs, prev.pos);
      const { off, def } = calcOffDef(prev.attrs, prev.pos, prev.name, prev.height);
      const stamina = calcStamina(prev.age, prev.attrs[ATH]);
      return { ...prev, overall, offRating: off, defRating: def, stamina };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlayerForm, playerForm.attrs, playerForm.age, playerForm.potential, playerForm.height, playerForm.pos, playerForm.name]);

  /* ---------------- Handlers ---------------- */
  const addTeam = () => {
    if (!newTeamName.trim()) return;
    const team = { name: newTeamName.trim(), logo: newTeamLogo.trim(), players: [] };
    setConferences(prev => ({ ...prev, [selectedConf]: [...prev[selectedConf], team] }));
    setNewTeamName(""); setNewTeamLogo("");
  };

  const openEditTeam = (idx) => setEditTeamModal({ idx, ...conferences[selectedConf][idx] });

  const saveEditTeam = () => {
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy[selectedConf][editTeamModal.idx].name = editTeamModal.name;
      copy[selectedConf][editTeamModal.idx].logo = editTeamModal.logo;
      return copy;
    });
    setEditTeamModal(null);
  };

  const openPlayerForm = (tIdx, pIdx = null) => {
    setEditingTeam(tIdx);
    if (pIdx !== null) {
      setEditingPlayer(pIdx);
      const ex = conferences[selectedConf][tIdx].players[pIdx];
      const safe = { potential: 75, height: 78, secondaryPos: "", ...ex };
      setPlayerForm(JSON.parse(JSON.stringify(safe)));
    } else {
      setEditingPlayer(null);
      setPlayerForm(initPlayer());
    }
    setShowPlayerForm(true);
  };

  const savePlayer = () => {
    const p = { ...playerForm };
    const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
    p.overall = calcOverall(p.attrs, p.pos);
    p.offRating = off; p.defRating = def; p.stamina = calcStamina(p.age, p.attrs[ATH]);
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (editingPlayer !== null) copy[selectedConf][editingTeam].players[editingPlayer] = p;
      else copy[selectedConf][editingTeam].players.push(p);
      return copy;
    });
    setShowPlayerForm(false);
  };

  // OVR sort toggle (preserves original order snapshot)
  const toggleSort = (idx) => {
    setConferences(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const team = copy[selectedConf][idx];
      const isSorted = !sortedTeams[idx];

      if (isSorted) {
        setOriginalOrders(prevOrders => ({
          ...prevOrders,
          [`${selectedConf}-${idx}`]: [...team.players],
        }));
        team.players.sort((a, b) => b.overall - a.overall);
      } else {
        setOriginalOrders(prevOrders => {
          const saved = prevOrders[`${selectedConf}-${idx}`];
          if (saved) team.players = saved;
          const newOrders = { ...prevOrders };
          delete newOrders[`${selectedConf}-${idx}`];
          return newOrders;
        });
      }
      return copy;
    });

    setSortedTeams(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAdvanced = (idx) => setExpandedTeams(prev => ({ ...prev, [idx]: !prev[idx] }));

  // Export snapshot: recompute OFF/DEF with current baselines, bake into JSON
  const buildExportSnapshot = () => {
    const clone = JSON.parse(JSON.stringify(conferences));
    const recalcPlayer = (p) => {
      const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
      return {
        ...p,
        overall: calcOverall(p.attrs, p.pos),
        offRating: off,
        defRating: def,
        stamina: calcStamina(p.age, p.attrs[ATH]),
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
              const snapshot = buildExportSnapshot();
              const json={leagueName,conferences:snapshot};
              const blob=new Blob([JSON.stringify(json,null,2)],{type:"application/json"});
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
          const players = team.players || [];
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
                  <th className="text-center font-semibold">OFF</th>
                  <th className="text-center font-semibold">DEF</th>
                  <th className="text-center font-semibold">POT</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {players.map((p,i)=>{
                  // Always compute OFF/DEF live for display parity
                  const live = calcOffDef(p.attrs, p.pos, p.name, p.height);
                  return (
                  <tr key={p.id || i} className="border-b align-middle py-4">
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
                            {attrNames.map((n,j)=><span key={j}>{n.split(" ")[0]} {p.attrs?.[j]}</span>)}
                            <span>Off {live.off}</span><span>Def {live.def}</span>
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
                    <td className="text-center">{live.off}</td>
                    <td className="text-center">{live.def}</td>
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
                )})}
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
                    type="range" min="25" max="99" value={playerForm.attrs[i]}
                    onChange={e =>
                      setPlayerForm(p => ({ ...p, attrs: p.attrs.map((a, j) => j === i ? +e.target.value : a) }))
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              ))}
              <div>
                <label className="text-sm">Age: {playerForm.age}</label>
                <input type="range" min="18" max="45" value={playerForm.age}
                  onChange={e => setPlayerForm({ ...playerForm, age: +e.target.value })}
                  className="w-full accent-green-600" />
              </div>
              <div>
                <label className="text-sm">Height: {formatHeight(playerForm.height)}</label>
                <input type="range" min="65" max="90" value={playerForm.height}
                  onChange={e => setPlayerForm({ ...playerForm, height: +e.target.value })}
                  className="w-full accent-purple-600" />
              </div>
              <div>
                <label className="text-sm">Potential: {playerForm.potential}</label>
                <input type="range" min="25" max="99" value={playerForm.potential}
                  onChange={e => setPlayerForm({ ...playerForm, potential: +e.target.value })}
                  className="w-full accent-pink-600" />
              </div>
            </div>

            {/* Live Stat Bar */}
            <p className="mt-4 font-semibold text-lg">
              Overall: {playerForm.overall} | Off: {playerForm.offRating} | Def: {playerForm.defRating} | Sta: {playerForm.stamina} | Pot: {playerForm.potential} | Ht: {formatHeight(playerForm.height)}
            </p>

            {/* Modal Buttons */}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowPlayerForm(false)} className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400">Cancel</button>
              <button onClick={savePlayer} className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700">Save Player</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Team Modal */}
      {editTeamModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[400px]">
            <h2 className="text-xl font-bold mb-4">Edit Team</h2>
            <input className="border p-2 rounded w-full mb-2" placeholder="Team Name"
              value={editTeamModal.name} onChange={e => setEditTeamModal({ ...editTeamModal, name: e.target.value })}/>
            <input className="border p-2 rounded w-full mb-4" placeholder="Logo URL"
              value={editTeamModal.logo} onChange={e => setEditTeamModal({ ...editTeamModal, logo: e.target.value })}/>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditTeamModal(null)} className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400">Cancel</button>
              <button onClick={saveEditTeam} className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function formatHeight(inches) {
    const ft=Math.floor(inches/12);
    const ins=inches%12;
    return `${ft}′${ins}″`;
  }
}
