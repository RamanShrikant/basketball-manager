import { getTeamAbbreviation } from "./teamAbbreviations.js";

export const PORTRAIT_CANVAS_WIDTH = 1040;
export const PORTRAIT_CANVAS_HEIGHT = 760;
export const ROOKIE_FACE_MANIFEST_URL = "/assets/rookie_faces/rookie_faces_manifest.json";
export const PORTRAIT_STUDIO_MANIFEST_URL = "/assets/portrait_studio/portrait_studio_manifest.json";
export const PORTRAIT_DEFAULT_FITS_URL = "/assets/portrait_studio/fits/portrait_fits.json";
export const JERSEY_MANIFEST_URL = "/assets/jerseys/v1/jerseys_manifest.json";
export const PORTRAIT_DRESSING_STORAGE_KEY = "bm_portrait_dressing_fit_v2";
export const PORTRAIT_DRESSING_LEGACY_STORAGE_KEY = "bm_portrait_dressing_fit_v1";
export const PORTRAIT_FIT_VERSION = "bm_portrait_dressing_fit_v2";

export const DEFAULT_JERSEY_FIT = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
  left: 0,
  right: 0,
  up: 0,
  down: 0,
  opacity: 1,
});

const clamp = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeJerseyFit(fit = {}) {
  return {
    x: clamp(fit.x ?? DEFAULT_JERSEY_FIT.x, -260, 260),
    y: clamp(fit.y ?? DEFAULT_JERSEY_FIT.y, -260, 260),
    scale: clamp(fit.scale ?? DEFAULT_JERSEY_FIT.scale, 0.55, 1.6),
    left: clamp(fit.left ?? DEFAULT_JERSEY_FIT.left, -180, 260),
    right: clamp(fit.right ?? DEFAULT_JERSEY_FIT.right, -180, 260),
    up: clamp(fit.up ?? DEFAULT_JERSEY_FIT.up, -180, 260),
    down: clamp(fit.down ?? DEFAULT_JERSEY_FIT.down, -180, 260),
    opacity: clamp(fit.opacity ?? DEFAULT_JERSEY_FIT.opacity, 0, 1),
  };
}

export function composeJerseyFits(base = DEFAULT_JERSEY_FIT, adjustment = DEFAULT_JERSEY_FIT) {
  const a = normalizeJerseyFit(base);
  const b = normalizeJerseyFit(adjustment);
  return normalizeJerseyFit({
    x: a.x + b.x,
    y: a.y + b.y,
    scale: a.scale * b.scale,
    left: a.left + b.left,
    right: a.right + b.right,
    up: a.up + b.up,
    down: a.down + b.down,
    opacity: a.opacity * b.opacity,
  });
}

function normalizeJerseyOverrideMap(map = {}) {
  if (!isObject(map)) return {};
  return Object.fromEntries(
    Object.entries(map)
      .filter(([templateId, fit]) => Boolean(templateId) && isObject(fit))
      .map(([templateId, fit]) => [templateId, normalizeJerseyFit(fit)])
  );
}

function normalizeStageMap(map = {}) {
  if (!isObject(map)) return {};
  return Object.fromEntries(
    Object.entries(map)
      .filter(([stageId, profile]) => Boolean(stageId) && isObject(profile))
      .map(([stageId, profile]) => [stageId, {
        default: profile.default ? normalizeJerseyFit(profile.default) : null,
        jerseys: normalizeJerseyOverrideMap(profile.jerseys),
      }])
  );
}

export function normalizeFaceFitProfile(profile = {}) {
  // v1 stored each face directly as a fit object. Treat that as the v2 default.
  const looksLikeLegacyFit = isObject(profile) && ["x", "y", "scale", "left", "right", "up", "down", "opacity"].some((key) => key in profile);
  if (looksLikeLegacyFit) {
    return { default: normalizeJerseyFit(profile), jerseys: {}, stages: {} };
  }
  return {
    default: normalizeJerseyFit(profile?.default || DEFAULT_JERSEY_FIT),
    jerseys: normalizeJerseyOverrideMap(profile?.jerseys),
    stages: normalizeStageMap(profile?.stages),
  };
}

