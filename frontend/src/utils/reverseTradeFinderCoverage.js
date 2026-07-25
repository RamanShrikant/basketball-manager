// Pure Reverse Trade Finder coverage helpers. These stay dependency-free so the
// candidate-order regression can be exercised by the Node regression suite.

function cleanLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

export function prioritizeReverseCandidateRows({
  candidates = [],
  maxCandidates = 220,
  packageKeyOf = () => "",
  heuristicOf = () => Number.POSITIVE_INFINITY,
} = {}) {
  const limit = cleanLimit(maxCandidates, 220);
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((items) => Array.isArray(items) && items.length)
    .map((items, originalIndex) => ({
      items,
      originalIndex,
      heuristic: Number(heuristicOf(items)),
    }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.heuristic) ? a.heuristic : Number.POSITIVE_INFINITY;
      const bScore = Number.isFinite(b.heuristic) ? b.heuristic : Number.POSITIVE_INFINITY;
      return aScore - bScore || a.items.length - b.items.length || a.originalIndex - b.originalIndex;
    });

  // A reverse search is looking for the minimum legal asking price. Preserve
  // every one-asset shell before multi-asset combinations so simple valid asks
  // cannot be crowded out by stronger standard-finder packages.
  const ordered = [...ranked.filter((row) => row.items.length === 1), ...ranked];
  const seen = new Set();
  const out = [];
  for (const row of ordered) {
    const key = String(packageKeyOf(row.items) || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row.items);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildReverseRescueQueue({
  candidates = [],
  checkedKeys = [],
  maxCandidates = 54,
  packageKeyOf = () => "",
} = {}) {
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
  const limit = cleanLimit(maxCandidates, 54);
  const out = [];
  const seen = new Set();
  for (const items of Array.isArray(candidates) ? candidates : []) {
    const key = String(packageKeyOf(items) || "");
    if (!key || checked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(items);
    if (out.length >= limit) break;
  }
  return out;
}
