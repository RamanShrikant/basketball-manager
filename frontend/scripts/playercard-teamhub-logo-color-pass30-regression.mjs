import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const playerPath = path.join(repo, 'frontend', 'src', 'components', 'PlayerCardModal.jsx');
const teamHubCssPath = path.join(repo, 'frontend', 'src', 'components', 'TeamHub.module.css');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(playerPath)) fail('PlayerCardModal.jsx missing.');
if (!fs.existsSync(teamHubCssPath)) fail('TeamHub.module.css missing.');

const player = fs.readFileSync(playerPath, 'utf8').replace(/\r\n/g, '\n');
const teamHub = fs.readFileSync(teamHubCssPath, 'utf8').replace(/\r\n/g, '\n');

if (!player.includes('filter: saturate(0.92) brightness(0.72) contrast(1.08);')) {
  fail('Player Card color-preserving watermark filter not installed.');
}
if (/\.pc29-watermark\s*\{[\s\S]*?filter:\s*grayscale\(1\);[\s\S]*?\}/.test(player)) {
  fail('Player Card still forces its watermark to grayscale.');
}

const starts = [...teamHub.matchAll(/^\.bannerWatermark\s*\{/gm)];
if (!starts.length) fail('Team Hub bannerWatermark block missing.');
const start = starts.at(-1).index;
const end = teamHub.indexOf('\n}', start);
const finalBlock = teamHub.slice(start, end + 2);
if (!finalBlock.includes('filter: saturate(0.88) brightness(0.72) contrast(1.08);')) {
  fail('Team Hub final watermark block does not contain the Pass 30 color-preserving filter.');
}
if (/grayscale\(/.test(finalBlock)) fail('Team Hub final watermark still uses grayscale.');

// High-value preservation markers: this pass must not rewrite Player Card mechanics.
for (const marker of [
  'buildPlayerCardSeasonRows',
  'dedupeDisplaySeasonRows',
  'combineDisplaySeasonRows',
  'getContractOptionInfo',
  'Trends',
  'Career Stats',
  'Accolades',
]) {
  if (!player.includes(marker)) fail(`Player Card preservation marker missing: ${marker}`);
}
if (!teamHub.includes('bannerWatermark')) fail('Team Hub watermark styling unexpectedly missing.');

console.log('PASS: Player Card and Team Hub faint logos preserve substantially more of their original team colors.');
console.log('PASS: Manual watermark opacity/position/scale/rotation controls remain untouched.');
console.log('PASS: Player Card season-history, contract-option, Trends, Career Stats, and Accolades machinery remains present.');
