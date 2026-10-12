/**
 * LEAGUE INTEL — MANUAL VISUAL CONTROLS (CSS/VIEW ONLY)
 *
 * Edit ONLY the section you want to move. Save and Vite refreshes instantly.
 * These settings never change saved league data, actual portraits or gameplay.
 *
 *   x:     + right, - left                (reference-pixel offsets)
 *   y:     + down,  - up                  (reference-pixel offsets)
 *   scale: 1 normal, 1.10 = 10% bigger, 0.90 = 10% smaller
 *
 * Positions scale with the card's width, so laptop and desktop layout stay
 * proportionate. You only need ONE set of numbers for each section.
 *
 * BORDER CONTROLS:
 *   headshot.borderWidth 0 = unboxed portraits (default), 1+ adds outline.
 *   ring.strokeWidth    thickness of the Roster View orange/POT SVG ring.
 *   card.borderWidth    card outline thickness (in px).
 *   starters.divider.borderWidth  gray line separating portrait and name.
 *   teamNeeds.pickLogo.x/y/scale    adjust the pick-origin logo independently.
 *   teamNeeds.pickLogo.opacity      0 transparent, 1 fully visible.
 *
 * ringText:  move/scale the INSIDE text without moving the orange SVG circle.
 * ringLabel: fine-tune the top OVR letters alone.
 * ringValue: fine-tune the large rating number alone.
 * ringPot:   fine-tune the bottom POT line alone.
 * STARTER NAME CENTRING: Your existing name.x=45 is PRESERVED and is now
 *   the centred reference point. Changing it ±10 nudges from true centre;
 *   longer names automatically shrink to fit the name strip on laptops.
 *
 * position/age: independently move or scale the PG/SG/etc and age metadata.
 *              The starter position label is controlled by starters.position.
 *              Only metadata that exists in the saved roster is shown.
 * SECTIONS BELOW (independent): starters, scoutingRows, targetsRows,
 * teamNeedsPlayers, teamNeeds (draft picks), expiringDeals, fullRoster.
 * Team Needs PLAYERS mirrors the scouting-row component with its own copied
 * controls. The original teamNeeds settings remain for PICKS unchanged.
 * Targets also gets its own section for low-opacity source-team logo pills.
 * Neither setting affects the Salary Table.
 *
 * Do NOT put these numbers in headshotLayout.js: that file has finalized
 * manual settings for the Salary Table and other game screens.
 */
