function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanInline(value) {
  return String(value ?? "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeTeam(value) {
  const text = cleanInline(value);
  const normalized = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized || normalized === "fa" || normalized === "freeagent" || normalized === "freeagency" || normalized === "unsigned") {
    return "";
  }
  return text;
}

function seasonRows(player) {
  const rows = Array.isArray(player?.history?.seasons) ? player.history.seasons : [];
  return rows.filter((row) => row && row?.rowType !== "total");
}

function accoladeRows(player) {
  const raw = [
    ...(Array.isArray(player?.history?.accolades) ? player.history.accolades : []),
    ...(Array.isArray(player?.accolades) ? player.accolades : []),
  ];

  const seen = new Set();
  return raw
    .map((row) => (typeof row === "string" ? { label: row, type: "custom" } : row))
    .filter(Boolean)
    .filter((row) => {
      const key = [
        Number(row?.seasonYear || 0),
        cleanInline(row?.type).toLowerCase(),
        cleanInline(row?.label || row?.name || row?.details).toLowerCase(),
        normalizeTeam(row?.team || row?.teamName),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function productionValue(row) {
  const ppg = Math.max(0, finiteNumber(row?.ppg));
  const rpg = Math.max(0, finiteNumber(row?.rpg));
  const apg = Math.max(0, finiteNumber(row?.apg));
  const spg = Math.max(0, finiteNumber(row?.spg));
  const bpg = Math.max(0, finiteNumber(row?.bpg));
  return ppg + 0.55 * rpg + 0.65 * apg + 1.35 * spg + 1.35 * bpg;
}

function formatStatLine(row) {
  if (!row) return "";
  const parts = [];
  const ppg = finiteNumber(row?.ppg);
  const rpg = finiteNumber(row?.rpg);
  const apg = finiteNumber(row?.apg);
  if (ppg > 0) parts.push(`${ppg.toFixed(1)} PPG`);
  if (rpg > 0) parts.push(`${rpg.toFixed(1)} RPG`);
  if (apg > 0) parts.push(`${apg.toFixed(1)} APG`);
  return parts.join(" • ");
}

function accoladeKind(row) {
  const type = cleanInline(row?.type).toLowerCase();
  const text = cleanInline(`${row?.label || ""} ${row?.name || ""} ${row?.details || ""}`).toLowerCase();

  if ((type === "mvp" || text.includes("most valuable player") || text === "mvp") && !text.includes("finals")) return "mvp";
  if (type === "finals_mvp" || text.includes("finals mvp")) return "finals_mvp";
  if (type === "dpoy" || text.includes("defensive player of the year")) return "dpoy";
  if (type === "champion" || text.includes("nba champion") || text.includes("championship")) return "champion";
  if (type === "all_nba_first" || text.includes("all-nba first")) return "all_nba_first";
  if (type === "all_nba_second" || text.includes("all-nba second")) return "all_nba_second";
  if (type === "all_nba_third" || text.includes("all-nba third")) return "all_nba_third";
  if (type.startsWith("all_nba") || text.includes("all-nba")) return "all_nba";
  if (type.startsWith("all_defensive") || text.includes("all-defensive")) return "all_defensive";
  if (type === "all_star" || text.includes("all-star")) return "all_star";
  if (type === "roty" || text.includes("rookie of the year")) return "roty";
  if (type === "sixth_man" || text.includes("sixth man")) return "sixth_man";
  if (type === "mip" || text.includes("most improved")) return "mip";
  if (type === "clutch_player" || text.includes("clutch player")) return "clutch";
  if (type.startsWith("all_rookie") || text.includes("all-rookie")) return "all_rookie";
  return "other";
}

const HONOR_META = {
  mvp: { label: "Most Valuable Player", weight: 9, priority: 1 },
  finals_mvp: { label: "Finals MVP", weight: 9, priority: 2 },
  dpoy: { label: "Defensive Player of the Year", weight: 7, priority: 3 },
  champion: { label: "NBA Champion", weight: 5, priority: 4 },
  all_nba_first: { label: "All-NBA First Team", weight: 5, priority: 5 },
  all_nba_second: { label: "All-NBA Second Team", weight: 4, priority: 6 },
  all_nba_third: { label: "All-NBA Third Team", weight: 3.5, priority: 7 },
  all_nba: { label: "All-NBA", weight: 3.5, priority: 8 },
  all_defensive: { label: "All-Defensive Team", weight: 2.5, priority: 9 },
  all_star: { label: "NBA All-Star", weight: 2, priority: 10 },
  roty: { label: "Rookie of the Year", weight: 3, priority: 11 },
  sixth_man: { label: "Sixth Man of the Year", weight: 2, priority: 12 },
  mip: { label: "Most Improved Player", weight: 1.5, priority: 13 },
  clutch: { label: "Clutch Player of the Year", weight: 1.5, priority: 14 },
  all_rookie: { label: "All-Rookie Team", weight: 1, priority: 15 },
  other: { label: "Career Honor", weight: 0.5, priority: 40 },
};

function yearOf(row) {
  const year = Number(row?.seasonYear || row?.year || 0);
  return Number.isFinite(year) && year >= 1900 && year <= 2200 ? year : 0;
}

function teamOf(row) {
  return normalizeTeam(row?.team || row?.teamName || row?.championTeam || row?.champion_team);
}

function championshipRows(player, leagueData) {
  const explicit = accoladeRows(player)
    .filter((row) => accoladeKind(row) === "champion")
    .map((row) => ({ ...row, seasonYear: yearOf(row), team: teamOf(row) }))
    .filter((row) => row.seasonYear || row.team);

  const seen = new Set(explicit.map((row) => `${row.seasonYear}|${row.team}`));
  const historyChampions = Array.isArray(leagueData?.leagueHistory?.champions) ? leagueData.leagueHistory.champions : [];
  const seasons = seasonRows(player);

  for (const row of seasons) {
    const year = yearOf(row);
    const team = normalizeTeam(row?.team || row?.teamName);
    if (!year || !team) continue;
    const champion = historyChampions.find((item) => Number(item?.seasonYear) === year && normalizeTeam(item?.championTeam || item?.teamName || item?.team) === team);
    if (!champion) continue;
    const key = `${year}|${team}`;
    if (!seen.has(key)) {
      explicit.push({ seasonYear: year, team, type: "champion", label: "NBA Champion", source: "leagueHistory" });
      seen.add(key);
    }
  }

  return explicit.sort((a, b) => yearOf(a) - yearOf(b));
}

function buildTeamCareerProfiles(player) {
  const profiles = new Map();

  for (const row of seasonRows(player)) {
    const team = normalizeTeam(row?.team || row?.teamName);
    if (!team) continue;
    const gp = Math.max(0, finiteNumber(row?.games ?? row?.gp));
    const value = productionValue(row);
    const current = profiles.get(team) || {
      team,
      games: 0,
      seasonCount: 0,
      productionScore: 0,
      peakProduction: 0,
      bestSeason: null,
      honorScore: 0,
      honors: [],
      latestYear: 0,
    };
    current.games += gp;
    current.seasonCount += 1;
    current.productionScore += (gp || 20) * (1 + value / 20);
    current.peakProduction = Math.max(current.peakProduction, value);
    current.latestYear = Math.max(current.latestYear, yearOf(row));
    if (!current.bestSeason || productionValue(row) > productionValue(current.bestSeason)) current.bestSeason = row;
    profiles.set(team, current);
  }

  for (const row of accoladeRows(player)) {
    const team = teamOf(row);
    if (!team) continue;
    const kind = accoladeKind(row);
    const meta = HONOR_META[kind] || HONOR_META.other;
    const current = profiles.get(team) || {
      team,
      games: 0,
      seasonCount: 0,
      productionScore: 0,
      peakProduction: 0,
      bestSeason: null,
      honorScore: 0,
      honors: [],
      latestYear: 0,
    };
    current.honorScore += meta.weight;
    current.honors.push({ row, kind, meta });
    current.latestYear = Math.max(current.latestYear, yearOf(row));
    profiles.set(team, current);
  }

  return [...profiles.values()]
    .map((profile) => ({
      ...profile,
      score: profile.productionScore + profile.honorScore * 120,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.honorScore !== a.honorScore) return b.honorScore - a.honorScore;
      if (b.peakProduction !== a.peakProduction) return b.peakProduction - a.peakProduction;
      if (b.games !== a.games) return b.games - a.games;
      return b.latestYear - a.latestYear;
    });
}

function groupedHonors(player) {
  const groups = new Map();
  for (const row of accoladeRows(player)) {
    const kind = accoladeKind(row);
    const meta = HONOR_META[kind] || HONOR_META.other;
    const fallbackLabel = cleanInline(row?.label || row?.name || row?.details || meta.label);
    const key = kind === "other" ? `other:${fallbackLabel.toLowerCase()}` : kind;
    const group = groups.get(key) || { key, kind, label: kind === "other" ? fallbackLabel : meta.label, priority: meta.priority, count: 0, rows: [] };
    group.count += 1;
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.priority - b.priority || b.count - a.count || a.label.localeCompare(b.label));
}

function formatYearList(rows) {
  const years = [...new Set(rows.map(yearOf).filter(Boolean))].sort((a, b) => a - b);
  return years.join(", ");
}

function formatGroupedHonor(group) {
  if (!group) return "";
  const countPrefix = group.count > 1 ? `${group.count}× ` : "";
  const years = formatYearList(group.rows);
  return `${countPrefix}${group.label}${years ? ` (${years})` : ""}`;
}

function formatChampionship(row) {
  const year = yearOf(row);
  const team = teamOf(row);
  if (year && team) return `${year} NBA Champion — ${team}`;
  if (year) return `${year} NBA Champion`;
  if (team) return `NBA Champion — ${team}`;
  return "NBA Champion";
}

function strongestPrimeHonor(profile) {
  if (!profile?.honors?.length) return "";
  const usable = profile.honors.filter(({ kind }) => kind !== "champion");
  if (!usable.length) return "";
  usable.sort((a, b) => (HONOR_META[a.kind]?.priority || 40) - (HONOR_META[b.kind]?.priority || 40));
  const first = usable[0];
  const sameKind = usable.filter((row) => row.kind === first.kind);
  const count = sameKind.length;
  const label = first.meta.label;
  return count > 1 ? `${count} ${label} selections` : `a ${label} selection`;
}

function cleanFinalSentence(value) {
  let text = cleanInline(value);
  if (!text) return "";
  text = text
    .replace(/\bnba\b/gi, "NBA")
    .replace(/\bppg\b/gi, "PPG")
    .replace(/\brpg\b/gi, "RPG")
    .replace(/\bapg\b/gi, "APG")
    .replace(/\ball nba\b/gi, "All-NBA")
    .replace(/\ball star\b/gi, "All-Star");
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

export function getRetirementNarrativeKey(player) {
  const id = player?.id ?? player?.playerId ?? null;
  if (id != null && String(id).trim()) return `id:${String(id)}`;
  const name = cleanInline(player?.name || player?.playerName || player?.player).toLowerCase();
  const year = Number(player?.retiredSeasonYear || 0);
  return `name:${name}|${year || "na"}`;
}

function hashNarrativeSeed(value) {
  const text = String(value || "retirement");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickNarrative(items, seed, salt = 0) {
  if (!Array.isArray(items) || !items.length) return null;
  const mixed = hashNarrativeSeed(`${seed}|${salt}|${items.length}|retirement-voice`);
  return items[mixed % items.length];
}

function roundedStatMemory(row, player = null) {
  if (!row) return "";
  const points = Math.max(0, Math.round(finiteNumber(row?.ppg)));
  const rebounds = Math.max(0, Math.round(finiteNumber(row?.rpg)));
  const assists = Math.max(0, Math.round(finiteNumber(row?.apg)));
  const position = cleanInline(player?.position || player?.pos).toUpperCase();

  const parts = [];
  if (points >= 5) parts.push(`${points} point${points === 1 ? "" : "s"}`);

  const isGuard = /PG|SG|G/.test(position);
  const isBig = /PF|C|F-C|C-F/.test(position);

  if (isGuard) {
    if (assists >= 2) parts.push(`${assists} assist${assists === 1 ? "" : "s"}`);
    if (rebounds >= 5 && parts.length < 3) parts.push(`${rebounds} rebound${rebounds === 1 ? "" : "s"}`);
  } else if (isBig) {
    if (rebounds >= 3) parts.push(`${rebounds} rebound${rebounds === 1 ? "" : "s"}`);
    if (assists >= 4 && parts.length < 3) parts.push(`${assists} assist${assists === 1 ? "" : "s"}`);
  } else {
    if (rebounds >= 4) parts.push(`${rebounds} rebound${rebounds === 1 ? "" : "s"}`);
    if (assists >= 3 && parts.length < 3) parts.push(`${assists} assist${assists === 1 ? "" : "s"}`);
  }

  if (parts.length === 0) return "";
  if (parts.length === 1) return `${parts[0]} a night`;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]} a night`;
  return `${parts[0]}, ${parts[1]} and ${parts[2]} a night`;
}

function careerLengthPhrase(seasonCount, totalGames) {
  if (seasonCount >= 20) return "after two decades in the league";
  if (seasonCount >= 17) return "after nearly two decades in the league";
  if (seasonCount >= 14) return "after a long run in the league";
  if (seasonCount >= 11) return "after more than a decade in the league";
  if (seasonCount >= 8) return "after a full career's worth of NBA seasons";
  if (totalGames >= 1000) return "after well over a thousand NBA games";
  if (totalGames >= 700) return "after hundreds and hundreds of NBA games";
  if (seasonCount >= 4) return "after several NBA seasons";
  return "at this point in my career";
}

function careerTone(player, prime, titles) {
  const groups = groupedHonors(player);
  const kinds = new Set(groups.map((group) => group.kind));
  const allStarCount = groups.find((group) => group.kind === "all_star")?.count || 0;
  const allNbaCount = groups
    .filter((group) => ["all_nba", "all_nba_first", "all_nba_second", "all_nba_third"].includes(group.kind))
    .reduce((sum, group) => sum + group.count, 0);
  const titleCount = Array.isArray(titles) ? titles.length : 0;
  const peak = productionValue(prime?.bestSeason);

  if (kinds.has("mvp") || kinds.has("finals_mvp") || allNbaCount >= 4 || allStarCount >= 7) return "legend";
  if (allNbaCount >= 1 || allStarCount >= 2 || peak >= 24) return "star";
  if (titleCount >= 1 || peak >= 15) return "established";
  return "role";
}

function buildOpeningContext(player, bestSeason, latestSeason, seasonCount, totalGames, prime, titles) {
  const age = Math.max(0, finiteNumber(player?.age));
  const overall = Math.max(0, finiteNumber(player?.overall ?? player?.ovr));
  const bestPpg = Math.max(0, finiteNumber(bestSeason?.ppg));
  const latestPpg = Math.max(0, finiteNumber(latestSeason?.ppg));
  const meaningfulDecline = bestPpg >= 10 && latestPpg <= bestPpg * 0.68;
  const retiredFrom = normalizeTeam(player?.retiredFromTeam || player?.teamName || player?.team);
  const isFreeAgent = !retiredFrom;
  const length = careerLengthPhrase(seasonCount, totalGames);
  const tone = careerTone(player, prime, titles);

  let archetype = "veteran";
  if (isFreeAgent && overall <= 65) archetype = "market_closed";
  else if (age >= 40) archetype = "old_guard";
  else if (meaningfulDecline) archetype = "decline";
  else if (overall >= 75 && age >= 35) archetype = "still_effective";
  else if (isFreeAgent) archetype = "free_agent";
  else if (age <= 34) archetype = "early_exit";

  return { age, overall, isFreeAgent, retiredFrom, length, tone, archetype, meaningfulDecline };
}

const OPENING_TEMPLATES = {
  market_closed: [
    ({ age, length }) => `I knew the league was starting to tell me something ${length}. At ${age || "this stage"}, the calls were different, the roles were smaller, and I did not want to spend another year waiting for a situation that might never come.`,
    ({ length }) => `There comes a point when chasing the next roster spot stops feeling like competing and starts feeling like hanging on. ${length[0].toUpperCase() + length.slice(1)}, I was at peace with letting go.`,
    ({ age }) => `I still believed I could help a team, but the market was getting quieter and I could feel the game moving in another direction. At ${age || "this stage of my career"}, I would rather choose my ending than wait for somebody else to choose it for me.`,
    ({ length }) => `The hardest part was admitting that the opportunities I wanted were not really there anymore. ${length[0].toUpperCase() + length.slice(1)}, I decided I had earned the right to walk away without chasing one last contract.`,
    () => `I kept waiting for the kind of opportunity that would make another season worth it, and eventually I realized I was waiting for the past. That was the sign for me to move on.`,
    () => `Basketball had been my routine for so long that stepping away was never going to feel completely natural. But once the roster spots became harder to find, I knew forcing another year would not make the ending better.`,
    ({ age }) => `At ${age || "this point"}, I was not interested in bouncing from workout to workout just to prove I still belonged. I knew what I had been in this league, and that gave me peace with retiring.`,
    () => `I did not lose my love for basketball; I just reached the point where the league no longer had the role I was looking for. I would rather remember the career I built than let the final chapter become a waiting game.`,
    () => `Once the phone stopped ringing the way it used to, I had a choice: keep chasing a shrinking opportunity or be honest with myself. I chose honesty.`,
    ({ length }) => `The end did not come with one dramatic moment. It came gradually, as the roles got smaller and the next opportunity got harder to find. ${length[0].toUpperCase() + length.slice(1)}, that was enough for me.`,
    () => `I always thought I would know exactly when it was over. In reality, it was quieter than that: fewer openings, fewer fits, and a growing sense that I had already given the game what I had.`,
    () => `I could have kept training and waiting for one more call, but I did not want my last memory of the NBA to be sitting by the phone. I was ready to close the book myself.`,
  ],
  old_guard: [
    ({ age, length }) => `At ${age || "this age"}, ${length}, I finally felt the weight of every season that came before this one. I still loved competing, but the preparation was asking more of me than I wanted to keep giving.`,
    ({ length }) => `I had reached the point where the offseason recovery felt almost as long as the season itself. ${length[0].toUpperCase() + length.slice(1)}, I knew I did not need to squeeze one more year out of my body.`,
    () => `For years I could always convince myself there was another season in me. This time, when I pictured the training camp, the travel and the recovery, I felt more peace than hunger.`,
    ({ age }) => `The competitor in me could always find a reason to come back, even at ${age || "this age"}. The rest of me was finally ready to listen when my body said enough.`,
    () => `I never wanted to stay just because leaving was hard. When another season started to feel like something I had to survive instead of something I could not wait to attack, I knew it was time.`,
    ({ length }) => `I got more basketball out of this life than I ever could have imagined. ${length[0].toUpperCase() + length.slice(1)}, walking away felt less like giving something up and more like appreciating that run for what it was.`,
    () => `The game had been good to me, but the recovery, travel and physical grind had all started to add up. I wanted to leave while I could still recognize myself as a player.`,
    ({ age }) => `At ${age || "this point in my career"}, I did not need anybody to push me out. I knew how much work it would take to do this again, and I knew I was finally ready for something different.`,
    () => `I had spent my whole career waking up with the next game in mind. For the first time, the thought of not having to prepare for another season felt right instead of frightening.`,
    () => `I could still find flashes of the player I had been, but I no longer wanted to build an entire season around chasing those flashes. That made the decision clearer than I expected.`,
    () => `Nothing about retiring was easy, but the hardest part had stopped being leaving the game. The hardest part was imagining another year of putting my body through everything an NBA season demands.`,
    () => `I always said I wanted to leave with something still in the tank. Once I realized I had reached that moment, I did not want pride to turn one good ending into one season too many.`,
  ],
  decline: [
    ({ age }) => `I could feel the difference between the player I had been and the role I was being asked to play now. At ${age || "this stage"}, I did not want to spend another season trying to recreate a version of myself that belonged to an earlier chapter.`,
    () => `The game did not suddenly disappear on me, but little things kept changing: the minutes, the matchups, the recovery and the way I could impact a night. Eventually those little things added up to an honest answer.`,
    () => `I had enough good nights left to remind myself what I used to be, but not enough to pretend the decline was not real. I would rather leave with gratitude than spend another year fighting the clock.`,
    () => `My role kept moving farther from the one I had built my career around. I respected the game too much to confuse stubbornness with competitiveness.`,
    ({ length }) => `I spent a long time adjusting my game and finding new ways to help. ${length[0].toUpperCase() + length.slice(1)}, I reached the point where another adjustment did not feel like the answer anymore.`,
    () => `There is a difference between adapting and hanging on. I had adapted for years, but this season I finally felt that line getting close.`,
    () => `I was proud that I could keep finding ways to contribute as my game changed. Eventually, though, I wanted my last seasons to feel like part of my career rather than an imitation of my prime.`,
    ({ age }) => `At ${age || "this stage"}, I could still help, but I knew I was no longer dictating games the way I once did. I was comfortable admitting that before the league had to make it obvious for me.`,
    () => `The film was honest with me. I could see the moments where I used to create an advantage and now had to work twice as hard for the same result. That made the decision real.`,
    () => `I did not need one bad season to tell me it was over. I just felt the gap between my best basketball and my current basketball getting wider, and I knew what that meant.`,
    () => `My pride wanted to keep chasing the old standard. My perspective told me I had already done enough. In the end, perspective won.`,
    () => `I had spent years reinventing parts of my game to stay useful. This time, instead of another reinvention, I felt ready to let the career stand as it was.`,
    () => `The hardest thing was not accepting that I had changed as a player; it was accepting that I did not need to keep proving I could change again. Once I understood that, retirement felt honest.`,
    () => `I could still recognize pieces of my old game, but they were showing up in shorter stretches. I did not want to spend another year measuring myself against who I used to be.`,
    () => `For a while I treated every drop in production like a problem I could solve with more work. Eventually I realized some changes are not problems; they are simply time doing what time does.`,
    () => `My game had become more about surviving possessions than imposing myself on them. That was not how I wanted to remember the final part of my career.`,
    () => `I kept telling myself the next offseason would bring me all the way back. This time I stopped making that promise and accepted where I was.`,
    () => `There were still nights when everything felt familiar, but there were more nights when I had to search for it. I knew I was ready before those good nights disappeared completely.`,
    () => `I had always taken pride in adjusting before opponents could expose a weakness. Near the end, the biggest adjustment was admitting I did not have to keep doing this forever.`,
    () => `The role I had late in my career was still valuable, but it no longer felt like the basketball life I wanted to keep building around. I was ready to leave that role to the next guy.`,
    () => `I did not resent the smaller role; I understood why it happened. I just knew I would rather step away than spend another season comparing every minute to the player I had once been.`,
    () => `I could feel myself becoming a different kind of player every year. I was proud of how long I adapted, but eventually the right adaptation was learning how to stop.`,
    () => `The numbers were not what made the decision for me. It was the feeling that I had to work harder and harder just to reach a version of my game that used to come naturally.`,
    () => `I had already proven I could evolve with age. I did not need one final season to prove it again, especially when I knew the best basketball of my career was already something to be proud of.`,
  ],
  still_effective: [
    ({ age }) => `I know some people will look at ${age || "my age"} and think I still had plenty left, and maybe I did. For me, that was exactly why this felt like the right time: I wanted to leave before the game made the choice for me.`,
    () => `I was still capable of helping a team, which made this decision harder, not easier. But I had reached a point where being able to play another season was not the same as wanting to live through another season.`,
    () => `This was not about feeling washed or unwanted. I simply reached a point where I was satisfied with the career I had built and did not need one more season to validate it.`,
    ({ length }) => `I could have talked myself into coming back. ${length[0].toUpperCase() + length.slice(1)}, I realized I did not need to prove I could keep going just because I probably could.`,
    () => `I wanted my last memory of myself as a player to be someone who could still compete, not someone waiting for the league to pass him by. That mattered to me.`,
    () => `There was still basketball left in me, but the desire to organize my whole life around an NBA season was not as strong as it used to be. I trusted that feeling.`,
    () => `The hardest retirement decisions are probably the ones where you know you could still play. I decided I would rather leave a little early than a little late.`,
    ({ age }) => `At ${age || "this point"}, I had enough experience to know the difference between loving the game and needing to keep playing it professionally. I still loved it; I just did not need the second part anymore.`,
    () => `I did not want a farewell tour and I did not need one last contract. I wanted to step away while I still felt like myself, and this was that moment.`,
    () => `Physically, I probably could have made another run. Mentally, I was ready to stop measuring every year by training camp, travel and the next playoff chase.`,
    () => `I had nothing against another season. I just finally had something I wanted more than another season, and that made the decision simple.`,
    () => `I was lucky enough to reach the end without feeling like the game had taken everything from me. Leaving with some basketball still left in my body felt like a gift, not a regret.`,
  ],
  free_agent: [
    ({ age }) => `Free agency gave me more time than usual to think about what I actually wanted. By ${age || "this point"}, I realized I was more comfortable with retiring than with forcing the wrong basketball situation.`,
    () => `I could have waited longer for the market to settle, but I did not want my future decided by which team happened to need a veteran late in the offseason. I was ready to make the call for myself.`,
    () => `There were still possible paths back into the league, but none of them felt meaningful enough to build another year around. That was the answer I needed.`,
    () => `Being unsigned has a way of making you look at the game differently. Instead of asking who might call, I started asking whether I even wanted the call anymore.`,
    ({ length }) => `${length[0].toUpperCase() + length.slice(1)}, I did not want to choose a team just to say I was still in the NBA. If I was going to come back, it had to feel right, and eventually retiring felt more right.`,
    () => `I had options to keep chasing basketball, but not every option is worth taking. I decided I would rather leave on my own terms than take a role I did not believe in.`,
    () => `The offseason gave me enough distance to see that I was not excited about starting over somewhere new. Once I admitted that, the retirement decision came pretty naturally.`,
    ({ age }) => `At ${age || "this stage"}, fit mattered more to me than simply having a uniform. When the right fit was not there, I was comfortable calling it a career.`,
    () => `I kept myself ready in case the right situation appeared, but somewhere along the way I realized I was preparing out of habit more than desire. That told me everything.`,
    () => `I did not want to spend the season measuring my career by ten-day opportunities and roster openings. I had a bigger body of work than that, and I was ready to appreciate it.`,
    () => `The door was not completely closed, but I stopped feeling the need to keep one foot in it. Retiring felt like the first decision in a while that was entirely mine.`,
    () => `There is always another workout, another phone call, another team that might need depth. I reached the point where “might” was not enough reason to put the rest of my life on hold.`,
  ],
  early_exit: [
    ({ age }) => `I know ${age || "my age"} is younger than people expect when they hear the word retirement, but careers do not all end the same way. For me, the role, the grind and where I was headed made this feel like the right moment.`,
    () => `This was not the ending I pictured when I entered the league, but I learned a long time ago that you cannot build your life around the version of a career you imagined years earlier.`,
    () => `I had to be honest about what another season would actually look like, not what I hoped it might become. Once I did that, retiring did not feel as strange as it might look from the outside.`,
    () => `Walking away earlier than most was not an easy decision, but neither was pretending I was excited about continuing down the same path. I chose the option that felt honest.`,
    () => `I thought I would fight the idea of retirement much longer than I did. Once I separated the love of basketball from the reality of another NBA season, the decision became much clearer.`,
    () => `Not every career needs to end after twenty years to feel complete. I reached a point where I could be proud of what I had done without needing to stretch it out.`,
    () => `The league asks a lot from you physically and mentally, and I had reached the point where another season no longer felt worth that price. I was ready to move forward.`,
    () => `I did not want to keep playing only because retirement felt too early. Age was not a good enough reason to ignore what I was actually feeling.`,
    () => `I had spent enough time asking how I could extend my career. Eventually I asked a different question: whether extending it was really what I wanted. The answer surprised me.`,
    () => `This decision probably looks sudden from the outside. Inside, it had been building for a while, and I finally stopped talking myself out of it.`,
    () => `I am leaving earlier than some guys do, but I would rather have a shorter career I can appreciate than a longer one I stayed in out of fear.`,
    () => `Once basketball started feeling more like an obligation than an opportunity, I knew I needed to listen to that. I did not want resentment to become the final chapter of my career.`,
  ],
  veteran: [
    ({ length }) => `${length[0].toUpperCase() + length.slice(1)}, I felt the balance finally shift. The work it took to get through a season was becoming heavier than the satisfaction I got from adding one more year.`,
    () => `I had been thinking about retirement in the background for a while, but this was the first offseason where the idea felt peaceful instead of scary. That told me I was ready.`,
    () => `Every veteran says he will know when it is time. I was never sure I believed that until this year, when another season stopped feeling automatic.`,
    () => `The decision was less dramatic than people might expect. I woke up, thought about everything another season would require, and realized I was okay not doing it again.`,
    () => `I still loved the locker room and I still loved competing. What changed was how much of myself I wanted to spend getting ready to do it all over again.`,
    ({ age }) => `At ${age || "this stage"}, I had enough perspective to stop confusing routine with desire. Basketball had been my routine forever, but I was ready to build a different one.`,
    () => `There was no single injury, bad game or conversation that ended it. It was the accumulation of years, travel, recovery and the feeling that I had reached a natural stopping point.`,
    () => `I did not need the league to tell me I was finished. I wanted the decision to come from me while I could still look back at the game with nothing but appreciation.`,
    () => `The idea of one more season used to excite me immediately. This time it made me tired before it made me excited, and I trusted what that meant.`,
    () => `My competitive side could always invent one more goal. Eventually I realized I did not need another goal for the career to feel complete.`,
    ({ length }) => `I had already gotten ${length.replace(/^after /, "")} out of this career. Another season might have added games to the total, but it was not going to change what the journey meant to me.`,
    () => `I wanted to finish with a clear mind, not after a season where everybody else could see the end before I was willing to admit it. This felt like the right time.`,
  ],
};

const REFLECTION_TEMPLATES = {
  legend: [
    () => `I leave knowing I got to play at the highest level, carry real expectations and build a career that I never could have scripted when I started.`,
    () => `What gives me peace is knowing there were years when teams prepared for me, fans expected something from me, and I answered that responsibility.`,
    () => `I was fortunate enough to have seasons where the game felt completely open to me, and those are the moments I will remember more than the ending.`,
    () => `The final version of me was never going to look like the player at my peak, but I do not need it to. That peak existed, and I am proud of what I did with it.`,
    () => `I got to be more than just someone who made the league; for a long stretch I mattered in it. That is something I will never take for granted.`,
    () => `There is always another milestone you can chase, but at some point the body of work has to be enough. Mine feels like enough.`,
  ],
  star: [
    () => `I am proud that there were years when I was asked to carry a real piece of a team's identity, not just fill a spot in the rotation.`,
    () => `The version of my career I will hold onto is the one where I was at my best and could feel the game bend around what I was doing.`,
    () => `I had seasons where I knew I could walk into the arena and change the game, and that is a feeling I will always be grateful for.`,
    () => `I got to test myself against the best players in the world while playing some of the best basketball of my life. That is the part that stays with me.`,
    () => `I do not judge this career by how the last season looked. I judge it by the years when I was trusted to be one of the guys a team could lean on.`,
    () => `The ending was quieter than the prime, but that does not diminish the prime. I know what level I reached, and I am proud of it.`,
  ],
  established: [
    () => `More than anything, I am proud that I found ways to matter on good teams and stay useful as the league changed around me.`,
    () => `A long NBA career is built on more than one version of yourself. I am proud of how many different versions of my game I was able to make work.`,
    () => `I never took for granted how hard it is to earn a real role in this league and keep it. I got to do that for a long time.`,
    () => `My career had different chapters, different roles and different expectations, and I am proud that I kept finding a place in all of them.`,
    () => `I may not remember every box score, but I will remember being trusted in big games, sharing locker rooms with great players and earning my place year after year.`,
    () => `The thing I value most is the respect that comes from lasting in this league and being someone coaches and teammates could rely on.`,
  ],
  role: [
    () => `I am proud that I carved out a place in a league where nothing is guaranteed and kept finding ways to help.`,
    () => `Not everybody gets to be the face of a franchise. I learned to value the smaller things: earning minutes, keeping a job and being ready when my number was called.`,
    () => `I built this career one opportunity at a time, and I am proud that I turned those opportunities into real NBA seasons.`,
    () => `The part I appreciate most is simply how long I was able to stay in the room with the best players in the world and contribute.`,
    () => `My career was never about one headline. It was about showing up, staying ready and proving I belonged over and over again.`,
    () => `I know how difficult it is to make this league, let alone stay in it. I will always be proud that I found a way to do both.`,
  ],
};

const PRIME_MEMORY_TEMPLATES = [
  ({ team, honor, stats }) => `The best basketball of my career came with the ${team}${honor ? `, where I earned ${honor}` : stats ? `, when I was giving them ${stats}` : ""}.`,
  ({ team, honor, stats }) => `I will always have a special connection to the ${team}${honor ? ` because that is where I became ${honor}` : stats ? `; that was the stretch where I was around ${stats}` : ""}.`,
  ({ team, honor, stats }) => `When I think about my prime, I think about the ${team}${honor ? ` and the ${honor} that came with those years` : stats ? `, when I was producing ${stats}` : ""}.`,
  ({ team, honor, stats }) => `The ${team} years will always mean something different to me${honor ? `; that was where I earned ${honor}` : stats ? `, playing at a level of roughly ${stats}` : ""}.`,
  ({ team, honor, stats }) => `I became the player I wanted to be with the ${team}${honor ? `, and earning ${honor} there is something I will never forget` : stats ? `, when my game had reached about ${stats}` : ""}.`,
  ({ team, honor, stats }) => `A lot of my favorite basketball memories come from the ${team}${honor ? `, especially the years that brought ${honor}` : stats ? `, when I was around ${stats}` : ""}.`,
  ({ team, honor, stats }) => `If I had to point to the stretch where I felt most like myself as a player, it would be my time with the ${team}${honor ? `, when I earned ${honor}` : stats ? ` and was giving them ${stats}` : ""}.`,
  ({ team, honor, stats }) => `The ${team} got some of the best years I had${honor ? `, including ${honor}` : stats ? `, when I was putting up around ${stats}` : ""}, and I will always be grateful for that chapter.`,
  ({ team, honor, stats }) => `My prime will always be tied to the ${team}${honor ? `, where the work turned into ${honor}` : stats ? `, where I was playing at roughly ${stats}` : ""}.`,
  ({ team, honor, stats }) => `There were a lot of stops along the way, but the ${team} years are the ones I think of first when I remember myself at my best${honor ? `, especially earning ${honor}` : stats ? ` at around ${stats}` : ""}.`,
];

const TITLE_MEMORY_TEMPLATES = [
  ({ year, team }) => `Nothing, though, will top winning the ${year ? `${year} ` : ""}NBA championship${team ? ` with the ${team}` : ""}.`,
  ({ year, team }) => `The memory I will carry longest is lifting the trophy${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""}.`,
  ({ year, team }) => `If there is one night I could relive, it would be the night we became ${year ? `${year} ` : ""}NBA champions${team ? ` with the ${team}` : ""}.`,
  ({ year, team }) => `For all the individual moments, winning it all${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""} is the one that sits above everything else.`,
  ({ year, team }) => `The championship run${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""} gave me the memory I always wanted from this game.`,
  ({ year, team }) => `I had plenty of great nights, but becoming an NBA champion${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""} is the one I will tell stories about forever.`,
  ({ year, team }) => `What I will smile about most years from now is that ${year ? `${year} ` : ""}title${team ? ` with the ${team}` : ""}.`,
  ({ year, team }) => `The best team memory of my career is simple: finishing the job${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""} and walking off as NBA champions.`,
  ({ year, team }) => `I can remember a thousand games, but the championship${team ? ` with the ${team}` : ""}${year ? ` in ${year}` : ""} will always feel different from all of them.`,
  ({ year, team }) => `Winning the ${year ? `${year} ` : ""}NBA title${team ? ` with the ${team}` : ""} is the moment that made every long flight, workout and recovery day worth it.`,
];

export function buildRetirementReason(player, leagueData = null) {
  const seasons = seasonRows(player);
  const seasonYears = [...new Set(seasons.map(yearOf).filter(Boolean))];
  const seasonCount = seasonYears.length || seasons.length;
  const totalGames = seasons.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.games ?? row?.gp)), 0);
  const rankedSeasons = [...seasons].sort((a, b) => productionValue(b) - productionValue(a));
  const bestSeason = rankedSeasons[0] || null;
  const latestSeason = [...seasons].sort((a, b) => yearOf(b) - yearOf(a))[0] || null;
  const profiles = buildTeamCareerProfiles(player);
  const prime = profiles[0] || null;
  const titles = championshipRows(player, leagueData);
  const context = buildOpeningContext(player, bestSeason, latestSeason, seasonCount, totalGames, prime, titles);
  const seed = hashNarrativeSeed(`${getRetirementNarrativeKey(player)}|${context.archetype}|${context.tone}`);

  const openingTemplates = OPENING_TEMPLATES[context.archetype] || OPENING_TEMPLATES.veteran;
  const openingBuilder = pickNarrative(openingTemplates, seed, 1);
  const opening = openingBuilder ? openingBuilder(context) : "I knew it was time to step away from the game.";

  const reflectionTemplates = REFLECTION_TEMPLATES[context.tone] || REFLECTION_TEMPLATES.role;
  const reflectionBuilder = pickNarrative(reflectionTemplates, seed, 2);
  const reflection = reflectionBuilder ? reflectionBuilder(context) : "";

  const favoriteTitle = titles[titles.length - 1] || null;
  const titleTeam = favoriteTitle ? teamOf(favoriteTitle) : "";
  const titleYear = favoriteTitle ? yearOf(favoriteTitle) : 0;
  const primeTeam = prime?.team || "";
  const primeHonor = strongestPrimeHonor(prime);
  const primeStats = roundedStatMemory(prime?.bestSeason, player);

  let primeMemory = "";
  let titleMemory = "";
  let fallbackMemory = "";

  if (favoriteTitle) {
    if (primeTeam && titleTeam && primeTeam !== titleTeam && (primeHonor || primeStats)) {
      const primeBuilder = pickNarrative(PRIME_MEMORY_TEMPLATES, seed, 3);
      if (primeBuilder) primeMemory = primeBuilder({ team: primeTeam, honor: primeHonor, stats: primeStats });
    }
    const titleBuilder = pickNarrative(TITLE_MEMORY_TEMPLATES, seed, 4);
    if (titleBuilder) titleMemory = titleBuilder({ year: titleYear, team: titleTeam });
  } else if (primeTeam) {
    const primeBuilder = pickNarrative(PRIME_MEMORY_TEMPLATES, seed, 5);
    if (primeBuilder) primeMemory = primeBuilder({ team: primeTeam, honor: primeHonor, stats: primeStats });
  } else if (bestSeason) {
    const team = normalizeTeam(bestSeason?.team || bestSeason?.teamName);
    const stats = roundedStatMemory(bestSeason, player);
    if (team || stats) {
      const fallbackMemories = [
        () => `I am especially proud of the stretch${team ? ` with the ${team}` : ""}${stats ? ` when I was playing at around ${stats}` : ""}.`,
        () => `When I look back at my best basketball${team ? `, a lot of it happened with the ${team}` : ""}${stats ? `, where I was around ${stats}` : ""}.`,
        () => `I will remember the seasons${team ? ` with the ${team}` : ""} when my game was at its sharpest${stats ? ` and I was giving them ${stats}` : ""}.`,
        () => `The part of the career I will miss most is being at my best${team ? ` with the ${team}` : ""}${stats ? `, playing at roughly ${stats}` : ""}.`,
        () => `I got to experience what it feels like to find your game at the NBA level${team ? ` with the ${team}` : ""}${stats ? `, when I was around ${stats}` : ""}, and I will never forget that.`,
        () => `My best stretch${team ? ` came with the ${team}` : ""}${stats ? `, when I was producing about ${stats}` : ""}, and that is the version of myself I will remember.`,
      ];
      const memoryBuilder = pickNarrative(fallbackMemories, seed, 6);
      if (memoryBuilder) fallbackMemory = memoryBuilder();
    }
  }

  // Vary both wording AND structure. Some players are reflective, some are concise,
  // some remember their prime before talking about the end. A title memory stays last.
  const structureMode = hashNarrativeSeed(`${seed}|structure`) % 6;
  let pieces = [];
  const memory = primeMemory || fallbackMemory;

  if (titleMemory) {
    // When a title came after a player's real prime somewhere else, always preserve
    // BOTH chapters: the peak years and the championship memory. Only the order/
    // amount of general reflection varies.
    if (memory) {
      if (structureMode === 0) pieces = [opening, reflection, memory, titleMemory];
      else if (structureMode === 1) pieces = [opening, memory, titleMemory];
      else if (structureMode === 2) pieces = [opening, memory, reflection, titleMemory];
      else if (structureMode === 3) pieces = [opening, memory, titleMemory];
      else if (structureMode === 4) pieces = [opening, reflection, memory, titleMemory];
      else pieces = [opening, memory, reflection, titleMemory];
    } else {
      pieces = structureMode % 2 === 0 ? [opening, reflection, titleMemory] : [opening, titleMemory];
    }
  } else if (memory) {
    if (structureMode === 0 || structureMode === 3) pieces = [opening, reflection, memory];
    else if (structureMode === 1 || structureMode === 4) pieces = [opening, memory];
    else pieces = [opening, memory, reflection];
  } else {
    pieces = structureMode % 2 === 0 ? [opening, reflection] : [opening];
  }

  return pieces.map(cleanFinalSentence).filter(Boolean).join(" ");
}

