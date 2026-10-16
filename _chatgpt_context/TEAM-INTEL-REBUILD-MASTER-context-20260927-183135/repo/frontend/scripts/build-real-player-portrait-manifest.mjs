import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const root = process.cwd();
const rosterArgIndex = process.argv.indexOf('--roster');
if (rosterArgIndex < 0 || !process.argv[rosterArgIndex + 1]) {
  console.error('Usage: npm run portrait:build-real -- --roster "C:/path/to/roster.json"');
  process.exit(1);
}

const rosterPath = path.resolve(process.argv[rosterArgIndex + 1]);
const outDir = path.join(root, 'public', 'assets', 'real_player_faces');
const outPath = path.join(outDir, 'real_player_faces_manifest.json');
fs.mkdirSync(path.join(outDir, 'base'), { recursive: true });

const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const rows = [];

function slug(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function shortHash(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

function portraitKey(player, headshot) {
  const nba = String(headshot).match(/cdn\.nba\.com\/headshots\/nba\/latest\/1040x760\/(\d+)\.png/i);
  if (nba) return nba[1];
  return `${slug(player?.name || 'player')}_${shortHash(player?.id || headshot || player?.name || '')}`;
}

for (const [conference, teams] of Object.entries(roster?.conferences || {})) {
  for (const team of Array.isArray(teams) ? teams : []) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      const headshot = String(player?.headshot || '').trim();
      if (!player?.id || !player?.name || !headshot) continue;
      const key = portraitKey(player, headshot);
      rows.push({
        id: `real_face_${key}`,
        playerId: String(player.id),
        name: String(player.name),
        teamName: String(team?.name || ''),
        conference,
        sourceUrl: headshot,
        baseFilename: `real_face_${key}_base.png`,
        baseUrl: `/assets/real_player_faces/base/real_face_${key}_base.png`,
        baseReady: false,
        needsBase: true,
      });
    }
  }
}

for (const player of Array.isArray(roster?.freeAgents) ? roster.freeAgents : []) {
  const headshot = String(player?.headshot || '').trim();
  if (!player?.id || !player?.name || !headshot) continue;
  const key = portraitKey(player, headshot);
  rows.push({
    id: `real_face_${key}`,
    playerId: String(player.id),
    name: String(player.name),
    teamName: 'Free Agency',
    conference: '',
    sourceUrl: headshot,
    baseFilename: `real_face_${key}_base.png`,
    baseUrl: `/assets/real_player_faces/base/real_face_${key}_base.png`,
    baseReady: false,
    needsBase: true,
  });
}

const seen = new Set();
const unique = rows.filter((row) => {
  if (seen.has(row.playerId)) return false;
  seen.add(row.playerId);
  return true;
}).sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(outPath, `${JSON.stringify(unique, null, 2)}\n`);
console.log('Real-player portrait manifest built.');
console.log(`- Players: ${unique.length}`);
console.log(`- Output: public/assets/real_player_faces/real_player_faces_manifest.json`);
