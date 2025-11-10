// frontend/src/api/simEngine.js
// JS port of your friend's "V1 game sim and box score" core logic
// – includes (a) ratings calc (b) auto-rotation fallback (c) one-game sim
// – produces: periods, winner, home/away box scores.

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function randn(mean = 0, sd = 1) {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1.0;
  while (p > L) { k++; p *= Math.random(); }
  return Math.max(0, k - 1);
}
function binom(n, p) {
  if (n <= 0) return 0;
  p = clamp(p, 0, 1);
  let k = 0;
  for (let i = 0; i < n; i++) if (Math.random() < p) k++;
  return k;
}

// ---------- shared pieces (match CoachGameplan math) ----------
function fatiguePenalty(mins, stamina = 70) {
  const threshold = 0.359 * stamina + 2.46;
  const over = Math.max(0, mins - threshold);
  return Math.max(0.7, 1 - 0.0075 * over);
}
function calculateTeamRatings(players, minutesByName) {
  let off = 0, def = 0, ovr = 0;
  const posTot = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const p of players) {
    const m = minutesByName[p.name] || 0;
    if (m <= 0) continue;
    const w = m / 240;
    const pen = fatiguePenalty(m, p.stamina || 70);
    off += w * ((p.offRating || 0) * pen);
    def += w * ((p.defRating || 0) * pen);
    ovr += w * ((p.overall  || 0) * pen);
    if (posTot[p.pos] !== undefined) posTot[p.pos] += m;
    if (p.secondaryPos && posTot[p.secondaryPos] !== undefined) posTot[p.secondaryPos] += m * 0.2;
  }
  const missing =
    Math.max(0, 48 - posTot.PG) +
    Math.max(0, 48 - posTot.SG) +
    Math.max(0, 48 - posTot.SF) +
    Math.max(0, 48 - posTot.PF) +
    Math.max(0, 48 - posTot.C);
  const coveragePenalty = 1 - 0.02 * (missing / 240);
  return {
    off: off * coveragePenalty,
    def: def * coveragePenalty,
    overall: ovr * coveragePenalty,
  };
}

