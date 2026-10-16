import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const root = process.cwd();
const WIDTH = 1040;
const HEIGHT = 760;
const draftRoot = path.join(root, "public", "assets", "rookie_faces");
const studioRoot = path.join(root, "public", "assets", "portrait_studio");
const baseRoot = path.join(studioRoot, "base");
const draftManifestPath = path.join(draftRoot, "rookie_faces_manifest.json");
const manifestPath = path.join(studioRoot, "portrait_studio_manifest.json");
const queuePath = path.join(studioRoot, "generation_queue.json");
const missingTextPath = path.join(studioRoot, "MISSING_BASES.txt");
const jerseyRoot = path.join(root, "public", "assets", "jerseys", "v1");
const jerseyManifestPath = path.join(jerseyRoot, "jerseys_manifest.json");
const fitsPath = path.join(studioRoot, "fits", "portrait_fits.json");

fs.mkdirSync(baseRoot, { recursive: true });

const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function readPngInfo(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 26 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error(`${path.basename(file)} is not a valid PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}


function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function syncJerseyManifest() {
  if (!fs.existsSync(jerseyManifestPath)) return [];
  const rows = readJSON(jerseyManifestPath);
  if (!Array.isArray(rows)) throw new Error("jerseys_manifest.json must be an array.");
  const next = rows.map((row) => {
    const file = path.join(jerseyRoot, row.filename || "");
    if (!row?.team || !row?.filename || !fs.existsSync(file)) {
      throw new Error(`Invalid jersey manifest row: ${JSON.stringify(row)}`);
    }
    return {
      ...row,
      id: row.id || `${String(row.team).toUpperCase()}_jersey_v1`,
      templateId: row.templateId || row.id || `${String(row.team).toUpperCase()}_jersey_v1`,
      version: Number(row.version || 1),
      hash: sha256(file).slice(0, 16),
    };
  });
  fs.writeFileSync(jerseyManifestPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function warnOnChangedJerseyTemplates(jerseys) {
  if (!fs.existsSync(fitsPath)) return;
  try {
    const fits = readJSON(fitsPath);
    const saved = fits?.jerseyTemplateHashes && typeof fits.jerseyTemplateHashes === "object" ? fits.jerseyTemplateHashes : {};
    const changed = jerseys.filter((row) => saved[row.templateId || row.id] && saved[row.templateId || row.id] !== row.hash);
    if (changed.length) {
      console.warn(`- WARNING: ${changed.length} jersey template(s) changed since fits were saved: ${changed.map((row) => row.team).join(", ")}`);
    }
  } catch (error) {
    console.warn(`- WARNING: Could not validate portrait fit template hashes: ${error.message}`);
  }
}

const jerseyRows = syncJerseyManifest();
warnOnChangedJerseyTemplates(jerseyRows);

const draftRows = readJSON(draftManifestPath);
if (!Array.isArray(draftRows)) throw new Error("rookie_faces_manifest.json must be an array.");

const draftMap = new Map(
  draftRows
    .filter((row) => row?.id)
    .map((row) => [String(row.id), row])
);

const baseFiles = fs
  .readdirSync(baseRoot)
  .filter((name) => name.toLowerCase().endsWith(".png"))
  .sort();

const baseMap = new Map();
const invalidNames = [];
const invalidImages = [];

for (const filename of baseFiles) {
  const match = filename.match(/^(rookie_face_\d{4})_base\.png$/i);
  if (!match) {
    invalidNames.push(filename);
    continue;
  }
  const id = match[1].toLowerCase();
  const info = readPngInfo(path.join(baseRoot, filename));
  const alphaCapable = info.colorType === 4 || info.colorType === 6;
  const validCanvas = info.width === WIDTH && info.height === HEIGHT;
  if (!validCanvas || !alphaCapable) {
    invalidImages.push({
      filename,
      width: info.width,
      height: info.height,
      colorType: info.colorType,
      reason: `${validCanvas ? "" : `expected ${WIDTH}x${HEIGHT}; `}${alphaCapable ? "" : "PNG has no alpha channel"}`.trim(),
    });
  }
  baseMap.set(id, { filename, info, validCanvas, alphaCapable });
}

if (invalidNames.length) {
  console.warn(`Ignored ${invalidNames.length} base PNG(s) with invalid names: ${invalidNames.join(", ")}`);
}
if (invalidImages.length) {
  console.error("Invalid jerseyless base portrait(s):");
  for (const row of invalidImages) {
    console.error(`- ${row.filename}: ${row.width}x${row.height}, colorType=${row.colorType}; ${row.reason}`);
  }
  process.exit(1);
}

const allIds = [...new Set([...draftMap.keys(), ...baseMap.keys()])].sort();
const maxNumericId = Math.max(
  0,
  ...allIds.map((id) => Number(id.match(/(\d{4})$/)?.[1] || 0))
);

const entries = allIds.map((id) => {
  const draft = draftMap.get(id) || null;
  const base = baseMap.get(id) || null;
  const baseFilename = `${id}_base.png`;
  return {
    id,
    baseFilename,
    baseUrl: base ? `/assets/portrait_studio/base/${base.filename}` : null,
    draftUrl: draft?.url || null,
    baseReady: Boolean(base),
    needsBase: Boolean(draft && !base),
    fitReference: id === "rookie_face_0001",
    canvas: base
      ? { width: base.info.width, height: base.info.height, alpha: base.alphaCapable }
      : { width: WIDTH, height: HEIGHT, alpha: true },
    appearancePool: draft?.appearancePool || draft?.pool || "Unclassified",
    skinTone: draft?.skinTone || "unknown",
    hairTextureGroup: draft?.hairTextureGroup || "unknown",
    defaultHairStyle: draft?.defaultHairStyle || draft?.hairStyle || "unknown",
    defaultFacialHair: draft?.defaultFacialHair || "none",
    expression: draft?.expression || "neutral",
    quality: draft?.quality || (base ? "base-only" : "unrated"),
  };
});

const baseReady = entries.filter((row) => row.baseReady).length;
const draftReferences = entries.filter((row) => row.draftUrl).length;
const needsBaseRows = entries.filter((row) => row.needsBase);

const manifest = {
  version: "bm_portrait_studio_manifest_v1",
  canvas: { width: WIDTH, height: HEIGHT },
  paths: {
    draftReferences: "/assets/rookie_faces/",
    jerseylessBases: "/assets/portrait_studio/base/",
    jerseys: "/assets/jerseys/v1/",
  },
  naming: {
    basePattern: "rookie_face_####_base.png",
    existingIdentityRule: "Use the same rookie_face_#### ID as the draft reference.",
    nextNewIdentity: `rookie_face_${String(maxNumericId + 1).padStart(4, "0")}`,
  },
  counts: {
    identities: entries.length,
    draftReferences,
    baseReady,
    needsBase: needsBaseRows.length,
  },
  entries,
};

const queue = {
  version: "bm_portrait_generation_queue_v1",
  instructions: {
    outputDirectory: "frontend/public/assets/portrait_studio/base/",
    requiredCanvas: `${WIDTH}x${HEIGHT}`,
    requiredFormat: "RGBA/alpha PNG",
    visualRule: "Same identity, head/hair/face/neck/shoulders/upper chest, no jersey, no shirt/top, no team branding.",
  },
  remaining: needsBaseRows.map((row) => ({
    id: row.id,
    sourceDraftUrl: row.draftUrl,
    targetFilename: row.baseFilename,
  })),
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

const missingText = [
  "BASKETBALL MANAGER — JERSEYLESS BASE GENERATION QUEUE",
  "=====================================================",
  "",
  `Draft references: ${draftReferences}`,
  `Base portraits ready: ${baseReady}`,
  `Draft portraits still needing a base: ${needsBaseRows.length}`,
  "",
  "For each current draft portrait, generate the same identity with NO TOP and save using the exact target filename below.",
  "Drop finished files into: frontend/public/assets/portrait_studio/base/",
  "",
  ...needsBaseRows.map((row) => `${row.id} -> ${row.baseFilename}`),
  "",
].join("\n");
fs.writeFileSync(missingTextPath, missingText);

console.log(`Portrait Studio synced.`);
console.log(`- Draft references: ${draftReferences}`);
console.log(`- Jerseyless bases ready: ${baseReady}`);
console.log(`- Still need jerseyless bases: ${needsBaseRows.length}`);
console.log(`- Next brand-new identity: ${manifest.naming.nextNewIdentity}`);
console.log(`- Manifest: public/assets/portrait_studio/portrait_studio_manifest.json`);
console.log(`- Queue: public/assets/portrait_studio/generation_queue.json`);
console.log(`- Jersey templates hashed/versioned: ${jerseyRows.length}`);
