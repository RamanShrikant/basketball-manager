import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { getLockerRoomMoods } from "../api/simEnginePy.js";
import PageFade from "../components/PageFade";
import "../styles/BMAnimations.css";
import "../styles/BMPageBackground.css";

const LOCKER_ROOM_SCROLLBAR_STYLE = `
  .locker-room-player-scroll,
  .locker-room-detail-scroll {
    scrollbar-width: thin;
    scrollbar-color: #f97316 rgba(10, 10, 10, 0.75);
  }

  .locker-room-player-scroll::-webkit-scrollbar,
  .locker-room-detail-scroll::-webkit-scrollbar {
    width: 8px;
  }

  .locker-room-player-scroll::-webkit-scrollbar-track,
  .locker-room-detail-scroll::-webkit-scrollbar-track {
    background: rgba(8, 8, 8, 0.78);
    border-radius: 999px;
  }

  .locker-room-player-scroll::-webkit-scrollbar-thumb,
  .locker-room-detail-scroll::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #fdba74 0%, #f97316 45%, #9a3412 100%);
    border-radius: 999px;
    border: 1px solid rgba(0, 0, 0, 0.85);
    box-shadow: 0 0 10px rgba(249, 115, 22, 0.38);
  }

  .locker-room-player-scroll::-webkit-scrollbar-thumb:hover,
  .locker-room-detail-scroll::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #fed7aa 0%, #fb923c 45%, #c2410c 100%);
  }

  .locker-room-player-scroll::-webkit-scrollbar-button,
  .locker-room-detail-scroll::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }
`;

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function teamLogoOf(team) {
  return (
    team?.logo ||
    team?.teamLogo ||
    team?.newTeamLogo ||
    team?.logoUrl ||
    team?.image ||
    ""
  );
}


function readStoredGameplanForMood(teamName) {
  if (!teamName || typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(`gameplan_${teamName}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.minutes || typeof parsed.minutes !== "object") {
      return null;
    }

    return {
      teamName: parsed.teamName || teamName,
      version: parsed.version ?? null,
      source: parsed.source || "stored_gameplan",
      updatedAt: parsed.updatedAt ?? null,
      order: Array.isArray(parsed.order) ? parsed.order : [],
      minutes: parsed.minutes,
    };
  } catch (err) {
    console.warn("[LockerRoom] Could not read stored gameplan for mood:", err);
    return null;
  }
}

function buildLeagueDataWithMoodGameplan(leagueData, teamName) {
  const gameplan = readStoredGameplanForMood(teamName);
  if (!leagueData || !gameplan) return leagueData;

  return {
    ...leagueData,
    moodGameplansByTeam: {
      ...(leagueData.moodGameplansByTeam || {}),
      [teamName]: gameplan,
    },
  };
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n / 1000)}K`;
}

function moodToneClasses(tone) {
  if (tone === "elite") return "border-emerald-300/45 bg-emerald-500/15 text-emerald-100";
  if (tone === "positive") return "border-lime-300/35 bg-lime-500/10 text-lime-100";
  if (tone === "neutral") return "border-orange-300/30 bg-orange-500/10 text-orange-100";
  if (tone === "warning") return "border-amber-300/35 bg-amber-500/12 text-amber-100";
  if (tone === "negative") return "border-red-300/35 bg-red-500/12 text-red-100";
  if (tone === "critical") return "border-red-400/50 bg-red-600/18 text-red-100";
  return "border-white/10 bg-white/[0.04] text-white";
}

function factorTone(value) {
  const n = Number(value || 0);
  if (n > 0) return "text-emerald-300";
  if (n < 0) return "text-red-300";
  return "text-neutral-300";
}

function trendText(trend) {
  if (trend === "rising") return "Rising";
  if (trend === "falling") return "Falling";
  return "Stable";
}

function humanizeMoodLabel(label) {
  const source = String(label || "Mood");
  const normalized = source
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  // Header callout labels need to stay compact so they do not truncate.
  // Keep all existing sizing/position settings untouched; only shorten this label.
  if (normalized.toLowerCase() === "playing time") return "Minutes";

  return normalized;
}

function buildMoodBreakdownCallouts(player, maxItems = 3) {
  const reasonItems = Array.isArray(player?.reasons)
    ? player.reasons
        .filter((reason) => Number(reason?.impact || 0) !== 0)
        .map((reason) => ({
          label: humanizeMoodLabel(reason?.category || "Mood"),
          value: Number(reason?.impact || 0),
          detail: reason?.detail || reason?.text || "",
        }))
    : [];

  if (reasonItems.length) {
    return reasonItems
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, maxItems);
  }

  const factorItems = Object.entries(player?.factors || {})
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => ({
      label: humanizeMoodLabel(key),
      value: Number(value || 0),
      detail: "",
    }));

  return factorItems
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, maxItems);
}

function sortMoodRowsByOverall(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const overallDiff = Number(b?.overall || 0) - Number(a?.overall || 0);
    if (overallDiff !== 0) return overallDiff;

    const potentialDiff = Number(b?.potential || 0) - Number(a?.potential || 0);
    if (potentialDiff !== 0) return potentialDiff;

    return String(a?.playerName || "").localeCompare(String(b?.playerName || ""));
  });
}

function MoodRing({ score = 0, size = 116 }) {
  const safeScore = Math.max(0, Math.min(100, Number(score || 0)));
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - safeScore / 100);

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 116 116">
        <defs>
          <linearGradient id="lockerMoodGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="50%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <circle cx="58" cy="58" r={radius} stroke="rgba(255,255,255,0.10)" strokeWidth="9" fill="rgba(0,0,0,0.35)" />
        <circle
          cx="58"
          cy="58"
          r={radius}
          stroke="url(#lockerMoodGradient)"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 58 58)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-400">Mood</div>
        <div className="mt-1 text-[34px] font-black text-orange-300">{Math.round(safeScore)}</div>
      </div>
    </div>
  );
}

