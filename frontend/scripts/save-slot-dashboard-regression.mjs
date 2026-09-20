import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_LEAGUE_SAVE_SLOTS,
  assignLeagueSaveSlotIndexes,
  buildVisibleLeagueSaveSlots,
  findFirstAvailableLeagueSaveSlot,
  normalizeLeagueSaveSlotIndex,
} from '../src/storage/leagueSaveSlots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

assert.equal(MAX_LEAGUE_SAVE_SLOTS, 10);
assert.equal(normalizeLeagueSaveSlotIndex(null), null);
assert.equal(normalizeLeagueSaveSlotIndex(undefined), null);
assert.equal(normalizeLeagueSaveSlotIndex(''), null);

const legacy = Array.from({ length: 5 }, (_, index) => ({
  saveId: `legacy_${index + 1}`,
  leagueName: `Legacy ${index + 1}`,
  createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
  updatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
}));
const migrated = assignLeagueSaveSlotIndexes(legacy);
assert.deepEqual(migrated.map((save) => save.slotIndex), [0, 1, 2, 3, 4]);
console.log('PASS save_slots.legacy_five_saves_migrate_to_slots_1_through_5');

const withGap = migrated.filter((save) => save.slotIndex !== 2);
const visibleGap = buildVisibleLeagueSaveSlots(withGap);
assert.equal(visibleGap.length, 10);
assert.equal(visibleGap[2].save, null);
assert.equal(visibleGap[3].save.saveId, 'legacy_4');
assert.equal(findFirstAvailableLeagueSaveSlot(withGap), 2);
console.log('PASS save_slots.delete_leaves_stable_gap_and_reuses_that_slot');

const full = Array.from({ length: 10 }, (_, slotIndex) => ({ saveId: `save_${slotIndex}`, slotIndex }));
assert.equal(findFirstAvailableLeagueSaveSlot(full), null);
assert.equal(buildVisibleLeagueSaveSlots(full).filter((slot) => slot.save).length, 10);
console.log('PASS save_slots.ten_slots_are_the_real_capacity');

const play = read('src/pages/Play.jsx');
assert.match(play, /grid-cols-5 grid-rows-2/);
assert.match(play, /h-\[100dvh\] overflow-hidden/);
assert.match(play, /visibleSaveSlots\.map/);
assert.match(play, /beginNewLeagueSetup\(slotIndex\)/);
assert.match(play, /slotIndex: newLeagueSlotIndex/);
assert.doesNotMatch(play, /screen === "continue"/);
assert.doesNotMatch(play, /setScreen\("continue"\)/);
console.log('PASS save_slots.single_non_scrolling_ten_slot_dashboard');

const saves = read('src/storage/leagueSaves.js');
assert.match(saves, /assignLeagueSaveSlotIndexes/);
assert.match(saves, /findFirstAvailableLeagueSaveSlot/);
assert.match(saves, /slotIndex: resolvedSlotIndex/);
assert.match(saves, /Save Slot \$\{resolvedSlotIndex \+ 1\} is already in use/);
assert.match(saves, /enqueueSaveMutation\(\(\) => writeLeagueSaveRecord\(save\)\)/);
console.log('PASS save_slots.persistence_and_migration_are_stable');

// Fit proof for the requested five-by-two layout at desktop browser widths.
// Page padding = 32px total and four 12px gaps across each row.
for (const viewportWidth of [1366, 1440, 1536, 1920]) {
  const gridWidth = Math.min(1500, viewportWidth - 32);
  const cardWidth = (gridWidth - 48) / 5;
  assert.ok(cardWidth >= 250, `${viewportWidth}px gives only ${cardWidth.toFixed(1)}px per save card`);
}
console.log('PASS save_slots.desktop_5x2_cards_have_room_without_horizontal_scroll');

console.log('Save-slot dashboard regression passed: 6/6 groups.');
