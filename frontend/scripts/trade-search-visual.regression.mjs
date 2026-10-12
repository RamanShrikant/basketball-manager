import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tradeSearchContractDisplay, tradeSearchPlayerMeta } from "../src/utils/tradeSearchPresentation.js";

const year2026 = { seasonYear: 2026 };
const example = { pos: "PG", age: 27, contract: { startYear: 2026, salaryByYear: [12_000_000, 13_000_000, 14_000_000] } };
const info = tradeSearchContractDisplay(example, year2026);
assert.equal(info.years, 3);
assert.equal(info.total, 39_000_000);
assert.match(info.annual, /26\/27 \$12M · 27\/28 \$13M · 28\/29 \$14M/);
assert.equal(info.average, "Avg. $13M/yr");
assert.match(info.summary, /3Y left · \$39M left/);
assert.equal(tradeSearchPlayerMeta(example), "PG · Age 27");

const rolled = tradeSearchContractDisplay({ contract: { startYear: 2024, salaryByYear: [10e6, 11e6, 12e6, 13e6] } }, year2026);
assert.equal(rolled.years, 2);
assert.equal(rolled.total, 25e6);
assert.match(rolled.annual, /^26\/27 \$12M/);
assert.equal(rolled.average, "Avg. $12.5M/yr");

const legacyOneYear = tradeSearchContractDisplay({ contract: { startYear: 2025, salaryByYear: [4e6] } }, year2026);
assert.match(legacyOneYear.annual, /^26\/27 \$4M/);
assert.equal(legacyOneYear.years, 1);
assert.equal(legacyOneYear.average, "Avg. $4M/yr");

const fa = tradeSearchContractDisplay({ contract: { startYear: 2026, salaryByYear: [50e6] } }, year2026, true);
assert.match(fa.summary, /Free agent/);
assert.equal(fa.annual, "");
assert.equal(fa.average, "Unsigned");

const legacy = tradeSearchContractDisplay({ salary: 5e6, yearsLeft: 3 }, year2026);
assert.match(legacy.summary, /3Y left/);
assert.match(legacy.annual, /not recorded/);
assert.equal(legacy.total, null); // do NOT invent 3 x AAV.
assert.equal(legacy.average, "Current $5M/yr");

const trades = readFileSync(new URL("../src/pages/Trades.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/pages/Trades.css", import.meta.url), "utf8");
assert.match(trades, /className="trade-search-player-row/);
assert.match(trades, /<PlayerRatingRing overall=\{overall\} potential=\{potential\}/);
assert.match(trades, /tradeSearchPlayerMeta\(result\.player\)/);
assert.match(trades, /tradeSearchContractDisplay\(result\.player, leagueData, isFreeAgent\)/);
assert.match(trades, /trade-search-team-logo-bg/);
assert.match(trades, /trade-search-contract-average/);
assert.match(trades, /object-contain object-bottom/);
assert.match(trades, /setSearchPlayerCard\(result\)/);
assert.match(css, /\.trade-search-player-row\s*\{/);
assert.match(css, /\.trade-search-contract-average\s*\{/);
assert.match(css, /\.trade-search-player-row \+ \.trade-search-player-row/);
assert.match(css, /inset:\s*0;/);
assert.match(css, /min-height:\s*56px/);
console.log("Trade Search visual and contract regression: PASS");
