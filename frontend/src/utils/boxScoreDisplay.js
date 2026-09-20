export function boxScoreMinutesToNumber(value) {
  if (typeof value === "string" && value.includes(":")) {
    const [mins, secs] = value.split(":").map((part) => Number(part));
    const m = Number.isFinite(mins) ? mins : 0;
    const s = Number.isFinite(secs) ? secs : 0;
    return m + s / 60;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function sortBoxRowsForDisplay(rows = [], frozenOrder = [], fallbackOrder = []) {
  const order = Array.from(new Set([...(frozenOrder || []), ...(fallbackOrder || [])].filter(Boolean)));
  const index = new Map(order.map((name, i) => [String(name), i]));

  return [...(rows || [])].sort((a, b) => {
    const aPlayed = boxScoreMinutesToNumber(a?.min ?? a?.minutes) > 0;
    const bPlayed = boxScoreMinutesToNumber(b?.min ?? b?.minutes) > 0;

    // Everyone who actually played belongs above every DNP. Within each group,
    // preserve the frozen gameplan order captured for this particular game.
    if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;

    const aName = String(a?.player || "");
    const bName = String(b?.player || "");
    const aIdx = index.has(aName) ? index.get(aName) : Number.MAX_SAFE_INTEGER;
    const bIdx = index.has(bName) ? index.get(bName) : Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) return aIdx - bIdx;

    if (aPlayed && bPlayed) {
      const minDiff =
        boxScoreMinutesToNumber(b?.min ?? b?.minutes) -
        boxScoreMinutesToNumber(a?.min ?? a?.minutes);
      if (minDiff !== 0) return minDiff;
    }

    return aName.localeCompare(bName);
  });
}
