import {
  loadAppDataFromDB,
  saveAppDataToDB,
} from "./indexedDbStorage.js";

const RETIREMENT_NARRATIVE_PREFIX = "bm_retirement_narratives_v1:";

export function retirementNarrativeStorageKey(seasonYear) {
  const year = Number(seasonYear);
  return `${RETIREMENT_NARRATIVE_PREFIX}${Number.isFinite(year) ? year : "unknown"}`;
}

export async function loadRetirementNarrativesFromDB(seasonYear) {
  try {
    const stored = await loadAppDataFromDB(retirementNarrativeStorageKey(seasonYear));
    if (!stored || typeof stored !== "object") return {};
    return stored?.narratives && typeof stored.narratives === "object"
      ? stored.narratives
      : {};
  } catch (error) {
    console.warn("[RetirementNarratives] IndexedDB load failed", error);
    return {};
  }
}

export async function saveRetirementNarrativesToDB(seasonYear, narratives) {
  const safeNarratives = {};

  for (const [key, row] of Object.entries(narratives || {})) {
    if (!key || !row || typeof row !== "object") continue;
    const reason = String(row.reason || "").trim();
    const accomplishments = Array.isArray(row.accomplishments)
      ? row.accomplishments.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 24)
      : [];

    safeNarratives[key] = {
      reason: reason.slice(0, 1800),
      accomplishments,
    };
  }

  try {
    await saveAppDataToDB(retirementNarrativeStorageKey(seasonYear), {
      version: 1,
      seasonYear: Number(seasonYear) || null,
      narratives: safeNarratives,
    });
    return safeNarratives;
  } catch (error) {
    console.warn("[RetirementNarratives] IndexedDB save failed", error);
    return safeNarratives;
  }
}
