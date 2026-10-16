// postRookieRightsNormalization.js
// One-time repair for stale rookie-scale/RFA control on players who have
// already signed a contract containing post-rookie seasons.

export const POST_ROOKIE_RIGHTS_MIGRATION_KEY = "postRookieContractRightsV1";

function finiteInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getDraftMeta(player = {}) {
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  return {
    draftYear: finiteInt(meta.draftYear ?? meta.draftSeasonYear ?? player?.draftYear, null),
    draftRound: finiteInt(meta.draftRound ?? player?.draftRound, null),
  };
}

function contractHasPostRookieYear(player = {}, contract = null) {
  if (!contract || typeof contract !== "object") return false;

  const { draftYear, draftRound } = getDraftMeta(player);
  if (!Number.isFinite(draftYear)) return false;
  if (Number.isFinite(draftRound) && ![1, 2].includes(draftRound)) return false;

  const salaryByYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const startYear = finiteInt(contract.startYear, null);
  if (!Number.isFinite(startYear) || salaryByYear.length <= 0) return false;

  // Rookie team control may cover draftYear through draftYear + 3.
  // Any salary season after that proves the player has already signed a
  // post-rookie contract/extension, so rookie-scale RFA control is consumed.
  const rookieControlLastYear = draftYear + 3;
  const contractLastYear = startYear + salaryByYear.length - 1;
  return contractLastYear > rookieControlLastYear;
}

function hasExplicitRookieExtensionMarker(player = {}) {
  const rights = player?.rights && typeof player.rights === "object" ? player.rights : {};
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const previousContract = player?.previousContract && typeof player.previousContract === "object"
    ? player.previousContract
    : {};

  if (rights.rookieScaleExtensionSigned || rights.rookieScaleControlConsumed) return true;

  const rows = [
    contract.extensionMeta,
    ...(Array.isArray(contract.extensions) ? contract.extensions : []),
    previousContract.extensionMeta,
    ...(Array.isArray(previousContract.extensions) ? previousContract.extensions : []),
  ].filter((row) => row && typeof row === "object");

  return rows.some((row) => String(row.type || row.extensionType || "").toLowerCase() === "rookie_scale");
}

export function getPostRookieRightsDiagnosis(player = {}) {
  const rights = player?.rights && typeof player.rights === "object" ? player.rights : {};
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : null;
  const previousContract = player?.previousContract && typeof player.previousContract === "object"
    ? player.previousContract
    : null;
  const { draftYear, draftRound } = getDraftMeta(player);

  const currentHasPostRookieYear = contractHasPostRookieYear(player, contract);
  const previousHasPostRookieYear = contractHasPostRookieYear(player, previousContract);
  const explicitExtension = hasExplicitRookieExtensionMarker(player);
  const staleRookieControl = Boolean(
    rights.rookieScale &&
    (explicitExtension || currentHasPostRookieYear || previousHasPostRookieYear)
  );

  return {
    playerId: player?.id ?? null,
    playerName: player?.name || "",
    draftYear,
    draftRound,
    rookieControlLastYear: Number.isFinite(draftYear) ? draftYear + 3 : null,
    contractStartYear: finiteInt(contract?.startYear, null),
    contractLastYear: Number.isFinite(finiteInt(contract?.startYear, null)) && Array.isArray(contract?.salaryByYear)
      ? finiteInt(contract.startYear, 0) + contract.salaryByYear.length - 1
      : null,
    previousContractStartYear: finiteInt(previousContract?.startYear, null),
    previousContractLastYear: Number.isFinite(finiteInt(previousContract?.startYear, null)) && Array.isArray(previousContract?.salaryByYear)
      ? finiteInt(previousContract.startYear, 0) + previousContract.salaryByYear.length - 1
      : null,
    currentHasPostRookieYear,
    previousHasPostRookieYear,
    explicitExtension,
    rightsRookieScale: Boolean(rights.rookieScale),
    rightsRestrictedFreeAgent: Boolean(rights.restrictedFreeAgent),
    qualifyingOffer: Boolean(player?.qualifyingOffer),
    qualifyingOfferEligible: Boolean(player?.qualifyingOfferEligible),
    staleRookieControl,
    alreadyConsumed: Boolean(meta.rookieRightsConsumed || rights.rookieScaleControlConsumed),
  };
}

