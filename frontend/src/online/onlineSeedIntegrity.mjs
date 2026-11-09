// Online-only, pure launch-time validator. Never import GameContext or mutate saves.
// The canonical shape is conferences.East/West; flat team arrays are converted.
// This is a release gate, NOT a validator for in-progress/retired historical rosters.
const DIVISIONS = Object.freeze({
  Atlantic: 'East', Central: 'East', Southeast: 'East',
  Northwest: 'West', Pacific: 'West', Southwest: 'West',
});
const NBA_DIVISIONS = Object.freeze({
  'Boston Celtics':'Atlantic','Brooklyn Nets':'Atlantic','New York Knicks':'Atlantic','Philadelphia 76ers':'Atlantic','Toronto Raptors':'Atlantic',
  'Chicago Bulls':'Central','Cleveland Cavaliers':'Central','Detroit Pistons':'Central','Indiana Pacers':'Central','Milwaukee Bucks':'Central',
  'Atlanta Hawks':'Southeast','Charlotte Hornets':'Southeast','Miami Heat':'Southeast','Orlando Magic':'Southeast','Washington Wizards':'Southeast',
  'Denver Nuggets':'Northwest','Minnesota Timberwolves':'Northwest','Oklahoma City Thunder':'Northwest','Portland Trail Blazers':'Northwest','Utah Jazz':'Northwest',
  'Golden State Warriors':'Pacific','Los Angeles Clippers':'Pacific','LA Clippers':'Pacific','Los Angeles Lakers':'Pacific','Phoenix Suns':'Pacific','Sacramento Kings':'Pacific',
  'Dallas Mavericks':'Southwest','Houston Rockets':'Southwest','Memphis Grizzlies':'Southwest','New Orleans Pelicans':'Southwest','San Antonio Spurs':'Southwest',
});
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x.trim() : '';
const fail = message => { throw new Error(`Online roster preflight: ${message}`); };
const validId = id => (typeof id === 'string' && !!id.trim() && id.length <= 120) ||
  (Number.isSafeInteger(id) && id > 0);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const seasonOf = seed => seed.seasonStartYear ?? seed.seasonYear ?? seed.currentSeasonYear;

// Lightweight compatibility helper for already-started flat-format leagues.
// Do NOT treat this as a security validator; new leagues must use validateOnlineStartingSeed.
export function normalizeOnlineTeamLayout(seed) {
  if (!obj(seed) || !Array.isArray(seed.teams) || seed.conferences) return seed;
  const divisions = seed.teams.map(team => text(team?.division) || NBA_DIVISIONS[text(team?.name)]);
  const conference = (team,index) => text(team?.conference) || text(team?.conf) || DIVISIONS[divisions[index]] || '';
  const east = [], west = [];
  for (let i=0;i<seed.teams.length;i++) {
    const conf = conference(seed.teams[i],i);
    const target = conf === 'East' ? east : conf === 'West' ? west : null;
    if (!target) return seed; // Do not invent metadata for an ambiguous existing save.
    target.push({ ...seed.teams[i], conference: conf, division: divisions[i] || seed.teams[i]?.division });
  }
  if (east.length !== 15 || west.length !== 15) return seed;
  const { teams: _teams, ...rest } = seed;
  return { ...rest, conferences: {East:east, West:west} };
}

