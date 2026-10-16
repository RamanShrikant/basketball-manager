import React, { useEffect, useMemo, useState } from "react";

const MANIFEST_URL = "/assets/rookie_faces/rookie_faces_manifest.json";
const PLAYER_DNA_STORAGE_KEY = "bm_face_dna_lab_player_presets_v4";
const FACE_CALIBRATION_STORAGE_KEY = "bm_face_dna_lab_face_calibration_v4";

const FALLBACK_FACES = [
  { id: "rookie_face_0003", url: "/assets/rookie_faces/rookie_face_0003.png", appearancePool: "Black", skinTone: "medium-dark", hairTextureGroup: "coily", defaultHairStyle: "short fade", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0004", url: "/assets/rookie_faces/rookie_face_0004.png", appearancePool: "Black", skinTone: "medium-dark", hairTextureGroup: "coily", defaultHairStyle: "short twists", defaultFacialHair: "light goatee", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0005", url: "/assets/rookie_faces/rookie_face_0005.png", appearancePool: "Black", skinTone: "medium-dark", hairTextureGroup: "coily", defaultHairStyle: "buzz cut", defaultFacialHair: "light beard", expression: "smile", quality: "strong" },
  { id: "rookie_face_0006", url: "/assets/rookie_faces/rookie_face_0006.png", appearancePool: "Black", skinTone: "medium-dark", hairTextureGroup: "coily", defaultHairStyle: "short twists", defaultFacialHair: "goatee", expression: "smile", quality: "strong" },
  { id: "rookie_face_0033", url: "/assets/rookie_faces/rookie_face_0033.png", appearancePool: "Mixed", skinTone: "light-brown", hairTextureGroup: "curly/coily", defaultHairStyle: "braids", defaultFacialHair: "light goatee", expression: "smile", quality: "strong" },
  { id: "rookie_face_0034", url: "/assets/rookie_faces/rookie_face_0034.png", appearancePool: "Latino / Mixed", skinTone: "tan", hairTextureGroup: "wavy/curly", defaultHairStyle: "short curls", defaultFacialHair: "light stubble", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0035", url: "/assets/rookie_faces/rookie_face_0035.png", appearancePool: "Mixed", skinTone: "light-brown", hairTextureGroup: "curly", defaultHairStyle: "short curls", defaultFacialHair: "light facial hair", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0036", url: "/assets/rookie_faces/rookie_face_0036.png", appearancePool: "Latino / Mixed", skinTone: "tan", hairTextureGroup: "curly/coily", defaultHairStyle: "braids", defaultFacialHair: "light beard", expression: "smile", quality: "strong" },
  { id: "rookie_face_0047", url: "/assets/rookie_faces/rookie_face_0047.png", appearancePool: "Black", skinTone: "dark", hairTextureGroup: "coily", defaultHairStyle: "short fade", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0048", url: "/assets/rookie_faces/rookie_face_0048.png", appearancePool: "Black", skinTone: "dark", hairTextureGroup: "coily", defaultHairStyle: "short fade", defaultFacialHair: "light beard", expression: "smile", quality: "strong" },
  { id: "rookie_face_0059", url: "/assets/rookie_faces/rookie_face_0059.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0060", url: "/assets/rookie_faces/rookie_face_0060.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "none", expression: "smile", quality: "strong" },
  { id: "rookie_face_0061", url: "/assets/rookie_faces/rookie_face_0061.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "light stubble", expression: "neutral", quality: "usable - crop slightly larger" },
  { id: "rookie_face_0062", url: "/assets/rookie_faces/rookie_face_0062.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "none", expression: "smile", quality: "strong" },
  { id: "rookie_face_0063", url: "/assets/rookie_faces/rookie_face_0063.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0064", url: "/assets/rookie_faces/rookie_face_0064.png", appearancePool: "White", skinTone: "light", hairTextureGroup: "straight/wavy", defaultHairStyle: "short hair", defaultFacialHair: "none", expression: "smile", quality: "strong" },
  { id: "rookie_face_0084", url: "/assets/rookie_faces/rookie_face_0084.png", appearancePool: "East Asian", skinTone: "light-medium", hairTextureGroup: "straight", defaultHairStyle: "short black hair", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0085", url: "/assets/rookie_faces/rookie_face_0085.png", appearancePool: "East Asian", skinTone: "light-medium", hairTextureGroup: "straight", defaultHairStyle: "short black hair", defaultFacialHair: "none", expression: "smile", quality: "strong" },
  { id: "rookie_face_0094", url: "/assets/rookie_faces/rookie_face_0094.png", appearancePool: "Mixed / Pacific Islander", skinTone: "medium", hairTextureGroup: "straight/wavy", defaultHairStyle: "short black hair", defaultFacialHair: "none", expression: "neutral", quality: "strong" },
  { id: "rookie_face_0095", url: "/assets/rookie_faces/rookie_face_0095.png", appearancePool: "Mixed", skinTone: "light-brown", hairTextureGroup: "wavy/curly", defaultHairStyle: "short curls", defaultFacialHair: "light stubble", expression: "neutral", quality: "strong" },
];

const FACIAL_HAIR_OPTIONS = ["none", "stubble", "mustache", "goatee", "short beard", "full beard"];
const STYLE_PROFILES = ["low maintenance", "clean cut", "changes hair sometimes", "experimental", "rugged veteran"];
const HAIRLINE_OPTIONS = ["normal", "slight recession", "medium recession", "deep recession"];
const JERSEY_OPTIONS = ["DRAFT", "FA", "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];

const CALIBRATION_LAYERS = [
  { key: "jersey", label: "Jersey/body layer" },
  { key: "facialHair", label: "Facial hair base / beard fill" },
  { key: "mustache", label: "Mustache only" },
  { key: "chinHair", label: "Goatee / chin hair only" },
  { key: "beardConnection", label: "Beard side connections" },
  { key: "aging", label: "Aging lines" },
  { key: "eyeBags", label: "Eye bags" },
  { key: "hairline", label: "Hairline / recession" },
  { key: "gray", label: "Grey hair" },
];

const DEFAULT_LAYER_CALIBRATION = {
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
};

const DEFAULT_OVERLAY_CALIBRATION = {
  jersey: { x: 0, y: 0, scale: 1, opacity: 1 },
  facialHair: { x: 0, y: 0, scale: 1, opacity: 1 },
  mustache: { x: 0, y: 0, scale: 1, opacity: 1 },
  chinHair: { x: 0, y: 0, scale: 1, opacity: 1 },
  beardConnection: { x: 0, y: 0, scale: 1, opacity: 1 },
  aging: { x: 0, y: 0, scale: 1, opacity: 1 },
  eyeBags: { x: 0, y: 0, scale: 1, opacity: 1 },
  hairline: { x: 0, y: 0, scale: 1, opacity: 1 },
  gray: { x: 0, y: 0, scale: 1, opacity: 1 },
};

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function safeJSON(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeLayerCalibration(layer = {}) {
  return {
    x: clamp(layer.x ?? DEFAULT_LAYER_CALIBRATION.x, -240, 240),
    y: clamp(layer.y ?? DEFAULT_LAYER_CALIBRATION.y, -240, 240),
    scale: clamp(layer.scale ?? DEFAULT_LAYER_CALIBRATION.scale, 0.5, 1.8),
    opacity: clamp(layer.opacity ?? DEFAULT_LAYER_CALIBRATION.opacity, 0, 1),
  };
}

function cloneCalibration(overrides = {}) {
  const next = {};
  for (const layer of CALIBRATION_LAYERS) {
    next[layer.key] = normalizeLayerCalibration({
      ...(DEFAULT_OVERLAY_CALIBRATION[layer.key] || DEFAULT_LAYER_CALIBRATION),
      ...(overrides?.[layer.key] || {}),
    });
  }
  return next;
}

function ensureCalibration(calibration = {}) {
  return cloneCalibration(calibration);
}

function normalizeCalibrationMap(map = {}) {
  const out = {};
  if (!map || typeof map !== "object") return out;

  for (const [faceId, calibration] of Object.entries(map)) {
    if (!faceId) continue;
    out[faceId] = ensureCalibration(calibration);
  }

  return out;
}

function svgLayerTransform(layer = {}) {
  const cal = normalizeLayerCalibration(layer);
  return `translate(${cal.x} ${cal.y}) translate(520 380) scale(${cal.scale}) translate(-520 -380)`;
}

function htmlLayerStyle(layer = {}) {
  const cal = normalizeLayerCalibration(layer);
  return {
    transform: `translate(${cal.x}px, ${cal.y}px) scale(${cal.scale})`,
    transformOrigin: "center center",
  };
}

function normalizeFace(row = {}) {
  const id = row.id || row.faceId || "unknown_face";
  return {
    id,
    url: row.url || `/assets/rookie_faces/${id}.png`,
    status: row.status || "keep",
    appearancePool: row.appearancePool || row.pool || "Unclassified",
    skinTone: row.skinTone || "unknown",
    hairTextureGroup: row.hairTextureGroup || "unknown",
    defaultHairStyle: row.defaultHairStyle || row.hairStyle || "unknown",
    defaultFacialHair: row.defaultFacialHair || "none",
    expression: row.expression || "neutral",
    quality: row.quality || "unrated",
    overlayCalibration: ensureCalibration(row.overlayCalibration || row.calibration || {}),
  };
}

function createDefaultPlayerDNA(face = FALLBACK_FACES[0]) {
  const safeFace = normalizeFace(face);
  return {
    version: "bm_face_player_dna_v3",
    baseFaceId: safeFace.id,
    baseFaceUrl: safeFace.url,
    appearancePool: safeFace.appearancePool,
    skinTone: safeFace.skinTone,
    hairTextureGroup: safeFace.hairTextureGroup,
    baseHairStyle: safeFace.defaultHairStyle,
    baseFacialHair: safeFace.defaultFacialHair || "none",
    // Overlay facial hair is additive. Existing/baked facial hair in the base PNG stays in the image.
    facialHair: "none",
    beardLevel: 0,
    mustacheThickness: 42,
    goateeChinOffsetY: 0,
    agingLevel: 0,
    grayLevel: 0,
    hairline: "normal",
    eyeBagLevel: 0,
    styleProfile: "low maintenance",
    jersey: "DRAFT",
    changeRates: {
      hairChangeRate: 20,
      beardGrowthRate: 25,
      hairLossRisk: 8,
      grayRate: 5,
      styleAdventurousness: 20,
    },
  };
}

function minimumBeardLevelForStyle(style) {
  if (style === "stubble") return 35;
  if (style === "mustache") return 35;
  if (style === "goatee") return 40;
  if (style === "short beard") return 45;
  if (style === "full beard") return 60;
  return 0;
}

function cleanPlayerDNA(dna = {}, face = FALLBACK_FACES[0]) {
  const safeFace = normalizeFace(face);
  const base = createDefaultPlayerDNA(safeFace);
  return {
    ...base,
    ...dna,
    version: "bm_face_player_dna_v3",
    baseFaceId: dna.baseFaceId || safeFace.id,
    baseFaceUrl: dna.baseFaceUrl || safeFace.url,
    appearancePool: dna.appearancePool || safeFace.appearancePool,
    skinTone: dna.skinTone || safeFace.skinTone,
    hairTextureGroup: dna.hairTextureGroup || safeFace.hairTextureGroup,
    baseHairStyle: dna.baseHairStyle || safeFace.defaultHairStyle,
    baseFacialHair: dna.baseFacialHair || safeFace.defaultFacialHair || "none",
    beardLevel: (() => {
      const raw = clamp(dna.beardLevel ?? base.beardLevel, 0, 100);
      if (!dna.facialHair || dna.facialHair === "none") return 0;
      return Math.max(minimumBeardLevelForStyle(dna.facialHair), raw);
    })(),
    mustacheThickness: clamp(dna.mustacheThickness ?? base.mustacheThickness, 0, 100),
    goateeChinOffsetY: clamp(dna.goateeChinOffsetY ?? base.goateeChinOffsetY, -60, 80),
    agingLevel: clamp(dna.agingLevel ?? base.agingLevel, 0, 100),
    grayLevel: clamp(dna.grayLevel ?? base.grayLevel, 0, 100),
    eyeBagLevel: clamp(dna.eyeBagLevel ?? base.eyeBagLevel, 0, 100),
    changeRates: {
      ...base.changeRates,
      ...(dna.changeRates || {}),
    },
  };
}

function getFaceCalibration(face, calibrationByFace = {}) {
  const safeFace = normalizeFace(face);
  return ensureCalibration(calibrationByFace?.[safeFace.id] || safeFace.overlayCalibration || {});
}

function getInitials(label = "DRAFT") {
  const text = String(label || "DRAFT").trim();
  if (!text) return "DR";
  if (text.length <= 4) return text.toUpperCase();
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function overlayOpacity(value, divisor = 100, max = 0.9) {
  return Math.min(max, Math.max(0, Number(value || 0) / divisor));
}

function copyToClipboard(data, onSuccess) {
  navigator.clipboard
    ?.writeText(typeof data === "string" ? data : JSON.stringify(data, null, 2))
    .then(() => onSuccess?.())
    .catch(() => {});
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PortraitPreview({ dna, selectedFace, faceCalibration }) {
  const safeFace = normalizeFace(selectedFace);
  const safeDNA = cleanPlayerDNA(dna, safeFace);
  const cal = ensureCalibration(faceCalibration);

  const beardOpacity = safeDNA.facialHair === "none" ? 0 : Math.max(0.16, overlayOpacity(safeDNA.beardLevel, 100, 0.72));
  const agingOpacity = overlayOpacity(safeDNA.agingLevel, 110, 0.55);
  const grayOpacity = overlayOpacity(safeDNA.grayLevel, 100, 0.65);
  const eyeBagOpacity = overlayOpacity(safeDNA.eyeBagLevel, 100, 0.55);
  const hairlineOpacity = safeDNA.hairline === "normal" ? 0 : safeDNA.hairline === "slight recession" ? 0.18 : safeDNA.hairline === "medium recession" ? 0.28 : 0.38;
  const jerseyText = getInitials(safeDNA.jersey);

  const jerseyCal = cal.jersey;
  const facialHairCal = cal.facialHair;
  const mustacheCal = cal.mustache;
  const chinHairCal = cal.chinHair;
  const beardConnectionCal = cal.beardConnection;
  const agingCal = cal.aging;
  const eyeBagsCal = cal.eyeBags;
  const hairlineCal = cal.hairline;
  const grayCal = cal.gray;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ aspectRatio: "1040 / 760" }}>
      <div
        className="absolute inset-x-0 bottom-0 h-[32%] bg-gradient-to-br from-slate-900 via-blue-800 to-slate-950"
        style={{ ...htmlLayerStyle(jerseyCal), opacity: jerseyCal.opacity }}
      />
      <div
        className="absolute bottom-[6%] left-1/2 -translate-x-1/2 text-white/80 font-black tracking-[0.25em] text-5xl select-none"
        style={{ opacity: jerseyCal.opacity }}
      >
        {jerseyText}
      </div>

      <img
        src={safeDNA.baseFaceUrl || safeFace.url}
        alt={safeDNA.baseFaceId || safeFace.id}
        className="absolute inset-0 h-full w-full object-contain"
        draggable="false"
      />

      {hairlineOpacity > 0 && (
        <div
          className="absolute left-[31%] top-[13%] h-[18%] w-[38%] rounded-b-[48%] bg-[#b9784f] blur-[12px]"
          style={{ ...htmlLayerStyle(hairlineCal), opacity: hairlineOpacity * hairlineCal.opacity }}
        />
      )}

      {safeDNA.facialHair !== "none" && (
        <svg viewBox="0 0 1040 760" className="absolute inset-0 h-full w-full pointer-events-none">
          <defs>
            <filter id="bmBeardSoftBlur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.8" />
            </filter>
          </defs>

          {(
            safeDNA.facialHair === "mustache" ||
            safeDNA.facialHair === "goatee" ||
            safeDNA.facialHair === "short beard" ||
            safeDNA.facialHair === "full beard"
          ) && (
            <g transform={svgLayerTransform(mustacheCal)}>
              <path
                d="M438 379 C462 371 492 371 514 379"
                stroke="#111"
                strokeWidth={Math.max(6, 7 + safeDNA.mustacheThickness * 0.11)}
                strokeLinecap="round"
                opacity={Math.min(0.72, beardOpacity * 0.78) * mustacheCal.opacity}
                fill="none"
              />
              <path
                d="M526 379 C548 371 578 371 602 379"
                stroke="#111"
                strokeWidth={Math.max(6, 7 + safeDNA.mustacheThickness * 0.11)}
                strokeLinecap="round"
                opacity={Math.min(0.72, beardOpacity * 0.78) * mustacheCal.opacity}
                fill="none"
              />
            </g>
          )}

          {safeDNA.facialHair === "stubble" && (
            <g transform={svgLayerTransform(facialHairCal)}>
              <path
                d="M405 386 C440 432 481 457 520 458 C559 457 600 432 635 386 C618 476 582 514 520 524 C458 514 422 476 405 386 Z"
                fill="#15100d"
                opacity={Math.max(0.16, beardOpacity * 0.46) * facialHairCal.opacity}
                filter="url(#bmBeardSoftBlur)"
              />
              <ellipse
                cx="520"
                cy="463"
                rx="65"
                ry="31"
                fill="#111"
                opacity={Math.max(0.09, beardOpacity * 0.26) * facialHairCal.opacity}
              />
            </g>
          )}

          {safeDNA.facialHair === "goatee" && (
            <g transform={svgLayerTransform(chinHairCal)}>
              <ellipse
                cx="520"
                cy={455 + Number(safeDNA.goateeChinOffsetY || 0)}
                rx="40"
                ry="27"
                fill="#111"
                opacity={Math.min(0.82, beardOpacity * 0.78) * chinHairCal.opacity}
                filter="url(#bmBeardSoftBlur)"
              />
            </g>
          )}

          {(safeDNA.facialHair === "short beard" || safeDNA.facialHair === "full beard") && (
            <>
              <g transform={svgLayerTransform(beardConnectionCal)}>
                <path
                  d="M420 384 C419 417 433 451 461 476"
                  stroke="#111"
                  strokeWidth={safeDNA.facialHair === "full beard" ? 18 : 12}
                  strokeLinecap="round"
                  opacity={(safeDNA.facialHair === "full beard" ? beardOpacity * 0.34 : beardOpacity * 0.22) * beardConnectionCal.opacity}
                  fill="none"
                  filter="url(#bmBeardSoftBlur)"
                />
                <path
                  d="M620 384 C621 417 607 451 579 476"
                  stroke="#111"
                  strokeWidth={safeDNA.facialHair === "full beard" ? 18 : 12}
                  strokeLinecap="round"
                  opacity={(safeDNA.facialHair === "full beard" ? beardOpacity * 0.34 : beardOpacity * 0.22) * beardConnectionCal.opacity}
                  fill="none"
                  filter="url(#bmBeardSoftBlur)"
                />
              </g>

              <g transform={svgLayerTransform(facialHairCal)}>
                <path
                  d="M405 394 C424 462 466 503 520 511 C574 503 616 462 635 394 C613 476 583 520 520 530 C457 520 427 476 405 394 Z"
                  fill="#111"
                  opacity={(safeDNA.facialHair === "full beard" ? beardOpacity * 0.42 : beardOpacity * 0.25) * facialHairCal.opacity}
                  filter="url(#bmBeardSoftBlur)"
                />
                <path
                  d="M432 406 C455 468 486 496 520 501 C554 496 585 468 608 406 C586 470 561 506 520 516 C479 506 454 470 432 406 Z"
                  fill="#111"
                  opacity={(safeDNA.facialHair === "full beard" ? beardOpacity * 0.36 : beardOpacity * 0.2) * facialHairCal.opacity}
                />
                {safeDNA.facialHair === "full beard" && (
                  <ellipse
                    cx="520"
                    cy="476"
                    rx="60"
                    ry="34"
                    fill="#111"
                    opacity={beardOpacity * 0.2 * facialHairCal.opacity}
                    filter="url(#bmBeardSoftBlur)"
                  />
                )}
              </g>
            </>
          )}
        </svg>
      )}

      {(agingOpacity > 0 || eyeBagOpacity > 0) && (
        <svg viewBox="0 0 1040 760" className="absolute inset-0 h-full w-full pointer-events-none">
          <g transform={svgLayerTransform(agingCal)}>
            <path d="M425 240 Q520 218 615 240" stroke="#2a1710" strokeWidth="6" strokeLinecap="round" opacity={agingOpacity * 0.55 * agingCal.opacity} fill="none" />
            <path d="M438 470 Q520 514 602 470" stroke="#2a1710" strokeWidth="6" strokeLinecap="round" opacity={agingOpacity * 0.7 * agingCal.opacity} fill="none" />
            <path d="M432 260 Q470 252 505 263" stroke="#2a1710" strokeWidth="4" strokeLinecap="round" opacity={agingOpacity * 0.45 * agingCal.opacity} fill="none" />
            <path d="M535 263 Q572 252 608 260" stroke="#2a1710" strokeWidth="4" strokeLinecap="round" opacity={agingOpacity * 0.45 * agingCal.opacity} fill="none" />
          </g>
          <g transform={svgLayerTransform(eyeBagsCal)}>
            <path d="M432 320 Q470 338 506 326" stroke="#2a1710" strokeWidth="5" strokeLinecap="round" opacity={(eyeBagOpacity || agingOpacity * 0.5) * eyeBagsCal.opacity} fill="none" />
            <path d="M535 326 Q572 338 608 320" stroke="#2a1710" strokeWidth="5" strokeLinecap="round" opacity={(eyeBagOpacity || agingOpacity * 0.5) * eyeBagsCal.opacity} fill="none" />
          </g>
        </svg>
      )}

      {grayOpacity > 0 && (
        <svg viewBox="0 0 1040 760" className="absolute inset-0 h-full w-full pointer-events-none">
          <g transform={svgLayerTransform(grayCal)}>
            <path d="M375 170 Q520 112 665 170" stroke="#e5e7eb" strokeWidth="18" strokeLinecap="round" opacity={grayOpacity * 0.55 * grayCal.opacity} fill="none" />
            <circle cx="435" cy="158" r="13" fill="#f8fafc" opacity={grayOpacity * grayCal.opacity} />
            <circle cx="600" cy="160" r="11" fill="#f8fafc" opacity={grayOpacity * 0.9 * grayCal.opacity} />
          </g>
        </svg>
      )}
    </div>
  );
}

export default function FaceDNAEditor() {
  const [faces, setFaces] = useState(FALLBACK_FACES.map(normalizeFace));
  const [manifestStatus, setManifestStatus] = useState("Loading face manifest...");
  const [poolFilter, setPoolFilter] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [selectedFaceId, setSelectedFaceId] = useState(FALLBACK_FACES[0].id);
  const [playerDNA, setPlayerDNA] = useState(createDefaultPlayerDNA(FALLBACK_FACES[0]));
  const [savedPlayerDNA, setSavedPlayerDNA] = useState([]);
  const [calibrationByFace, setCalibrationByFace] = useState({});
  const [copiedLabel, setCopiedLabel] = useState("");
  const [showCalibration, setShowCalibration] = useState(true);
  const [activeCalibrationLayer, setActiveCalibrationLayer] = useState("mustache");

  useEffect(() => {
    const savedDNA = safeJSON(localStorage.getItem(PLAYER_DNA_STORAGE_KEY), []);
    if (Array.isArray(savedDNA)) setSavedPlayerDNA(savedDNA);

    const savedCalibration = safeJSON(localStorage.getItem(FACE_CALIBRATION_STORAGE_KEY), {});
    setCalibrationByFace(normalizeCalibrationMap(savedCalibration));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch(MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Manifest returned ${res.status}`);
        return res.json();
      })
      .then((rows) => {
        if (cancelled) return;
        const normalized = Array.isArray(rows) && rows.length ? rows.map(normalizeFace) : FALLBACK_FACES.map(normalizeFace);
        setFaces(normalized);
        setSelectedFaceId((prev) => (normalized.some((f) => f.id === prev) ? prev : normalized[0].id));
        setPlayerDNA((prev) => {
          const face = normalized.find((f) => f.id === prev.baseFaceId) || normalized[0];
          return cleanPlayerDNA({ ...prev, baseFaceId: face.id, baseFaceUrl: face.url }, face);
        });
        setManifestStatus(`Loaded ${normalized.length} faces from ${MANIFEST_URL}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setFaces(FALLBACK_FACES.map(normalizeFace));
        setManifestStatus(`Using built-in fallback faces because manifest could not load: ${err.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const pools = useMemo(() => {
    return ["All", ...Array.from(new Set(faces.map((f) => f.appearancePool).filter(Boolean))).sort()];
  }, [faces]);

  const selectedFace = useMemo(() => {
    return faces.find((f) => f.id === selectedFaceId) || faces[0] || normalizeFace(FALLBACK_FACES[0]);
  }, [faces, selectedFaceId]);

  const selectedFaceCalibration = useMemo(() => {
    return getFaceCalibration(selectedFace, calibrationByFace);
  }, [selectedFace, calibrationByFace]);

  const currentCalibration = selectedFaceCalibration[activeCalibrationLayer] || DEFAULT_LAYER_CALIBRATION;

  const filteredFaces = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return faces.filter((face) => {
      const matchesPool = poolFilter === "All" || face.appearancePool === poolFilter;
      const haystack = `${face.id} ${face.appearancePool} ${face.skinTone} ${face.hairTextureGroup} ${face.defaultHairStyle} ${face.defaultFacialHair} ${face.expression}`.toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      return matchesPool && matchesSearch;
    });
  }, [faces, poolFilter, searchText]);

  const updatePlayerDNA = (patch) => {
    setPlayerDNA((prev) => cleanPlayerDNA({ ...prev, ...patch }, selectedFace));
  };

  const updateRates = (patch) => {
    setPlayerDNA((prev) =>
      cleanPlayerDNA(
        {
          ...prev,
          changeRates: {
            ...prev.changeRates,
            ...patch,
          },
        },
        selectedFace
      )
    );
  };

  const updateFaceCalibration = (layerKey, patch) => {
    setCalibrationByFace((prev) => {
      const currentFaceCal = getFaceCalibration(selectedFace, prev);
      return {
        ...prev,
        [selectedFace.id]: {
          ...currentFaceCal,
          [layerKey]: normalizeLayerCalibration({ ...currentFaceCal[layerKey], ...patch }),
        },
      };
    });
  };

  const resetCalibrationLayer = (layerKey) => {
    updateFaceCalibration(layerKey, DEFAULT_OVERLAY_CALIBRATION[layerKey] || DEFAULT_LAYER_CALIBRATION);
  };

  const resetSelectedFaceCalibration = () => {
    setCalibrationByFace((prev) => ({
      ...prev,
      [selectedFace.id]: cloneCalibration(),
    }));
  };

  const saveFaceCalibrationToStorage = () => {
    const clean = normalizeCalibrationMap(calibrationByFace);
    localStorage.setItem(FACE_CALIBRATION_STORAGE_KEY, JSON.stringify(clean));
    setCopiedLabel("Saved face calibration");
    setTimeout(() => setCopiedLabel(""), 1400);
  };

  const selectFace = (face) => {
    const safeFace = normalizeFace(face);
    setSelectedFaceId(safeFace.id);
    setPlayerDNA((prev) =>
      cleanPlayerDNA(
        {
          ...prev,
          baseFaceId: safeFace.id,
          baseFaceUrl: safeFace.url,
          appearancePool: safeFace.appearancePool,
          skinTone: safeFace.skinTone,
          hairTextureGroup: safeFace.hairTextureGroup,
          baseHairStyle: safeFace.defaultHairStyle,
          baseFacialHair: safeFace.defaultFacialHair || "none",
        },
        safeFace
      )
    );
  };

  const randomizePlayerDNA = () => {
    const poolFaces = poolFilter === "All" ? faces : faces.filter((f) => f.appearancePool === poolFilter);
    const nextFace = poolFaces[Math.floor(Math.random() * poolFaces.length)] || selectedFace;
    const next = createDefaultPlayerDNA(nextFace);
    next.facialHair = FACIAL_HAIR_OPTIONS[Math.floor(Math.random() * FACIAL_HAIR_OPTIONS.length)];
    next.beardLevel = next.facialHair === "none" ? 0 : Math.floor(minimumBeardLevelForStyle(next.facialHair) + Math.random() * 25);
    next.agingLevel = Math.floor(Math.random() * 22);
    next.grayLevel = Math.floor(Math.random() * 8);
    next.hairline = HAIRLINE_OPTIONS[Math.floor(Math.random() * 2)];
    next.eyeBagLevel = Math.floor(Math.random() * 14);
    next.styleProfile = STYLE_PROFILES[Math.floor(Math.random() * STYLE_PROFILES.length)];
    setSelectedFaceId(nextFace.id);
    setPlayerDNA(next);
  };

  const saveCurrentPlayerDNA = () => {
    const clean = cleanPlayerDNA(playerDNA, selectedFace);
    const next = [
      { ...clean, savedAt: new Date().toISOString() },
      ...savedPlayerDNA,
    ].slice(0, 24);
    setSavedPlayerDNA(next);
    localStorage.setItem(PLAYER_DNA_STORAGE_KEY, JSON.stringify(next));
  };

  const exportCalibratedManifest = () => {
    const rows = faces.map((face) => ({
      id: face.id,
      url: face.url,
      status: face.status,
      appearancePool: face.appearancePool,
      skinTone: face.skinTone,
      hairTextureGroup: face.hairTextureGroup,
      defaultHairStyle: face.defaultHairStyle,
      defaultFacialHair: face.defaultFacialHair,
      expression: face.expression,
      quality: face.quality,
      overlayCalibration: getFaceCalibration(face, calibrationByFace),
    }));

    downloadJSON("rookie_faces_manifest_calibrated.json", rows);
  };

  const copyPlayerDNA = () => {
    copyToClipboard(cleanPlayerDNA(playerDNA, selectedFace), () => {
      setCopiedLabel("Copied player DNA");
      setTimeout(() => setCopiedLabel(""), 1400);
    });
  };

  const copyFaceCalibration = () => {
    copyToClipboard(selectedFaceCalibration, () => {
      setCopiedLabel("Copied face calibration");
      setTimeout(() => setCopiedLabel(""), 1400);
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight">Face DNA Lab</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                In-house face editor with a clean split: player DNA controls the look, while base face calibration controls where overlays sit on each face. Beard overlays use reset v4 calibration so old saved offsets from earlier broken versions do not carry over.
              </p>
              <div className="mt-2 text-xs text-slate-500">{manifestStatus}</div>
              {copiedLabel && <div className="mt-2 text-xs font-bold text-green-700">{copiedLabel}</div>}
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={randomizePlayerDNA} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700">
                Random Player DNA
              </button>
              <button onClick={copyPlayerDNA} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                Copy Player DNA
              </button>
              <button onClick={() => downloadJSON("player_face_dna_export.json", cleanPlayerDNA(playerDNA, selectedFace))} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black">
                Export Player DNA
              </button>
              <button onClick={saveCurrentPlayerDNA} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700">
                Save Player Preset
              </button>
              <button onClick={exportCalibratedManifest} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700">
                Export Calibrated Manifest
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr_400px]">
          <div className="rounded-3xl bg-white p-5 shadow-sm border space-y-4">
            <div>
              <h2 className="text-lg font-black">Base Face Library</h2>
              <p className="text-xs text-slate-500">Pick the permanent identity. Calibration is saved by base face, not by player.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Pool</label>
                <select value={poolFilter} onChange={(e) => setPoolFilter(e.target.value)} className="w-full rounded-xl border bg-white p-2 text-sm">
                  {pools.map((pool) => <option key={pool}>{pool}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Search</label>
                <input value={searchText} onChange={(e) => setSearchText(e.target.value)} className="w-full rounded-xl border p-2 text-sm" placeholder="hair, pool, id" />
              </div>
            </div>

            <div className="grid max-h-[720px] grid-cols-2 gap-3 overflow-y-auto pr-1">
              {filteredFaces.map((face) => {
                const active = face.id === selectedFaceId;
                const hasSavedCalibration = Boolean(calibrationByFace[face.id]);
                return (
                  <button
                    key={face.id}
                    type="button"
                    onClick={() => selectFace(face)}
                    className={`overflow-hidden rounded-2xl border bg-white text-left transition hover:border-blue-400 ${active ? "ring-4 ring-blue-500 border-blue-500" : ""}`}
                  >
                    <div className="aspect-[1040/760] bg-slate-50">
                      <img src={face.url} alt={face.id} className="h-full w-full object-contain" loading="lazy" />
                    </div>
                    <div className="p-2">
                      <div className="truncate text-xs font-black">{face.id}</div>
                      <div className="truncate text-[11px] text-slate-500">{face.appearancePool} | {face.defaultHairStyle}</div>
                      {hasSavedCalibration && <div className="mt-1 text-[10px] font-bold text-green-700">calibrated</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm border space-y-5">
            <div>
              <h2 className="text-lg font-black">Live Preview</h2>
              <p className="text-xs text-slate-500">Preview = selected base face + selected face calibration + current player DNA.</p>
            </div>

            <PortraitPreview dna={playerDNA} selectedFace={selectedFace} faceCalibration={selectedFaceCalibration} />

            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold text-slate-500">Face</div>
                <div className="font-black truncate">{selectedFace.id}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold text-slate-500">Pool</div>
                <div className="font-black">{selectedFace.appearancePool}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold text-slate-500">Hair Texture</div>
                <div className="font-black">{selectedFace.hairTextureGroup}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold text-slate-500">Quality</div>
                <div className="font-black">{selectedFace.quality}</div>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3 md:col-span-4">
                <div className="text-[11px] font-bold text-amber-700">Base PNG Facial Hair</div>
                <div className="font-black text-amber-950">{selectedFace.defaultFacialHair || "none"}</div>
                <div className="mt-1 text-[11px] text-amber-800">
                  This is baked into the base image. Facial hair controls add extra overlay hair on top.
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black">Base Face Calibration</h3>
                  <p className="text-[11px] text-slate-500">This applies to every player using {selectedFace.id}.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCalibration((prev) => !prev)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold ${showCalibration ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-800"}`}
                >
                  {showCalibration ? "On" : "Off"}
                </button>
              </div>

              {showCalibration && (
                <div className="space-y-3 rounded-2xl border bg-slate-50 p-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-600">Layer</label>
                    <select
                      value={activeCalibrationLayer}
                      onChange={(e) => setActiveCalibrationLayer(e.target.value)}
                      className="w-full rounded-xl border bg-white p-2 text-sm"
                    >
                      {CALIBRATION_LAYERS.map((layer) => (
                        <option key={layer.key} value={layer.key}>{layer.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">X: {currentCalibration.x}</label>
                      <input type="range" min="-120" max="120" value={currentCalibration.x} onChange={(e) => updateFaceCalibration(activeCalibrationLayer, { x: Number(e.target.value) })} className="w-full accent-orange-600" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Y: {currentCalibration.y}</label>
                      <input type="range" min="-120" max="120" value={currentCalibration.y} onChange={(e) => updateFaceCalibration(activeCalibrationLayer, { y: Number(e.target.value) })} className="w-full accent-orange-600" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Scale: {Number(currentCalibration.scale).toFixed(2)}</label>
                      <input type="range" min="0.7" max="1.3" step="0.01" value={currentCalibration.scale} onChange={(e) => updateFaceCalibration(activeCalibrationLayer, { scale: Number(e.target.value) })} className="w-full accent-orange-600" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-600">Opacity: {Number(currentCalibration.opacity).toFixed(2)}</label>
                      <input type="range" min="0" max="1" step="0.01" value={currentCalibration.opacity} onChange={(e) => updateFaceCalibration(activeCalibrationLayer, { opacity: Number(e.target.value) })} className="w-full accent-orange-600" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => resetCalibrationLayer(activeCalibrationLayer)} className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-300">
                      Reset Layer
                    </button>
                    <button type="button" onClick={resetSelectedFaceCalibration} className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-300">
                      Reset Face
                    </button>
                    <button type="button" onClick={saveFaceCalibrationToStorage} className="rounded-xl bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700">
                      Save Face Calibration
                    </button>
                    <button type="button" onClick={copyFaceCalibration} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">
                      Copy Face Calibration
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm border space-y-5">
            <div>
              <h2 className="text-lg font-black">Player DNA Controls</h2>
              <p className="text-xs text-slate-500">These values are per-player and are what progression will eventually update.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Jersey</label>
              <select value={playerDNA.jersey} onChange={(e) => updatePlayerDNA({ jersey: e.target.value })} className="w-full rounded-xl border bg-white p-2 text-sm">
                {JERSEY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Facial Hair Overlay</label>
              <select value={playerDNA.facialHair} onChange={(e) => updatePlayerDNA({ facialHair: e.target.value, beardLevel: Math.max(minimumBeardLevelForStyle(e.target.value), playerDNA.beardLevel) })} className="w-full rounded-xl border bg-white p-2 text-sm">
                {FACIAL_HAIR_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                <span className="font-black">Base face already has:</span> {selectedFace.defaultFacialHair || "none"}. Use overlay = none to keep only the original PNG facial hair.
              </div>
              {playerDNA.facialHair !== "none" && (
                <button
                  type="button"
                  onClick={() => updatePlayerDNA({ facialHair: "none", beardLevel: 0 })}
                  className="mt-2 rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-300"
                >
                  Use Base Facial Hair Only
                </button>
              )}
            </div>

            {(playerDNA.facialHair === "mustache" || playerDNA.facialHair === "goatee") && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Mustache Thickness: {playerDNA.mustacheThickness}</label>
                <input type="range" min="0" max="100" value={playerDNA.mustacheThickness ?? 42} onChange={(e) => updatePlayerDNA({ mustacheThickness: clamp(e.target.value) })} className="w-full accent-blue-600" />
              </div>
            )}

            {playerDNA.facialHair === "goatee" && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">Goatee Chin Gap: {playerDNA.goateeChinOffsetY ?? 0}</label>
                <input type="range" min="-60" max="80" value={playerDNA.goateeChinOffsetY ?? 0} onChange={(e) => updatePlayerDNA({ goateeChinOffsetY: clamp(e.target.value, -60, 80) })} className="w-full accent-blue-600" />
              </div>
            )}

            {[
              ["beardLevel", "Beard Level"],
              ["agingLevel", "Aging Level"],
              ["grayLevel", "Grey Level"],
              ["eyeBagLevel", "Eye Bags"],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-bold text-slate-600">{label}: {playerDNA[key]}</label>
                <input type="range" min="0" max="100" value={playerDNA[key]} onChange={(e) => updatePlayerDNA({ [key]: clamp(e.target.value) })} className="w-full accent-blue-600" />
              </div>
            ))}

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Hairline</label>
              <select value={playerDNA.hairline} onChange={(e) => updatePlayerDNA({ hairline: e.target.value })} className="w-full rounded-xl border bg-white p-2 text-sm">
                {HAIRLINE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Style Profile</label>
              <select value={playerDNA.styleProfile} onChange={(e) => updatePlayerDNA({ styleProfile: e.target.value })} className="w-full rounded-xl border bg-white p-2 text-sm">
                {STYLE_PROFILES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-2 text-sm font-black">Progression Tendencies</h3>
              {[
                ["hairChangeRate", "Hair Change Rate"],
                ["beardGrowthRate", "Beard Growth Rate"],
                ["hairLossRisk", "Hair Loss Risk"],
                ["grayRate", "Grey Rate"],
                ["styleAdventurousness", "Style Adventurousness"],
              ].map(([key, label]) => (
                <div key={key} className="mb-3">
                  <label className="mb-1 block text-xs font-bold text-slate-600">{label}: {playerDNA.changeRates?.[key] ?? 0}</label>
                  <input type="range" min="0" max="100" value={playerDNA.changeRates?.[key] ?? 0} onChange={(e) => updateRates({ [key]: clamp(e.target.value) })} className="w-full accent-purple-600" />
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
              <div className="font-black">Base Face Calibration moved beside the preview.</div>
              <div className="mt-1">Use the middle column to adjust X, Y, scale, and opacity while watching the face at the same time.</div>
            </div>

            {!!savedPlayerDNA.length && (
              <div className="border-t pt-4">
                <h3 className="mb-2 text-sm font-black">Saved Player Presets</h3>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {savedPlayerDNA.map((item, index) => (
                    <button
                      key={`${item.baseFaceId}-${item.savedAt}-${index}`}
                      type="button"
                      onClick={() => {
                        const face = faces.find((f) => f.id === item.baseFaceId) || selectedFace;
                        setPlayerDNA(cleanPlayerDNA(item, face));
                        setSelectedFaceId(item.baseFaceId || face.id);
                      }}
                      className="w-full rounded-xl border p-3 text-left hover:bg-slate-50"
                    >
                      <div className="text-xs font-black">{item.baseFaceId}</div>
                      <div className="text-[11px] text-slate-500">{item.facialHair} | aging {item.agingLevel} | grey {item.grayLevel}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