export function createEmptyPortraitFitConfig() {
  return {
    version: PORTRAIT_FIT_VERSION,
    canvas: { width: PORTRAIT_CANVAS_WIDTH, height: PORTRAIT_CANVAS_HEIGHT },
    fitByTemplate: {},
    fitByFace: {},
    jerseyTemplateHashes: {},
  };
}

export function normalizePortraitFitConfig(raw = {}) {
  const source = isObject(raw) ? raw : {};
  const rawFaceMap = isObject(source.fitByFace) ? source.fitByFace : source;
  const fitByFace = Object.fromEntries(
    Object.entries(rawFaceMap)
      .filter(([faceId, profile]) => /^rookie_face_\d+$/i.test(String(faceId || "")) && isObject(profile))
      .map(([faceId, profile]) => [String(faceId).toLowerCase(), normalizeFaceFitProfile(profile)])
  );
  const fitByTemplate = Object.fromEntries(
    Object.entries(isObject(source.fitByTemplate) ? source.fitByTemplate : {})
      .filter(([templateId, fit]) => Boolean(templateId) && isObject(fit))
      .map(([templateId, fit]) => [templateId, normalizeJerseyFit(fit)])
  );
  const jerseyTemplateHashes = Object.fromEntries(
    Object.entries(isObject(source.jerseyTemplateHashes) ? source.jerseyTemplateHashes : {})
      .filter(([templateId, hash]) => Boolean(templateId) && Boolean(hash))
      .map(([templateId, hash]) => [String(templateId), String(hash)])
  );
  return {
    version: PORTRAIT_FIT_VERSION,
    canvas: { width: PORTRAIT_CANVAS_WIDTH, height: PORTRAIT_CANVAS_HEIGHT },
    fitByTemplate,
    fitByFace,
    jerseyTemplateHashes,
  };
}

export function mergePortraitFitConfigs(base = {}, overlay = {}) {
  const a = normalizePortraitFitConfig(base);
  const b = normalizePortraitFitConfig(overlay);
  const fitByFace = { ...a.fitByFace };
  for (const [faceId, profile] of Object.entries(b.fitByFace)) {
    const previous = fitByFace[faceId] || normalizeFaceFitProfile({});
    fitByFace[faceId] = {
      default: profile.default || previous.default,
      jerseys: { ...previous.jerseys, ...profile.jerseys },
      stages: { ...previous.stages, ...profile.stages },
    };
  }
  return {
    ...a,
    ...b,
    fitByTemplate: { ...a.fitByTemplate, ...b.fitByTemplate },
    fitByFace,
    jerseyTemplateHashes: { ...a.jerseyTemplateHashes, ...b.jerseyTemplateHashes },
  };
}

export function normalizeJerseyFitMap(map = {}) {
  // Backwards-compatible helper used by older imports/tests.
  return Object.fromEntries(
    Object.entries(normalizePortraitFitConfig({ fitByFace: map }).fitByFace)
      .map(([faceId, profile]) => [faceId, profile.default])
  );
}

export function getStoredPortraitFitConfig() {
  if (typeof window === "undefined") return createEmptyPortraitFitConfig();
  try {
    const current = window.localStorage.getItem(PORTRAIT_DRESSING_STORAGE_KEY);
    if (current) return normalizePortraitFitConfig(JSON.parse(current));
    const legacy = window.localStorage.getItem(PORTRAIT_DRESSING_LEGACY_STORAGE_KEY);
    if (legacy) return normalizePortraitFitConfig({ fitByFace: JSON.parse(legacy) });
  } catch {}
  return createEmptyPortraitFitConfig();
}

export function saveStoredPortraitFitConfig(config = {}) {
  const clean = normalizePortraitFitConfig(config);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PORTRAIT_DRESSING_STORAGE_KEY, JSON.stringify(clean));
  }
  return clean;
}

export function getStoredJerseyFitMap() {
  return Object.fromEntries(
    Object.entries(getStoredPortraitFitConfig().fitByFace).map(([faceId, profile]) => [faceId, profile.default])
  );
}

export function saveStoredJerseyFitMap(map = {}) {
  const config = saveStoredPortraitFitConfig({ fitByFace: map });
  return Object.fromEntries(Object.entries(config.fitByFace).map(([faceId, profile]) => [faceId, profile.default]));
}