function OvrPill({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-center">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className="text-xl font-black text-white">{value ?? "-"}</div>
    </div>
  );
}


const LOCKER_ROOM_PLAYER_PILL_TUNING = {
  rowMinHeight: 92,
  rowPaddingX: 16,
  rowPaddingY: 14,
  rowRadius: 16,

  headshotBoxWidth: 150,
  headshotSize: 96,
  headshotX: 12,
  headshotY: 0,
  leftPad: 148,

  ringSize: 72,
  ringX: -10,
  ringY: 0,
  ringGap: 16,

  nameSize: 16,
  infoSize: 12,
  detailSize: 11,

  scorePadX: 14,
  scorePadY: 8,
  scoreRadius: 12,
};

const LOCKER_ROOM_PLAYER_LOGO_TUNING = {
  enabled: true,
  size: 280,
  opacity: 0.11,
  x: 250,
  y: 0,
  rotate: 0,
  blur: 0,
  brightness: 1.25,
  contrast: 1.12,
  saturate: 1.2,
  blendMode: "screen",
};


// ============================================================
// RIGHT-SIDE LOCKER ROOM REPORT HEADER MANUAL CONTROLS
// ============================================================
// These controls affect ONLY the big player report banner on the
// right side of the Locker Room page. They do not affect the left
// player list, mood logic, Python, or any gameplay data.
//
// IMPORTANT DESIGN FIX:
// Everything inside this header is now ABSOLUTELY POSITIONED.
// That means the headshot, the title text, the player name, and
// the grey divider bar do NOT push each other around anymore.
//
// How to use this:
// - Positive x = move right. Negative x = move left.
// - Positive y = move down. Negative y = move up.
// - Increase imageSize to make the player headshot bigger.
// - Increase reportLabel.fontSize to make "LOCKER ROOM REPORT" bigger.
// - Increase playerName.fontSize to make the player name bigger.
// - The text is forced to stay on ONE LINE with whiteSpace: "nowrap".
// - No text truncation is applied here, so letters like y/g/p should not get cut off.
const LOCKER_ROOM_REPORT_HEADER_TUNING = {
  // Outer report banner shell. This is the bordered area above Role / Contract / Stats.
  headerBox: {
    height: 260,          // Fixed header height. Increase only if you want a taller hero area.
    paddingX: 28,         // Left/right breathing room inside the banner.
    paddingTop: 24,       // Top breathing room inside the banner.
    borderRadius: 24,     // Roundness of the banner's top corners.
    overflow: "visible", // Keep visible so large text/headshots/rings do not get clipped.
  },

  // Thin grey line under the player/headshot area, similar to the RosterView card bar.
  // This now has a high zIndex so it draws OVER the headshot/rings/card layer.
  greyDividerBar: {
    x: 0,                 // Move the grey bar left/right.
    y: 0,                 // Move the grey bar up/down from the bottom edge.
    width: "100%",        // Bar width. Examples: "95%", "100%", "calc(100% - 24px)".
    height: 3,            // Bar thickness.
    opacity: 0.55,        // Bar visibility.
    color: "#ffffff",     // Bar color.
    zIndex: 30,           // Higher number = bar sits above headshot/rings/text if they overlap.
  },

  // Player face/headshot in the right report banner.
  // This is fully independent from the grey divider bar.
  faceCard: {
    boxWidth: 220,        // Invisible lane width. Increase if a big face gets cropped sideways.
    boxHeight: 230,       // Invisible lane height. Does NOT control the grey bar.
    boxX: 70,             // Move the whole headshot lane right/left.
    boxY: 20,             // Move the whole headshot lane down/up.

    imageSize: 200,       // ACTUAL headshot size. Increase this for a bigger player image.
    imageX: -45,          // Move only the headshot image right/left inside the lane.
    imageY: 6,            // Move only the headshot image down/up inside the lane.
    imageBottom: 0,       // Anchors the image from the bottom of the fixed lane.

    zIndex: 4,            // Layer order for the headshot.
    shadow: true,         // Turn headshot drop shadow on/off.
  },

  // Entire text group containing the report label + player name.
  // Move this first when you want to place the whole text block.
  textBlock: {
    x: 330,               // Move BOTH label and player name right/left together.
    y: 70,                // Move BOTH label and player name down/up together.
    width: "max-content", // Keeps text free-flowing instead of resizing itself.
    zIndex: 6,            // Higher number = sits above background logo.
  },

  // The orange "LOCKER ROOM REPORT" text above the player name.
  reportLabel: {
    fontSize: 29,         // Text size.
    x: -160,              // Move only this label right/left.
    y: -50,               // Move only this label down/up.
    lineHeight: 1.15,     // Prevents tall letters from being clipped.
    letterSpacing: "0.24em",
    whiteSpace: "nowrap", // Forces the label to stay on one line.
  },

  // Big player name in the right report banner.
  playerName: {
    fontSize: 48,         // Player name size.
    x: -110,              // Move only the name right/left.
    y: -56,               // Move only the name down/up.
    lineHeight: 1.12,     // Prevents descenders like y/g/p from getting cut off.
    marginTop: 8,         // Space between report label and player name.
    whiteSpace: "nowrap", // Keeps the name from wrapping/resizing.
  },

  // NOTE: The old right-side OVR/POT ring has been removed from this header.
  // The mood ring below now uses that same visual spot so the right header focuses on mood.

  // Mood ring on the right-side report header.
  // This replaces the old mood square with a clean green/yellow/orange ring.
  // It is fully free-positioned, so it does not affect the headshot, OVR ring, text, or grey bar.
  moodRing: {
    enabled: true,        // Set false to hide the right-side mood ring.

    // Position/size of the whole ring.
    // These start centered around the old mood-square spot, so it should land in the same area.
    x: 255,               // Move the mood ring right/left inside the header.
    y: 116,               // Move the mood ring down/up inside the header.
    size: 144,            // Whole mood ring size.
    zIndex: 8,            // Layer order for the mood ring.

    // Ring shape/visuals.
    strokeWidth: 9,       // Thickness of the mood ring.
    trackOpacity: 0.10,   // Faint empty-ring opacity.
    fillOpacity: 1,       // Filled-ring opacity.
    backgroundFill: "rgba(0,0,0,0.35)",

    // Gradient colors. Low mood starts orange, middle mood is yellow, high mood turns green.
    gradientStart: "#fb923c",
    gradientMid: "#facc15",
    gradientEnd: "#22c55e",

    // Text controls inside the ring.
    textScale: 1.1,         // Quick global text multiplier for all mood-ring text.
    labelText: "Mood",   // Label above the mood score.
    labelSize: 10,        // Label font size.
    labelX: 0,            // Move only label text right/left.
    labelY: -1,           // Move only label text down/up.
    scoreSize: 44,        // Mood score font size.
    scoreX: 0,            // Move only score text right/left.
    scoreY: 1,            // Move only score text down/up.
    showTrend: true,      // Set false if you only want the score in the ring.
    trendSize: 8,         // Trend label font size.
    trendX: 0,            // Move only trend text right/left.
    trendY: 4,            // Move only trend text down/up.
    letterSpacing: "0.16em",

    labelColor: "#d4d4d8",
    scoreColor: "#fed7aa",
    trendColor: "#d4d4d8",
  },

  // ============================================================
  // MOOD BREAKDOWN CALLOUTS (RIGHT OF THE MOOD RING)
  // ============================================================
  // Calm explanatory diagram that uses thin leader lines + soft bubbles.
  // It reads the strongest mood reasons/factors and places them to the
  // right of the mood ring so the user can quickly see how the final
  // mood score was built.
  moodBreakdown: {
    enabled: true,
    zIndex: 10,
    maxItems: 3,

    // Connection behavior.
    // true = each line automatically starts on the visible edge of the mood ring.
    // This means you can move moodRing.x / moodRing.y / moodRing.size and the
    // diagram lines will stay attached to the ring without hand-fixing anchors.
    attachLinesToMoodRing: true,
    startRadiusOffset: -4, // Negative pulls line start slightly inside the ring. Positive pushes outside.
    showAnchorDots: true,  // Small dots make it visually clear the lines belong to the ring.
    anchorDotRadius: 3,

    // Shared defaults for the three callout rectangles.
    // These are used unless an individual item below overrides them.
    bubbleWidth: 178,     // Default rectangle width.
    bubbleHeight: 42,     // Default rectangle height.
    bubbleRadius: 14,     // Default rectangle corner roundness.
    bubblePaddingX: 14,   // Default inside left/right padding.
    bubbleGap: 12,        // Default gap between label text and value text.

    elbowGap: 14,
    lineWidth: 1.5,
    positiveColor: "rgba(74, 222, 128, 0.95)",
    negativeColor: "rgba(251, 146, 60, 0.95)",
    neutralColor: "rgba(255,255,255,0.42)",

    bubbleBackground: "rgba(8,8,8,0.82)",
    bubbleBorder: "rgba(255,255,255,0.10)",
    labelColor: "#f5f5f5",
    valuePositiveColor: "#86efac",
    valueNegativeColor: "#fdba74",
    valueNeutralColor: "#d4d4d8",
    labelFontSize: 12,    // Default category text size.
    valueFontSize: 15,    // Default +/- number text size.
    detailFontSize: 9,

    // ============================================================
    // INDIVIDUAL RECTANGLE CONTROLS
    // ============================================================
    // Each object below controls ONE of the 3 callout rectangles.
    //
    // Per rectangle:
    // - bubbleX / bubbleY move that rectangle.
    // - bubbleWidth / bubbleHeight change the real box size.
    // - bubbleRadius changes corner roundness.
    // - labelFontSize changes the category text size.
    // - valueFontSize changes the +/- number text size.
    // - bubblePaddingX changes inside spacing.
    // - bubbleGap changes space between the label and number.
    // - boxScale scales width, height, padding, and text together.
    //
    // Per line / connector:
    // - lineX moves ONLY that colored line left/right. It does NOT move the rectangle.
    // - lineY moves ONLY that colored line up/down. It does NOT move the rectangle.
    // - lineStartOffsetX / lineStartOffsetY move only the small dot/start point near the ring.
    // - lineEndOffsetX / lineEndOffsetY move only where the line touches the rectangle side.
    // - lineElbowGap controls how far left the line turns before the rectangle.
    //
    // Easy examples:
    // - Want the TOP green line higher? Set the first item's lineY to -10.
    // - Want the MIDDLE orange line lower? Set the second item's lineY to 10.
    // - Want the BOTTOM green line lower? Set the third item's lineY to 10.
    //
    // To move the actual rectangles, use bubbleX / bubbleY.
    // To move only the colored connector lines, use lineX / lineY.
    // To make all 3 smaller/larger quickly, set boxScale on each item.
    // anchorDx / anchorDy are only used if attachLinesToMoodRing is false.
    items: [
      {
        anchorDx: 38,
        anchorDy: -24,
        bubbleX: 480,
        bubbleY: 116,
        bubbleWidth: 158,
        bubbleHeight: 22,
        bubbleRadius: 14,
        labelFontSize: 12,
        valueFontSize: 15,
        bubblePaddingX: 14,
        bubbleGap: 12,
        boxScale: 1,

        // Line/connector controls for this rectangle.
        // lineX / lineY move this whole colored line without moving the box.
        lineX: -11,
        lineY: 0,
        lineStartOffsetX: 0,
        lineStartOffsetY: -18,
        lineEndOffsetX: 11, // Tiny attach fix: top line now meets the Role box edge.
        lineEndOffsetY: 0,
        lineElbowGap: null,
      },
      {
        anchorDx: 48,
        anchorDy: 0,
        bubbleX: 470,
        bubbleY: 148,
        bubbleWidth: 158,
        bubbleHeight: 22,
        bubbleRadius: 14,
        labelFontSize: 12,
        valueFontSize: 15,
        bubblePaddingX: 14,
        bubbleGap: 12,
        boxScale: 1,

        // Line/connector controls for this rectangle.
        // lineX / lineY move this whole colored line without moving the box.
        lineX: 0,
        lineY: 0,
        lineStartOffsetX: 0,
        lineStartOffsetY: 0,
        lineEndOffsetX: 0,
        lineEndOffsetY: 0,
        lineElbowGap: null,
      },
      {
        anchorDx: 38,
        anchorDy: 24,
        bubbleX: 450,
        bubbleY: 190,
        bubbleWidth: 158,
        bubbleHeight: 22,
        bubbleRadius: 14,
        labelFontSize: 12,
        valueFontSize: 15,
        bubblePaddingX: 14,
        bubbleGap: 12,
        boxScale: 1,

        // Line/connector controls for this rectangle.
        // lineX / lineY move this whole colored line without moving the box.
        lineX: -25,
        lineY: 15,
        lineStartOffsetX: 0,
        lineStartOffsetY: 18,
        lineEndOffsetX: 25, // Tiny attach fix: bottom line now meets the Security box edge.
        lineEndOffsetY: 0,
        lineElbowGap: null,
      },
    ],
  },
};

