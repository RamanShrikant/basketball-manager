const DEFAULT_GAME_COUNT = 30;
const DEFAULT_TRIALS = 4;
const DEFAULT_TIMEOUT_MS = 120000;
let requestCounter = 1;

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round3(value) {
  return Math.round(finiteNumber(value, 0) * 1000) / 1000;
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams.filter(Boolean);
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    return Object.values(leagueData.conferences)
      .flatMap((rows) => (Array.isArray(rows) ? rows.filter(Boolean) : []));
  }
  return [];
}

function playerNameOf(player = {}) {
  return String(player?.name || player?.player || player?.fullName || "").trim();
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildBenchmarkMinutes(players = []) {
  const rotation = [...players]
    .filter((player) => player && playerNameOf(player))
    .sort((a, b) => {
      const overallDiff = finiteNumber(b?.overall, 0) - finiteNumber(a?.overall, 0);
      if (overallDiff) return overallDiff;
      return playerNameOf(a).localeCompare(playerNameOf(b));
    })
    .slice(0, 10);

  // Deterministic 240-minute allocation. This benchmark intentionally does not
  // read/write live coach gameplans or mutate the save.
  const minuteSlots = [36, 34, 32, 30, 28, 24, 20, 16, 12, 8];
  const minutes = {};
  rotation.forEach((player, index) => {
    minutes[playerNameOf(player)] = minuteSlots[index] || 0;
  });
  return minutes;
}

function buildBenchmarkTeam(team = {}) {
  const clone = jsonClone(team || {});
  clone.players = (Array.isArray(clone.players) ? clone.players : []).map((player) => ({
    ...player,
    secondaryPos:
      player?.secondaryPos === undefined || player?.secondaryPos === null || String(player.secondaryPos).trim() === ""
        ? null
        : player.secondaryPos,
  }));
  clone.minutes = buildBenchmarkMinutes(clone.players);
  return clone;
}

function buildBenchmarkGames(leagueData = {}, requestedGameCount = DEFAULT_GAME_COUNT) {
  const teams = getAllTeams(leagueData);
  if (teams.length < 2) {
    throw new Error("Game architecture benchmark requires at least two league teams.");
  }

  const preparedTeams = teams.slice(0, Math.min(30, teams.length)).map(buildBenchmarkTeam);
  const pairCount = Math.max(1, Math.floor(preparedTeams.length / 2));
  const gameCount = Math.max(2, Math.min(120, Math.trunc(finiteNumber(requestedGameCount, DEFAULT_GAME_COUNT))));
  const games = [];

  for (let index = 0; index < gameCount; index += 1) {
    const pairIndex = index % pairCount;
    const home = preparedTeams[pairIndex * 2] || preparedTeams[0];
    const away = preparedTeams[pairIndex * 2 + 1] || preparedTeams[1];
    games.push({
      id: `bm_arch_${index}`,
      home,
      away,
    });
  }

  return games;
}

function hashString(value = "") {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeNumbers(values = []) {
  const rows = values.map((value) => finiteNumber(value, 0)).filter((value) => value >= 0);
  if (!rows.length) return { count: 0, totalMs: 0, averageMs: 0, medianMs: 0, minMs: 0, maxMs: 0 };
  const sorted = [...rows].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const total = rows.reduce((sum, value) => sum + value, 0);
  return {
    count: rows.length,
    totalMs: round3(total),
    averageMs: round3(total / rows.length),
    medianMs: round3(median),
    minMs: round3(sorted[0]),
    maxMs: round3(sorted[sorted.length - 1]),
  };
}

function createRequestWaiter(worker, message, matcher, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Game architecture benchmark timed out waiting for ${message?.type || "worker response"}.`));
    }, timeoutMs);

    const onMessage = (event) => {
      const payload = event?.data;
      if (!matcher(payload)) return;
      cleanup();
      resolve(payload);
    };

    const onError = (event) => {
      cleanup();
      reject(event?.error || new Error(event?.message || "Game architecture benchmark worker failed."));
    };

    function cleanup() {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(message);
  });
}

async function seedWorker(worker, seed) {
  const requestId = `seed_${Date.now()}_${requestCounter++}`;
  const response = await createRequestWaiter(
    worker,
    {
      type: "benchmark-set-game-rng-seed",
      requestId,
      seed: Math.trunc(finiteNumber(seed, 1)),
    },
    (payload) => payload?.type === "benchmark-game-rng-seeded" && payload?.requestId === requestId
  );
  if (response?.error) throw new Error(`Failed to seed benchmark worker: ${response.error}`);
}

async function setWorkerYieldMode(worker, disabled) {
  const requestId = `yield_${Date.now()}_${requestCounter++}`;
  const response = await createRequestWaiter(
    worker,
    {
      type: "benchmark-set-game-yield-mode",
      requestId,
      disabled: Boolean(disabled),
    },
    (payload) => payload?.type === "benchmark-game-yield-mode-set" && payload?.requestId === requestId
  );
  if (response?.error) throw new Error(`Failed to set benchmark yield mode: ${response.error}`);
}

async function runSingles(worker, games, seed, trialIndex) {
  await seedWorker(worker, seed);
  const results = [];
  const workerPerfRows = [];
  const startedAt = nowMs();

  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    const id = `arch_single_${trialIndex}_${index}_${Date.now()}`;
    const response = await createRequestWaiter(
      worker,
      {
        type: "simulate-single",
        id,
        home: game.home,
        away: game.away,
        multiYearDiagnostics: true,
      },
      (payload) => payload?.type === "result-single" && payload?.id === id
    );
    if (response?.result?.error) {
      throw new Error(`Single-game benchmark failed: ${response.result.error}`);
    }
    results.push(response.result);
    workerPerfRows.push(response?.perf || {});
  }

  return {
    wallMs: round3(nowMs() - startedAt),
    results,
    perf: {
      toPy: summarizeNumbers(workerPerfRows.map((row) => row?.toPyMs)),
      python: summarizeNumbers(workerPerfRows.map((row) => row?.pythonComputeMs)),
      toJs: summarizeNumbers(workerPerfRows.map((row) => row?.toJsMs)),
    },
  };
}

async function runBatch(worker, games, seed, trialIndex) {
  await seedWorker(worker, seed);
  const batchId = `arch_batch_${trialIndex}_${Date.now()}`;
  const startedAt = nowMs();
  const response = await createRequestWaiter(
    worker,
    {
      type: "simulate-batch",
      batchId,
      multiYearDiagnostics: true,
      games: games.map((game) => ({ id: game.id, home: game.home, away: game.away })),
    },
    (payload) => payload?.type === "result-batch" && payload?.batchId === batchId
  );
  const wallMs = round3(nowMs() - startedAt);
  if (response?.error) throw new Error(`Batch benchmark failed: ${response.error}`);
  return {
    wallMs,
    results: (response?.results || []).map((row) => row?.result),
    perf: response?.perf || {},
  };
}

function buildParity(singleResults = [], batchResults = []) {
  const singleJson = JSON.stringify(singleResults);
  const batchJson = JSON.stringify(batchResults);
  return {
    exact: singleJson === batchJson,
    singleHash: hashString(singleJson),
    batchHash: hashString(batchJson),
    singleBytes: singleJson.length,
    batchBytes: batchJson.length,
  };
}

export async function runGameArchitectureBenchmark({
  leagueData,
  games = DEFAULT_GAME_COUNT,
  trials = DEFAULT_TRIALS,
  seed = 20260812,
} = {}) {
  const benchmarkGames = buildBenchmarkGames(leagueData, games);
  const trialCount = Math.max(1, Math.min(8, Math.trunc(finiteNumber(trials, DEFAULT_TRIALS))));
  const worker = new Worker("/workers/simWorkerV2.js");
  const totalStartedAt = nowMs();
  const rows = [];

  try {
    // Force worker/Pyodide initialization before measured trials.
    const initStartedAt = nowMs();
    await seedWorker(worker, seed - 1);
    const initMs = round3(nowMs() - initStartedAt);

    // One tiny warm-up in each dispatch shape. Its RNG is isolated in this
    // dedicated benchmark worker and never touches the live simulation worker.
    await runSingles(worker, benchmarkGames.slice(0, 2), seed - 2, -1);
    await runBatch(worker, benchmarkGames.slice(0, 2), seed - 2, -1);

    for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
      const trialSeed = Math.trunc(finiteNumber(seed, 20260812)) + trialIndex;
      let single;
      let batch;

      // Alternate order to reduce warm-cache/order bias while resetting Python
      // RNG before each shape so outputs must remain byte-for-byte identical.
      if (trialIndex % 2 === 0) {
        single = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
        batch = await runBatch(worker, benchmarkGames, trialSeed, trialIndex);
      } else {
        batch = await runBatch(worker, benchmarkGames, trialSeed, trialIndex);
        single = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
      }

      const parity = buildParity(single.results, batch.results);
      rows.push({
        trial: trialIndex + 1,
        seed: trialSeed,
        gameCount: benchmarkGames.length,
        order: trialIndex % 2 === 0 ? "single_then_batch" : "batch_then_single",
        singleWallMs: single.wallMs,
        batchWallMs: batch.wallMs,
        speedupPct: single.wallMs > 0
          ? round3(((single.wallMs - batch.wallMs) / single.wallMs) * 100)
          : 0,
        parity,
        singleWorker: single.perf,
        batchWorker: batch.perf,
      });
    }

    const singleWalls = summarizeNumbers(rows.map((row) => row.singleWallMs));
    const batchWalls = summarizeNumbers(rows.map((row) => row.batchWallMs));
    const speedups = summarizeNumbers(rows.map((row) => row.speedupPct));
    const allParity = rows.every((row) => row.parity.exact);
    const medianSingleMs = singleWalls.medianMs;
    const medianBatchMs = batchWalls.medianMs;

    return {
      ok: allParity,
      benchmark: "game_dispatch_single_vs_safe_worker_batch",
      generatedAt: new Date().toISOString(),
      liveSaveMutated: false,
      liveSimulationWorkerTouched: false,
      workerInitMs: initMs,
      gameCountPerTrial: benchmarkGames.length,
      trials: trialCount,
      parity: {
        exactAcrossAllTrials: allParity,
        hashes: rows.map((row) => ({
          trial: row.trial,
          single: row.parity.singleHash,
          batch: row.parity.batchHash,
          exact: row.parity.exact,
        })),
      },
      summary: {
        singleWall: singleWalls,
        batchWall: batchWalls,
        speedupPct: speedups,
        medianSingleMs,
        medianBatchMs,
        medianSavedMs: round3(Math.max(0, medianSingleMs - medianBatchMs)),
        medianSavedMsPerGame: benchmarkGames.length
          ? round3(Math.max(0, medianSingleMs - medianBatchMs) / benchmarkGames.length)
          : 0,
        projectedSavedMsAcross1230Games: benchmarkGames.length
          ? round3((Math.max(0, medianSingleMs - medianBatchMs) / benchmarkGames.length) * 1230)
          : 0,
      },
      rows,
      totalElapsedMs: round3(nowMs() - totalStartedAt),
    };
  } finally {
    worker.terminate();
  }
}

export async function runGameYieldBenchmark({
  leagueData,
  games = DEFAULT_GAME_COUNT,
  trials = DEFAULT_TRIALS,
  seed = 20260812,
} = {}) {
  const benchmarkGames = buildBenchmarkGames(leagueData, games);
  const trialCount = Math.max(1, Math.min(8, Math.trunc(finiteNumber(trials, DEFAULT_TRIALS))));
  const worker = new Worker("/workers/simWorkerV2.js");
  const totalStartedAt = nowMs();
  const rows = [];

  try {
    const initStartedAt = nowMs();
    await seedWorker(worker, seed - 1);
    const initMs = round3(nowMs() - initStartedAt);

    // Warm both execution modes on the same isolated worker. The no-yield mode
    // only replaces asyncio.sleep() inside this dedicated benchmark worker.
    await setWorkerYieldMode(worker, false);
    await runSingles(worker, benchmarkGames.slice(0, 2), seed - 2, -1);
    await setWorkerYieldMode(worker, true);
    await runSingles(worker, benchmarkGames.slice(0, 2), seed - 2, -2);
    await setWorkerYieldMode(worker, false);

    for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
      const trialSeed = Math.trunc(finiteNumber(seed, 20260812)) + trialIndex;
      let baseline;
      let noYield;

      if (trialIndex % 2 === 0) {
        await setWorkerYieldMode(worker, false);
        baseline = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
        await setWorkerYieldMode(worker, true);
        noYield = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
      } else {
        await setWorkerYieldMode(worker, true);
        noYield = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
        await setWorkerYieldMode(worker, false);
        baseline = await runSingles(worker, benchmarkGames, trialSeed, trialIndex);
      }

      const parity = buildParity(baseline.results, noYield.results);
      rows.push({
        trial: trialIndex + 1,
        seed: trialSeed,
        gameCount: benchmarkGames.length,
        order: trialIndex % 2 === 0 ? "baseline_then_no_yield" : "no_yield_then_baseline",
        baselineWallMs: baseline.wallMs,
        noYieldWallMs: noYield.wallMs,
        speedupPct: baseline.wallMs > 0
          ? round3(((baseline.wallMs - noYield.wallMs) / baseline.wallMs) * 100)
          : 0,
        parity,
        baselineWorker: baseline.perf,
        noYieldWorker: noYield.perf,
      });
    }

    await setWorkerYieldMode(worker, false);

    const baselineWalls = summarizeNumbers(rows.map((row) => row.baselineWallMs));
    const noYieldWalls = summarizeNumbers(rows.map((row) => row.noYieldWallMs));
    const speedups = summarizeNumbers(rows.map((row) => row.speedupPct));
    const allParity = rows.every((row) => row.parity.exact);
    const medianBaselineMs = baselineWalls.medianMs;
    const medianNoYieldMs = noYieldWalls.medianMs;
    const medianSavedMs = Math.max(0, medianBaselineMs - medianNoYieldMs);

    return {
      ok: allParity,
      benchmark: "game_asyncio_yield_cost",
      generatedAt: new Date().toISOString(),
      liveSaveMutated: false,
      liveSimulationWorkerTouched: false,
      workerInitMs: initMs,
      gameCountPerTrial: benchmarkGames.length,
      trials: trialCount,
      parity: {
        exactAcrossAllTrials: allParity,
        hashes: rows.map((row) => ({
          trial: row.trial,
          baseline: row.parity.singleHash,
          noYield: row.parity.batchHash,
          exact: row.parity.exact,
        })),
      },
      summary: {
        baselineWall: baselineWalls,
        noYieldWall: noYieldWalls,
        speedupPct: speedups,
        medianBaselineMs,
        medianNoYieldMs,
        medianSavedMs: round3(medianSavedMs),
        medianSavedMsPerGame: benchmarkGames.length
          ? round3(medianSavedMs / benchmarkGames.length)
          : 0,
        projectedSavedMsAcross1230Games: benchmarkGames.length
          ? round3((medianSavedMs / benchmarkGames.length) * 1230)
          : 0,
      },
      rows,
      totalElapsedMs: round3(nowMs() - totalStartedAt),
    };
  } finally {
    worker.terminate();
  }
}

