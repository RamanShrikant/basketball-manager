import React, { useId } from "react";

const SIZE_PRESETS = {
  xs: 56,
  sm: 72,
  md: 88,
  lg: 104,
  xl: 120,
};

function finiteRating(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(99, Math.round(n)));
}

export default function PlayerRatingRing({
  overall,
  potential = null,
  size = "md",
  className = "",
  label = "OVR",
  showPotential = true,
  strokeWidth = null,
  ariaLabel = null,
}) {
  const rawId = useId();
  const gradientId = `bm-rating-ring-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const px = typeof size === "number" ? Math.max(48, size) : SIZE_PRESETS[size] || SIZE_PRESETS.md;
  const ovr = finiteRating(overall, null);
  const pot = finiteRating(potential, null);
  const fill = Math.max(0, Math.min(1, Number(ovr || 0) / 99));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const ringStroke = strokeWidth == null ? Math.max(6, Math.min(9, px * 0.09)) : strokeWidth;

  // Text scales from the actual rendered ring size. The old pages used the same
  // 34px number in 72px and 104px rings, which made POT/OVR collide with the SVG.
  const labelSize = Math.max(7, Math.round(px * 0.105));
  const valueSize = Math.max(20, Math.round(px * (showPotential ? 0.34 : 0.40)));
  const potentialSize = Math.max(7, Math.round(px * 0.105));
  const valueLineHeight = showPotential ? 0.88 : 1;

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: px, height: px }}
      role="img"
      aria-label={ariaLabel || `${label} ${ovr ?? "unknown"}${showPotential ? `, potential ${pot ?? "unknown"}` : ""}`}
    >
      <svg width={px} height={px} viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA500" />
            <stop offset="100%" stopColor="#FFD54F" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={ringStroke}
          fill="none"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={ringStroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fill)}
          transform="rotate(-90 60 60)"
        />
      </svg>

      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
        style={{ paddingTop: showPotential ? px * 0.015 : 0 }}
      >
        <span
          className="font-black uppercase tracking-[0.08em] text-white/55"
          style={{ fontSize: labelSize, lineHeight: 1 }}
        >
          {label}
        </span>
        <span
          className="font-black text-orange-400"
          style={{ fontSize: valueSize, lineHeight: valueLineHeight, marginTop: px * 0.025 }}
        >
          {ovr ?? "–"}
        </span>
        {showPotential && (
          <span
            className="font-bold uppercase tracking-[0.04em] text-white/45"
            style={{ fontSize: potentialSize, lineHeight: 1, marginTop: px * 0.035 }}
          >
            POT <span className="text-orange-300">{pot ?? "–"}</span>
          </span>
        )}
      </div>
    </div>
  );
}