function LockerRoomPillBackgroundLogo({ team }) {
  const logo = teamLogoOf(team);
  const t = LOCKER_ROOM_PLAYER_LOGO_TUNING;

  if (!t.enabled || !logo) return null;

  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 z-0 select-none object-contain"
      style={{
        width: t.size,
        height: t.size,
        opacity: t.opacity,
        transform: `translate(calc(-50% + ${t.x}px), calc(-50% + ${t.y}px)) rotate(${t.rotate}deg)`,
        filter: `blur(${t.blur}px) brightness(${t.brightness}) contrast(${t.contrast}) saturate(${t.saturate})`,
        mixBlendMode: t.blendMode,
      }}
    />
  );
}

function LockerRoomPlayerHeadshot({ row }) {
  const t = LOCKER_ROOM_PLAYER_PILL_TUNING;

  if (!row?.headshot) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 top-0 z-[2] flex items-end justify-start overflow-visible"
      style={{ width: t.headshotBoxWidth }}
      aria-hidden="true"
    >
      <img
        src={row.headshot}
        alt=""
        className="w-auto object-contain select-none"
        style={{
          height: t.headshotSize,
          transform: `translate(${t.headshotX}px, ${t.headshotY}px)`,
        }}
      />
    </div>
  );
}

function LockerRoomMiniRatingRing({ row }) {
  const t = LOCKER_ROOM_PLAYER_PILL_TUNING;
  const overall = Number(row?.overall || 0);
  const potential = Number(row?.potential || overall || 0);
  const size = t.ringSize;
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const fillPercent = Math.min(Math.max(overall, 0) / 99, 1);
  const strokeOffset = circumference * (1 - fillPercent);

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        transform: `translate(${t.ringX}px, ${t.ringY}px)`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 120 120">
        <defs>
          <linearGradient id="lockerRoomRowOvrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FFD54F" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="rgba(0,0,0,0.30)" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="url(#lockerRoomRowOvrGradient)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div className="text-[8px] font-black uppercase tracking-wide text-neutral-300">OVR</div>
        <div className="text-[28px] font-black leading-[0.9] text-orange-400">{row?.overall ?? "-"}</div>
        <div className="text-[8px] font-black uppercase text-neutral-400">
          POT <span className="text-orange-400">{potential || "-"}</span>
        </div>
      </div>
    </div>
  );
}