export const LEAGUE_INTEL_LAYOUT = {
  // ============= 1. STARTERS / PROJECTED LINEUP =============
  starters: {
    headshot: { x: 15, y: -2.6, scale: 1, borderWidth: 0 },
    name:     { x: 45, y: 0, scale: 1 },
    ring:     { x: 15, y: -35, scale: 0.7, strokeWidth: 8 },
    ringText: { x: 0, y: 0, scale: 1 }, // move all OVR / rating / POT text together
    ringLabel: { x: 0, y: 0, scale: 1 }, // OVR label only
    ringValue: { x: 0, y: 0, scale: 1 }, // large number only
    ringPot: { x: 0, y: 0, scale: 1 }, // POT value/label together
    card:     { borderWidth: 1 },
    divider:  { borderWidth: 1 },
    position: { x: 0, y: 0, scale: 1 }, // PG / SG / SF / PF / C label
  },
  // ============= 2. PROTECTED / AVAILABLE / TARGETS =============
  scoutingRows: {
    headshot: { x: 20, y: 10, scale: 1.7, borderWidth: 0 },
    name:     { x: 40, y: 0, scale: 1 },
    ring:     { x: 25, y: -5, scale: 1.1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 0.8 }, // entire inner text block
    ringLabel: { x: 0, y: 0, scale: 1 }, // OVR label
    ringValue: { x: 0, y: 0, scale: 1 }, // large OVR number
    ringPot: { x: 0, y: 0, scale: 1 }, // POT label/value
    card:     { borderWidth: 1 },
    position: { x: 40, y: 0, scale: 1 }, // metadata position only
    age:      { x: 40, y: 0, scale: 1 }, // metadata age only
  },
  // ============= 2B. TARGETS (own logo-watermark controls) =============
  // Copied from scoutingRows so Targets can be tuned independently.
  targetsRows: {
    headshot: { x: 20, y: 10, scale: 1.7, borderWidth: 0 },
    name:     { x: 40, y: 0, scale: 1 },
    ring:     { x: 25, y: -5, scale: 1.1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 0.8 },
    ringLabel: { x: 0, y: 0, scale: 1 },
    ringValue: { x: 0, y: 0, scale: 1 },
    ringPot: { x: 0, y: 0, scale: 1 },
    card:     { borderWidth: 1 },
    position: { x: 40, y: 0, scale: 1 },
    age:      { x: 40, y: 0, scale: 1 },
    teamLogo: { x: 0, y: 0, scale: 1, opacity: 0.16 },
  },
  // ============= 3A. TEAM NEEDS: PLAYERS =============
  // Exact visual preset copied from scoutingRows. Changes to these values
  // affect ONLY your two Team Needs player rows, never Protected/Available/Targets.
  teamNeedsPlayers: {
    headshot: { x: 20, y: 10, scale: 1.7, borderWidth: 0 },
    name:     { x: 40, y: 0, scale: 1 },
    ring:     { x: 25, y: -5, scale: 1.1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 0.8 },
    ringLabel: { x: 0, y: 0, scale: 1 },
    ringValue: { x: 0, y: 0, scale: 1 },
    ringPot: { x: 0, y: 0, scale: 1 },
    card:     { borderWidth: 1 },
    position: { x: 40, y: 0, scale: 1 },
    age:      { x: 40, y: 0, scale: 1 },
  },
  // ============= 3B. TEAM NEEDS: PICKS (original controls kept) =============
  teamNeeds: {
    headshot: { x: 0, y: 0, scale: 1.7, borderWidth: 0 },
    name:     { x: 30, y: 0, scale: 1 },
    ring:     { x: 30, y: 0, scale: 1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 1 }, // entire inner text block
    ringLabel: { x: 0, y: 0, scale: 1 }, // OVR label
    ringValue: { x: 0, y: 0, scale: 1 }, // large OVR number
    ringPot: { x: 0, y: 0, scale: 1 }, // POT label/value
    card:     { borderWidth: 1 },
    pickLogo: { x: 0, y: 0, scale: 1.4, opacity: 0.36 },
    position: { x: 30, y: 0, scale: 1 }, // metadata position only
    age:      { x: 30, y: 0, scale: 1 }, // metadata age only
  },
  // ============= 4. EXPIRING CONTRACTS =============
  expiringDeals: {
    headshot: { x: 0, y: 0, scale: 1, borderWidth: 0 },
    name:     { x: 0, y: 0, scale: 1 },
    ring:     { x: 0, y: 0, scale: 1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 1 }, // entire inner text block
    ringLabel: { x: 0, y: 0, scale: 1 }, // OVR label
    ringValue: { x: 0, y: 0, scale: 1 }, // large OVR number
    ringPot: { x: 0, y: 0, scale: 1 }, // POT label/value
    card:     { borderWidth: 1 },
    position: { x: 0, y: 0, scale: 1 }, // metadata position only
    age:      { x: 0, y: 0, scale: 1 }, // metadata age only
  },
  // ============= 5. FULL ROSTER POPUP =============
  fullRoster: {
    headshot: { x: 0, y: 0, scale: 1, borderWidth: 0 },
    name:     { x: 0, y: 0, scale: 1 },
    ring:     { x: 0, y: 0, scale: 1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 1 }, // entire inner text block
    ringLabel: { x: 0, y: 0, scale: 1 }, // OVR label
    ringValue: { x: 0, y: 0, scale: 1 }, // large OVR number
    ringPot: { x: 0, y: 0, scale: 1 }, // POT label/value
    card:     { borderWidth: 1 },
    position: { x: 0, y: 0, scale: 1 }, // metadata position only
    age:      { x: 0, y: 0, scale: 1 }, // metadata age only
  },
};

