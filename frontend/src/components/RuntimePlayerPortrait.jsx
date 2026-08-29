import React, { useEffect, useMemo, useState } from "react";
import HeadshotLayoutTransform from "./HeadshotLayoutTransform.jsx";
import {
  JERSEY_MANIFEST_URL,
  PORTRAIT_DEFAULT_FITS_URL,
  PORTRAIT_STUDIO_MANIFEST_URL,
  REAL_PLAYER_FACE_MANIFEST_URL,
  getFallbackPortraitUrl,
  getLastKnownPortraitTeamCode,
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
    fetch(REAL_PLAYER_FACE_MANIFEST_URL).then((res) => (res.ok ? res.json() : [])).catch(() => []),
    fetch(JERSEY_MANIFEST_URL).then((res) => (res.ok ? res.json() : [])),
    fetch(`${PORTRAIT_DEFAULT_FITS_URL}?runtime=${Date.now()}`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
  ])
    .then(([studio, realPlayers, jerseys, fits]) => {
      const rookieEntries = Array.isArray(studio?.entries) ? studio.entries : [];
      const realEntries = Array.isArray(realPlayers) ? realPlayers : [];
      const entries = [...rookieEntries, ...realEntries];
      const jerseyRows = Array.isArray(jerseys) ? jerseys : [];
      const next = {
        studio,
        fitConfig: normalizePortraitFitConfig(fits || {}),
        faceById: new Map(entries.filter((row) => row?.id).map((row) => [String(row.id).toLowerCase(), row])),
        faceByPlayerId: new Map(realEntries.filter((row) => row?.playerId).map((row) => [String(row.playerId), row])),
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
 * - Active players use jerseyless base + current team jersey when appropriate.
 * - Real NBA free agents preserve their most recent valid team headshot.
 * - First-year generated rookie free agents keep their original draft-attire portrait.
 * - Other generated free agents preserve the existing jerseyless-base behavior.
 * - Fit resolution supports per-player defaults and per-player/per-template overrides.
 *
 * The outer wrapper stays overflow-visible so page-level headshot tuning can
 * move the complete portrait freely. The canonical 1040x760 composite itself
 * is clipped, so jersey overlays cannot bleed past the portrait canvas edge.
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

  const runtimeFace = useMemo(() => {
    if (!data) return null;
    return data.faceById?.get(faceId) || data.faceByPlayerId?.get(String(player?.id || "")) || null;
  }, [data, faceId, player?.id]);

  const resolved = useMemo(() => {
    if (mode === "draft" || useDraftAttireFreeAgent || !runtimeFace) return null;
    const face = runtimeFace;
    if (!face?.baseReady || !face?.baseUrl) return null;

    const fitFaceId = String(face?.id || faceId || "").toLowerCase();
    const isRealPlayerFace = /^real_face_/i.test(fitFaceId);
    const sourceTeamCode = isRealPlayerFace
      ? normalizePortraitTeamCode(face?.teamName || "", {})
      : "";

    // A real player's jerseyless base is never a finished portrait. When the
    // player is a free agent, preserve the most recent NBA-team presentation
    // recorded by the existing FA lifecycle metadata (for example:
    // PHX official -> SAS dressed portrait -> FA keeps SAS dressed portrait).
    const portraitTeamCode = isRealPlayerFace && !teamCode
      ? getLastKnownPortraitTeamCode(player || {})
      : teamCode;

    // If the last/current team is still the source-headshot team, the official
    // source image is already the correct most-recent look.
    if (isRealPlayerFace && sourceTeamCode && sourceTeamCode === portraitTeamCode) {
      return null;
    }

    const jersey = portraitTeamCode ? data.jerseyByTeam?.get(portraitTeamCode) : null;

    // Never expose a naked jerseyless base for a real NBA player. If there is
    // no valid team jersey to layer, fall back to the official source headshot.
    if (isRealPlayerFace && !jersey?.url) return null;

    const templateId = jersey ? getJerseyTemplateId(jersey) : "";
    const fit = jersey ? resolveJerseyFit(data.fitConfig, fitFaceId, templateId, stageId) : null;
    return { face, jersey, fit, portraitTeamCode };
  }, [data, faceId, mode, player, runtimeFace, stageId, teamCode, useDraftAttireFreeAgent]);

  const isRealRuntimeFace = /^real_face_/i.test(String(runtimeFace?.id || faceId || ""));
  const fallbackIsNakedRealBase = /\/assets\/real_player_faces\/base\/real_face_[a-z0-9_-]+_base\.png(?:[?#].*)?$/i.test(String(fallbackSrc || ""));
  const displayFallbackSrc = isRealRuntimeFace
    ? (runtimeFace?.sourceUrl || (fallbackIsNakedRealBase ? "" : fallbackSrc))
    : fallbackSrc;

  return (
    <div className={`relative overflow-visible ${className}`} style={style} aria-hidden={ariaHidden || undefined}>
      <HeadshotLayoutTransform
        page={layoutPage}
        layout={layoutOverride}
        className="absolute inset-0 overflow-visible"
      >
        {resolved ? (
          <div className="absolute bottom-0 left-1/2 h-full -translate-x-1/2 overflow-hidden" style={{ aspectRatio: "1040 / 760" }}>
            <div className="relative h-full w-full overflow-hidden" style={contentStyle}>
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
          <FallbackPortrait src={displayFallbackSrc} alt={alt} imageClassName={imageClassName} fallback={fallback} />
        )}
      </HeadshotLayoutTransform>
    </div>
  );
}