export function getJerseyTemplateId(jersey = {}) {
  if (jersey?.id) return String(jersey.id);
  if (jersey?.templateId) return String(jersey.templateId);
  if (jersey?.team) return `${String(jersey.team).toUpperCase()}_jersey_v1`;
  const filename = String(jersey?.filename || "").replace(/\.png$/i, "").trim();
  return filename || "";
}

export function getPortraitStageId(player = {}) {
  return String(player?.portraitStage || player?.portraitVariant || "").trim().toLowerCase();
}

export function getPlayerPortraitId(player = {}, fallbackSrc = "") {
  const explicit = String(player?.portraitId || player?.portraitFamilyId || player?.faceId || "").trim().toLowerCase();
  if (/^rookie_face_\d+$/i.test(explicit)) return explicit;
  const source = String(fallbackSrc || player?.headshot || player?.image || player?.img || player?.portrait || "");
  const match = source.match(/(rookie_face_\d+)(?:_base)?\.png/i);
  return match ? match[1].toLowerCase() : "";
}

export function getFallbackPortraitUrl(player = {}, explicitSrc = "") {
  return explicitSrc || player?.headshot || player?.portrait || player?.image || player?.photo || player?.img || player?.face || "";
}

export function normalizePortraitTeamCode(teamLike, player = {}) {
  const raw = typeof teamLike === "string"
    ? teamLike
    : teamLike?.abbreviation || teamLike?.abbr || teamLike?.teamAbbr || teamLike?.code || teamLike?.name || teamLike?.teamName || "";
  const playerRaw = player?.teamAbbr || player?.teamCode || player?.teamName || player?.team || "";
  const candidate = String(raw || playerRaw || "").trim();
  if (!candidate || /free\s*agent|unsigned/i.test(candidate)) return "";
  const upper = candidate.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper === "PHO" ? "PHX" : upper;
  const fromName = getTeamAbbreviation(candidate, "");
  return fromName === "PHO" ? "PHX" : fromName;
}

export function hasJerseyOverride(config, faceId, templateId, stageId = "") {
  const clean = normalizePortraitFitConfig(config);
  const profile = clean.fitByFace[String(faceId || "").toLowerCase()];
  if (!profile || !templateId) return false;
  const stage = stageId ? profile.stages?.[String(stageId).toLowerCase()] : null;
  return Boolean(stage?.jerseys?.[templateId] || profile.jerseys?.[templateId]);
}

export function resolveJerseyFit(config, faceId, templateId, stageId = "") {
  const clean = normalizePortraitFitConfig(config);
  const profile = clean.fitByFace[String(faceId || "").toLowerCase()] || normalizeFaceFitProfile({});
  const normalizedStage = String(stageId || "").toLowerCase();
  const stage = normalizedStage ? profile.stages?.[normalizedStage] : null;
  const specific = stage?.jerseys?.[templateId] || profile.jerseys?.[templateId];
  if (specific) return normalizeJerseyFit(specific);
  const defaultFit = stage?.default || profile.default || DEFAULT_JERSEY_FIT;
  const templateFit = clean.fitByTemplate?.[templateId] || DEFAULT_JERSEY_FIT;
  return composeJerseyFits(defaultFit, templateFit);
}

export function jerseyLayerStyle(fit = {}) {
  const safe = normalizeJerseyFit(fit);
  const leftPx = -safe.left + safe.x;
  const rightPx = -safe.right - safe.x;
  const topPx = -safe.up + safe.y;
  const bottomPx = -safe.down - safe.y;
  return {
    left: `${(leftPx / PORTRAIT_CANVAS_WIDTH) * 100}%`,
    right: `${(rightPx / PORTRAIT_CANVAS_WIDTH) * 100}%`,
    top: `${(topPx / PORTRAIT_CANVAS_HEIGHT) * 100}%`,
    bottom: `${(bottomPx / PORTRAIT_CANVAS_HEIGHT) * 100}%`,
    transform: `scale(${safe.scale})`,
    transformOrigin: "center center",
    opacity: safe.opacity,
  };
}
