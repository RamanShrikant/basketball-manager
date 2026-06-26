// src/utils/tradeDeskFeed.js
// Real Trade Desk feed storage/helpers for CPU-to-CPU rumors, negotiations, completed trades,
// and the Trade History Log.

export const TRADE_DESK_FEED_KEY = "bm_trade_desk_feed_v1";
const MAX_FEED_ROWS = 90;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeJson(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value = "") {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

function getCurrentSeasonYear(leagueData = {}) {
  return Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      0
  );
}

function uniqueIdForEntry(entry = {}) {
  const base = [
    entry.type || "feed",
    entry.date || entry.currentDate || "",
    entry.day || entry.dayIndex || "",
    entry.label || "",
    entry.tag || "",
    entry.headline || "",
    safeArray(entry.teamNames).join("|"),
    safeArray(entry.playerNames).join("|"),
  ].join("::");

  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }

  return `${norm(entry.type || "feed") || "feed"}_${hash.toString(36)}`;
}

function formatPickFromObject(pick = {}) {
  const year = pick.year || pick.season || pick.seasonYear || "Future";
  const round = Number(pick.round || pick.rnd || 1);
  const original = pick.originalTeam || pick.originalTeamName || pick.original || pick.team || pick.fromTeam || pick.owner || "Own";
  const suffix = round === 1 ? "1st" : round === 2 ? "2nd" : `R${round}`;
  const pickNumber = Number(pick.pickNumber || pick.overallPick || pick.resolvedPickNumber || pick.draftPickNumber || 0);
  const pickText = pickNumber ? ` #${pickNumber}` : "";
  return `${year} ${suffix}${pickText} - ${original}`;
}

function normalizeAsset(asset = {}, fallbackTeamName = "") {
  if (typeof asset === "string") {
    const label = cleanText(asset);
    return label ? { type: "asset", label, teamName: fallbackTeamName } : null;
  }

  if (!asset || typeof asset !== "object") return null;

  const type = cleanText(asset.type || asset.assetType || (asset.player || asset.playerName ? "player" : asset.pick || asset.year ? "pick" : "asset")).toLowerCase();

  if (type === "player") {
    const player = asset.player && typeof asset.player === "object" ? asset.player : asset;
    const label = cleanText(asset.label || asset.playerName || player.name || player.player || "Unknown Player");
    return {
      ...asset,
      type: "player",
      label,
      playerName: cleanText(asset.playerName || player.name || player.player || label),
      pos: cleanText(asset.pos || player.pos || player.position || ""),
      age: Number.isFinite(Number(asset.age ?? player.age)) ? Number(asset.age ?? player.age) : undefined,
      overall: Number.isFinite(Number(asset.overall ?? player.overall ?? player.ovr)) ? Number(asset.overall ?? player.overall ?? player.ovr) : undefined,
      potential: Number.isFinite(Number(asset.potential ?? player.potential ?? player.pot)) ? Number(asset.potential ?? player.potential ?? player.pot) : undefined,
      salary: Number.isFinite(Number(asset.salary ?? player.salary ?? player.currentSalary)) ? Number(asset.salary ?? player.salary ?? player.currentSalary) : undefined,
      teamName: cleanText(asset.teamName || player.teamName || player.currentTeam || fallbackTeamName),
    };
  }

  if (type === "pick" || type === "resolved") {
    const pick = asset.pick && typeof asset.pick === "object" ? asset.pick : asset;
    const label = cleanText(asset.label || asset.displayLabel || formatPickFromObject(pick));
    const protection = cleanText(asset.protection || pick.displayProtection || pick.protections || pick.protection || "Unprotected");
    return {
      ...asset,
      type: "pick",
      label,
      displayLabel: label,
      protection,
      year: pick.year || pick.season || pick.seasonYear,
      round: pick.round || pick.rnd,
      originalTeam: cleanText(pick.originalTeam || pick.originalTeamName || pick.original || pick.team || ""),
      teamName: cleanText(asset.teamName || pick.ownerTeam || pick.currentOwnerTeamName || pick.owner || fallbackTeamName),
    };
  }

  const label = cleanText(asset.label || asset.name || asset.title || "Asset");
  return { ...asset, type: "asset", label, teamName: cleanText(asset.teamName || fallbackTeamName) };
}