export function validateOnlineStartingSeed(seed) {
  if (!obj(seed)) fail('the roster JSON must be an object.');
  const hasFlat = Array.isArray(seed.teams);
  const hasConfs = obj(seed.conferences) &&
    (own(seed.conferences,'East') || own(seed.conferences,'West'));
  if (hasFlat && hasConfs) fail('choose either teams or conferences, not two conflicting copies.');
  if (!hasFlat && !hasConfs) fail('provide teams or conferences.East/West.');
  if (hasConfs && (!Array.isArray(seed.conferences.East) || !Array.isArray(seed.conferences.West)))
    fail('both East and West conferences must be arrays.');
  const normalized = hasFlat ? normalizeOnlineTeamLayout(seed) : seed;
  if (!obj(normalized.conferences))
    fail('flat teams require East/West conference assignments (or recognized NBA divisions).');
  const east = normalized.conferences.East, west = normalized.conferences.West;
  if (!Array.isArray(east) || !Array.isArray(west) || east.length !== 15 || west.length !== 15)
    fail('the NBA calendar requires 15 Eastern and 15 Western teams.');

  const season = seasonOf(seed);
  if (!Number.isInteger(season) || season < 2026 || season > 2028)
    fail('the starting season must be a supported start year (2026–2028).');
  for (const key of ['seasonYear','seasonStartYear','currentSeasonYear']) {
    if (seed[key] != null && seed[key] !== season) fail(`${key} contradicts the starting season.`);
  }
  const teamNames = new Set(), teamNamesExact = new Set(), ids = new Set(), divisions = new Map();
  const addPlayer = (p,where,contractRequired) => {
    if (!obj(p) || !validId(p.id)) fail(`${where} has a missing or invalid player ID.`);
    const id = String(p.id).trim();
    if (ids.has(id)) fail(`duplicate player ID ${id} (${where}).`);
    ids.add(id);
    if (text(p.name).length < 2 || text(p.name).length > 100) fail(`${where} has an invalid player name.`);
    if (!text(p.pos) || text(p.pos).length > 12) fail(`${where} has no playable position.`);
    if (!finite(p.overall) || p.overall < 0 || p.overall > 100) fail(`${where} has an invalid overall rating.`);
    if (!Array.isArray(p.attrs) || p.attrs.length !== 15 || p.attrs.some(a => !finite(a) || a < 0 || a > 100))
      fail(`${where} must have 15 valid skill ratings.`);
    if (contractRequired || p.contract != null) {
      const c=p.contract;
      if (!obj(c) || !Number.isInteger(c.startYear) || !Array.isArray(c.salaryByYear) ||
        !c.salaryByYear.length || c.salaryByYear.length > 8 ||
        c.salaryByYear.some(v => !Number.isSafeInteger(v) || v < 0 || v > 1000000000))
        fail(`${where} has an invalid contract or salaryByYear.`);
      if (contractRequired && (c.startYear > season || c.startYear+c.salaryByYear.length <= season))
        fail(`${where}'s contract does not cover the starting season.`);
    }
  };
  for (const [conf,teams] of [['East',east],['West',west]]) {
    for (const [index,team] of teams.entries()) {
      if (!obj(team) || text(team.name).length < 2 || text(team.name).length > 80)
        fail(`${conf} team ${index+1} is invalid.`);
      const name=text(team.name), key=name.toLowerCase();
      if (teamNames.has(key)) fail(`duplicate team name ${name}.`);
      teamNames.add(key);
      teamNamesExact.add(name);
      const div=text(team.division) || NBA_DIVISIONS[name];
      if (DIVISIONS[div] !== conf) fail(`${name} needs a valid ${conf} NBA division.`);
      divisions.set(div,(divisions.get(div)||0)+1);
      if (team.conference != null && text(team.conference)!==conf) fail(`${name} has conflicting conference metadata.`);
      if (!Array.isArray(team.players) || team.players.length < 8 || team.players.length > 20)
        fail(`${name} needs 8–20 standard players for safe simulation.`);
      const names = new Set();
      for (const p of team.players) {
        addPlayer(p,`${name} roster`,true);
        const pname=text(p.name).toLowerCase();
        if (names.has(pname)) fail(`duplicate active player name on ${name}: ${p.name}.`);
        names.add(pname);
      }
      for (const bucket of ['twoWayPlayers','stashPlayers','stashedPlayers']) {
        if (team[bucket] != null && !Array.isArray(team[bucket])) fail(`${name}'s ${bucket} must be an array.`);
        for (const p of team[bucket] || []) addPlayer(p,`${name} ${bucket}`,false);
      }
    }
  }
  for (const div of Object.keys(DIVISIONS)) {
    if (divisions.get(div)!==5) fail(`the ${div} division must contain exactly five teams.`);
  }
  if (!Array.isArray(seed.freeAgents)) fail('freeAgents must be an array (use [] if empty).');
  for (const p of seed.freeAgents) addPlayer(p,'free-agent pool',false);
  if (!obj(seed.financials)) fail('financials must define the starting salary-cap season.');
  const calendar = seed.calendar;
  const validDate = value => {
    if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  };
  if (!obj(calendar) || !validDate(calendar.regularSeasonStart) || !validDate(calendar.regularSeasonEnd) ||
    Number(calendar.regularSeasonStart.slice(0,4))!==season ||
    Number(calendar.regularSeasonEnd.slice(0,4))!==season+1 ||
    calendar.regularSeasonStart >= calendar.regularSeasonEnd)
    fail('calendar must contain valid starting and ending NBA regular-season dates.');
  if (!Array.isArray(seed.draftPicks)) fail('draftPicks must include the initial NBA draft ledger.');
  const pickIds = new Set();
  let firstYearPicks=0;
  for (const p of seed.draftPicks) {
    if (!obj(p) || !validId(p.id) || !Number.isInteger(p.year) || p.year < season+1 || p.year>season+10 ||
        ![1,2].includes(p.round) || !teamNamesExact.has(text(p.ownerTeam)))
      fail('draftPicks contains an invalid future asset or non-league owner.');
    const id=String(p.id).trim();
    if (pickIds.has(id)) fail(`duplicate draft-pick ID ${id}.`);
    pickIds.add(id);
    if (p.year===season+1) firstYearPicks++;
  }
  if (firstYearPicks<60) fail(`the ${season+1} draft needs at least 60 pick/swap ledger entries.`);
  // Persist exactly one team representation, with explicit schedule metadata.
  const canonical = { ...normalized, conferences: {
    East: east.map(t => ({...t, conference:'East', division: text(t.division) || NBA_DIVISIONS[text(t.name)]})),
    West: west.map(t => ({...t, conference:'West', division: text(t.division) || NBA_DIVISIONS[text(t.name)]})),
  }};
  const bytes=new TextEncoder().encode(JSON.stringify(canonical)).byteLength;
  if (bytes>10000000) fail('the normalized roster exceeds the 10 MB upload limit.');
  return canonical;
}
