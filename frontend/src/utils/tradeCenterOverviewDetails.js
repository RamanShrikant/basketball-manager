/** Read-only, saved-contract display helpers for the Trade Center's expandable
 *  Cap Outlook / Expiring Contracts panels. Never modify the player or league. */
function validAmount(raw) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function validYear(raw) {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2020 && year <= 2150 ? year : null;
}
export function tradeCenterContractOption(player = {}, currentYear = 2026) {
  const contract = player.contract && typeof player.contract === 'object' ? player.contract : {};
  const option = contract.option && typeof contract.option === 'object' ? contract.option : null;
  if (!option) return null;
  const type = String(option.type || '').toLowerCase();
  if (type !== 'player' && type !== 'team') return null;
  // A decided option is not a current pending decision.
  if (option.picked != null) return null;
  const yearIndices = Array.isArray(option.yearIndices) ? option.yearIndices :
    (option.yearIndex != null ? [option.yearIndex] : []);
  const startYear = validYear(contract.startYear) ?? currentYear;
  const nextIndex = yearIndices.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && startYear + i >= currentYear).sort((a, b) => a - b)[0];
  if (nextIndex == null) return null;
  const year = startYear + nextIndex;
  return { type, label: type === 'player' ? 'Player option' : 'Team option', short: type === 'player' ? 'PO' : 'TO', year };
}
export function tradeCenterContractSnapshot(player = {}, currentYear = 2026) {
  const contract = player.contract && typeof player.contract === 'object' ? player.contract : {};
  const salaryByYear = Array.isArray(contract.salaryByYear) ? contract.salaryByYear : [];
  const startYear = validYear(contract.startYear) ?? currentYear;
  let offset = Math.max(0, currentYear - startYear);
  // Existing one-season older-save convention, also used by Trade Search.
  if (salaryByYear.length === 1 && offset === 1) offset = 0;
  const remaining = salaryByYear.slice(offset);
  const allKnown = remaining.length > 0 && remaining.every((amount) => validAmount(amount) != null);
  const remainingTotal = allKnown ? remaining.reduce((sum, amount) => sum + Number(amount), 0) : null;
  const directlyRecordedYears = Number(player.yearsLeft ?? player.contractYears);
  const yearsLeft = remaining.length || (Number.isFinite(directlyRecordedYears) && directlyRecordedYears > 0 ? Math.floor(directlyRecordedYears) : 0);
  const currentSalary = validAmount(remaining[0]) ?? validAmount(player.salary ?? player.currentSalary ?? player.contractSalary ?? player.capHit ?? player.aav);
  return {
    yearsLeft,
    currentSalary,
    remainingTotal,
    option: tradeCenterContractOption(player, currentYear),
    completeSchedule: allKnown,
  };
}
/** Status supplied exclusively by the game's extension preview. Eligibility
 *  means willing to negotiate, NOT a guaranteed signed extension. */
export function tradeCenterExtensionStatus(preview, player = {}) {
  if (!preview || !Array.isArray(preview.players)) return { label: 'Interest not assessed', code: 'unknown' };
  const playerId = player.id ?? player.playerId;
  const name = String(player.name || player.player || '').trim().toLowerCase();
  const row = preview.players.find((p) =>
    (playerId != null && p.playerId != null && String(p.playerId) === String(playerId)) ||
    (name && String(p.playerName || '').trim().toLowerCase() === name)
  );
  if (!row) return { label: 'Interest not assessed', code: 'unknown' };
  if (row.playerRefusesExtension) return { label: 'Not interested', code: 'declined' };
  if (row.eligible) return { label: 'Open to talks', code: 'open' };
  if (row.alreadyExtended || row.displayStatusCode === 'already_extended') return { label: 'Already extended', code: 'extended' };
  return { label: 'Not eligible now', code: 'unavailable' };
}