function LockerRoomReportMoodRing({ player, tuning }) {
  if (!tuning?.enabled) return null;

  const safeScore = Math.max(0, Math.min(100, Number(player?.moodScore || 0)));
  const size = Number(tuning.size || 114);
  const strokeWidth = Number(tuning.strokeWidth || 9);
  const radius = Math.max(10, 50 - strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - safeScore / 100);
  const textScale = Number(tuning.textScale || 1);

  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        left: tuning.x,
        top: tuning.y,
        width: size,
        height: size,
        zIndex: tuning.zIndex,
      }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 120 120">
        <defs>
          <linearGradient id="lockerRoomReportMoodGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={tuning.gradientStart || "#fb923c"} />
            <stop offset="50%" stopColor={tuning.gradientMid || "#facc15"} />
            <stop offset="100%" stopColor={tuning.gradientEnd || "#22c55e"} />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke={`rgba(255,255,255,${Number(tuning.trackOpacity ?? 0.10)})`}
          strokeWidth={strokeWidth}
          fill={tuning.backgroundFill || "rgba(0,0,0,0.35)"}
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="url(#lockerRoomReportMoodGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          opacity={Number(tuning.fillOpacity ?? 1)}
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          transform="rotate(-90 60 60)"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <div
          className="font-black uppercase"
          style={{
            color: tuning.labelColor || "#d4d4d8",
            fontSize: Number(tuning.labelSize || 10) * textScale,
            letterSpacing: tuning.letterSpacing || "0.16em",
            transform: `translate(${tuning.labelX || 0}px, ${tuning.labelY || 0}px)`,
          }}
        >
          {tuning.labelText || "Mood"}
        </div>

        <div
          className="mt-1 font-black leading-none"
          style={{
            color: tuning.scoreColor || "#fed7aa",
            fontSize: Number(tuning.scoreSize || 34) * textScale,
            transform: `translate(${tuning.scoreX || 0}px, ${tuning.scoreY || 0}px)`,
          }}
        >
          {Math.round(safeScore)}
        </div>

        {tuning.showTrend && (
          <div
            className="mt-1 font-black uppercase"
            style={{
              color: tuning.trendColor || "#d4d4d8",
              fontSize: Number(tuning.trendSize || 8) * textScale,
              letterSpacing: tuning.letterSpacing || "0.16em",
              transform: `translate(${tuning.trendX || 0}px, ${tuning.trendY || 0}px)`,
            }}
          >
            {trendText(player?.trend)}
          </div>
        )}
      </div>
    </div>
  );
}

