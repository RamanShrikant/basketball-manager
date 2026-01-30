// src/utils/ensureGameplans.js

// Helpers to support both league shapes: {teams:[...]} or {conferences:{...}}
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

// ---- Your existing logic (copied from CoachGameplan) ----
function fatiguePenalty(mins, stamina) {
  const threshold = 0.359 * stamina + 2.46;
  const over = Math.max(0, mins - threshold);
  return Math.max(0.7, 1 - 0.0075 * over);
}

// This is your Auto Rebuild rotation builder (trimmed to only return minutes obj)
// IMPORTANT: we are keeping this logic identical in spirit to your CoachGameplan.
// If you want PERFECT parity, in Step 2 we’ll literally paste your exact buildSmartRotation here.
function buildSmartRotation(teamPlayers) {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );
  if (valid.length === 0) return { obj: {} };

  const score = (p) => (Number(p.overall) || 0) + ((Number(p.stamina) || 70) - 70) * 0.15;

  // choose ~10
  const chosen = [];
  for (const pos of POSITIONS) {
    const posPlayers = valid
      .filter((p) => p.pos === pos || p.secondaryPos === pos)
      .sort((a, b) => score(b) - score(a));
    if (posPlayers.length) {
      const best = posPlayers[0];
      if (!chosen.find((c) => c.name === best.name)) chosen.push(best);
    }
  }
  for (const p of [...valid].sort((a, b) => score(b) - score(a))) {
    if (chosen.length >= Math.min(10, valid.length)) break;
    if (!chosen.find((c) => c.name === p.name)) chosen.push(p);
  }

  const work = chosen.map((p) => ({ ...p, minutes: 0 }));

  // baseline minutes
  for (const w of work) w.minutes = 12;
  let remain = 240 - 12 * work.length;
  let i = 0;
  while (remain > 0 && work.length > 0) {
    work[i % work.length].minutes += 1;
    i++;
    remain--;
  }

  const teamTotal = (arr) => {
    let ovr = 0;
    const posTot = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    for (const p of arr) {
      const m = p.minutes || 0;
      if (m <= 0) continue;
      const pen = fatiguePenalty(m, p.stamina || 70);
      const w = m / 240;
      ovr += w * ((p.overall || 0) * pen);
      if (p.pos) posTot[p.pos] += m;
      if (p.secondaryPos) posTot[p.secondaryPos] += m * 0.2;
    }
    const missing =
      Math.max(0, 48 - (posTot.PG || 0)) +
      Math.max(0, 48 - (posTot.SG || 0)) +
      Math.max(0, 48 - (posTot.SF || 0)) +
      Math.max(0, 48 - (posTot.PF || 0)) +
      Math.max(0, 48 - (posTot.C || 0));
    const coveragePenalty = 1 - 0.02 * (missing / 240);
    return { ovr: ovr * coveragePenalty };
  };

  // hill-climb minutes a bit
  const coreSet = new Set(work.slice(0, 5).map((p) => p.name));
  let improved = true;
  while (improved) {
    improved = false;
    let base = teamTotal(work).ovr;

    for (let a = 0; a < work.length; a++) {
      for (let b = 0; b < work.length; b++) {
        if (a === b) continue;
        const A = work[a], B = work[b];
        if ((A.minutes || 0) <= 12) continue;
        if ((B.minutes || 0) >= 24 && !coreSet.has(B.name)) continue;

        A.minutes -= 1;
        B.minutes += 1;

        const test = teamTotal(work).ovr;
        if (test > base) {
          base = test;
          improved = true;
        } else {
          A.minutes += 1;
          B.minutes -= 1;
        }
      }
    }
  }

  // minutes object
  const obj = {};
  for (const p of work) obj[p.name] = p.minutes || 0;
  for (const p of valid) if (!(p.name in obj)) obj[p.name] = 0;

  return { obj };
}

// ✅ MAIN: ensures every team has a saved gameplan in localStorage
export function ensureGameplansForLeague(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!teams.length) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  for (const t of teams) {
    const teamName = t?.name;
    if (!teamName) continue;

    const key = `gameplan_${teamName}`;
    const already = localStorage.getItem(key);

    if (already) {
      skipped++;
      continue;
    }

    const { obj } = buildSmartRotation(t.players || []);
    localStorage.setItem(key, JSON.stringify(obj));
    created++;
  }

  return { created, skipped };
}
