export const MAX_LEAGUE_SAVE_SLOTS = 10;

export function normalizeLeagueSaveSlotIndex(value, maxSlots = MAX_LEAGUE_SAVE_SLOTS) {
  if (value === null || value === undefined || value === "") return null;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= Number(maxSlots || 0)) return null;
  return index;
}

export function assignLeagueSaveSlotIndexes(records = [], maxSlots = MAX_LEAGUE_SAVE_SLOTS) {
  const limit = Math.max(1, Number(maxSlots || MAX_LEAGUE_SAVE_SLOTS));
  const input = Array.isArray(records) ? records : [];
  const used = new Set();
  const assigned = [];
  const pending = [];

  for (const record of input) {
    if (!record || typeof record !== "object") continue;
    const slotIndex = normalizeLeagueSaveSlotIndex(record.slotIndex, limit);
    if (slotIndex !== null && !used.has(slotIndex)) {
      used.add(slotIndex);
      assigned.push({ ...record, slotIndex });
    } else {
      pending.push(record);
    }
  }

  pending.sort((a, b) => {
    const aTime = Date.parse(a?.createdAt || a?.updatedAt || 0) || 0;
    const bTime = Date.parse(b?.createdAt || b?.updatedAt || 0) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a?.saveId || "").localeCompare(String(b?.saveId || ""));
  });

  for (const record of pending) {
    let slotIndex = null;
    for (let index = 0; index < limit; index += 1) {
      if (!used.has(index)) {
        slotIndex = index;
        used.add(index);
        break;
      }
    }
    assigned.push({ ...record, slotIndex });
  }

  return assigned.sort((a, b) => {
    const ai = normalizeLeagueSaveSlotIndex(a?.slotIndex, limit);
    const bi = normalizeLeagueSaveSlotIndex(b?.slotIndex, limit);
    if (ai !== null && bi !== null) return ai - bi;
    if (ai !== null) return -1;
    if (bi !== null) return 1;
    return (Date.parse(b?.updatedAt || 0) || 0) - (Date.parse(a?.updatedAt || 0) || 0);
  });
}

export function findFirstAvailableLeagueSaveSlot(records = [], maxSlots = MAX_LEAGUE_SAVE_SLOTS) {
  const limit = Math.max(1, Number(maxSlots || MAX_LEAGUE_SAVE_SLOTS));
  const used = new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => normalizeLeagueSaveSlotIndex(record?.slotIndex, limit))
      .filter((value) => value !== null)
  );

  for (let index = 0; index < limit; index += 1) {
    if (!used.has(index)) return index;
  }
  return null;
}

export function buildVisibleLeagueSaveSlots(records = [], maxSlots = MAX_LEAGUE_SAVE_SLOTS) {
  const limit = Math.max(1, Number(maxSlots || MAX_LEAGUE_SAVE_SLOTS));
  const assigned = assignLeagueSaveSlotIndexes(records, limit);
  const byIndex = new Map();
  for (const record of assigned) {
    const index = normalizeLeagueSaveSlotIndex(record?.slotIndex, limit);
    if (index !== null && !byIndex.has(index)) byIndex.set(index, record);
  }
  return Array.from({ length: limit }, (_, slotIndex) => ({
    slotIndex,
    save: byIndex.get(slotIndex) || null,
  }));
}
