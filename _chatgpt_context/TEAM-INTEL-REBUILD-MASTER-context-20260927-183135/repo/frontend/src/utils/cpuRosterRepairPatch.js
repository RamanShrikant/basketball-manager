export function normalizeCpuRosterRepairTargetNames(values = []) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

export function applyCpuRosterRepairLeaguePatch(leagueData, leaguePatch) {
  if (!leaguePatch || typeof leaguePatch !== "object") return leagueData;

  const teamPatchRows = Array.isArray(leaguePatch.teamPatches)
    ? leaguePatch.teamPatches
    : [];
  const teamPatchMap = new Map(
    teamPatchRows
      .filter((row) => row?.teamName && row?.team)
      .map((row) => [String(row.teamName), row.team])
  );

  const sourceConferences = leagueData?.conferences || {};
  const nextConferences = { ...sourceConferences };
  for (const conferenceName of ["East", "West"]) {
    const teams = Array.isArray(sourceConferences?.[conferenceName])
      ? sourceConferences[conferenceName]
      : [];
    nextConferences[conferenceName] = teams.map((team) => {
      const teamName = String(team?.name || "");
      return teamPatchMap.get(teamName) || team;
    });
  }

  const nextLeague = {
    ...(leagueData || {}),
    conferences: nextConferences,
  };
  const topLevel = leaguePatch.topLevel;
  if (topLevel && typeof topLevel === "object") {
    for (const [key, value] of Object.entries(topLevel)) {
      nextLeague[key] = value;
    }
  }
  return nextLeague;
}