function normalizeAssetList(assets = [], fallbackTeamName = "") {
  return safeArray(assets).map((asset) => normalizeAsset(asset, fallbackTeamName)).filter(Boolean);
}

function assetsFromSummary(summary = {}, fallbackTeamName = "") {
  if (!summary || typeof summary !== "object") return [];
  const players = safeArray(summary.players).map((label) => ({ type: "player", label: cleanText(label), playerName: cleanText(label), teamName: fallbackTeamName }));
  const picks = safeArray(summary.picks).map((label) => ({ type: "pick", label: cleanText(label), displayLabel: cleanText(label), teamName: fallbackTeamName }));
  return [...players, ...picks].filter((asset) => asset.label);
}

function summarizeAssets(assets = []) {
  const clean = normalizeAssetList(assets).map((asset) => cleanText(asset.label)).filter(Boolean);
  if (!clean.length) return "salary and roster pieces";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more`;
}

function summarizePlayers(players = []) {
  const clean = safeArray(players).map(cleanText).filter(Boolean);
  if (!clean.length) return "salary and roster pieces";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more`;
}

function summarizePicks(picks = []) {
  const clean = safeArray(picks).map(cleanText).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean.length - 2} more picks`;
}

function assetsLine(players = [], picks = []) {
  const playerLine = summarizePlayers(players);
  const pickLine = summarizePicks(picks);
  return pickLine ? `${playerLine}, plus ${pickLine}` : playerLine;
}

function reasonForTeam(row = {}, teamName = "", fallback = "") {
  const reasonMap = row.reasoning && typeof row.reasoning === "object" ? row.reasoning : {};
  const direct = reasonMap[teamName] || reasonMap[norm(teamName)] || "";
  if (direct) return cleanText(direct);

  const side = safeArray(row.teamPackages).find((pkg) => norm(pkg?.teamName) === norm(teamName));
  if (side?.reason) return cleanText(side.reason);

  if (fallback) return cleanText(fallback);
  return `${teamName} accepted the package because the incoming value fit its roster direction and trade rules.`;
}

function buildTeamPackagesFromTradeRecord(row = {}) {
  const fromTeam = cleanText(row.fromTeamName || row.userTeamName || "");
  const toTeam = cleanText(row.toTeamName || row.cpuTeamName || "");
  if (!fromTeam || !toTeam) return [];

  if (Array.isArray(row.teamPackages) && row.teamPackages.length) {
    return row.teamPackages
      .map((side) => ({
        teamName: cleanText(side?.teamName),
        received: normalizeAssetList(side?.received, side?.teamName),
        sent: normalizeAssetList(side?.sent, side?.teamName),
        reason: cleanText(side?.reason || reasonForTeam(row, side?.teamName || "")),
      }))
      .filter((side) => side.teamName);
  }

  const fromSent = normalizeAssetList(row.fromSentAssets || row.userSentAssets, fromTeam);
  const toSent = normalizeAssetList(row.toSentAssets || row.cpuSentAssets, toTeam);
  const fallbackFromSent = fromSent.length ? fromSent : assetsFromSummary(row.userSent, fromTeam);
  const fallbackToSent = toSent.length ? toSent : assetsFromSummary(row.cpuSent, toTeam);

  return [
    {
      teamName: fromTeam,
      received: fallbackToSent,
      sent: fallbackFromSent,
      reason: reasonForTeam(row, fromTeam),
    },
    {
      teamName: toTeam,
      received: fallbackFromSent,
      sent: fallbackToSent,
      reason: reasonForTeam(row, toTeam),
    },
  ];
}

function buildTradeHeadline(row = {}, teamPackages = []) {
  const fromTeam = cleanText(row.fromTeamName || row.userTeamName || "");
  const toTeam = cleanText(row.toTeamName || row.cpuTeamName || "");
  if (row.headline) return cleanText(row.headline);

  const toSide = teamPackages.find((side) => norm(side.teamName) === norm(toTeam));
  const fromSide = teamPackages.find((side) => norm(side.teamName) === norm(fromTeam));
  if (fromTeam && toTeam && toSide && fromSide) {
    return `${toTeam} acquired ${summarizeAssets(toSide.received)} from ${fromTeam} for ${summarizeAssets(fromSide.received)}.`;
  }

  if (fromTeam && toTeam) return `${fromTeam} and ${toTeam} completed a trade.`;
  return "A completed trade was added to the league history.";
}

export function normalizeTradeDeskEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;

  const type = cleanText(entry.type || entry.kind || "rumor").toLowerCase();
  const label = cleanText(entry.label || entry.title || (type === "transaction" ? "Transaction Wire" : "League Intel"));
  const headline = cleanText(entry.headline || entry.message || entry.text || "");
  if (!headline) return null;

  const tag = cleanText(entry.tag || type || "Feed");
  const date = cleanText(entry.date || entry.currentDate || "");
  const createdAt = cleanText(entry.createdAt || entry.timestamp || "") || nowIso();
  const dayValue = Number(entry.day ?? entry.dayIndex ?? entry.currentDay ?? 0);
  const day = Number.isFinite(dayValue) && dayValue > 0 ? dayValue : null;

  const teamNames = safeArray(entry.teamNames || entry.teams)
    .map(cleanText)
    .filter(Boolean);
  const playerNames = safeArray(entry.playerNames || entry.players)
    .map(cleanText)
    .filter(Boolean);

  const teamPackages = safeArray(entry.teamPackages)
    .map((side) => ({
      teamName: cleanText(side?.teamName),
      received: normalizeAssetList(side?.received, side?.teamName),
      sent: normalizeAssetList(side?.sent, side?.teamName),
      reason: cleanText(side?.reason || ""),
    }))
    .filter((side) => side.teamName);

  return {
    ...entry,
    id: cleanText(entry.id || "") || uniqueIdForEntry({ ...entry, type, label, headline, tag, date, teamNames, playerNames }),
    type,
    label,
    headline,
    tag,
    date,
    day,
    createdAt,
    teamNames,
    playerNames,
    teamPackages,
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : type === "transaction" ? 100 : type === "negotiation" ? 65 : 40,
    source: cleanText(entry.source || "cpu_trade_desk"),
  };
}

export function readTradeDeskFeed() {
  if (typeof localStorage === "undefined") return [];
  const rows = safeJson(localStorage.getItem(TRADE_DESK_FEED_KEY), []);
  return safeArray(rows)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries);
}

export function writeTradeDeskFeed(entries = []) {
  const clean = safeArray(entries)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries)
    .slice(0, MAX_FEED_ROWS);

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(TRADE_DESK_FEED_KEY, JSON.stringify(clean));
    } catch (error) {
      console.warn("[TradeDeskFeed] failed to save feed", error);
    }
  }

  return clean;
}

export function appendTradeDeskEntries(entries = []) {
  const incoming = safeArray(entries)
    .map(normalizeTradeDeskEntry)
    .filter(Boolean);

  if (!incoming.length) return readTradeDeskFeed();

  const byId = new Map();
  for (const row of [...readTradeDeskFeed(), ...incoming]) {
    if (!row?.id) continue;
    byId.set(row.id, { ...(byId.get(row.id) || {}), ...row });
  }

  return writeTradeDeskFeed([...byId.values()]);
}

export function sortTradeDeskEntries(a = {}, b = {}) {
  const dateA = Date.parse(a.createdAt || a.date || "") || 0;
  const dateB = Date.parse(b.createdAt || b.date || "") || 0;
  if (dateA !== dateB) return dateB - dateA;
  return Number(b.priority || 0) - Number(a.priority || 0);
}

export function buildTradeHistoryLogEntry(tradeRecord = {}) {
  if (!tradeRecord || typeof tradeRecord !== "object") return null;

  const fromTeam = cleanText(tradeRecord.fromTeamName || tradeRecord.userTeamName || "");
  const toTeam = cleanText(tradeRecord.toTeamName || tradeRecord.cpuTeamName || "");
  if (!fromTeam || !toTeam) return null;

  const teamPackages = buildTeamPackagesFromTradeRecord(tradeRecord);
  const headline = buildTradeHeadline(tradeRecord, teamPackages);
  const teamNames = [fromTeam, toTeam];
  const playerNames = teamPackages.flatMap((side) => side.received || [])
    .filter((asset) => asset?.type === "player")
    .map((asset) => asset.playerName || asset.label)
    .filter(Boolean);

  return normalizeTradeDeskEntry({
    id: `history_${tradeRecord.id || tradeRecord.tradeRecordId || `${fromTeam}_${toTeam}_${tradeRecord.completedAt || Date.now()}`}`,
    type: "transaction",
    label: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "CPU Trade" : "Trade History",
    tag: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "CPU Deal" : "Completed",
    headline,
    date: tradeRecord.date || tradeRecord.currentDate || "",
    day: tradeRecord.day || tradeRecord.dayIndex || tradeRecord.currentDay || null,
    createdAt: tradeRecord.completedAt || tradeRecord.createdAt || nowIso(),
    teamNames,
    playerNames,
    priority: 130,
    source: tradeRecord.source || "trade_history",
    tradeRecordId: tradeRecord.id || null,
    seasonYear: tradeRecord.seasonYear || null,
    cpuCpuTrade: Boolean(tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade"),
    teamPackages,
    reasoning: tradeRecord.reasoning || {},
  });
}

export function buildCompletedCpuTradeDeskEntry(tradeRecord = {}, currentDate = "") {
  const entry = buildTradeHistoryLogEntry({
    ...tradeRecord,
    date: currentDate || tradeRecord.date || tradeRecord.currentDate || "",
  });
  if (!entry) return null;

  return normalizeTradeDeskEntry({
    ...entry,
    id: entry.id || `history_${tradeRecord.id || Date.now()}`,
    label: tradeRecord.cpuCpuTrade || tradeRecord.source === "cpu_cpu_trade" ? "Transaction Wire" : "Trade History",
    tag: "Completed",
    priority: 120,
  });
}

export function buildRejectedCpuTradeDeskEntry({ candidate = {}, result = {}, currentDate = "" } = {}) {
  const fromTeam = cleanText(candidate.fromTeamName || candidate.sellerTeamName || "");
  const toTeam = cleanText(candidate.toTeamName || candidate.buyerTeamName || "");
  if (!fromTeam || !toTeam) return null;

  const targetNames = safeArray(candidate.fromItems)
    .filter((item) => item?.type === "player")
    .map((item) => cleanText(item?.player?.name || item?.player?.player))
    .filter(Boolean);

  const target = targetNames[0] || "a rotation piece";
  const reason = cleanText(result?.reason || "the value gap stayed too wide");

  return normalizeTradeDeskEntry({
    type: "negotiation",
    label: "Talks Stalled",
    tag: "Stalled",
    headline: `${toTeam} checked on ${target} from ${fromTeam}, but talks stalled because ${reason.toLowerCase()}.`,
    date: currentDate,
    createdAt: nowIso(),
    teamNames: [fromTeam, toTeam],
    playerNames: targetNames,
    priority: 58,
    source: "cpu_cpu_trade_rejected",
  });
}

export function buildTradeHistoryLogEntries(leagueData = {}) {
  const currentSeason = getCurrentSeasonYear(leagueData);

  return safeArray(leagueData?.tradeHistory)
    .filter((row) => {
      const rowSeason = Number(row?.seasonYear || currentSeason || 0);
      return !currentSeason || !rowSeason || rowSeason === currentSeason;
    })
    .map(buildTradeHistoryLogEntry)
    .filter(Boolean)
    .sort(sortTradeDeskEntries);
}

export function buildTradeHistoryDeskEntries(leagueData = {}) {
  return buildTradeHistoryLogEntries(leagueData).map((entry) =>
    normalizeTradeDeskEntry({
      ...entry,
      label: entry.cpuCpuTrade ? "Transaction Wire" : "Trade History",
      tag: entry.cpuCpuTrade ? "CPU Deal" : "Completed",
      priority: 120,
    })
  ).filter(Boolean);
}

export function mergeTradeDeskFeedWithLeague(feed = [], leagueData = {}) {
  const byId = new Map();
  for (const entry of [...safeArray(feed), ...buildTradeHistoryDeskEntries(leagueData)]) {
    const clean = normalizeTradeDeskEntry(entry);
    if (clean?.id) byId.set(clean.id, clean);
  }
  return [...byId.values()].sort(sortTradeDeskEntries);
}