export function consumePostRookieRightsForPlayer(player = {}) {
  if (!player || typeof player !== "object") return { changed: false, diagnosis: null };

  const diagnosis = getPostRookieRightsDiagnosis(player);
  if (!diagnosis?.staleRookieControl) return { changed: false, diagnosis };

  const rights = player.rights && typeof player.rights === "object" ? player.rights : {};
  player.rights = {
    ...rights,
    rookieScale: false,
    restrictedFreeAgent: false,
    rookieScaleControlConsumed: true,
    rookieScaleExtensionSigned: true,
  };

  player.rookieScale = false;
  player.restrictedFreeAgent = false;

  for (const key of [
    "qualifyingOffer",
    "qualifyingOfferEligible",
    "rfaOfferSheet",
    "offerSheet",
    "rfaMatched",
    "rfaMatch",
    "rfaStatus",
    "tenderedQO",
  ]) {
    delete player[key];
  }

  const meta = player.meta && typeof player.meta === "object" ? player.meta : (player.meta = {});
  meta.rookieTeamControl = false;
  meta.rookieRightsConsumed = true;
  delete meta.rookieRightsPath;

  for (const contract of [player.contract, player.previousContract]) {
    if (!contract || typeof contract !== "object") continue;
    contract.rookieScale = false;
    for (const key of [
      "restrictedFreeAgent",
      "rfa",
      "isRFA",
      "rfaMatched",
      "offerSheet",
      "qualifyingOffer",
    ]) {
      delete contract[key];
    }
  }

  return {
    changed: true,
    diagnosis: getPostRookieRightsDiagnosis(player),
  };
}

function iterLeaguePlayers(leagueData = {}) {
  const rows = [];
  for (const teams of Object.values(leagueData?.conferences || {})) {
    for (const team of Array.isArray(teams) ? teams : []) {
      for (const player of Array.isArray(team?.players) ? team.players : []) {
        rows.push({ player, teamName: team?.name || "" });
      }
    }
  }
  for (const player of Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : []) {
    rows.push({ player, teamName: "Free Agent" });
  }
  return rows;
}

export function auditPostRookieRights(leagueData = {}) {
  return iterLeaguePlayers(leagueData)
    .map(({ player, teamName }) => ({ teamName, ...getPostRookieRightsDiagnosis(player) }))
    .filter((row) => row.staleRookieControl || row.alreadyConsumed || row.playerName === "Paolo Banchero");
}

export function normalizePostRookieExtensionRights(leagueData = {}, { force = false } = {}) {
  if (!leagueData || typeof leagueData !== "object") return { leagueData, changed: false, repaired: [] };

  const migrations = leagueData.dataMigrations && typeof leagueData.dataMigrations === "object"
    ? leagueData.dataMigrations
    : (leagueData.dataMigrations = {});

  if (!force && migrations[POST_ROOKIE_RIGHTS_MIGRATION_KEY]) {
    return { leagueData, changed: false, repaired: [] };
  }

  const repaired = [];
  for (const { player, teamName } of iterLeaguePlayers(leagueData)) {
    const before = getPostRookieRightsDiagnosis(player);
    const result = consumePostRookieRightsForPlayer(player);
    if (result.changed) {
      repaired.push({
        teamName,
        playerId: player?.id ?? null,
        playerName: player?.name || "",
        draftYear: before?.draftYear ?? null,
        rookieControlLastYear: before?.rookieControlLastYear ?? null,
        contractLastYear: before?.contractLastYear ?? before?.previousContractLastYear ?? null,
      });
    }
  }

  migrations[POST_ROOKIE_RIGHTS_MIGRATION_KEY] = {
    applied: true,
    repairedCount: repaired.length,
  };

  if (repaired.length) {
    console.info("[PostRookieRights] consumed stale rookie-scale control", repaired);
  }

  return { leagueData, changed: repaired.length > 0, repaired };
}
