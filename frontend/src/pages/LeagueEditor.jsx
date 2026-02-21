// LeagueEditor.jsx
import React, { useState, useEffect, useMemo } from "react";

/* ------------------------------------------------------------
   League Editor v5.1 (v19 OFF/DEF parity + live table render)
   - OFF/DEF table cells now compute from live formula (no lag)
   - v19 math: PF absolute mix + PF→SF bridge + SF DEF lift
   - Banker’s rounding; jitter after league-shift
   - NEW: birthdays + contracts (with options) + backwards-compatible import/load
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

  // Trades modal state (simple roster swap tool)
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeA, setTradeA] = useState({ conf: "East", teamIdx: 0 });
  const [tradeB, setTradeB] = useState({ conf: "West", teamIdx: 0 });
  const [sendAIds, setSendAIds] = useState([]);
  const [sendBIds, setSendBIds] = useState([]);

  const allTeamsFlat = useMemo(() => {
    const out = [];
    for (const conf of ["East", "West"]) {
      for (let i = 0; i < (conferences[conf] || []).length; i++) {
        const t = conferences[conf][i];
        out.push({
          key: `${conf}-${i}`,
          conf,
          teamIdx: i,
          name: t?.name || `${conf} Team ${i + 1}`,
        });
      }
    }
    return out;
  }, [conferences]);

  const getTeam = (ref) => conferences?.[ref.conf]?.[ref.teamIdx] || null;

  const toggleId = (arr, id) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const openTradeModal = () => {
    const firstEast = conferences?.East?.length
      ? { conf: "East", teamIdx: 0 }
      : { conf: "West", teamIdx: 0 };
    const firstWest = conferences?.West?.length
      ? { conf: "West", teamIdx: 0 }
      : { conf: "East", teamIdx: 0 };

    setTradeA(firstEast);
    setTradeB(firstWest);
    setSendAIds([]);
    setSendBIds([]);
    setShowTradeModal(true);
  };

  const executeTrade = () => {
    const A = getTeam(tradeA);
    const B = getTeam(tradeB);

    if (!A || !B) return;

    if (tradeA.conf === tradeB.conf && tradeA.teamIdx === tradeB.teamIdx) {
      alert("Pick two different teams.");
      return;
    }

    setConferences((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));

      const teamA = copy[tradeA.conf][tradeA.teamIdx];
      const teamB = copy[tradeB.conf][tradeB.teamIdx];

      const aSend = (teamA.players || []).filter((p) => sendAIds.includes(p.id));
      const bSend = (teamB.players || []).filter((p) => sendBIds.includes(p.id));

      teamA.players = (teamA.players || [])
        .filter((p) => !sendAIds.includes(p.id))
        .concat(bSend);
      teamB.players = (teamB.players || [])
        .filter((p) => !sendBIds.includes(p.id))
        .concat(aSend);

      return copy;
    });

    setSendAIds([]);
    setSendBIds([]);
    setShowTradeModal(false);
  };

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
      scoringRating: 50,

      // NEW: birthdays
      birthMonth: 1,
      birthDay: 1,

      // NEW: contract (supports options)
      contract: {
        startYear: 2026,
        salaryByYear: [8_000_000, 8_500_000],
        option: null, // { yearIndex: 1, type: "team" | "player", picked: null }
      },
    };
  }

  // Backwards-compatible defaults for player objects (load/import/edit)
  const normalizePlayer = (p) => {
    const birthMonth = Number(p?.birthMonth ?? 1);
    const birthDay = Number(p?.birthDay ?? 1);

    const contract =
      p?.contract ??
      (p?.salary != null || p?.contractYears != null
        ? {
            startYear: 2026,
            salaryByYear: Array(Math.max(1, Number(p.contractYears ?? 1))).fill(
              Number(p.salary ?? 8) * 1_000_000
            ),
            option: null,
          }
        : {
            startYear: 2026,
            salaryByYear: [8_000_000, 8_500_000],
            option: null,
          });

    const safeContract = {
      startYear: Number(contract?.startYear ?? 2026),
      salaryByYear: Array.isArray(contract?.salaryByYear)
        ? contract.salaryByYear.map((x) => Number(x) || 0)
        : [8_000_000],
      option: contract?.option ?? null,
    };

    return {
      ...p,
      headshot: p?.headshot || "",
      scoringRating: p?.scoringRating ?? 50,
      birthMonth: Math.min(12, Math.max(1, birthMonth)),
      birthDay: Math.min(31, Math.max(1, birthDay)),
      contract: safeContract,
    };
  };

  /* ---------------- Attribute indexes ---------------- */
  const T3 = 0,
    MID = 1,
    CLOSE = 2,
    FT = 3,
    BH = 4,
    PAS = 5,
    SPD = 6,
    ATH = 7;
  const PERD = 8,
    INTD = 9,
    BLK = 10,
    STL = 11,
    REB = 12,
    OIQ = 13,
    DIQ = 14;

  /* ---------------- Position Params for Overall (unchanged) ---------------- */
  const posParams = {
    PG: {
      weights: [
        0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.1, 0.07, 0.1, 0.02, 0.01, 0.07, 0.05,
        0.01, 0.01,
      ],
      prim: [5, 6, 1, 7],
      alpha: 0.25,
    },
    SG: {
      weights: [
        0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08,
        0.06, 0.01, 0.01,
      ],
      prim: [1, 5, 7],
      alpha: 0.28,
    },
    SF: {
      weights: [
        0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.1, 0.1, 0.1, 0.06, 0.04, 0.08,
        0.05, 0.01, 0.01,
      ],
      prim: [1, 8, 9],
      alpha: 0.22,
    },
    PF: {
      weights: [
        0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08,
        0.08, 0.05, 0.01, 0.01,
      ],
      prim: [3, 10, 8],
      alpha: 0.24,
    },
    C: {
      weights: [
        0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13,
        0.06, 0.08, 0.01, 0.01,
      ],
      prim: [3, 10, 11, 13],
      alpha: 0.3,
    },
  };

  const attrNames = [
    "Three Point",
    "Mid Range",
    "Close Shot",
    "Free Throw",
    "Ball Handling",
    "Passing",
    "Speed",
    "Athleticism",
    "Perimeter Defense",
    "Interior Defense",
    "Block",
    "Steal",
    "Rebounding",
    "Offensive IQ",
    "Defensive IQ",
  ];

  /* ---------------- v19 OFF weights on position z ---------------- */
  const OFF_WEIGHTS_POSZ = {
    PG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.2, [PAS]: 0.2, [SPD]: 0.04, [ATH]: 0.02, [OIQ]: 0.0 },
    SG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.14, [PAS]: 0.14, [SPD]: 0.06, [ATH]: 0.06, [OIQ]: 0.02 },
    SF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.1, [PAS]: 0.1, [SPD]: 0.08, [ATH]: 0.1, [OIQ]: 0.08 },
    PF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.1, [PAS]: 0.12, [SPD]: 0.08, [ATH]: 0.08, [OIQ]: 0.08 },
    C: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.04, [PAS]: 0.1, [SPD]: 0.06, [ATH]: 0.16, [OIQ]: 0.1 },
  };

  /* ---------------- v19 penalties ---------------- */
  const threePenaltyMult = (pos) =>
    ({ PG: 1.1, SG: 1.0, SF: 0.75, PF: 0.8, C: 0.3 }[pos] || 1);
  const closePenaltyMult = (pos) =>
    ({ PG: 0.3, SG: 0.45, SF: 0.7, PF: 0.85, C: 1.1 }[pos] || 1);

  /* ---------------- Helpers ---------------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function bankersRound(n) {
    const f = Math.floor(n);
    const diff = n - f;
    if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(n);
  }

  function v19Jitter(name = "", attrs = []) {
    let sA = 0;
    for (let i = 0; i < attrs.length; i++) sA += (i + 1) * (attrs[i] ?? 0);
    let sN = 0;
    for (let i = 0; i < name.length; i++) sN += name.charCodeAt(i);
    const seed = (sA + 0.13 * sN) * 12.9898;
    const raw = Math.sin(seed) * 43758.5453;
    const frac = raw - Math.floor(raw);
    return (frac - 0.5) * 0.7;
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

  /* ---------------- Overall & Stamina (unchanged) ---------------- */
  const calcOverall = (attrs, pos) => {
    const p = posParams[pos];
    if (!p) return 0;
    const W = p.weights.reduce((s, w, i) => s + w * (attrs[i] || 75), 0);
    const prim = p.prim.map((i) => i - 1);
    const Peak = Math.max(...prim.map((i) => attrs[i] || 75));
    const B = p.alpha * Peak + (1 - p.alpha) * W;
    let overall = 60 + 39 * sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = (attrs || []).filter((a) => a >= 90).length;
    if (num90 >= 3) {
      const bonus = num90 - 2;
      overall = Math.min(99, overall + bonus);
    }
    return overall;
  };

  const calcStamina = (age, athleticism) => {
    age = clamp(age, 18, 45);
    athleticism = clamp(athleticism, 25, 99);
    let ageFactor;
    if (age <= 27) ageFactor = 1.0;
    else if (age <= 34) ageFactor = 0.95 - (0.15 * (age - 28)) / 6;
    else ageFactor = 0.8 - (0.45 * (age - 35)) / 10;
    ageFactor = clamp(ageFactor, 0.35, 1.0);
    const raw = ageFactor * 99 * 0.575 + athleticism * 0.425;
    const norm = (raw - 40) / (99 - 40);
    return Math.round(clamp(40 + norm * 59, 40, 99));
  };

  /* ---------------- v19 Baselines (pos means/std + league-absolute means/std) ---------------- */
  const ratingBaselines = useMemo(() => {
    const POS = ["PG", "SG", "SF", "PF", "C"];
    const offIdx = [T3, MID, CLOSE, BH, PAS, SPD, ATH, OIQ];
    const defIdx = [PERD, STL, INTD, BLK, SPD, ATH];

    const allPlayers = [...(conferences.East || []), ...(conferences.West || [])].flatMap((t) =>
      (t.players || []).map((p) => ({
        pos: POS.includes(p.pos) ? p.pos : "SF",
        attrs: p.attrs || Array(15).fill(75),
      }))
    );

    const posBuckets = Object.fromEntries(
      POS.map((p) => [
        p,
        Object.fromEntries([...offIdx, ...defIdx].map((k) => [k, []])),
      ])
    );
    const absBuckets = Object.fromEntries(offIdx.map((k) => [k, []]));

    for (const pl of allPlayers) {
      const { pos, attrs } = pl;
      for (const k of [...offIdx, ...defIdx]) posBuckets[pos][k].push(attrs[k]);
      for (const k of offIdx) absBuckets[k].push(attrs[k]);
    }

    const sampleStd = (arr) => {
      const n = arr.length;
      if (n < 2) return 1.0;
      const m = arr.reduce((s, v) => s + v, 0) / n;
      const v = arr.reduce((s, v2) => s + (v2 - m) * (v2 - m), 0) / (n - 1);
      return Math.max(1.0, Math.sqrt(v));
    };

    const posMean = {},
      posStd = {};
    for (const p of POS) {
      posMean[p] = {};
      posStd[p] = {};
      for (const k of [...offIdx, ...defIdx]) {
        const arr = posBuckets[p][k];
        posMean[p][k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
        posStd[p][k] = arr.length ? sampleStd(arr) : 1.0;
      }
    }
    const absMean = {},
      absStd = {};
    for (const k of offIdx) {
      const arr = absBuckets[k];
      absMean[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
      absStd[k] = arr.length ? sampleStd(arr) : 1.0;
    }

    const safe = (v) => (v && v > 1e-6 ? v : 1.0);
    const zPos = (attrs, pos, k) => (attrs[k] - (posMean[pos]?.[k] ?? 75)) / safe(posStd[pos]?.[k]);
    const zAbs = (attrs, k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);

    const pfBridgedWeights = (() => {
      const pf = OFF_WEIGHTS_POSZ.PF,
        sf = OFF_WEIGHTS_POSZ.SF;
      const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
      const out = {};
      for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
      return out;
    })();

    const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };
    const zToRating = (z) => clamp(75 + 12 * z, 50, 99);

    const previewOff = (attrs, pos) => {
      const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
      const w = p === "PF" ? pfBridgedWeights : OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF;
      const mix = ABS_MIX[p] ?? 0.1;

      let zPosSum = 0,
        zAbsSum = 0;
      for (const [kStr, wt] of Object.entries(w)) {
        const k = +kStr;
        zPosSum += wt * zPos(attrs, p, k);
        zAbsSum += wt * zAbs(attrs, k);
      }
      let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

      const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
      const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
      off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
      off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);
      return clamp(off, 50, 99);
    };

    const previewDef = (attrs, pos) => {
      const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
      const DW =
        {
          PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
          SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
          SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
          PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
          C: { [INTD]: 0.52, [BLK]: 0.4, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
        }[p] || {};
      let zsum = 0;
      for (const [kStr, wt] of Object.entries(DW)) zsum += wt * zPos(attrs, p, +kStr);
      let def = zToRating(zsum);

      const ath = attrs[ATH] ?? 75;
      let absPen = Math.max(0, 78 - ath) * 0.08;
      let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

      if (p === "SF") {
        absPen *= 0.8;
        relPen *= 0.8;
        def += 2.5;
        const perd = attrs[PERD] ?? 75,
          intd = attrs[INTD] ?? 75;
        const hi = Math.max(perd, intd),
          lo = Math.min(perd, intd);
        if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
        let tier = 0;
        if (perd >= 90 || intd >= 90) tier += 0.5;
        if (perd >= 85 && intd >= 85) tier += 0.5;
        if (hi >= 93 && lo >= 84) tier += 0.5;
        if (hi >= 94 && lo >= 90) tier += 0.5;
        def += Math.min(2.0, tier);
      }

      def -= Math.min(4, absPen + relPen);
      const cap = p === "C" ? 99 : p === "PF" ? 98 : 96;
      return clamp(def, 50, cap);
    };

    let sumOV = 0,
      sumOFF = 0,
      sumDEF = 0,
      n = 0;
    for (const t of [...(conferences.East || []), ...(conferences.West || [])]) {
      for (const p of t.players || []) {
        const a = p.attrs || Array(15).fill(75);
        sumOV += calcOverall(a, p.pos);
        n++;
        sumOFF += previewOff(a, p.pos);
        sumDEF += previewDef(a, p.pos);
      }
    }
    const ovMean = n ? sumOV / n : 75;
    const offMean = n ? sumOFF / n : 75;
    const defMean = n ? sumDEF / n : 75;

    const offShift = clamp(ovMean - offMean, -1.5, 1.5);
    const defShift = clamp(ovMean - defMean, -1.5, 1.5);

    return { posMean, posStd, absMean, absStd, offShift, defShift };
  }, [conferences]);

  /* ---------------- v19 Ratings (live) ---------------- */
  const calcOffDef = (attrs, pos, name = "", height = 78) => {
    const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
    const { posMean, posStd, absMean, absStd, offShift, defShift } = ratingBaselines;

    const safe = (v) => (v && v > 1e-6 ? v : 1.0);
    const zPos = (k) => (attrs[k] - (posMean[p]?.[k] ?? 75)) / safe(posStd[p]?.[k]);
    const zAbs = (k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
    const zToRating = (z) => clamp(75 + 12 * z, 50, 99);

    const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };
    const wBase =
      p === "PF"
        ? (() => {
            const pf = OFF_WEIGHTS_POSZ.PF,
              sf = OFF_WEIGHTS_POSZ.SF;
            const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
            const out = {};
            for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
            return out;
          })()
        : OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF;

    let zPosSum = 0,
      zAbsSum = 0;
    for (const [kStr, wt] of Object.entries(wBase)) {
      const k = +kStr;
      zPosSum += wt * zPos(k);
      zAbsSum += wt * zAbs(k);
    }
    const mix = ABS_MIX[p] ?? 0.1;
    let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

    const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
    const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
    off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
    off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

    const DW =
      {
        PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
        SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
        SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
        PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
        C: { [INTD]: 0.52, [BLK]: 0.4, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
      }[p] || {};
    let zsumD = 0;
    for (const [kStr, wt] of Object.entries(DW)) zsumD += wt * zPos(+kStr);
    let def = zToRating(zsumD);

    const ath = attrs[ATH] ?? 75;
    let absPen = Math.max(0, 78 - ath) * 0.08;
    let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;
    if (p === "SF") {
      absPen *= 0.8;
      relPen *= 0.8;
      def += 2.5;
      const perd = attrs[PERD] ?? 75,
        intd = attrs[INTD] ?? 75;
      const hi = Math.max(perd, intd),
        lo = Math.min(perd, intd);
      if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
      let tier = 0;
      if (perd >= 90 || intd >= 90) tier += 0.5;
      if (perd >= 85 && intd >= 85) tier += 0.5;
      if (hi >= 93 && lo >= 84) tier += 0.5;
      if (hi >= 94 && lo >= 90) tier += 0.5;
      def += Math.min(2.0, tier);
    }
    def -= Math.min(4, absPen + relPen);

    const j = v19Jitter(name, attrs);
    off = clamp(off + offShift + j, 50, 99);
    const defCap = p === "C" ? 99 : p === "PF" ? 98 : 96;
    def = clamp(def + defShift + 0.7 * j, 50, defCap);

    return { off: bankersRound(off), def: bankersRound(def) };
  };

  function explodeJS(value, power) {
    return (value / 100) ** power;
  }

  function closePenaltyJS(close) {
    if (close >= 70) return 0;
    return ((70 - close) / 30) ** 2.3;
  }

  function calcScoringRating(pos, three, mid, close) {
    if (pos === "PG" || pos === "SG") {
      const three_term = explodeJS(three, 7) * 1.2;
      const mid_term = explodeJS(mid, 7) * 1.55;
      const close_term = explodeJS(close, 6) * 1.1;

      const base = 0.38 * (three / 100) + 0.4 * (mid / 100) + 0.22 * (close / 100);
      const penalty = closePenaltyJS(close) * 1.7;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    if (pos === "SF") {
      const three_term = explodeJS(three, 7) * 1.05;
      const mid_term = explodeJS(mid, 7) * 1.4;
      const close_term = explodeJS(close, 7) * 1.5;

      const base = 0.32 * (three / 100) + 0.35 * (mid / 100) + 0.33 * (close / 100);
      const penalty = closePenaltyJS(close) * 1.2;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    if (pos === "PF" || pos === "C") {
      const close_term = explodeJS(close, 8) * 1.95;
      const mid_term = explodeJS(mid, 6) * 1.3;
      const three_term = explodeJS(three, 5) * 0.6;

      const base = 0.58 * (close / 100) + 0.27 * (mid / 100) + 0.15 * (three / 100);
      const penalty = closePenaltyJS(close) * 2.0;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    return 50;
  }

  /* ---------------- Auto-Save + Load ---------------- */
  useEffect(() => {
    const saved = localStorage.getItem("leagueData");
    if (!saved) return;

    try {
      const data = JSON.parse(saved);
      const updated = { ...data, conferences: {} };

      for (const side of ["East", "West"]) {
        updated.conferences[side] = (data.conferences?.[side] || []).map((team) => ({
          ...team,
          players: (team.players || []).map((p) => {
            const three = p.attrs?.[0] ?? 75;
            const mid = p.attrs?.[1] ?? 75;
            const close = p.attrs?.[2] ?? 75;
            const scoringRating = calcScoringRating(p.pos, three, mid, close);
            return normalizePlayer({ ...p, scoringRating });
          }),
        }));
      }

      setLeagueName(updated.leagueName);
      setConferences(updated.conferences);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("leagueData", JSON.stringify({ leagueName, conferences }));
  }, [leagueName, conferences]);

  /* ---------------- Live Recalc in Modal ---------------- */
  useEffect(() => {
    if (!showPlayerForm) return;
    setPlayerForm((prev) => {
      const overall = calcOverall(prev.attrs, prev.pos);
      const { off, def } = calcOffDef(prev.attrs, prev.pos, prev.name, prev.height);
      const stamina = calcStamina(prev.age, prev.attrs[ATH]);

      const three = prev.attrs[0];
      const mid = prev.attrs[1];
      const close = prev.attrs[2];
      const scoringRating = calcScoringRating(prev.pos, three, mid, close);

      return {
        ...prev,
        overall,
        offRating: off,
        defRating: def,
        scoringRating,
        stamina,
      };
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlayerForm, playerForm.attrs, playerForm.age, playerForm.potential, playerForm.height, playerForm.pos, playerForm.name]);

  /* ---------------- Handlers ---------------- */
  const addTeam = () => {
    if (!newTeamName.trim()) return;
    const team = { name: newTeamName.trim(), logo: newTeamLogo.trim(), players: [] };
    setConferences((prev) => ({ ...prev, [selectedConf]: [...prev[selectedConf], team] }));
    setNewTeamName("");
    setNewTeamLogo("");
  };

  const openEditTeam = (idx) => setEditTeamModal({ idx, ...conferences[selectedConf][idx] });

  const saveEditTeam = () => {
    setConferences((prev) => {
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
      const safe = normalizePlayer({
        potential: 75,
        height: 78,
        secondaryPos: "",
        scoringRating: 50,
        ...ex,
      });
      setPlayerForm(JSON.parse(JSON.stringify(safe)));
    } else {
      setEditingPlayer(null);
      setPlayerForm(initPlayer());
    }
    setShowPlayerForm(true);
  };

  const savePlayer = () => {
    const p = normalizePlayer({ ...playerForm });
    const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
    p.overall = calcOverall(p.attrs, p.pos);
    p.offRating = off;
    p.defRating = def;
    p.stamina = calcStamina(p.age, p.attrs[ATH]);
    setConferences((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      if (editingPlayer !== null) copy[selectedConf][editingTeam].players[editingPlayer] = p;
      else copy[selectedConf][editingTeam].players.push(p);
      return copy;
    });
    setShowPlayerForm(false);
  };

  const toggleSort = (idx) => {
    setConferences((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const team = copy[selectedConf][idx];
      const isSorted = !sortedTeams[idx];

      if (isSorted) {
        setOriginalOrders((prevOrders) => ({
          ...prevOrders,
          [`${selectedConf}-${idx}`]: [...team.players],
        }));
        team.players.sort((a, b) => b.overall - a.overall);
      } else {
        setOriginalOrders((prevOrders) => {
          const saved = prevOrders[`${selectedConf}-${idx}`];
          if (saved) team.players = saved;
          const newOrders = { ...prevOrders };
          delete newOrders[`${selectedConf}-${idx}`];
          return newOrders;
        });
      }
      return copy;
    });

    setSortedTeams((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAdvanced = (idx) => setExpandedTeams((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const buildExportSnapshot = () => {
    const clone = JSON.parse(JSON.stringify(conferences));
    const recalcPlayer = (p0) => {
      const p = normalizePlayer(p0);
      const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
      const scoringRating = calcScoringRating(p.pos, p.attrs[0], p.attrs[1], p.attrs[2]);

      return {
        ...p,
        overall: calcOverall(p.attrs, p.pos),
        offRating: off,
        defRating: def,
        scoringRating,
        stamina: calcStamina(p.age, p.attrs[ATH]),
      };
    };

    ["East", "West"].forEach((side) => {
      clone[side] = (clone[side] || []).map((team) => ({
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

      <div className="flex flex-col md:flex-row items-center justify-center gap-4">
        <input
          className="border p-2 rounded w-60"
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
          placeholder="League Name"
        />
        <div className="flex gap-2">
          <label className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 cursor-pointer">
            Import JSON
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = (x) => {
                  try {
                    const d = JSON.parse(x.target.result);
                    if (d.leagueName && d.conferences) {
                      const updated = { ...d, conferences: {} };

                      for (const side of ["East", "West"]) {
                        updated.conferences[side] = (d.conferences[side] || []).map((team) => ({
                          ...team,
                          players: (team.players || []).map((p) => {
                            const three = p.attrs?.[0] ?? 75;
                            const mid = p.attrs?.[1] ?? 75;
                            const close = p.attrs?.[2] ?? 75;
                            const scoringRating = calcScoringRating(p.pos, three, mid, close);
                            return normalizePlayer({ ...p, scoringRating });
                          }),
                        }));
                      }

                      setLeagueName(updated.leagueName);
                      setConferences(updated.conferences);
                      localStorage.setItem("leagueData", JSON.stringify(updated));

                      alert(`✅ Imported ${updated.leagueName} (birthdays + contracts kept / added)`);
                    } else alert("⚠️ Invalid JSON");
                  } catch {
                    alert("❌ Failed to parse JSON");
                  }
                };
                r.readAsText(f);
              }}
            />
          </label>

          <button
            onClick={openTradeModal}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          >
            Trades
          </button>

          <button
            onClick={() => {
              const snapshot = buildExportSnapshot();
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

      <div className="flex justify-center gap-4">
        {["East", "West"].map((c) => (
          <button
            key={c}
            onClick={() => setSelectedConf(c)}
            className={`px-4 py-2 rounded ${
              selectedConf === c ? "bg-green-600 text-white" : "bg-gray-200"
            }`}
          >
            {c} Conference
          </button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <input
          className="border p-2 rounded w-52"
          placeholder="Team Name"
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
        />
        <input
          className="border p-2 rounded w-52"
          placeholder="Logo URL"
          value={newTeamLogo}
          onChange={(e) => setNewTeamLogo(e.target.value)}
        />
        <button
          onClick={addTeam}
          className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
        >
          Add Team
        </button>
      </div>

      <div className="flex flex-col gap-8">
        {conferences[selectedConf].map((team, idx) => {
          const sorted = sortedTeams[idx];
          const players = team.players || [];
          return (
            <div key={idx} className="border rounded-2xl p-8 bg-white shadow-lg">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-3">
                  {team.logo && <img src={team.logo} alt="" className="w-14 h-14 object-contain" />}
                  <h2 className="text-2xl font-bold">{team.name}</h2>
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => openPlayerForm(idx)}
                    className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                  >
                    Add Player
                  </button>
                  <button
                    onClick={() => toggleAdvanced(idx)}
                    className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                  >
                    {expandedTeams[idx] ? "Hide Advanced" : "Show Advanced"}
                  </button>
                  <button
                    onClick={() => toggleSort(idx)}
                    className={`bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 text-lg ${
                      sorted ? "text-green-600" : ""
                    }`}
                    title="Sort by Overall"
                  >
                    ⬇️ OVR
                  </button>
                  <button
                    onClick={() => openEditTeam(idx)}
                    className="text-blue-600 text-xl hover:opacity-80"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Delete team?")) {
                        setConferences((prev) => {
                          const c = JSON.parse(JSON.stringify(prev));
                          c[selectedConf].splice(idx, 1);
                          return c;
                        });
                      }
                    }}
                    className="text-red-600 text-xl hover:opacity-75"
                  >
                    🗑️
                  </button>
                </div>
              </div>

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
                    <th className="text-center font-semibold">SCO</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p0, i) => {
                    const p = normalizePlayer(p0);
                    const live = calcOffDef(p.attrs, p.pos, p.name, p.height);
                    return (
                      <tr key={p.id || i} className="border-b align-middle py-4">
                        <td className="flex items-center gap-4 py-4">
                          {p.headshot && (
                            <div
                              className="w-16 h-16 rounded-full bg-white border border-slate-200"
                              style={{
                                backgroundImage: `url(${p.headshot})`,
                                backgroundSize: "80%",
                                backgroundPosition: "center 10%",
                                backgroundRepeat: "no-repeat",
                              }}
                            />
                          )}
                          <div>
                            <div className="font-semibold text-base">{p.name}</div>
                            {expandedTeams[idx] && (
                              <div className="text-[0.8rem] text-slate-600 grid grid-cols-3 gap-x-2">
                                {attrNames.map((n, j) => (
                                  <span key={j}>
                                    {n.split(" ")[0]} {p.attrs?.[j]}
                                  </span>
                                ))}
                                <span>Off {live.off}</span>
                                <span>Def {live.def}</span>
                                <span>Sta {p.stamina}</span>
                                <span>Pot {p.potential}</span>
                                <span>Sco {p.scoringRating?.toFixed(1)}</span>
                                <span>Ht {formatHeight(p.height)}</span>
                                <span>BD {p.birthMonth}/{p.birthDay}</span>
                                <span>Yrs {(p.contract?.salaryByYear || []).length}</span>
                                <span>
                                  Opt {p.contract?.option?.type ? `${p.contract.option.type} Y${(p.contract.option.yearIndex ?? 0) + 1}` : "None"}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="text-center">
                          {p.pos}
                          {p.secondaryPos ? ` / ${p.secondaryPos}` : ""}
                        </td>
                        <td className="text-center">{p.age}</td>
                        <td className="text-center">{formatHeight(p.height)}</td>
                        <td className="text-center font-bold">{p.overall}</td>
                        <td className="text-center">{live.off}</td>
                        <td className="text-center">{live.def}</td>
                        <td className="text-center">{p.potential}</td>
                        <td className="text-center">{p.scoringRating?.toFixed(1) ?? "—"}</td>
                        <td className="text-right">
                          <button
                            onClick={() => openPlayerForm(idx, i)}
                            className="text-blue-600 text-sm hover:underline mr-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setConferences((prev) => {
                                const c = JSON.parse(JSON.stringify(prev));
                                c[selectedConf][idx].players.splice(i, 1);
                                return c;
                              });
                            }}
                            className="text-red-600 text-xl hover:opacity-75"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Trades Modal */}
      {showTradeModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[900px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Trades (Roster Swap)</h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                  <span>Team A</span>
                  {getTeam(tradeA)?.logo && (
                    <img src={getTeam(tradeA).logo} alt="" className="w-5 h-5 object-contain" />
                  )}
                </div>
                <select
                  className="border p-2 rounded w-full"
                  value={`${tradeA.conf}-${tradeA.teamIdx}`}
                  onChange={(e) => {
                    const [conf, idxStr] = e.target.value.split("-");
                    setTradeA({ conf, teamIdx: Number(idxStr) });
                    setSendAIds([]);
                  }}
                >
                  {allTeamsFlat.map((t) => (
                    <option key={`A-${t.key}`} value={t.key}>
                      {t.name} ({t.conf})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                  <span>Team B</span>
                  {getTeam(tradeB)?.logo && (
                    <img src={getTeam(tradeB).logo} alt="" className="w-5 h-5 object-contain" />
                  )}
                </div>
                <select
                  className="border p-2 rounded w-full"
                  value={`${tradeB.conf}-${tradeB.teamIdx}`}
                  onChange={(e) => {
                    const [conf, idxStr] = e.target.value.split("-");
                    setTradeB({ conf, teamIdx: Number(idxStr) });
                    setSendBIds([]);
                  }}
                >
                  {allTeamsFlat.map((t) => (
                    <option key={`B-${t.key}`} value={t.key}>
                      {t.name} ({t.conf})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="border rounded-lg p-3">
                <div className="font-semibold mb-2">
                  Send from {getTeam(tradeA)?.name || "Team A"} → {getTeam(tradeB)?.name || "Team B"}
                </div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2">
                  {(getTeam(tradeA)?.players || []).map((p0) => {
                    const p = normalizePlayer(p0);
                    return (
                      <label key={`Apl-${p.id}`} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendAIds.includes(p.id)}
                          onChange={() => setSendAIds((arr) => toggleId(arr, p.id))}
                        />
                        {p.headshot ? (
                          <img
                            src={p.headshot}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200" />
                        )}
                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-500">
                          ({p.pos}, {p.overall})
                        </span>
                      </label>
                    );
                  })}
                  {!(getTeam(tradeA)?.players || []).length && (
                    <div className="text-sm text-slate-500">No players.</div>
                  )}
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="font-semibold mb-2">
                  Send from {getTeam(tradeB)?.name || "Team B"} → {getTeam(tradeA)?.name || "Team A"}
                </div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2">
                  {(getTeam(tradeB)?.players || []).map((p0) => {
                    const p = normalizePlayer(p0);
                    return (
                      <label key={`Bpl-${p.id}`} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendBIds.includes(p.id)}
                          onChange={() => setSendBIds((arr) => toggleId(arr, p.id))}
                        />

                        {p.headshot ? (
                          <img
                            src={p.headshot}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover border border-slate-200"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200" />
                        )}

                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-500">
                          ({p.pos}, {p.overall})
                        </span>
                      </label>
                    );
                  })}
                  {!(getTeam(tradeB)?.players || []).length && (
                    <div className="text-sm text-slate-500">No players.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowTradeModal(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={executeTrade}
                className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700"
              >
                Execute Trade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Modal */}
      {showPlayerForm && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[650px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingPlayer !== null ? "Edit Player" : "Add Player"}</h2>

            <div className="flex flex-col gap-2 mb-3">
              <input
                className="border p-2 rounded"
                placeholder="Player Name"
                value={playerForm.name}
                onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })}
              />

              <input
                className="border p-2 rounded"
                placeholder="Headshot URL"
                value={playerForm.headshot}
                onChange={(e) => setPlayerForm({ ...playerForm, headshot: e.target.value })}
              />

              {/* NEW: Birthdays */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border p-2 rounded"
                  type="number"
                  min="1"
                  max="12"
                  placeholder="Birth Month (1-12)"
                  value={playerForm.birthMonth ?? 1}
                  onChange={(e) =>
                    setPlayerForm({ ...playerForm, birthMonth: Number(e.target.value) })
                  }
                />
                <input
                  className="border p-2 rounded"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="Birth Day (1-31)"
                  value={playerForm.birthDay ?? 1}
                  onChange={(e) =>
                    setPlayerForm({ ...playerForm, birthDay: Number(e.target.value) })
                  }
                />
              </div>

              {/* NEW: Contract */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="border p-2 rounded"
                  type="number"
                  placeholder="Contract Start Year"
                  value={playerForm.contract?.startYear ?? 2026}
                  onChange={(e) => {
                    const startYear = Number(e.target.value);
                    setPlayerForm({
                      ...playerForm,
                      contract: {
                        ...(playerForm.contract ?? {}),
                        startYear,
                        salaryByYear: playerForm.contract?.salaryByYear ?? [8_000_000],
                        option: playerForm.contract?.option ?? null,
                      },
                    });
                  }}
                />

                <input
                  className="border p-2 rounded"
                  type="text"
                  placeholder="Salaries CSV (millions) e.g. 8, 8.5, 9"
                  value={(playerForm.contract?.salaryByYear ?? [])
                    .map((x) => {
                      const m = Number(x) / 1_000_000;
                      const s = m.toFixed(1);
                      return s.endsWith(".0") ? s.slice(0, -2) : s;
                    })
                    .join(", ")}
                  onChange={(e) => {
                    const salaryByYear = e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0)
                      .map((s) => Math.round(Number(s) * 1_000_000))
                      .filter((n) => Number.isFinite(n) && n >= 0);

                    setPlayerForm({
                      ...playerForm,
                      contract: {
                        ...(playerForm.contract ?? {}),
                        startYear: playerForm.contract?.startYear ?? 2026,
                        salaryByYear: salaryByYear.length ? salaryByYear : [8_000_000],
                        option: playerForm.contract?.option ?? null,
                      },
                    });
                  }}
                />
              </div>

              {/* NEW: Option */}
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="border p-2 rounded"
                  value={playerForm.contract?.option?.type ?? "none"}
                  onChange={(e) => {
                    const type = e.target.value;
                    const cur = playerForm.contract ?? { startYear: 2026, salaryByYear: [8_000_000], option: null };

                    setPlayerForm({
                      ...playerForm,
                      contract: {
                        ...cur,
                        option:
                          type === "none"
                            ? null
                            : {
                                yearIndex: cur.option?.yearIndex ?? Math.max(0, (cur.salaryByYear?.length ?? 1) - 1),
                                type,
                                picked: cur.option?.picked ?? null,
                              },
                      },
                    });
                  }}
                >
                  <option value="none">No Option</option>
                  <option value="team">Team Option</option>
                  <option value="player">Player Option</option>
                </select>

                <input
                  className="border p-2 rounded"
                  type="number"
                  min="1"
                  placeholder="Option Year (1..N)"
                  value={
                    playerForm.contract?.option
                      ? Number(playerForm.contract.option.yearIndex ?? 0) + 1
                      : 1
                  }
                  onChange={(e) => {
                    const year1 = Math.max(1, Number(e.target.value));
                    const cur = playerForm.contract ?? { startYear: 2026, salaryByYear: [8_000_000], option: null };
                    if (!cur.option) return;

                    const maxN = Math.max(1, cur.salaryByYear?.length ?? 1);
                    const clamped = Math.min(maxN, Math.max(1, year1));

                    setPlayerForm({
                      ...playerForm,
                      contract: {
                        ...cur,
                        option: { ...cur.option, yearIndex: clamped - 1 },
                      },
                    });
                  }}
                  disabled={!playerForm.contract?.option}
                />
              </div>

              <select
                className="border p-2 rounded"
                value={playerForm.pos}
                onChange={(e) => {
                  const pos = e.target.value;
                  setPlayerForm({
                    ...playerForm,
                    pos,
                    secondaryPos: playerForm.secondaryPos === pos ? "" : playerForm.secondaryPos,
                  });
                }}
              >
                {["PG", "SG", "SF", "PF", "C"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>

              <select
                className="border p-2 rounded"
                value={playerForm.secondaryPos}
                onChange={(e) => setPlayerForm({ ...playerForm, secondaryPos: e.target.value })}
              >
                <option value="">No Secondary</option>
                {["PG", "SG", "SF", "PF", "C"]
                  .filter((p) => p !== playerForm.pos)
                  .map((p) => (
                    <option key={p}>{p}</option>
                  ))}
              </select>
            </div>

            <div className="space-y-2">
              {attrNames.map((l, i) => (
                <div key={i}>
                  <label className="text-sm">
                    {l}: {playerForm.attrs[i]}
                  </label>
                  <input
                    type="range"
                    min="25"
                    max="99"
                    value={playerForm.attrs[i]}
                    onChange={(e) =>
                      setPlayerForm((p) => ({
                        ...p,
                        attrs: p.attrs.map((a, j) => (j === i ? +e.target.value : a)),
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
                  onChange={(e) => setPlayerForm({ ...playerForm, age: +e.target.value })}
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
                  onChange={(e) => setPlayerForm({ ...playerForm, height: +e.target.value })}
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
                  onChange={(e) => setPlayerForm({ ...playerForm, potential: +e.target.value })}
                  className="w-full accent-pink-600"
                />
              </div>
            </div>

            <p className="mt-4 font-semibold text-lg">
              Overall: {playerForm.overall} | Off: {playerForm.offRating} | Def: {playerForm.defRating} | Sta:{" "}
              {playerForm.stamina} | Pot: {playerForm.potential} | Ht: {formatHeight(playerForm.height)} | Sco:{" "}
              {playerForm.scoringRating.toFixed(2)}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowPlayerForm(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={savePlayer}
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
              >
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
              onChange={(e) => setEditTeamModal({ ...editTeamModal, name: e.target.value })}
            />
            <input
              className="border p-2 rounded w-full mb-4"
              placeholder="Logo URL"
              value={editTeamModal.logo}
              onChange={(e) => setEditTeamModal({ ...editTeamModal, logo: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditTeamModal(null)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={saveEditTeam}
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function formatHeight(inches) {
    const ft = Math.floor(inches / 12);
    const ins = inches % 12;
    return `${ft}′${ins}″`;
  }
}