function LockerRoomMoodBreakdownDiagram({ player, moodRingTuning, tuning }) {
  if (!tuning?.enabled) return null;

  const items = buildMoodBreakdownCallouts(player, Number(tuning.maxItems || 3));
  if (!items.length) return null;

  const ringCenterX = Number(moodRingTuning?.x || 0) + Number(moodRingTuning?.size || 0) / 2;
  const ringCenterY = Number(moodRingTuning?.y || 0) + Number(moodRingTuning?.size || 0) / 2;
  const defaultBubbleWidth = Number(tuning.bubbleWidth || 178);
  const defaultBubbleHeight = Number(tuning.bubbleHeight || 42);
  const defaultBubbleRadius = Number(tuning.bubbleRadius || 14);
  const defaultBubblePaddingX = Number(tuning.bubblePaddingX || 14);
  const defaultBubbleGap = Number(tuning.bubbleGap || 12);
  const defaultLabelFontSize = Number(tuning.labelFontSize || 12);
  const defaultValueFontSize = Number(tuning.valueFontSize || 15);
  const moodRingSize = Number(moodRingTuning?.size || 0);
  const moodRingStrokeWidth = Number(moodRingTuning?.strokeWidth || 0);
  const visibleRingRadius = Math.max(
    0,
    moodRingSize / 2 - moodRingStrokeWidth / 2 + Number(tuning.startRadiusOffset || 0)
  );

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: tuning.zIndex }} aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {items.map((item, index) => {
          const placement = tuning.items?.[index] || tuning.items?.[tuning.items.length - 1] || {};
          const bubbleX = Number(placement.bubbleX || 0);
          const bubbleY = Number(placement.bubbleY || 0);
          const boxScale = Number(placement.boxScale ?? 1);
          const bubbleHeight = Number(placement.bubbleHeight ?? defaultBubbleHeight) * boxScale;
          const lineX = Number(placement.lineX || 0);
          const lineY = Number(placement.lineY || 0);
          const endX = bubbleX + Number(placement.lineEndOffsetX || 0) + lineX;
          const endY = bubbleY + bubbleHeight / 2 + Number(placement.lineEndOffsetY || 0) + lineY;
          const lineElbowGap = Number(placement.lineElbowGap ?? tuning.elbowGap ?? 14);
          const elbowX = endX - lineElbowGap;
          const lineColor = item.value > 0 ? tuning.positiveColor : item.value < 0 ? tuning.negativeColor : tuning.neutralColor;

          let startX = ringCenterX + Number(placement.anchorDx || 0);
          let startY = ringCenterY + Number(placement.anchorDy || 0);

          if (tuning.attachLinesToMoodRing !== false) {
            const dx = endX - ringCenterX;
            const dy = endY - ringCenterY;
            const len = Math.hypot(dx, dy) || 1;
            startX = ringCenterX + (dx / len) * visibleRingRadius;
            startY = ringCenterY + (dy / len) * visibleRingRadius;
          }

          startX += Number(placement.lineStartOffsetX || 0) + lineX;
          startY += Number(placement.lineStartOffsetY || 0) + lineY;

          const pathD = `M ${startX} ${startY} L ${elbowX} ${startY} L ${elbowX} ${endY} L ${endX} ${endY}`;

          return (
            <g key={`line-${item.label}-${index}`}>
              <path
                d={pathD}
                fill="none"
                stroke={lineColor}
                strokeWidth={tuning.lineWidth || 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.92"
              />
              {tuning.showAnchorDots && (
                <circle
                  cx={startX}
                  cy={startY}
                  r={tuning.anchorDotRadius || 3}
                  fill={lineColor}
                  opacity="0.95"
                />
              )}
            </g>
          );
        })}
      </svg>

      {items.map((item, index) => {
        const placement = tuning.items?.[index] || tuning.items?.[tuning.items.length - 1] || {};
        const bubbleX = Number(placement.bubbleX || 0);
        const bubbleY = Number(placement.bubbleY || 0);
        const boxScale = Number(placement.boxScale ?? 1);
        const bubbleWidth = Number(placement.bubbleWidth ?? defaultBubbleWidth) * boxScale;
        const bubbleHeight = Number(placement.bubbleHeight ?? defaultBubbleHeight) * boxScale;
        const bubbleRadius = Number(placement.bubbleRadius ?? defaultBubbleRadius) * boxScale;
        const bubblePaddingX = Number(placement.bubblePaddingX ?? defaultBubblePaddingX) * boxScale;
        const bubbleGap = Number(placement.bubbleGap ?? defaultBubbleGap) * boxScale;
        const labelFontSize = Number(placement.labelFontSize ?? defaultLabelFontSize) * boxScale;
        const valueFontSize = Number(placement.valueFontSize ?? defaultValueFontSize) * boxScale;
        const valueColor = item.value > 0
          ? tuning.valuePositiveColor
          : item.value < 0
          ? tuning.valueNegativeColor
          : tuning.valueNeutralColor;

        return (
          <div
            key={`bubble-${item.label}-${index}`}
            className="absolute flex items-center justify-between"
            style={{
              left: bubbleX,
              top: bubbleY,
              width: bubbleWidth,
              height: bubbleHeight,
              borderRadius: bubbleRadius,
              paddingLeft: bubblePaddingX,
              paddingRight: bubblePaddingX,
              gap: bubbleGap,
              background: tuning.bubbleBackground,
              border: `1px solid ${tuning.bubbleBorder}`,
              boxShadow: "0 10px 24px rgba(0,0,0,0.26)",
            }}
          >
            <div className="min-w-0">
              <div
                className="truncate font-black uppercase tracking-[0.14em]"
                style={{
                  color: tuning.labelColor,
                  fontSize: labelFontSize,
                }}
              >
                {item.label}
              </div>
              {/* Header callout intentionally shows only category + value.
                  The full reasoning text still appears lower on the page. */}
            </div>

            <div
              className="shrink-0 text-right font-black"
              style={{
                color: valueColor,
                fontSize: valueFontSize,
              }}
            >
              {item.value > 0 ? "+" : ""}
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlayerMoodRow({ row, active, onClick, team }) {
  const t = LOCKER_ROOM_PLAYER_PILL_TUNING;
  const hasHeadshot = Boolean(row?.headshot);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative isolate w-full overflow-hidden border text-left transition hover:-translate-y-0.5 hover:border-orange-400/30 ${
        active ? "border-orange-400/60 bg-orange-500/15" : "border-white/10 bg-white/[0.035]"
      }`}
      style={{
        minHeight: t.rowMinHeight,
        padding: `${t.rowPaddingY}px ${t.rowPaddingX}px`,
        borderRadius: t.rowRadius,
      }}
    >
      <LockerRoomPillBackgroundLogo team={team} />
      <LockerRoomPlayerHeadshot row={row} />

      <div
        className="relative z-10 flex items-center justify-between gap-3"
        style={{ paddingLeft: hasHeadshot ? t.leftPad : 0 }}
      >
        <div className="min-w-0 flex flex-1 items-center text-left" style={{ gap: t.ringGap }}>
          <LockerRoomMiniRatingRing row={row} />

          <div className="min-w-0 flex-1">
            <div className="truncate font-black text-white" style={{ fontSize: t.nameSize }}>
              {row.playerName}
            </div>

            <div
              className="mt-1 flex min-w-0 items-center gap-2 font-black uppercase tracking-[0.08em] text-neutral-300"
              style={{ fontSize: t.infoSize }}
            >
              <span className="truncate">{row.position || "-"}</span>
              <span className="shrink-0 text-neutral-500">•</span>
              <span className="shrink-0">Age {row.age ?? "-"}</span>
            </div>

          </div>
        </div>

        <div
          className={`shrink-0 text-center font-black transition ${
            active ? "bg-orange-600 text-white" : "bg-black text-orange-300 group-hover:bg-white/10"
          }`}
          style={{
            borderRadius: t.scoreRadius,
            padding: `${t.scorePadY}px ${t.scorePadX}px`,
          }}
        >
          <div className="text-[24px] leading-none">{row.moodScore}</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-neutral-300">{trendText(row.trend)}</div>
        </div>
      </div>
    </button>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 py-2 last:border-b-0">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">{label}</div>
      <div className="text-right text-sm font-black text-white">{value}</div>
    </div>
  );
}

function ReasonCard({ reason }) {
  const impact = Number(reason?.impact || 0);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/65 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">{reason?.category || "Mood"}</div>
          <div className="mt-1 text-sm font-bold leading-5 text-white">{reason?.text}</div>
          {reason?.detail && <div className="mt-2 text-xs font-semibold text-neutral-500">{reason.detail}</div>}
        </div>
        <div className={`shrink-0 text-lg font-black ${factorTone(impact)}`}>{impact > 0 ? "+" : ""}{impact}</div>
      </div>
    </div>
  );
}

export default function LockerRoom() {
  const { leagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [viewIndex, setViewIndex] = useState(0);
  const [moodData, setMoodData] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const teams = useMemo(() => {
    return getAllTeamsFromLeague(leagueData).sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
  }, [leagueData]);

  useEffect(() => {
    if (!teams.length || !selectedTeam?.name) return;
    const idx = teams.findIndex((team) => team?.name === selectedTeam.name);
    setViewIndex(idx >= 0 ? idx : 0);
  }, [teams, selectedTeam?.name]);

  const activeTeam = teams[viewIndex] || selectedTeam || null;

  useEffect(() => {
    let cancelled = false;

    async function loadMoods() {
      if (!leagueData || !activeTeam?.name) return;
      setLoading(true);
      setError("");

      try {
        const moodLeagueData = buildLeagueDataWithMoodGameplan(leagueData, activeTeam.name);
        const result = await getLockerRoomMoods(moodLeagueData, activeTeam.name);
        if (cancelled) return;

        if (!result?.ok) {
          setMoodData(null);
          setError(result?.reason || "Could not load locker room moods.");
          return;
        }

        setMoodData(result);
        const sortedMoodRows = sortMoodRowsByOverall(result.players || []);
        const first = sortedMoodRows?.[0]?.playerKey || null;
        setSelectedKey((prev) => {
          if (prev && result.players?.some((row) => row.playerKey === prev)) return prev;
          return first;
        });
      } catch (err) {
        if (cancelled) return;
        setMoodData(null);
        setError(err?.message || String(err || "Could not load locker room moods."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMoods();
    return () => {
      cancelled = true;
    };
  }, [leagueData, activeTeam?.name]);

  const handleTeamSwitch = (dir) => {
    if (!teams.length) return;
    setViewIndex((prev) => {
      const next = dir === "next" ? (prev + 1) % teams.length : (prev - 1 + teams.length) % teams.length;
      setSelectedTeam?.(teams[next]);
      setSelectedKey(null);
      return next;
    });
  };

  const players = moodData?.players || [];
  const sortedPlayers = useMemo(() => sortMoodRowsByOverall(players), [players]);
  const selectedPlayer = sortedPlayers.find((row) => row.playerKey === selectedKey) || sortedPlayers[0] || null;
  const logo = moodData?.teamLogo || teamLogoOf(activeTeam);
  const reportHeaderT = LOCKER_ROOM_REPORT_HEADER_TUNING;

  if (!leagueData || !selectedTeam) {
    return (
      <PageFade>
        <div className="bmCourtPage flex min-h-screen flex-col items-center justify-center px-4 text-white">
          <p className="mb-4 text-lg font-semibold">No league/team loaded.</p>
          <button onClick={() => navigate("/team-selector")} className="rounded-xl bg-orange-600 px-6 py-3 font-bold">
            Team Select
          </button>
        </div>
      </PageFade>
    );
  }

  return (
    <PageFade>
      <style>{LOCKER_ROOM_SCROLLBAR_STYLE}</style>
      <div className="bmCourtPage min-h-screen px-4 py-8 text-white">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-6 flex items-center justify-between gap-4 select-none">
            <button
              onClick={() => handleTeamSwitch("prev")}
              className="w-20 text-left text-4xl font-black text-white transition hover:text-orange-400 active:scale-95"
              title="Previous Team"
            >
              ◄
            </button>

            <div className="min-w-0 text-center">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">Locker Room</div>
              <div className="mt-2 flex items-center justify-center gap-4">
                {logo ? <img src={logo} alt={activeTeam?.name || "Team"} className="h-16 w-16 object-contain" /> : null}
                <h1 className="truncate text-4xl font-black text-orange-500">{activeTeam?.name || "Team"}</h1>
              </div>
            </div>

            <button
              onClick={() => handleTeamSwitch("next")}
              className="w-20 text-right text-4xl font-black text-white transition hover:text-orange-400 active:scale-95"
              title="Next Team"
            >
              ►
            </button>
          </div>

          <div className="mb-8" />

          {error && (
            <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm font-black text-red-100">
              {error}
            </div>
          )}

          {loading && !moodData ? (
            <div className="rounded-[28px] border border-white/10 bg-black/75 p-10 text-center text-lg font-black text-neutral-300">
              Checking the locker room...
            </div>
          ) : (
            <div className="grid items-start gap-5 xl:grid-cols-[560px_1fr]">
              <div className="flex h-[680px] max-h-[74vh] min-h-0 flex-col rounded-[28px] border border-white/10 bg-neutral-950/90 p-4 shadow-2xl">
                <div className="mb-4 flex items-center justify-between gap-3 px-1">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Players</div>
                    <div className="text-sm font-semibold text-neutral-500">Lowest mood is listed first.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm font-black text-white">
                    {players.length}
                  </div>
                </div>

                <div className="locker-room-player-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {sortedPlayers.map((row) => (
                    <PlayerMoodRow
                      key={row.playerKey || row.playerName}
                      row={row}
                      team={activeTeam}
                      active={selectedPlayer?.playerKey === row.playerKey}
                      onClick={() => setSelectedKey(row.playerKey)}
                    />
                  ))}
                </div>
              </div>

              <div className="locker-room-detail-scroll relative isolate h-[680px] max-h-[74vh] overflow-y-auto overflow-x-hidden rounded-[28px] border border-white/10 bg-neutral-950/95 shadow-2xl">
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute right-[-120px] top-[-120px] z-0 h-[460px] w-[460px] object-contain opacity-[0.08]"
                  />
                ) : null}

                {selectedPlayer ? (
                  <div className="relative z-10 p-6">
                    <div
                      className="relative mb-6 border border-white/10 bg-transparent shadow-[0_18px_45px_rgba(0,0,0,0.32)]"
                      style={{
                        height: reportHeaderT.headerBox.height,
                        paddingLeft: reportHeaderT.headerBox.paddingX,
                        paddingRight: reportHeaderT.headerBox.paddingX,
                        paddingTop: reportHeaderT.headerBox.paddingTop,
                        borderTopLeftRadius: reportHeaderT.headerBox.borderRadius,
                        borderTopRightRadius: reportHeaderT.headerBox.borderRadius,
                        overflow: reportHeaderT.headerBox.overflow,
                      }}
                    >


                      <div
                        className="pointer-events-none absolute flex items-end justify-center"
                        style={{
                          left: reportHeaderT.faceCard.boxX,
                          top: reportHeaderT.faceCard.boxY,
                          width: reportHeaderT.faceCard.boxWidth,
                          height: reportHeaderT.faceCard.boxHeight,
                          zIndex: reportHeaderT.faceCard.zIndex,
                        }}
                        aria-hidden="true"
                      >
                        {selectedPlayer.headshot ? (
                          <img
                            src={selectedPlayer.headshot}
                            alt=""
                            className={`absolute left-1/2 w-auto max-w-none select-none object-contain ${
                              reportHeaderT.faceCard.shadow ? "drop-shadow-[0_18px_28px_rgba(0,0,0,0.45)]" : ""
                            }`}
                            style={{
                              bottom: reportHeaderT.faceCard.imageBottom,
                              height: reportHeaderT.faceCard.imageSize,
                              transform: `translate(calc(-50% + ${reportHeaderT.faceCard.imageX}px), ${reportHeaderT.faceCard.imageY}px)`,
                            }}
                          />
                        ) : (
                          <div className="flex h-32 w-28 items-center justify-center rounded-2xl border border-white/10 bg-black/45 text-sm font-bold text-neutral-500">
                            No Image
                          </div>
                        )}
                      </div>

                      <div
                        className="absolute min-w-0"
                        style={{
                          left: reportHeaderT.textBlock.x,
                          top: reportHeaderT.textBlock.y,
                          width: reportHeaderT.textBlock.width,
                          zIndex: reportHeaderT.textBlock.zIndex,
                          overflow: "visible",
                        }}
                      >
                        <div
                          className="font-black uppercase text-orange-300"
                          style={{
                            fontSize: reportHeaderT.reportLabel.fontSize,
                            lineHeight: reportHeaderT.reportLabel.lineHeight,
                            letterSpacing: reportHeaderT.reportLabel.letterSpacing,
                            whiteSpace: reportHeaderT.reportLabel.whiteSpace,
                            transform: `translate(${reportHeaderT.reportLabel.x}px, ${reportHeaderT.reportLabel.y}px)`,
                          }}
                        >
                          Locker Room Report
                        </div>
                        <h2
                          className="font-black text-white"
                          style={{
                            marginTop: reportHeaderT.playerName.marginTop,
                            fontSize: reportHeaderT.playerName.fontSize,
                            lineHeight: reportHeaderT.playerName.lineHeight,
                            whiteSpace: reportHeaderT.playerName.whiteSpace,
                            overflow: "visible",
                            transform: `translate(${reportHeaderT.playerName.x}px, ${reportHeaderT.playerName.y}px)`,
                          }}
                        >
                          {selectedPlayer.playerName}
                        </h2>
                      </div>

                      <LockerRoomReportMoodRing
                        player={selectedPlayer}
                        tuning={reportHeaderT.moodRing}
                      />

                      <LockerRoomMoodBreakdownDiagram
                        player={selectedPlayer}
                        moodRingTuning={reportHeaderT.moodRing}
                        tuning={reportHeaderT.moodBreakdown}
                      />

                      <div
                        className="pointer-events-none absolute"
                        style={{
                          left: reportHeaderT.greyDividerBar.x,
                          bottom: reportHeaderT.greyDividerBar.y,
                          width: reportHeaderT.greyDividerBar.width,
                          height: reportHeaderT.greyDividerBar.height,
                          backgroundColor: reportHeaderT.greyDividerBar.color,
                          opacity: reportHeaderT.greyDividerBar.opacity,
                          zIndex: reportHeaderT.greyDividerBar.zIndex,
                        }}
                      />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="rounded-3xl border border-white/10 bg-black/70 p-4">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Role</div>
                        <DetailRow label="Current Role" value={selectedPlayer.role?.actualRole || "-"} />
                        <DetailRow label="Expected Role" value={selectedPlayer.role?.expectedRole || "-"} />
                        <DetailRow label="Team Rank" value={selectedPlayer.role?.rank ? `#${selectedPlayer.role.rank}` : "-"} />
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-black/70 p-4">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Contract</div>
                        <DetailRow label="Salary" value={formatMoney(selectedPlayer.contract?.salary)} />
                        <DetailRow label="Years Left" value={selectedPlayer.contract?.yearsLeft ?? "-"} />
                        <DetailRow label="Market AAV" value={formatMoney(selectedPlayer.contract?.estimatedMarketAAV)} />
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-black/70 p-4">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-orange-300">Stats Used</div>
                        <DetailRow label="GP" value={selectedPlayer.stats?.games ?? "-"} />
                        <DetailRow label="MPG" value={selectedPlayer.stats?.minutesPerGame ?? "-"} />
                        <DetailRow label="PPG" value={selectedPlayer.stats?.pointsPerGame ?? "-"} />
                      </div>
                    </div>

                    <div className="mt-6 rounded-3xl border border-white/10 bg-black/70 p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Mood Factors</div>
                          <div className="text-sm font-semibold text-neutral-500">Positive numbers help mood. Negative numbers hurt mood.</div>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {Object.entries(selectedPlayer.factors || {}).map(([key, value]) => (
                          <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.13em] text-neutral-500">
                              {key.replace(/([A-Z])/g, " $1")}
                            </div>
                            <div className={`mt-1 text-2xl font-black ${factorTone(value)}`}>{Number(value) > 0 ? "+" : ""}{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-orange-300">What is getting to him?</div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {(selectedPlayer.reasons || []).map((reason, index) => (
                          <ReasonCard key={`${reason.category}-${index}`} reason={reason} />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 p-10 text-center text-lg font-black text-neutral-400">
                    No player mood rows found for this team.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-8 flex justify-center">
            <button
              onClick={() => navigate("/team-hub")}
              className="rounded-lg bg-orange-600 px-8 py-3 font-semibold text-white transition hover:bg-orange-500 active:scale-95"
            >
              Back to Team Hub
            </button>
          </div>
        </div>
      </div>
    </PageFade>
  );
}
