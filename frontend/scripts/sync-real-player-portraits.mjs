import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const WIDTH = 1040;
const HEIGHT = 760;
const realRoot = path.join(root, 'public', 'assets', 'real_player_faces');
const baseRoot = path.join(realRoot, 'base');
const manifestPath = path.join(realRoot, 'real_player_faces_manifest.json');
const queuePath = path.join(realRoot, 'generation_queue.json');
const missingPath = path.join(realRoot, 'MISSING_BASES.txt');

fs.mkdirSync(baseRoot, { recursive: true });
if (!fs.existsSync(manifestPath)) {
  fs.writeFileSync(manifestPath, '[]\n');
}

const rows = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(rows)) throw new Error('real_player_faces_manifest.json must be an array.');

function readPngInfo(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 26 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error(`${path.basename(file)} is not a valid PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

const next = rows.map((row) => {
  const filename = row.baseFilename || `${row.id}_base.png`;
  const file = path.join(baseRoot, filename);
  const ready = fs.existsSync(file);
  if (ready) {
    const info = readPngInfo(file);
    const alpha = info.colorType === 4 || info.colorType === 6;
    if (info.width !== WIDTH || info.height !== HEIGHT || !alpha) {
      throw new Error(`${filename} must be ${WIDTH}x${HEIGHT} and have alpha transparency.`);
    }
  }
  return {
    ...row,
    baseFilename: filename,
    baseUrl: `/assets/real_player_faces/base/${filename}`,
    baseReady: ready,
    needsBase: !ready,
  };
});

fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
const missing = next.filter((row) => row.needsBase);
const queue = {
  version: 'bm_real_player_portrait_queue_v1',
  instructions: {
    outputDirectory: 'frontend/public/assets/real_player_faces/base/',
    requiredCanvas: '1040x760',
    requiredFormat: 'RGBA/alpha PNG',
    visualRule: 'Same player identity, jerseyless clean base, no team branding. Match the existing rookie base portrait standard.',
  },
  remaining: missing.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    name: row.name,
    teamName: row.teamName,
    sourceUrl: row.sourceUrl,
    targetFilename: row.baseFilename,
  })),
};
fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
fs.writeFileSync(missingPath, [
  'BASKETBALL MANAGER — REAL PLAYER BASE PORTRAITS',
  '===============================================',
  '',
  `Ready: ${next.length - missing.length}`,
  `Missing: ${missing.length}`,
  '',
  ...missing.map((row) => `${row.name} -> ${row.baseFilename}`),
  '',
].join('\n'));

console.log('Real-player portraits synced.');
console.log(`- Players tracked: ${next.length}`);
console.log(`- Jerseyless bases ready: ${next.length - missing.length}`);
console.log(`- Still need bases: ${missing.length}`);
console.log('- Queue: public/assets/real_player_faces/generation_queue.json');
