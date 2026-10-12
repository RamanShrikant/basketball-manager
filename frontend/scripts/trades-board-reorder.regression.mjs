// Read-only regression for Trades overview block order. No game data used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../src/pages/Trades.jsx"), "utf8");
const findOnce = (text) => {
  const at = src.indexOf(text);
  assert.ok(at >= 0, `Missing: ${text.slice(0, 80)}`);
  assert.equal(src.indexOf(text, at + 1), -1, `Duplicated: ${text.slice(0, 80)}`);
  return at;
};
const firstDiv = (anchor, token = '                <div className="mt-3 grid grid-cols-2 gap-2.5">') => {
  const at = findOnce(anchor);
  const start = src.lastIndexOf(token, at);
  assert.ok(start >= 0, `No wrapping container for ${anchor}`);
  return start;
};
const pAction = firstDiv('onClick={() => !tradeWindowLocked && navigate("/propose-trade")}');
const pLock = findOnce('                {tradeWindowLocked && <div');
const pDepth = findOnce('                <div className="mt-3 rounded-[16px]');
const pCap = src.lastIndexOf('                <div ref={tradeOverviewPairRef} className=', findOnce('className="mt-3 grid grid-cols-2 items-start gap-2.5 bm-tco-pair"'));
const pEnd = src.indexOf('              </div>\n            </section>\n\n            <section className="trade-center-panel', pCap);
assert.ok(pAction < pLock && pLock < pDepth && pDepth < pCap && pCap < pEnd, 'Trade dashboard blocks are out of order');
const segments = {
  action: src.slice(pAction, pLock),
  lock: src.slice(pLock, pDepth),
  depth: src.slice(pDepth, pCap),
};
const expected = {"action": "1bbd40d2defc96a3bdf342bea4e7b3464b1fa83229f26a85b3526f0e2588b315", "lock": "c49f3c21662e1d2747d5f57ddceb1e5caebc227327eb3214dd0c58d05b8fd1e3", "depth": "6db0d647702fae98bc95273291021bca5851b5a5b602d9d57acf2b1726783ede"};
for (const [name, value] of Object.entries(segments)) {
  const hash = createHash("sha256").update(value).digest("hex");
  assert.equal(hash, expected[name], `${name} block changed from the original — expected only a reorder`);
}
for (const token of [
  'onClick={() => !tradeWindowLocked && navigate("/propose-trade")}',
  'onClick={() => !tradeWindowLocked && navigate("/trade-finder")}',
  'disabled={tradeWindowLocked}',
  'onClick={() => setContextDetail({ type: "position", key: row.key, label: row.label })}',
  'onClick={() => setContextDetail({ type: "pick", key: row.key, label: row.label })}',
  "Open Salary Table",
  "Open Contract Extensions",
  "aria-expanded={openOverview.cap}",
  "aria-expanded={openOverview.expiring}",
  'League Rumor Board',
  'trade-search-player-row',
]) assert.ok(src.includes(token), `Preserved interaction missing: ${token}`);
console.log("PASS: trade actions > position depth > pick depth > cap/expiring");
console.log("PASS: action/lock/depth blocks unchanged; Cap/Expiring cards intentionally expanded; search/rumor board intact");
