// draftPicks.js
// Shared helpers for draft-pick ownership, swap rights, and protections.

export function normalizeTeamName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function getAllTeamsFromLeague(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams.filter(Boolean);
  if (leagueData.conferences && typeof leagueData.conferences === "object") {
    return Object.values(leagueData.conferences).flat().filter(Boolean);
  }
  return [];
}

function getTeamName(team) {
  return String(team?.name || team?.teamName || "").trim();
}

function getTeamLogo(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    team?.img ||
    ""
  );
}

export function getTeamLogoMap(leagueData) {
  const map = {};
  for (const team of getAllTeamsFromLeague(leagueData)) {
    const name = getTeamName(team);
    if (!name) continue;
    map[normalizeTeamName(name)] = getTeamLogo(team);
  }
  return map;
}

export function makeDraftPickId(asset = {}) {
  const year = Number(asset.year || 0) || "YYYY";
  const round = Number(asset.round || 0) || "R";
  const type = String(asset.assetType || asset.type || "pick").toLowerCase();
  const original = String(asset.originalTeam || asset.team || "TEAM")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28)
    .toUpperCase() || "TEAM";
  const owner = String(asset.ownerTeam || "OWNER")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28)
    .toUpperCase() || "OWNER";
  const seed = String(asset.seed || asset.id || Date.now())
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(-8);

  return `${year}_${original}_R${round}_${type}_${owner}_${seed}`;
}

function parseRound(value) {
  if (Number(value) === 1) return 1;
  if (Number(value) === 2) return 2;
  const text = String(value || "").toLowerCase();
  if (text.includes("1")) return 1;
  if (text.includes("2")) return 2;
  return 1;
}

function cleanOptionalText(value) {
  const text = String(value || "").trim();
  if (!text || text === "null" || text === "undefined" || text === "None") return "";
  return text;
}

function pickKnownTeam(value, teamNames = []) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exact = teamNames.find((name) => normalizeTeamName(name) === normalizeTeamName(raw));
  return exact || raw;
}

export function normalizeDraftPickAsset(asset = {}, index = 0, teamNames = []) {
  const assetType = String(asset.assetType || asset.type || "pick").toLowerCase().includes("swap")
    ? "swap"
    : "pick";

  const originalTeam = pickKnownTeam(
    asset.originalTeam || asset.original_team || asset.affectedTeam || asset.team || asset.fromTeam,
    teamNames
  );

  const ownerTeam = pickKnownTeam(
    asset.ownerTeam || asset.owner_team || asset.currentOwner || asset.rightHolder || asset.holderTeam,
    teamNames
  );

  const swapWithTeam = pickKnownTeam(
    asset.swapWithTeam || asset.swap_with_team || asset.swapTeam || asset.otherTeam,
    teamNames
  );

  const normalized = {
    ...asset,
    id: asset.id || makeDraftPickId({ ...asset, assetType, originalTeam, ownerTeam, seed: index }),
    type: assetType,
    assetType,
    year: Number(asset.year || asset.season || 2026),
    round: parseRound(asset.round),
    originalTeam,
    ownerTeam,
    swapWithTeam: assetType === "swap" ? swapWithTeam : cleanOptionalText(swapWithTeam),
    protections: cleanOptionalText(asset.protections || asset.protection || asset.conditions),
    status: cleanOptionalText(asset.status) || "active",
    notes: cleanOptionalText(asset.notes || asset.note || asset.details),
  };

  if (!normalized.originalTeam && teamNames.length) normalized.originalTeam = teamNames[0];
  if (!normalized.ownerTeam) normalized.ownerTeam = normalized.originalTeam || teamNames[0] || "";

  return normalized;
}

export function normalizeDraftPicks(picks = [], teamNames = []) {
  if (!Array.isArray(picks)) return [];

  const seen = new Set();
  const normalized = [];

  picks.forEach((asset, index) => {
    if (!asset || typeof asset !== "object") return;
    const row = normalizeDraftPickAsset(asset, index, teamNames);
    if (!row.originalTeam || !row.ownerTeam || !row.year || !row.round) return;

    let id = row.id;
    let suffix = 1;
    while (seen.has(id)) {
      suffix += 1;
      id = `${row.id}_${suffix}`;
    }
    seen.add(id);
    normalized.push({ ...row, id });
  });

  return normalized;
}

export function sortDraftPickAssets(a, b) {
  const yearDiff = Number(a?.year || 0) - Number(b?.year || 0);
  if (yearDiff) return yearDiff;

  const roundDiff = Number(a?.round || 0) - Number(b?.round || 0);
  if (roundDiff) return roundDiff;

  const ownerDiff = String(a?.ownerTeam || "").localeCompare(String(b?.ownerTeam || ""));
  if (ownerDiff) return ownerDiff;

  const originalDiff = String(a?.originalTeam || "").localeCompare(String(b?.originalTeam || ""));
  if (originalDiff) return originalDiff;

  return String(a?.assetType || a?.type || "pick").localeCompare(String(b?.assetType || b?.type || "pick"));
}

export function getDraftPickAssetLabel(asset = {}) {
  const type = String(asset.assetType || asset.type || "pick") === "swap" ? "Swap" : "Pick";
  const round = Number(asset.round) === 1 ? "1st" : "2nd";
  const original = asset.originalTeam || "Unknown Team";
  const owner = asset.ownerTeam || "Unknown Owner";
  const year = asset.year || "Unknown Year";

  if (type === "Swap") {
    const other = asset.swapWithTeam ? ` with ${asset.swapWithTeam}` : "";
    return `${year} ${round} swap right: ${owner} controls ${original}${other}`;
  }

  return `${year} ${round} round pick: ${original} owned by ${owner}`;
}

function draftPickMergeKey(asset = {}) {
  return [
    asset.assetType || asset.type || "pick",
    Number(asset.year || 0),
    Number(asset.round || 0),
    normalizeTeamName(asset.originalTeam),
    normalizeTeamName(asset.ownerTeam),
    normalizeTeamName(asset.swapWithTeam),
  ].join("|");
}

export function createDefaultDraftPicksForTeams(teamNames = [], startYear = 2026, endYear = 2032) {
  const picks = [];
  const safeStart = Number(startYear || 2026);
  const safeEnd = Number(endYear || safeStart);

  for (const teamName of teamNames) {
    if (!teamName) continue;
    for (let year = safeStart; year <= safeEnd; year += 1) {
      for (const round of [1, 2]) {
        picks.push({
          id: makeDraftPickId({
            assetType: "pick",
            year,
            round,
            originalTeam: teamName,
            ownerTeam: teamName,
            seed: `${year}_${round}_${teamName}`,
          }),
          type: "pick",
          assetType: "pick",
          year,
          round,
          originalTeam: teamName,
          ownerTeam: teamName,
          swapWithTeam: "",
          protections: "",
          status: "active",
          notes: "Default own pick",
        });
      }
    }
  }

  return picks;
}

export function mergeDraftPicks(existingPicks = [], incomingPicks = []) {
  const merged = [];
  const seenKeys = new Set();
  const seenIds = new Set();

  for (const asset of [...existingPicks, ...incomingPicks]) {
    if (!asset || typeof asset !== "object") continue;
    const key = draftPickMergeKey(asset);
    const id = String(asset.id || "");

    if (seenKeys.has(key)) continue;
    if (id && seenIds.has(id)) continue;

    seenKeys.add(key);
    if (id) seenIds.add(id);
    merged.push(asset);
  }

  return merged;
}