// Desktop-reference card widths. Smaller cards scale all x/y values down
// proportionally using CSS container query units (Chrome / modern browsers).
const REFERENCE_WIDTH = {
  starters: 185,
  scoutingRows: 310,
  targetsRows: 310,
  teamNeedsPlayers: 310,
  teamNeeds: 310,
  expiringDeals: 310,
  fullRoster: 600,
};

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function transformFor(layer, width) {
  const data = layer || {};
  const x = (100 * numberOr(data.x, 0)) / width;
  const y = (100 * numberOr(data.y, 0)) / width;
  const scale = Math.max(0.1, numberOr(data.scale, 1));
  return `translate(${x}cqw, ${y}cqw) scale(${scale})`;
}

export function leagueIntelTuningVars(section) {
  const key = Object.hasOwn(REFERENCE_WIDTH, section) ? section : "starters";
  const block = LEAGUE_INTEL_LAYOUT[key];
  const width = REFERENCE_WIDTH[key];
  return {
    "--bm-il-headshot-tune": transformFor(block.headshot, width),
    "--bm-il-name-tune": transformFor(block.name, width),
    "--bm-il-position-tune": transformFor(block.position, width),
    "--bm-il-age-tune": transformFor(block.age, width),
    "--bm-il-rating-tune": transformFor(block.ring, width),
    "--bm-il-ring-text-tune": transformFor(block.ringText, width),
    "--bm-il-ring-label-tune": transformFor(block.ringLabel, width),
    "--bm-il-ring-value-tune": transformFor(block.ringValue, width),
    "--bm-il-ring-pot-tune": transformFor(block.ringPot, width),
    // Name X=45 is the original user's visual centred baseline, NOT reset.
    // For starter names only, use it as a nudge from true centred alignment.
    "--bm-il-starter-name-shift": `translate(${(100 * (numberOr(block.name?.x, 45) - 45)) / width}cqw, ${(100 * numberOr(block.name?.y, 0)) / width}cqw)`,
    "--bm-il-starter-name-user-scale": Math.max(0.1, numberOr(block.name?.scale, 1)),
    "--bm-il-headshot-border-width": `${Math.max(0, numberOr(block.headshot.borderWidth, 0))}px`,
    "--bm-il-card-border-width": `${Math.max(0, numberOr(block.card.borderWidth, 1))}px`,
    "--bm-il-divider-border-width": `${Math.max(0, numberOr(block.divider?.borderWidth, 1))}px`,
    "--bm-il-pick-logo-tune": transformFor(block.pickLogo, width),
    "--bm-il-pick-logo-opacity": Math.max(0, Math.min(1, numberOr(block.pickLogo?.opacity, .36))),
    "--bm-il-target-logo-tune": transformFor(block.teamLogo, width),
    "--bm-il-target-logo-opacity": Math.max(0, Math.min(1, numberOr(block.teamLogo?.opacity, .16))),
  };
}


/** Ring circumference width from the shared Roster View SVG component. */
export function leagueIntelRingStrokeWidth(section) {
  const settings = LEAGUE_INTEL_LAYOUT[section] || LEAGUE_INTEL_LAYOUT.scoutingRows;
  return Math.max(0, numberOr(settings?.ring?.strokeWidth, 7));
}


/** Pure, UI-only fit calculation for exceptionally long starter names.
 * The caller measures the natural (untransformed) text width; this helper
 * never changes text content, saved players, team data or shared components.
 */
export function fitIntelStarterNameScale(availableWidth, naturalTextWidth, manualScale = 1) {
  const usable = Math.max(1, numberOr(availableWidth, 1));
  const needed = Math.max(1, numberOr(naturalTextWidth, 1));
  const userScale = Math.max(0.1, numberOr(manualScale, 1));
  return Math.min(1, usable / (needed * userScale));
}
