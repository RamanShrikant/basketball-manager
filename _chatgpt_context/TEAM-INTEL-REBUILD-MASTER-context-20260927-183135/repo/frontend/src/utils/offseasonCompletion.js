// Completion evidence is valid only for the offseason that produced it.
export function readCurrentOffseasonState(stored, seasonYear, defaults = {}) {
  const current = stored && Number(stored.seasonYear) === Number(seasonYear);
  return { ...defaults, ...(current ? stored : {}), seasonYear };
}

export function currentOptionsResult(stored, seasonYear) {
  return stored && Number(stored.seasonYear) === Number(seasonYear) ? stored : null;
}

export function optionsPreviewNeedsProcessing(preview) {
  if (!preview?.ok) return false;
  return ['expiredContracts', 'playerOptions', 'teamOptions', 'twoWayDecisions', 'stashDecisions']
    .some((key) => Array.isArray(preview[key]) && preview[key].length > 0);
}
