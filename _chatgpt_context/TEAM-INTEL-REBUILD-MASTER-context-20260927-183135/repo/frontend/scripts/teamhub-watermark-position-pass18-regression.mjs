import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const cssPath = path.join(repo, 'frontend/src/components/TeamHub.module.css');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) fail('Could not find frontend/src/components/TeamHub.module.css');

const css = fs.readFileSync(cssPath, 'utf8');

const requiredFragments = [
  '/* TEAM HUB WATERMARK / POSITION / EDGE PASS 18 */',
  '.teamBanner {',
  'rgba(77, 38, 24, 0.34)',
  '.teamBanner::after {',
  'rgba(123, 77, 48, 0.018)',
  '.bannerWatermark {',
  'right: 164px;',
  'opacity: 0.040;',
  '.playerVisual {',
  'border-bottom: 4px solid rgba(149, 157, 170, 0.36);',
  '.playerPositionBadge {',
  'left: auto !important;',
  'right: 10px;'
];

for (const fragment of requiredFragments) {
  if (!css.includes(fragment)) fail(`Missing expected fragment: ${fragment}`);
}

console.log('PASS: Team Hub Watermark / Position / Edge Pass 18 is present.');