// ---------- fallback: auto-rotation (same structure as your CoachGameplan) ----------
function buildSmartRotation(teamPlayers) {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const valid = (teamPlayers || []).filter(p => p && p.name && Number.isFinite(p.overall));
  if (!valid.length) return { players: [], minutes: {} };

  const score = (p) => (p.overall || 0) + ((p.stamina || 70) - 70) * 0.15;

  const teamTotal = (arr, mins) => {
    let off = 0, deff = 0, ovr = 0;
    const posTot = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    for (const p of arr) {
      const m = mins[p.name] || 0;
      if (m <= 0) continue;
      const w = m / 240;
      const pen = fatiguePenalty(m, p.stamina || 70);
      off += w * ((p.offRating || 0) * pen);
      deff += w * ((p.defRating || 0) * pen);
      ovr += w * ((p.overall || 0) * pen);
      posTot[p.pos] = (posTot[p.pos] || 0) + m;
      if (p.secondaryPos) posTot[p.secondaryPos] = (posTot[p.secondaryPos] || 0) + m * 0.2;
    }
    const missing =
      Math.max(0, 48 - (posTot.PG || 0)) +
      Math.max(0, 48 - (posTot.SG || 0)) +
      Math.max(0, 48 - (posTot.SF || 0)) +
      Math.max(0, 48 - (posTot.PF || 0)) +
      Math.max(0, 48 - (posTot.C || 0));
    const coveragePenalty = 1 - 0.02 * (missing / 240);
    return { off: off * coveragePenalty, deff: deff * coveragePenalty, ovr: ovr * coveragePenalty };
  };

  const used = new Set();
  const chosen = [];
  for (const pos of POSITIONS) {
    const eligible = valid
      .filter(p => !used.has(p.name) && (p.pos === pos || p.secondaryPos === pos))
      .sort((a, b) => score(b) - score(a));
    if (eligible.length) {
      chosen.push(eligible[0]);
      used.add(eligible[0].name);
    }
  }
  for (const p of [...valid].sort((a, b) => score(b) - score(a))) {
    if (chosen.length >= Math.min(10, valid.length)) break;
    if (!used.has(p.name)) { chosen.push(p); used.add(p.name); }
  }

  const mins = {};
  for (const p of chosen) mins[p.name] = 12;
  let remain = 240 - 12 * chosen.length;
  let idx = 0;
  while (remain > 0 && chosen.length > 0) {
    mins[chosen[idx % chosen.length].name] += 1;
    idx++; remain--;
  }

  const coreSet = new Set(chosen.slice(0, 5).map(p => p.name));
  let improved = true;
  while (improved) {
    improved = false;
    let base = teamTotal(chosen, mins).ovr;
    for (let i = 0; i < chosen.length; i++) {
      for (let j = 0; j < chosen.length; j++) {
        if (i === j) continue;
        const a = chosen[i], b = chosen[j];
        if ((mins[a.name] || 0) <= 12) continue;
        if ((mins[b.name] || 0) >= 24 && !coreSet.has(b.name)) continue;
        mins[a.name] -= 1; mins[b.name] += 1;
        const test = teamTotal(chosen, mins).ovr;
        if (test > base) { base = test; improved = true; }
        else { mins[a.name] += 1; mins[b.name] -= 1; }
      }
    }
  }

  // starters: best position matching
  const permute = (arr) => {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const t of permute(rest)) out.push([arr[i], ...t]);
    }
    return out;
  };
  const POS = POSITIONS;
  let bestMap = null, bestScore = -Infinity;
  const combos = (arr, k) => {
    const res = [];
    (function go(start, path) {
      if (path.length === k) { res.push(path.slice()); return; }
      for (let i = start; i < arr.length; i++) { path.push(arr[i]); go(i + 1, path); path.pop(); }
    })(0, []);
    return res;
  };
  for (const five of combos(chosen, Math.min(5, chosen.length))) {
    for (const perm of permute(POS)) {
      let validMap = true;
      const mapping = {};
      for (let k = 0; k < five.length; k++) {
        const pl = five[k]; const pos = perm[k];
        if (!(pl.pos === pos || pl.secondaryPos === pos)) { validMap = false; break; }
        mapping[pos] = pl;
      }
      if (!validMap) continue;
      const { ovr } = teamTotal(five, mins);
      if (ovr > bestScore) { bestScore = ovr; bestMap = mapping; }
    }
  }
  if (!bestMap) {
    const top5 = [...chosen].sort((a, b) => b.overall - a.overall).slice(0, 5);
    bestMap = {}; for (let i = 0; i < POS.length; i++) if (top5[i]) bestMap[POS[i]] = top5[i];
  }
  const starters = POS.map(p => bestMap[p]).filter(Boolean);
  const starterIds = new Set(starters.map(p => p.name));
  const bench = chosen.filter(p => !starterIds.has(p.name)).sort((a, b) => (mins[b.name] || 0) - (mins[a.name] || 0));
  const others = valid.filter(p => !used.has(p.name));
  const players = [...starters, ...bench, ...others];

  const minutes = {};
  for (const p of players) minutes[p.name] = mins[p.name] || 0;
  for (const p of valid) if (!(p.name in minutes)) minutes[p.name] = 0;

  return { players, minutes };
}

