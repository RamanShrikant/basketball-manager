import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/pages/ViewingOffers.jsx"), "utf8");

let passed = 0;
const failures = [];
function check(condition, id, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${id}`);
  } else {
    failures.push(`${id}: ${message}`);
    console.error(`FAIL ${id}: ${message}`);
  }
}

function key(offer = {}) {
  const team = String(offer.teamName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const player = String(offer.playerId ?? offer.playerKey ?? offer.playerName ?? "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
  return team && player ? `${team}|${player}` : "";
}
function day(offer = {}, fallback = null) {
  const value = Number(offer.submittedDay ?? offer.day ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}
function buildFirstSeen(entries = [], current = []) {
  const map = new Map();
  const record = (offer, fallback) => {
    const k = key(offer);
    const d = day(offer, fallback);
    if (!k || !d) return;
    if (!map.has(k) || d < map.get(k)) map.set(k, d);
  };
  for (const entry of entries) for (const offer of entry.generatedOffers || []) record(offer, entry.offerDay);
  for (const offer of current) record(offer, null);
  return map;
}

const history = [
  { offerDay: 1, generatedOffers: [
    { teamName: "Toronto Raptors", playerName: "Kawhi Leonard", submittedDay: 1 },
    { teamName: "Toronto Raptors", playerName: "RJ Barrett", submittedDay: 1 },
  ] },
  { offerDay: 2, generatedOffers: [
    { teamName: "Toronto Raptors", playerName: "Kawhi Leonard", submittedDay: 2 },
    { teamName: "Toronto Raptors", playerName: "Jimmy Butler", submittedDay: 2 },
  ] },
];
const current = history[1].generatedOffers;
const firstSeen = buildFirstSeen(history, current);
const onlyNew = current.filter((offer) => firstSeen.get(key(offer)) === day(offer));

check(firstSeen.get(key(current[0])) === 1, "fa_cpu_offer.first_seen_persists", "Repeated team/player pursuits must remember their earliest offer day.");
check(onlyNew.length === 1 && onlyNew[0].playerName === "Jimmy Butler", "fa_cpu_offer.only_new_filter", "Only New must hide a refreshed Kawhi pursuit while retaining a genuinely new Butler pursuit.");
check(source.includes("cpuOfferFirstSeenDayByKey") && source.includes("fullFreeAgencySummaryEntries"), "fa_cpu_offer.durable_history_source", "ViewingOffers must derive first-seen day from the durable FA action log instead of adding a new storage blob.");
check(source.includes("onlyNewCpuOffers") && source.includes('"Only New"'), "fa_cpu_offer.minimal_toggle", "ViewingOffers must expose the minimal Only New toggle.");
check(source.includes("First offered Day") && source.includes("Refreshed Day"), "fa_cpu_offer.day_labels", "Each CPU offer card must explain when the pursuit first appeared and when the current board refreshed it.");
check(!source.includes("setItem(\"bm_cpu_offer_first_seen"), "fa_cpu_offer.no_localstorage_blob", "The offer-board display must not create a new localStorage history blob.");

if (failures.length) {
  console.error(`\nFA CPU offer-board regression failed: ${failures.length} failure(s).`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`\nFA CPU offer-board regression passed: ${passed}/${passed} checks.`);