export function buildRetirementAccomplishments(player, leagueData = null) {
  const groups = groupedHonors(player);
  const titles = championshipRows(player, leagueData);
  const items = [];

  // Championships are listed individually so the year and team are never lost.
  for (const row of titles) items.push(formatChampionship(row));

  for (const group of groups) {
    if (group.kind === "champion") continue;
    const text = formatGroupedHonor(group);
    if (text) items.push(text);
  }

  const seasons = seasonRows(player);
  const seasonYears = [...new Set(seasons.map(yearOf).filter(Boolean))];
  const seasonCount = seasonYears.length || seasons.length;
  const totalGames = seasons.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.games ?? row?.gp)), 0);
  const bestSeason = [...seasons].sort((a, b) => productionValue(b) - productionValue(a))[0] || null;

  if (seasonCount > 0) items.push(`${seasonCount} NBA season${seasonCount === 1 ? "" : "s"}`);
  if (totalGames > 0) items.push(`${Math.round(totalGames)} career games`);

  if (bestSeason) {
    const year = yearOf(bestSeason);
    const team = normalizeTeam(bestSeason?.team || bestSeason?.teamName);
    const line = formatStatLine(bestSeason);
    if (line) items.push(`Peak season${year ? ` (${year})` : ""}${team ? ` — ${team}` : ""}: ${line}`);
  }

  const cleaned = [];
  const seen = new Set();
  for (const item of items) {
    const text = cleanInline(item)
      .replace(/\bnba\b/gi, "NBA")
      .replace(/\ball nba\b/gi, "All-NBA")
      .replace(/\ball star\b/gi, "All-Star");
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
  }

  return cleaned.length ? cleaned : ["No major recorded career honors."];
}

export function buildRetirementNarrativeSnapshot(players, leagueData = null) {
  const map = {};
  for (const player of Array.isArray(players) ? players : []) {
    const key = getRetirementNarrativeKey(player);
    map[key] = {
      reason: buildRetirementReason(player, leagueData),
      accomplishments: buildRetirementAccomplishments(player, leagueData),
    };
  }
  return map;
}