// ---------- helpers to get minutes ----------
function loadMinutesForTeam(team) {
  const key = `gameplan_${team.name}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // fallback auto
  return buildSmartRotation(team.players).minutes;
}

function leaguePlayers(leagueData) {
  return Object.values(leagueData.conferences).flat().flatMap(t => t.players || []);
}

function leagueAttrMeans(leagueData) {
  const ps = leaguePlayers(leagueData);
  let sums = { three:0, pass:0, reb:0, stl:0, blk:0, offiq:0, defiq:0, overall:0 };
  for (const p of ps) {
    const a = p.attrs || Array(15).fill(70);
    sums.three += a[2]; sums.pass += a[5]; sums.reb += a[12];
    sums.stl += a[11]; sums.blk += a[10]; sums.offiq += a[13]; sums.defiq += a[14];
    sums.overall += (p.overall ?? 75);
  }
  const cnt = ps.length || 1;
  const m = {}; for (const k in sums) m[k] = sums[k] / cnt;
  return m;
}

// ----- multinomial split to integer counts
function sampleMultinomial(total, weights) {
  const out = Array(weights.length).fill(0);
  const S = weights.reduce((a,b)=>a+b,0);
  if (S <= 0) { for (let i=0;i<total;i++) out[Math.floor(Math.random()*weights.length)]++; return out; }
  const cum = []; let acc=0;
  for (const w of weights) { acc += w; cum.push(acc); }
  for (let k=0;k<total;k++) {
    const r = Math.random()*S;
    let i=0; while (i<cum.length && r>cum[i]) i++;
    out[i] += 1;
  }
  return out;
}

// ---------- BOX SCORE (JS port of friend's function, condensed where safe) ----------
function generateBoxScore({ team, minutesByName, teamPoints, teamRatings, leagueData, numOT }) {
  const BASE = { PTS:113.8, REB:44.1, AST:26.5, STL:8.2, BLK:4.9,
                 FGM:41.7, FGA:89.2, '3PM':13.5, '3PA':37.6, FTM:16.9, FTA:21.7, TO:14.3, PF:20.8 };

  // roster
  const fullRoster = team.players.slice(); // preserve order
  const active = fullRoster.filter(p => (minutesByName[p.name] || 0) > 0);
  const benchZero = fullRoster.filter(p => (minutesByName[p.name] || 0) <= 0);

  // slight minute jitter + reconcile to exact 240 (+25/OT)
  const gameTarget = 240 + 25 * Math.max(0, parseInt(numOT || 0, 10));
  if (active.length) {
    const maxPer = 48 + 5 * Math.max(0, parseInt(numOT || 0, 10));
    const tweaked = active.map(p => {
      const base = Math.round(minutesByName[p.name] || 0);
      const mm = Math.round(base + (Math.random()*3 - 1.5));
      return clamp(mm, 1, maxPer);
    });
    let cur = tweaked.reduce((a,b)=>a+b,0);
    const starW = active.map(p => (Math.max(1, p.offRating) ** 1.15) * Math.max(1, (minutesByName[p.name]||0)));
    const up = [...starW.keys()].sort((i,j)=>starW[j]-starW[i]);
    const dn = [...up].reverse();
    let guard=0;
    while (cur !== gameTarget && guard < 3000) {
      if (cur < gameTarget) {
        for (const i of up) { if (tweaked[i] < maxPer) { tweaked[i]++; cur++; if (cur===gameTarget) break; } }
      } else {
        for (const i of dn) { if (tweaked[i] > 1) { tweaked[i]--; cur--; if (cur===gameTarget) break; } }
      }
      guard++;
    }
    for (let i=0;i<active.length;i++) minutesByName[active[i].name] = tweaked[i];
  }
  if (!active.length) {
    return fullRoster.map(p => ({
      player:p.name, min:0, pts:0, reb:0, ast:0, stl:0, blk:0,
      fg:"0/0", "3p":"0/0", ft:"0/0", to:0, pf:0
    }));
  }

  // ensure attrs
  for (const p of active) if (!p.attrs) p.attrs = Array(15).fill(70);
  const L = leagueAttrMeans(leagueData);

  const totMin = active.reduce((a,p)=>a+(minutesByName[p.name]||0),0) || 1;
  const wmean = (idx) => active.reduce((a,p)=>a+p.attrs[idx]*(minutesByName[p.name]||0),0) / totMin;

  const tm = {
    three: wmean(2), pass: wmean(5), reb: wmean(12),
    stl: wmean(11), blk:wmean(10), offiq:wmean(13), defiq:wmean(14),
    overall: active.reduce((a,p)=>a+p.overall*(minutesByName[p.name]||0),0)/totMin
  };
  const bigShare = active
    .filter(p => p.pos.includes("PF") || p.pos.includes("C"))
    .reduce((a,p)=>a+(minutesByName[p.name]||0),0)/totMin;
  const leagueBigShare = 0.40;

  const rel = (x, mean) => (x - mean)/10.0;

  const off = teamRatings.off ?? 75.0;
  const paceAdj = clamp(1.0 + (off-75.0)*0.002 + randn(0,0.02), 0.95, 1.05);
  const fgaMult = clamp(1.0 + 0.04*rel(tm.overall,L.overall) + 0.02*rel(tm.three,L.three) + randn(0,0.045), 0.88, 1.12);
  const threeMult = clamp(1.0 + 0.22*rel(tm.three,L.three) - 0.04*(bigShare - leagueBigShare) + randn(0,0.06), 0.75, 1.35);
  const driveProp = (-0.50*rel(tm.three,L.three) + 0.25*rel(tm.offiq,L.offiq) + 0.15*rel(tm.overall,L.overall));
  const ftaMult = clamp(1.0 + 0.20*driveProp + randn(0,0.07), 0.75, 1.35);
  const toMult  = clamp(1.0 + 0.25*rel(L.offiq,tm.offiq) + 0.10*rel(L.overall,tm.overall) + randn(0,0.07), 0.75, 1.40);
  const pfMult  = clamp(1.0 + 0.22*rel(L.defiq,tm.defiq) + 0.12*(bigShare - leagueBigShare) + randn(0,0.06), 0.75, 1.40);
  const rebMult = clamp(1.0 + 0.25*rel(tm.reb,L.reb) + 0.10*(bigShare - leagueBigShare) + randn(0,0.05), 0.85, 1.25);
  const astMult = clamp(1.0 + 0.25*rel(tm.pass,L.pass) + 0.08*rel(tm.offiq,L.offiq) + randn(0,0.06), 0.80, 1.25);
  const stlMult = clamp(1.0 + 0.25*rel(tm.stl,L.stl) + randn(0,0.08), 0.70, 1.40);
  const blkMult = clamp(1.0 + 0.28*rel(tm.blk,L.blk) + 0.12*(bigShare - leagueBigShare) + randn(0,0.08), 0.70, 1.50);

  let teamFGA = Math.round(BASE.FGA * paceAdj * fgaMult);
  let team3PA = Math.round(BASE["3PA"] * threeMult);
  let teamFTA = Math.round(BASE.FTA * ftaMult);
  team3PA = clamp(team3PA, Math.floor(teamFGA*0.20), Math.floor(teamFGA*0.52));
  teamFGA = Math.max(teamFGA, team3PA + 5);

  // usage weights
  const plist = active.slice();
  const teamOffMean = plist.reduce((a,p)=>a+p.offRating*(minutesByName[p.name]||0),0) / (totMin||1);
  let baseW = plist.map(p => {
    const relStar = 1.0 + 0.015*(p.offRating - teamOffMean);
    return (Math.max(1,p.offRating)**1.2) * Math.max(1,(minutesByName[p.name]||0)) * Math.max(0.5,relStar);
  });
  const prelimP = baseW.map(w => w / (baseW.reduce((a,b)=>a+b,0) || 1));
  const prelimTop = [...prelimP.keys()].sort((i,j)=>prelimP[j]-prelimP[i]).slice(0,3);
  prelimTop.forEach((i,rank) => {
    if (Math.random() < [0.14,0.09,0.06][rank]) baseW[i] *= (1.5 + Math.random()*0.7);
    else if (Math.random() < 0.08) baseW[i] *= (0.5 + Math.random()*0.25);
  });
  baseW = baseW.map((w, i) => w * Math.exp(randn(0, (minutesByName[plist[i].name]||0) < 18 ? 0.35 : 0.18)));
  const pUsage = baseW.map(w => w / (baseW.reduce((a,b)=>a+b,0) || 1));

  // allocate attempts
  const fga = sampleMultinomial(teamFGA, pUsage);

  // 3PA
  const LOW_3PT_HARD_CAP = 50;
  function posBasePer36(pos) {
    if (pos.includes("PG")) return 7.5;
    if (pos.includes("SG")) return 7.0;
    if (pos.includes("SF")) return 6.2;
    if (pos.includes("PF")) return 4.2;
    return 2.2; // C
  }
  function per36_3pa_target(p) {
    if ((p.attrs?.[2] ?? 70) < LOW_3PT_HARD_CAP) return 0.0;
    const three = p.attrs[2], offiq = p.attrs[13];
    const base = posBasePer36(p.pos);
    const bump = 0.18*(three - L.three) + 0.06*(offiq - L.offiq);
    return clamp(base + bump, 1.2, 11.8);
  }
  const target3 = plist.map(p => {
    const mu36 = per36_3pa_target(p);
    const vol = Math.exp(randn(0, (minutesByName[p.name]||0) < 22 ? 0.22 : 0.14));
    return mu36 * vol * ((minutesByName[p.name]||0)/36.0);
  });

  let threeAtt = plist.map((p, i) => {
    if ((p.attrs?.[2] ?? 70) < LOW_3PT_HARD_CAP) return 0;
    const three = p.attrs[2], offIQ = p.attrs[13];
    let share = 0.26 + 0.003*(three - L.three) + 0.0010*(offIQ - L.offiq);
    if ((p.pos.includes("PF") || p.pos.includes("C")) && three >= 88) share += 0.06;
    if (three < 65) share = clamp(share, 0.10, 0.22);
    else if (three < 80) share = clamp(share, 0.12, 0.35);
    else share = clamp(share, 0.14, 0.55);
    let att = 0;
    for (let k=0;k<fga[i];k++) if (Math.random() < share) att++;
    const blend = clamp(Math.random()*(0.65-0.35)+0.35, 0.35, 0.65);
    att = Math.round(blend*att + (1-blend)*target3[i] + (Math.random()*2-1));
    return clamp(att, 0, fga[i]);
  });
  // force team 3PA
  let need = team3PA - threeAtt.reduce((a,b)=>a+b,0);
  const eligible = plist
    .map((p,i)=>({i,p}))
    .filter(x => (x.p.attrs?.[2] ?? 70) >= LOW_3PT_HARD_CAP)
    .map(x=>x.i);
  if (need !== 0 && eligible.length) {
    const order = eligible.sort((j,k) => {
      const dj = per36_3pa_target(plist[j]) - ((threeAtt[j]/Math.max(1,(minutesByName[plist[j].name]||0)))*36);
      const dk = per36_3pa_target(plist[k]) - ((threeAtt[k]/Math.max(1,(minutesByName[plist[k].name]||0)))*36);
      return need > 0 ? (dk - dj) : (dj - dk);
    });
    for (const j of order) {
      if (need === 0) break;
      const room = (need > 0) ? (fga[j] - threeAtt[j]) : threeAtt[j];
      if (room <= 0) continue;
      const delta = Math.min(Math.abs(need), Math.max(1, Math.floor(room/2)));
      threeAtt[j] += (need > 0 ? delta : -delta);
      need += (need > 0 ? -delta : +delta);
    }
  }
  threeAtt = threeAtt.map((a,i)=> ((plist[i].attrs?.[2] ?? 70) < LOW_3PT_HARD_CAP) ? 0 : a);

  const twoAtt = threeAtt.map((t,i)=>Math.max(0, fga[i]-t)).map((t,i)=>{
    if (t < (fga[i] >= 6 ? 1 : 0) && threeAtt[i] >= 1) return (t+1); else return t;
  });

  // FTA
  const top3 = [...pUsage.keys()].sort((i,j)=>pUsage[j]-pUsage[i]).slice(0,3);
  const starBoost = pUsage.map((_,i)=> top3.includes(i) ? 1.15 : 0.95);
  let ftW = plist.map((p,i)=>{
    const offIQ = p.attrs[13], ftSkill = p.attrs[3];
    const share = (fga[i] > 0) ? (threeAtt[i] / fga[i]) : 0;
    const drive = (1.0 - share);
    const orFac = (p.offRating/75.0)**0.7;
    const ftFac = (Math.max(50,ftSkill)/75.0)**0.6;
    let w = pUsage[i]*drive*(0.9 + 0.004*(offIQ - L.offiq)) * starBoost[i] * orFac * ftFac;
    if ((minutesByName[p.name]||0) < 15) w *= (0.7 + Math.random()*0.7);
    return Math.max(0.0001, w);
  }).map(w => w**0.85);

  const pairs = Math.max(0, Math.floor(teamFTA/2));
  const pairAlloc = sampleMultinomial(pairs, ftW);
  let fta = pairAlloc.map(c => 2*c);
  let leftover = teamFTA - fta.reduce((a,b)=>a+b,0);
  if (leftover > 0) {
    const order = [...plist.keys()].sort((j,k) => (ftW[k]-ftW[j]) || (pUsage[k]-pUsage[j]));
    for (const j of order) { if (leftover<=0) break; fta[j] += 1; leftover--; }
  }
  const perMinCap = plist.map((p,i)=>{
    let cap = Math.round(((minutesByName[p.name]||0)/36.0) * (4.5 + 0.03*(p.offRating - 75))) + (top3.includes(i)?1:0);
    cap += (Math.random()<0.33?1:0);
    return Math.max(0, cap);
  });
  let overflow = 0;
  for (let i=0;i<fta.length;i++) if (fta[i] > perMinCap[i]) { overflow += fta[i]-perMinCap[i]; fta[i] = perMinCap[i]; }
  if (overflow > 0) {
    const order = [...plist.keys()].sort((j,k)=>(ftW[k]-ftW[j]) || ((perMinCap[k]-fta[k])-(perMinCap[j]-fta[j])));
    for (const j of order) { if (overflow<=0) break; const room = Math.max(0, perMinCap[j]-fta[j]); const add = Math.min(room, overflow); fta[j]+=add; overflow-=add; }
  }

  // percentages
  const pctTwoFor = (p) => {
    const mid = p.attrs[1], offIQ = p.attrs[13];
    const pos = p.pos;
    const base = pos.includes("C") ? 0.59 : pos.includes("PF") ? 0.55 : pos.includes("SF") ? 0.53 : pos.includes("SG") ? 0.52 : 0.51;
    let pct = base + 0.0020*(mid - 67) + 0.0015*(offIQ - L.offiq);
    return clamp(pct, base-0.08, base+0.09);
  };
  const pctThreeFor = (p) => {
    const three = p.attrs[2], offIQ = p.attrs[13];
    let pct = 0.35 + 0.0060*(three - L.three) + 0.0012*(offIQ - L.offiq);
    return clamp(pct, 0.28, 0.48);
  };
  const pctFtFor = (p) => clamp(0.80 + 0.0035*((p.attrs[3] ?? 70) - 70), 0.74, 0.97);

  const form = plist.map((_,i)=> clamp(randn(1.0, top3.includes(i)?0.12:0.08), 0.85, 1.20));
  const luckTwo   = form.map(f => clamp(randn(f, 0.05), 0.90, 1.15));
  const luckThree = form.map(f => clamp(randn(f, 0.07), 0.88, 1.18));
  const luckFt    = plist.map(_ => clamp(randn(1.0, 0.02), 0.96, 1.06));

  const twoMade = plist.map((p,i)=> binom(twoAtt[i], clamp(pctTwoFor(p)*luckTwo[i], 0.25, 0.75)));
  const threeMade = plist.map((p,i)=> binom(threeAtt[i], clamp(pctThreeFor(p)*luckThree[i], 0.20, 0.70)));
  const ftMade = plist.map((p,i)=> binom(fta[i], clamp(pctFtFor(p)*luckFt[i], 0.70, 0.99)));

  // peripherals: REB / AST / STL / BLK
  const minFactor = (p)=> ((minutesByName[p.name]||0)/36.0) ** 0.90;
  const rebW = plist.map((p,i)=> Math.max(0.1, (p.attrs[12]||70)/80.0) * minFactor(p));
  const madeFG = plist.map((_,i)=> twoMade[i] + threeMade[i]);
  const totalMadeFG = madeFG.reduce((a,b)=>a+b,0) || 1;
  const posBonus = plist.map(p => p.pos.includes("PG")?1.25: p.pos.includes("SG")?1.10: p.pos.includes("SF")?1.00: p.pos.includes("PF")?0.85:0.70);
  const creationScore = plist.map((p,i)=>{
    return 0.90*(p.attrs[5]||70) + 0.60*(p.attrs[13]||70) + 0.25*(p.offRating - tm.overall) + 20.0*pUsage[i];
  });
  const topCreators = [...creationScore.keys()].sort((i,j)=>creationScore[j]-creationScore[i]).slice(0,3);
  const astW = plist.map((p,i)=>{
    let w = ((Math.max(1,(p.attrs[5]||70))/75.0)**1.25) * (0.55 + 1.25*pUsage[i]) * (1.0 + 0.25*madeFG[i]/totalMadeFG);
    w *= (Math.max(55,(p.attrs[13]||70))/75.0) ** 0.90;
    w *= posBonus[i];
    w *= minFactor(p);
    const vol = topCreators.includes(i) ? (i===topCreators[0] ? 0.30 : 0.24) : 0.18;
    w *= Math.exp(randn(0, vol));
    return Math.max(0.05, w);
  });
  const stlW = plist.map((p)=> Math.max(0.1, (p.attrs[11]||70)/85.0) * minFactor(p));
  const blkW = plist.map((p)=> Math.max(0.1, (p.attrs[10]||70)/85.0) * minFactor(p));

  function apportion(total, weights, rnd=[0.78,1.22], floor0=true) {
    const S = weights.reduce((a,b)=>a+b,0) || 1;
    let vals = weights.map(w => Math.round(total*(w/S)*(rnd[0] + Math.random()*(rnd[1]-rnd[0]))));
    // fix to exact total
    let guard = 0;
    while (vals.reduce((a,b)=>a+b,0) !== total && guard < 400) {
      const diff = total - vals.reduce((a,b)=>a+b,0);
      if (diff > 0) {
        const i = weights.indexOf(Math.max(...weights));
        vals[i] += 1;
      } else {
        let i = vals.indexOf(Math.max(...vals));
        if (vals[i] > (floor0 ? 0 : 1)) vals[i] -= 1;
        else {
          const j = vals.findIndex(v => v > (floor0 ? 0 : 1));
          if (j === -1) break; vals[j] -= 1;
        }
      }
      guard++;
    }
    return vals;
  }
  const teamREB = Math.round(BASE.REB * paceAdj * rebMult);
  const teamAST = Math.round(BASE.AST * paceAdj * astMult);
  const teamSTL = Math.round(BASE.STL * stlMult);
  const teamBLK = Math.round(BASE.BLK * blkMult);
  const rebs = apportion(teamREB, rebW);
  const asts = apportion(teamAST, astW, [0.70,1.35]);
  const stls = apportion(teamSTL, stlW);
  const blks = apportion(teamBLK, blkW);

  // turnovers
  const teamTO = Math.round(BASE.TO * toMult);
  const touches = plist.map((_,i)=> fga[i] + 0.44*fta[i] + 0.30*(asts[i]||0));
  const lam = plist.map((p,i)=>{
    const offIQ = p.attrs[13]||70, overall = p.overall||75, pos = p.pos;
    const guardFac = (pos.includes("G") ? 1.15 : 0.90);
    const iqPen = 1.0 + Math.max(0, L.offiq - offIQ) * (pos.includes("G") ? 0.015 : 0.008);
    const ovPen = 1.0 + Math.max(0, L.overall - overall) * 0.008;
    return clamp(guardFac * iqPen * ovPen * (touches[i]/8.0), 0.05, 5.0);
  });
  let tos = lam.map(poisson);
  const capsTo = plist.map((_,i)=> Math.min(Math.ceil(0.40*touches[i]), 8 + (top3.includes(i)?3:0)));
  let overTO = 0; for (let i=0;i<tos.length;i++) if (tos[i] > capsTo[i]) { overTO += tos[i]-capsTo[i]; tos[i] = capsTo[i]; }
  if (overTO > 0) {
    const order = [...plist.keys()].sort((j,k)=> lam[k]-lam[j]);
    for (const j of order) { if (overTO<=0) break; const room = Math.max(0, capsTo[j]-tos[j]); const add = Math.min(room, overTO); tos[j]+=add; overTO-=add; }
  }
  let diffTO = teamTO - tos.reduce((a,b)=>a+b,0);
  const ordUp = [...plist.keys()].sort((j,k)=> lam[k]-lam[j]);
  const ordDn = [...plist.keys()].sort((j,k)=> tos[k]-tos[j]);
  let guardTO=0;
  while (diffTO !== 0 && guardTO < 300) {
    if (diffTO > 0) { tos[ordUp[0]]++; diffTO--; }
    else { if (tos[ordDn[0]]>0) { tos[ordDn[0]]--; diffTO++; } }
    guardTO++;
  }

  // personal fouls (cap 6) + fix to team total
  const teamPF = Math.round(BASE.PF * pfMult);
  const pfLam = plist.map(p=>{
    const defIQ = p.attrs[14]||70; const big = p.pos.includes("C") || p.pos.includes("PF");
    const posFac = big ? 1.20 : 0.90;
    const iqPen = 1.0 + Math.max(0, L.defiq - defIQ) * (big ? 0.020 : 0.010);
    return clamp(posFac * iqPen * ((minutesByName[p.name]||0)/36.0) * 2.8, 0.05, 4.5);
  });
  let pfs = pfLam.map(poisson).map(x=>Math.min(6,x));
  let diffPF = teamPF - pfs.reduce((a,b)=>a+b,0);
  const ordUpPF = [...plist.keys()].sort((j,k)=> pfLam[k]-pfLam[j]);
  const ordDnPF = [...plist.keys()].sort((j,k)=> pfs[k]-pfs[j]);
  let guardPF=0;
  while (diffPF !== 0 && guardPF < 400) {
    if (diffPF > 0) {
      const i = ordUpPF.find(ii => pfs[ii] < 6);
      if (i==null) break; pfs[i] += 1; diffPF -= 1;
    } else {
      const i = ordDnPF.find(ii => pfs[ii] > 0);
      if (i==null) break; pfs[i] -= 1; diffPF += 1;
    }
    guardPF++;
  }

  // force points = scoreboard target (prefer FG bumps)
  const totalPts = (tw, th, ft) => 2*tw.reduce((a,b)=>a+b,0) + 3*th.reduce((a,b)=>a+b,0) + ft.reduce((a,b)=>a+b,0);
  const P0 = totalPts(twoMade, threeMade, ftMade) || 1;
  const target = Math.round(teamPoints);
  if (P0 !== target) {
    const f = clamp(target / P0, 0.85, 1.15);
    for (let i=0;i<plist.length;i++) {
      twoMade[i]   = clamp(Math.round(twoMade[i]*f), 0, twoAtt[i]);
      threeMade[i] = clamp(Math.round(threeMade[i]*f), 0, threeAtt[i]);
      ftMade[i]    = clamp(Math.round(ftMade[i]*(0.85*f + 0.15)), 0, fta[i]);
    }
    function bumpUp() {
      const order = top3.concat([...plist.keys()].filter(k=>!top3.includes(k)));
      for (const i of order) if (threeMade[i] < threeAtt[i]) { threeMade[i]++; return 3; }
      for (const i of order) if (twoMade[i] < twoAtt[i]) { twoMade[i]++; return 2; }
      for (const i of order) if (ftMade[i]  < Math.min(fta[i], Math.floor(0.9*fta[i]))) { ftMade[i]++; return 1; }
      return 0;
    }
    function bumpDown() {
      for (let i=plist.length-1;i>=0;i--) if (twoMade[i] > 0) { twoMade[i]--; return 2; }
      for (let i=plist.length-1;i>=0;i--) if (threeMade[i] > 0) { threeMade[i]--; return 3; }
      for (let i=plist.length-1;i>=0;i--) if (ftMade[i] > Math.floor(0.6*fta[i])) { ftMade[i]--; return 1; }
      return 0;
    }
    let guard=0;
    while (totalPts(twoMade, threeMade, ftMade) !== target && guard < 450) {
      const cur = totalPts(twoMade, threeMade, ftMade);
      if (cur < target) { if (!bumpUp()) break; }
      else { if (!bumpDown()) break; }
      guard++;
    }
  }

  // build rows (plus DNP zeros)
  const rows = plist.map((p,i)=> {
    const min = Math.round(minutesByName[p.name]||0);
    const fgm = twoMade[i] + threeMade[i];
    const fga = twoAtt[i] + threeAtt[i];
    const pts = 2*twoMade[i] + 3*threeMade[i] + ftMade[i];
    return {
      player: p.name, min, pts,
      reb: rebs[i]||0, ast: asts[i]||0, stl: stls[i]||0, blk: blks[i]||0,
      fg: `${fgm}/${fga}`, "3p": `${threeMade[i]}/${threeAtt[i]}`,
      ft: `${ftMade[i]}/${fta[i]}`, to: tos[i]||0, pf: pfs[i]||0
    };
  });
  for (const p of benchZero) rows.push({
    player: p.name, min:0, pts:0, reb:0, ast:0, stl:0, blk:0,
    fg:"0/0", "3p":"0/0", ft:"0/0", to:0, pf:0
  });
  return rows;
}

// ---------- public: simulate a single game ----------
export function simulateOneGame({ leagueData, homeTeamName, awayTeamName }) {
  if (!leagueData) throw new Error("leagueData required");
  const allTeams = Object.values(leagueData.conferences).flat();
  const home = allTeams.find(t => t.name === homeTeamName);
  const away = allTeams.find(t => t.name === awayTeamName);
  if (!home || !away) throw new Error("Team not found.");

  // minutes
  const homeMin = loadMinutesForTeam(home);
  const awayMin = loadMinutesForTeam(away);

  // ratings (for scoreboard means)
  const hR = calculateTeamRatings(home.players, homeMin);
  const aR = calculateTeamRatings(away.players, awayMin);

  // final score targets (match your friend’s formula)
  const hm = 107 + (hR.off - 75) * 0.9 - (aR.def - 75) * 0.9 + (hR.overall - aR.overall) * 0.6;
  const am = 107 + (aR.off - 75) * 0.9 - (hR.def - 75) * 0.9 + (aR.overall - hR.overall) * 0.6;
  let hs = Math.round(randn(hm, 8));
  let as = Math.round(randn(am, 8));
  hs = clamp(hs, 85, 145);
  as = clamp(as, 85, 145);

  // quarters + OT
  function qsplit(total) {
    const q = Array.from({length:4}, ()=> 0.22 + Math.random()*(0.28-0.22));
    const sc = total / q.reduce((a,b)=>a+b,0);
    const pts = q.map(x => Math.floor(x*sc));
    pts[3] += total - pts.reduce((a,b)=>a+b,0);
    return pts;
  }
  const hq = qsplit(hs);
  const aq = qsplit(as);
  let otH = 0, otA = 0, otCount = 0;
  while (hq.reduce((a,b)=>a+b,0) === aq.reduce((a,b)=>a+b,0)) {
    const addH = 8 + Math.floor(Math.random()*9);
    const addA = 8 + Math.floor(Math.random()*9);
    hq.push(addH); aq.push(addA); otH += addH; otA += addA; otCount++;
  }
  const H = hq.reduce((a,b)=>a+b,0);
  const A = aq.reduce((a,b)=>a+b,0);
  const winner = (H > A) ? { side: "home", score: `${H}-${A}`, ot: otCount>0 } : { side: "away", score: `${A}-${H}`, ot: otCount>0 };

  // box scores (pass ratings + league for means + OT count for minute reconciliation)
  const homeBox = generateBoxScore({
    team: home, minutesByName: {...homeMin}, teamPoints: H, teamRatings: hR, leagueData, numOT: otCount
  });
  const awayBox = generateBoxScore({
    team: away, minutesByName: {...awayMin}, teamPoints: A, teamRatings: aR, leagueData, numOT: otCount
  });

  return {
    periods: { home: hq, away: aq, otCount, otBreakdown: { home: otH || null, away: otA || null } },
    totals: { home: H, away: A },
    winner,
    box: { home: homeBox, away: awayBox },
    ratings: { home: hR, away: aR }
  };
}
