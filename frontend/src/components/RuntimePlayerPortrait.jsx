import React, { useEffect, useMemo, useState } from "react";
import HeadshotLayoutTransform from "./HeadshotLayoutTransform.jsx";
import {
  JERSEY_MANIFEST_URL,
  PORTRAIT_DEFAULT_FITS_URL,
  PORTRAIT_STUDIO_MANIFEST_URL,
  getFallbackPortraitUrl,
  getJerseyTemplateId,
  getPlayerPortraitId,
  getPortraitStageId,
  jerseyLayerStyle,
  normalizePortraitFitConfig,
  normalizePortraitTeamCode,
  resolveJerseyFit,
  shouldUseDraftAttireForFirstYearGeneratedFreeAgent,
} from "../utils/portraitDressing.js";

let runtimeSnapshot = null;
let runtimePromise = null;
const subscribers = new Set();

function emitRuntimeSnapshot(next) {
  runtimeSnapshot = next;
  subscribers.forEach((listener) => listener(next));
}

async function loadPortraitRuntimeData() {
  if (runtimeSnapshot) return runtimeSnapshot;
  if (runtimePromise) return runtimePromise;
  runtimePromise = Promise.all([
    fetch(PORTRAIT_STUDIO_MANIFEST_URL).then((res) => (res.ok ? res.json() : null)),
    fetch(JERSEY_MANIFEST_URL).then((res) => (res.ok ? res.json() : [])),
    fetch(`${PORTRAIT_DEFAULT_FITS_URL}?runtime=${Date.now()}`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
  ])
    .then(([studio, jerseys, fits]) => {
      const entries = Array.isArray(studio?.entries) ? studio.entries : [];
      const jerseyRows = Array.isArray(jerseys) ? jerseys : [];
      const next = {
        studio,
        fitConfig: normalizePortraitFitConfig(fits || {}),
        faceById: new Map(entries.filter((row) => row?.id).map((row) => [String(row.id).toLowerCase(), row])),
        jerseyByTeam: new Map(jerseyRows.filter((row) => row?.team).map((row) => [String(row.team).toUpperCase(), row])),
      };
      emitRuntimeSnapshot(next);
      return next;
    })
    .catch((error) => {
      console.warn("[PortraitRuntime] Could not load portrait dressing assets", error);
      emitRuntimeSnapshot({ error, fitConfig: normalizePortraitFitConfig({}), faceById: new Map(), jerseyByTeam: new Map() });
      return runtimeSnapshot;
    })
    .finally(() => {
      runtimePromise = null;
    });
  return runtimePromise;
}

export function invalidatePortraitRuntimeCache() {
  runtimeSnapshot = null;
  runtimePromise = null;
  emitRuntimeSnapshot(null);
}

function usePortraitRuntimeData() {
  const [snapshot, setSnapshot] = useState(runtimeSnapshot);
  useEffect(() => {
    const listener = (next) => setSnapshot(next);
    subscribers.add(listener);
    loadPortraitRuntimeData().then((next) => setSnapshot(next));
    return () => subscribers.delete(listener);
  }, []);
  return snapshot;
}

function FallbackPortrait({ src, alt, imageClassName = "", fallback = null }) {
  if (!src) return fallback || <div className="h-full w-full" aria-hidden="true" />;
  return (
    <img
      src={src}
      alt={alt}
      draggable="false"
      className={`absolute inset-0 h-full w-full select-none object-contain object-bottom ${imageClassName}`}
    />
  );
}

/**
 * Runtime portrait renderer for post-draft players.
 * - Prospects/draft views can set mode="draft" to preserve the baked source image.
 * - Active players use jerseyless base + current team jersey.
 * - First-year generated rookie free agents keep their original draft-attire portrait.
 * - Other free agents (no team) use the jerseyless base only.
 * - Fit resolution supports per-player defaults and per-player/per-template overrides.
 *
 * The wrapper uses overflow-visible so page-level headshot Y tuning doesn't run
 * into an artificial inner clipping pocket before reaching the page chrome.
 */
export default function RuntimePlayerPortrait({
  player = null,
  team = null,
  teamName = "",
  src = "",
  alt = "Player portrait",
  className = "h-full w-full",
  imageClassName = "",
  style = undefined,
  contentStyle = undefined,
  fallback = null,
  mode = "runtime",
  ariaHidden = false,
  layoutPage = "",
  layoutOverride = null,
}) {
  const data = usePortraitRuntimeData();
  const fallbackSrc = getFallbackPortraitUrl(player || {}, src);
  const faceId = getPlayerPortraitId(player || {}, fallbackSrc);
  const stageId = getPortraitStageId(player || {});
  const teamCode = normalizePortraitTeamCode(teamName || team, player || {});
  const useDraftAttireFreeAgent = shouldUseDraftAttireForFirstYearGeneratedFreeAgent(
    player || {},
    faceId,
    fallbackSrc,
    teamCode
  );

  const resolved = useMemo(() => {
    if (mode === "draft" || useDraftAttireFreeAgent || !faceId || !data) return null;
    const face = data.faceById?.get(faceId);
    if (!face?.baseReady || !face?.baseUrl) return null;
    const jersey = teamCode ? data.jerseyByTeam?.get(teamCode) : null;
    const templateId = jersey ? getJerseyTemplateId(jersey) : "";
    const fit = jersey ? resolveJerseyFit(data.fitConfig, faceId, templateId, stageId) : null;
    return { face, jersey, fit };
  }, [data, faceId, mode, stageId, teamCode, useDraftAttireFreeAgent]);

  return (
    <div className={`relative overflow-visible ${className}`} style={style} aria-hidden={ariaHidden || undefined}>
      <HeadshotLayoutTransform
        page={layoutPage}
        layout={layoutOverride}
        className="absolute inset-0 overflow-visible"
      >
        {resolved ? (
          <div className="absolute bottom-0 left-1/2 h-full -translate-x-1/2 overflow-visible" style={{ aspectRatio: "1040 / 760" }}>
            <div className="relative h-full w-full overflow-visible" style={contentStyle}>
              <img
                src={resolved.face.baseUrl}
                alt={alt}
                draggable="false"
                className={`absolute inset-0 z-10 h-full w-full select-none object-contain object-bottom ${imageClassName}`}
              />
              {resolved.jersey?.url && (
                <div className="pointer-events-none absolute z-20 select-none" style={jerseyLayerStyle(resolved.fit)}>
                  <img
                    src={resolved.jersey.url}
                    alt=""
                    draggable="false"
                    className="h-full w-full select-none object-fill"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <FallbackPortrait src={fallbackSrc} alt={alt} imageClassName={imageClassName} fallback={fallback} />
        )}
      </HeadshotLayoutTransform>
    </div>
  );
}
