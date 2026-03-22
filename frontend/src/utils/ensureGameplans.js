// src/utils/ensureGameplans.js

const GAMEPLAN_VERSION = 2;

// Helpers to support both league shapes: { teams: [...] } or { conferences: { ... } }
function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getRosterSignature(teamPlayers = []) {
  return [...teamPlayers]
    .map((p) =>
      [
        p.name || "",
        p.pos || "",
        p.secondaryPos || "",
        Number(p.overall) || 0,
      ].join("|")
    )
    .sort()
    .join("||");
}

function fatiguePenalty(mins, stamina) {
  const threshold = 0.359 * stamina + 2.46;
  const over = Math.max(0, mins - threshold);
  return Math.max(0.7, 1 - 0.0075 * over);
}

// FULL smart rotation builder - returns BOTH sorted players and minutes obj
function buildSmartRotation(teamPlayers) {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(Number(p.overall))
  );

  if (valid.length === 0) return { sorted: [], obj: {} };

  const score = (p) =>
    (Number(p.overall) || 0) + ((Number(p.stamina) || 70) - 70) * 0.15;

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

  const coreSet = new Set(work.slice(0, 5).map((p) => p.name));
  let improved = true;

  while (improved) {
    improved = false;
    let base = teamTotal(work).ovr;

    for (let a = 0; a < work.length; a++) {
      for (let b = 0; b < work.length; b++) {
        if (a === b) continue;

        const A = work[a];
        const B = work[b];

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

  const permute = (arr) => {
    const out = [];
    const rec = (path, rest) => {
      if (rest.length === 0) {
        out.push(path.slice());
        return;
      }
      for (let j = 0; j < rest.length; j++) {
        path.push(rest[j]);
        rec(path, [...rest.slice(0, j), ...rest.slice(j + 1)]);
        path.pop();
      }
    };
    rec([], arr.slice());
    return out;
  };

  const combos = (arr, k) => {
    const res = [];
    const go = (start, path) => {
      if (path.length === k) {
        res.push(path.slice());
        return;
      }
      for (let j = start; j < arr.length; j++) {
        path.push(arr[j]);
        go(j + 1, path);
        path.pop();
      }
    };
    go(0, []);
    return res;
  };

  const posPerms = permute(POSITIONS);
  let bestMap = null;
  let bestScore = -Infinity;

  const PRIMARY_BONUS = 0.02;
  const SECONDARY_PEN = 0.01;

  for (const five of combos(work, Math.min(5, work.length))) {
    for (const perm of posPerms) {
      let ok = true;
      let primaryHits = 0;
      let secUses = 0;
      let sumOvr = 0;
      const mapping = {};

      for (let k = 0; k < five.length; k++) {
        const pl = five[k];
        const pos = perm[k];
        const eligible = pl.pos === pos || pl.secondaryPos === pos;

        if (!eligible) {
          ok = false;
          break;
        }

        mapping[pos] = pl;
        sumOvr += pl.overall || 0;

        if (pos === pl.pos) primaryHits += 1;
        else if (pl.secondaryPos === pos) secUses += 1;
      }

      if (!ok) continue;

      const avgOvr = sumOvr / 5;
      const score = avgOvr + PRIMARY_BONUS * primaryHits - SECONDARY_PEN * secUses;

      if (score > bestScore) {
        bestScore = score;
        bestMap = mapping;
      }
    }
  }

  if (!bestMap) {
    const top5 = [...work]
      .sort((a, b) => (b.overall || 0) - (a.overall || 0))
      .slice(0, 5);

    bestMap = {};
    const POS = ["PG", "SG", "SF", "PF", "C"];
    for (let j = 0; j < POS.length; j++) {
      if (top5[j]) bestMap[POS[j]] = top5[j];
    }
  }

  const starters = ["PG", "SG", "SF", "PF", "C"]
    .map((p) => bestMap[p])
    .filter(Boolean);

  const starterIds = new Set(starters.map((p) => p.name));

  const bench = work
    .filter((p) => !starterIds.has(p.name))
    .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));

  const usedNames = new Set(work.map((w) => w.name));
  const others = valid.filter((p) => !usedNames.has(p.name));

  const sorted = [...starters, ...bench, ...others];

  const obj = {};
  for (const p of sorted) obj[p.name] = p.minutes || 0;
  for (const p of valid) {
    if (!(p.name in obj)) obj[p.name] = 0;
  }

  return { sorted, obj };
}

function buildGameplanPayload(team) {
  const teamPlayers = team?.players || [];
  const { sorted, obj } = buildSmartRotation(teamPlayers);

  return {
    version: GAMEPLAN_VERSION,
    teamName: team?.name || "",
    rosterSignature: getRosterSignature(teamPlayers),
    order: sorted.map((p) => p.name),
    minutes: obj,
    updatedAt: Date.now(),
  };
}

function saveGameplan(team) {
  if (!team?.name) return false;

  const payload = buildGameplanPayload(team);
  localStorage.setItem(`gameplan_${team.name}`, JSON.stringify(payload));
  return true;
}

// creates only missing plans
export function ensureGameplansForLeague(leagueData) {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!teams.length) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;

  for (const t of teams) {
    const key = `gameplan_${t.name}`;
    const already = localStorage.getItem(key);

    if (already) {
      skipped++;
      continue;
    }

    if (saveGameplan(t)) created++;
  }

  return { created, skipped };
}

// force rebuilds ALL teams, overwriting stale plans
export function rebuildGameplansForLeague(leagueData, options = {}) {
  const teams = getAllTeamsFromLeague(leagueData);
  if (!teams.length) return { rebuilt: 0 };

  const skipUserTeamName = options.skipUserTeamName || null;
  let rebuilt = 0;

  for (const t of teams) {
    if (!t?.name) continue;
    if (skipUserTeamName && t.name === skipUserTeamName) continue;

    if (saveGameplan(t)) rebuilt++;
  }

  return { rebuilt };
}

export function rebuildSingleTeamGameplan(team) {
  if (!team?.name) return false;
  return saveGameplan(team);
}

export function getRosterSignatureForGameplan(teamPlayers = []) {
  return getRosterSignature(teamPlayers);
}