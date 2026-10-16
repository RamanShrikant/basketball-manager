import fs from "node:fs";
import path from "node:path";
import {
  auditPostRookieRights,
  consumePostRookieRightsForPlayer,
  getPostRookieRightsDiagnosis,
  normalizePostRookieExtensionRights,
  POST_ROOKIE_RIGHTS_MIGRATION_KEY,
} from "../src/utils/postRookieRightsNormalization.js";

let pass = 0;
let fail = 0;
function check(ok, name, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function player(overrides = {}) {
  return {
    id: "test-player",
    name: "Test Player",
    age: 23,
    overall: 85,
    potential: 90,
    rights: {
      heldByTeam: "Orlando Magic",
      seasonsTowardBird: 3,
      birdLevel: "bird",
      rookieScale: true,
      restrictedFreeAgent: false,
    },
    meta: {
      draftYear: 2022,
      draftRound: 1,
      proSeasons: 4,
      yearsWithCurrentTeam: 4,
    },
    contract: {
      startYear: 2026,
      salaryByYear: [41_240_250, 44_539_470, 47_838_690, 51_137_910, 54_437_130],
      option: null,
    },
    ...overrides,
  };
}

// Paolo-style seeded extension.
const paolo = player({ name: "Paolo Banchero" });
const paoloBefore = getPostRookieRightsDiagnosis(paolo);
check(paoloBefore.staleRookieControl === true, "Paolo-style extension detected as stale rookie control");
const paoloFix = consumePostRookieRightsForPlayer(paolo);
check(paoloFix.changed === true, "Paolo-style rights repaired");
check(paolo.rights.rookieScale === false, "Paolo-style rookieScale consumed");
check(paolo.rights.restrictedFreeAgent === false, "Paolo-style RFA cleared");
check(paolo.meta.rookieRightsConsumed === true, "Paolo-style consumed marker stored");

// Final rookie year with no extension must remain under rookie control.
const anthony = player({
  name: "Anthony Black",
  meta: { draftYear: 2023, draftRound: 1, proSeasons: 3, yearsWithCurrentTeam: 3 },
  contract: { startYear: 2026, salaryByYear: [10_106_316], option: null },
});
const anthonyBefore = getPostRookieRightsDiagnosis(anthony);
check(anthonyBefore.staleRookieControl === false, "True final rookie year is not misclassified");
check(consumePostRookieRightsForPlayer(anthony).changed === false, "True rookie control remains intact");
check(anthony.rights.rookieScale === true, "Final rookie-year player stays rookieScale");

// Embedded extension: final rookie year + future extension years.
const wemby = player({
  name: "Victor Wembanyama",
  meta: { draftYear: 2023, draftRound: 1, proSeasons: 3, yearsWithCurrentTeam: 3 },
  contract: { startYear: 2026, salaryByYear: [16_868_246, 43_500_000, 46_980_000, 50_460_000, 53_940_000], option: null },
});
check(getPostRookieRightsDiagnosis(wemby).staleRookieControl === true, "Embedded rookie extension detected");
check(consumePostRookieRightsForPlayer(wemby).changed === true, "Embedded extension consumes rookie control");

// Already-entered FA with stale QO state and a previous post-rookie contract.
const staleFa = player({
  name: "Expired Extension FA",
  contract: null,
  previousContract: {
    startYear: 2026,
    salaryByYear: [30_000_000, 32_000_000, 34_000_000, 36_000_000],
  },
  qualifyingOffer: { teamName: "Orlando Magic", amount: 40_000_000 },
  qualifyingOfferEligible: { status: "pending", amount: 40_000_000 },
  rights: {
    heldByTeam: "Orlando Magic",
    seasonsTowardBird: 3,
    birdLevel: "bird",
    rookieScale: true,
    restrictedFreeAgent: true,
  },
});
check(consumePostRookieRightsForPlayer(staleFa).changed === true, "Already-entered stale RFA repaired from previous contract");
check(!staleFa.qualifyingOffer && !staleFa.qualifyingOfferEligible, "Stale QO metadata removed");
check(staleFa.rights.restrictedFreeAgent === false, "Stale FA no longer RFA");

// One-time league migration should repair once and then become O(1) on later normalizations.
const migrationLeague = {
  conferences: {
    East: [{ name: "Orlando Magic", players: [player({ name: "Migration Paolo" }), anthony] }],
  },
  freeAgents: [],
};
const firstMigration = normalizePostRookieExtensionRights(migrationLeague);
check(firstMigration.repaired.length === 1, "One-time migration repairs only stale post-rookie player");
check(Boolean(migrationLeague.dataMigrations?.[POST_ROOKIE_RIGHTS_MIGRATION_KEY]), "Migration version marker stored");
const secondMigration = normalizePostRookieExtensionRights(migrationLeague);
check(secondMigration.repaired.length === 0, "Subsequent normalization skips full migration scan");

// Optional shipped-roster audit when the source JSON exists.
const candidates = [
  path.resolve(process.cwd(), "../deflation fc PATCH31.json"),
  path.resolve(process.cwd(), "deflation fc PATCH31.json"),
];
const rosterPath = candidates.find((candidate) => fs.existsSync(candidate));
if (rosterPath) {
  const league = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const before = auditPostRookieRights(league);
  const beforePaolo = before.find((row) => row.playerName === "Paolo Banchero");
  check(beforePaolo?.staleRookieControl === true, "Shipped Paolo seed reproduces stale rookie control");

  const migrated = normalizePostRookieExtensionRights(league, { force: true });
  const after = auditPostRookieRights(league);
  const afterPaolo = after.find((row) => row.playerName === "Paolo Banchero");
  check(migrated.repaired.some((row) => row.playerName === "Paolo Banchero"), "Shipped Paolo repaired by migration");
  check(afterPaolo?.staleRookieControl !== true && afterPaolo?.rightsRookieScale === false, "Shipped Paolo no longer carries rookie-scale control");
  console.log(`INFO  Shipped roster stale post-rookie rights repaired: ${migrated.repaired.length}`);
}

console.log(`\nPost-rookie rights regression: ${pass}/${pass + fail} PASS`);
if (fail) process.exit(1);
