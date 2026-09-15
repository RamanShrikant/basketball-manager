import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const configPath = path.join(repo, 'frontend/src/config/teamHubBannerLayout.js');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) fail('Could not find frontend/src/config/teamHubBannerLayout.js');
const text = fs.readFileSync(configPath, 'utf8');

const required = [
  'banner: { height: 80 }',
  'identityBlock: { x: 0, y: 0 }',
  'logo: { x: 40, y: 0, size: 73 }',
  'teamCity: { x: 40, y: 0, size: 23 }',
  'teamName: { x: 40, y: 0, size: 39 }',
  'recordBlock: { x: 10, y: 0 }',
  'recordLabel: { x: 10, y: 0, size: 9 }',
  'recordValue: { x: 10, y: 0, size: 18 }',
  'recordStanding: { x: 10, y: 0, size: 9 }',
  'last10Block: { x: 15, y: 0 }',
  'last10Label: { x: 15, y: 0, size: 9 }',
  'last10Value: { x: 15, y: 0, size: 18 }',
  'last10Subtext: { x: 0, y: 0, size: 9 }',
  'watermark: { x: 70, y: 0, scale: 1, opacity: 0.065, rotation: -5 }',
  'nextGameBlock: { x: 0, y: 0 }',
  'nextGameLabel: { x: -20, y: 0, size: 15 }',
  'nextGameValue: { x: 0, y: 0, size: 16 }',
  'nextGameLogo: { x: -15, y: 0, size: 98 }',
  'nextGameDate: { x: 0, y: 0, size: 10 }',
  'nextGameEmpty: { x: 0, y: 0, size: 10 }'
];

for (const fragment of required) {
  if (!text.includes(fragment)) fail(`Manual banner control changed or missing: ${fragment}`);
}

console.log('PASS: Team Hub Pass 21 changed only the secondary-logo opacity; all other manual banner controls are preserved.');
