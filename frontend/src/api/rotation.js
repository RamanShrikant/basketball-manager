/* Auto rotation builder from your old simEngine.js (unchanged). */

export const buildSmartRotation = (teamPlayers) => {
  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const valid = (teamPlayers || []).filter(
    (p) => p && p.name && Number.isFinite(p.overall)
  );
  if (valid.length === 0) return { sorted: [], obj: {} };

  const score = (p) =>
    (p.overall || 0) + ((p.stamina || 70) - 70) * 0.15;

  // ---- choose ~10 and baseline minutes ----
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

  // assign minutes
  for (const w of work) w.minutes = 12;
  let remain = 240 - 12 * work.length;
  let i = 0;
  while (remain > 0 && work.length > 0) {
    work[i % work.length].minutes += 1;
    i++;
    remain--;
  }

  // final rotation object
  const obj = {};
  for (const p of work) obj[p.name] = p.minutes || 0;
  for (const p of valid) if (!(p.name in obj)) obj[p.name] = 0;

  return { sorted: work, obj };
};
