// Online-only availability registry. A pending route is NOT a playable screen.
// Keep this list aligned with ONLINE_READ_ONLY_SCREENS in OnlineFranchise.jsx.
export const ONLINE_PENDING_VIEW_PATHS = Object.freeze([
  "/playoff-stats",
  "/locker-room",
  "/intel",
  "/upcoming-draft",
  "/award-tracker",
  "/all-stars",
  "/league-history",
  "/award-history",
  "/past-champions",
]);

const pending = new Set(ONLINE_PENDING_VIEW_PATHS);
export function isOnlinePendingView(view) {
  return pending.has(view);
}
