function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactPlayer(player = {}) {
  return {
    id: player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null,
    name: player?.name || player?.player || player?.playerName || "",
  };
}

function compactPick(pick = {}) {
  return {
    id: pick?.id || pick?.pickId || null,
    pickId: pick?.pickId || pick?.id || null,
    assetType: pick?.assetType || pick?.type || "pick",
    type: pick?.assetType || pick?.type || "pick",
    year: finiteNumber(pick?.year ?? pick?.seasonYear, 0),
    seasonYear: finiteNumber(pick?.seasonYear ?? pick?.year, 0),
    round: finiteNumber(pick?.round, 1),
    originalTeam: pick?.originalTeam || pick?.originalTeamName || pick?.team || "",
    originalTeamName: pick?.originalTeamName || pick?.originalTeam || pick?.team || "",
    ownerTeam: pick?.ownerTeam || pick?.currentOwnerTeamName || pick?.owner || "",
    currentOwnerTeamName: pick?.currentOwnerTeamName || pick?.ownerTeam || pick?.owner || "",
    protection: pick?.protection || pick?.protections || pick?.displayProtection || "Unprotected",
    protections: pick?.protections || pick?.protection || pick?.displayProtection || "Unprotected",
    displayProtection: pick?.displayProtection || pick?.protections || pick?.protection || "Unprotected",
    status: pick?.status || "active",
    pickNumber: pick?.pickNumber || pick?.overallPick || pick?.resolvedPickNumber || null,
    overallPick: pick?.overallPick || pick?.pickNumber || pick?.resolvedPickNumber || null,
  };
}

function compactItem(item = {}) {
  if (item?.type === "player") {
    return {
      type: "player",
      teamName: item?.teamName || "",
      player: compactPlayer(item?.player || {}),
    };
  }

  if (item?.type === "pick") {
    return {
      type: "pick",
      teamName: item?.teamName || "",
      pick: compactPick(item?.pick || {}),
      protection:
        item?.protection || item?.pick?.displayProtection || item?.pick?.protection || "Unprotected",
      displayLabel: item?.displayLabel || item?.pick?.displayLabel || "",
      tradeRule: item?.tradeRule || null,
      tradeValueExcluded: Boolean(item?.tradeValueExcluded),
      displayOnlyLinkedSwap: Boolean(item?.displayOnlyLinkedSwap),
    };
  }

  return null;
}

function compactCandidate(candidate = {}) {
  return {
    fromTeamName: candidate?.fromTeamName || "",
    toTeamName: candidate?.toTeamName || "",
    fromItems: (candidate?.fromItems || []).map(compactItem).filter(Boolean),
    toItems: (candidate?.toItems || []).map(compactItem).filter(Boolean),
  };
}

function compactView(view = null) {
  if (!view || typeof view !== "object") return view || null;
  return {
    accepted: Boolean(view?.accepted),
    decision: view?.decision || "",
    score: finiteNumber(view?.score, 0),
    message: view?.message || "",
    reasons: Array.isArray(view?.reasons) ? [...view.reasons] : [],
  };
}

function compactProjection(projection = null) {
  if (!projection || typeof projection !== "object") return projection || null;
  return {
    ok: projection?.ok !== false,
    reason: projection?.reason || "",
    allowedMax: finiteNumber(projection?.allowedMax, 0),
    requiresRepairBeforeSimulation: Boolean(projection?.requiresRepairBeforeSimulation),
    counts:
      projection?.counts && typeof projection.counts === "object"
        ? { ...projection.counts }
        : null,
  };
}

export function compactCpuTradeValidationResult(result = {}) {
  const base = {
    ok: Boolean(result?.ok),
    reason: result?.reason || "",
    staleCode: result?.staleCode || "",
  };

  if (!result?.ok) {
    return {
      ...base,
      message: result?.message || "",
      fromTeamView: compactView(result?.fromTeamView),
      toTeamView: compactView(result?.toTeamView),
      cooldown:
        result?.cooldown && typeof result.cooldown === "object"
          ? { ...result.cooldown }
          : null,
      fromRosterProjection: compactProjection(result?.fromRosterProjection),
      toRosterProjection: compactProjection(result?.toRosterProjection),
    };
  }

  return {
    ...base,
    candidate: compactCandidate(result?.candidate || {}),
    fromTeamView: compactView(result?.fromTeamView),
    toTeamView: compactView(result?.toTeamView),
    evaluation: {
      accepted: Boolean(result?.evaluation?.accepted),
      decision: result?.evaluation?.decision || "",
      score: finiteNumber(result?.evaluation?.score, 0),
      message: result?.evaluation?.message || "",
      reasons: Array.isArray(result?.evaluation?.reasons)
        ? [...result.evaluation.reasons]
        : [],
    },
    executionValidation:
      result?.executionValidation && typeof result.executionValidation === "object"
        ? {
            ok: result.executionValidation?.ok !== false,
            reason: result.executionValidation?.reason || "",
          }
        : null,
    fromRosterProjection: compactProjection(result?.fromRosterProjection),
    toRosterProjection: compactProjection(result?.toRosterProjection),
    requiresRosterRepairBeforeSimulation: Boolean(
      result?.requiresRosterRepairBeforeSimulation
    ),
  };
}

export function partitionIndexedCpuTradeCandidates(candidates = [], workerCount = 1) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const count = Math.max(1, Math.min(Math.trunc(Number(workerCount) || 1), rows.length || 1));
  const partitions = Array.from({ length: count }, () => []);

  rows.forEach((candidate, index) => {
    partitions[index % count].push({ index, candidate });
  });

  return partitions;
}

export function mergeIndexedCpuTradeValidationResults(responses = [], total = 0) {
  const size = Math.max(0, Math.trunc(Number(total) || 0));
  const merged = new Array(size);

  for (const response of responses || []) {
    for (const row of response?.results || []) {
      const index = Math.trunc(Number(row?.index));
      if (index < 0 || index >= size || merged[index]) {
        throw new Error("CPU_TRADE_VALIDATION_POOL_INVALID_INDEX");
      }
      merged[index] = {
        result: row?.result || null,
        durationMs: finiteNumber(row?.durationMs, 0),
        workerIndex: finiteNumber(response?.workerIndex, -1),
      };
    }
  }

  if (merged.some((row) => !row?.result)) {
    throw new Error("CPU_TRADE_VALIDATION_POOL_INCOMPLETE_RESULT");
  }

  return merged;
}

export function cpuTradeValidationParityProjection(result = {}) {
  const compact = compactCpuTradeValidationResult(result);
  return {
    ok: compact.ok,
    reason: compact.reason,
    staleCode: compact.staleCode,
    candidate: compact.candidate || null,
    fromTeamView: compact.fromTeamView,
    toTeamView: compact.toTeamView,
    evaluation: compact.evaluation || null,
    cooldown: compact.cooldown || null,
    fromRosterProjection: compact.fromRosterProjection || null,
    toRosterProjection: compact.toRosterProjection || null,
    requiresRosterRepairBeforeSimulation: Boolean(
      compact.requiresRosterRepairBeforeSimulation
    ),
  };
}

export function cpuTradeValidationParityMatches(left, right) {
  return (
    JSON.stringify(cpuTradeValidationParityProjection(left)) ===
    JSON.stringify(cpuTradeValidationParityProjection(right))
  );
}
