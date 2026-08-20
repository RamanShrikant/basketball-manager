import React from "react";
import RuntimePlayerPortrait from "./RuntimePlayerPortrait.jsx";

/**
 * Shared bottom-anchored portrait lane for hero headers.
 * When a generated rookie identity is supplied through `player` (or can be
 * inferred from `src`) this automatically switches to the post-draft dynamic
 * portrait system. Legacy/static headshots still render exactly as before.
 *
 * Overflow is intentionally visible so page-level headshot Y tuning can move
 * portraits down without falling into a fake clipped void inside the frame.
 * The page chrome/divider remains the real visual boundary.
 */
export default function PlayerPortraitFrame({
  src,
  player = null,
  team = null,
  teamName = "",
  mode = "runtime",
  alt = "Player portrait",
  className = "h-[112px] w-[138px]",
  imageClassName = "",
  bottomInset = 4,
  fallback = null,
  layoutPage = "",
}) {
  const inset = Math.max(0, Number(bottomInset) || 0);
  return (
    <div className={`relative shrink-0 self-end overflow-visible ${className}`}>
      <RuntimePlayerPortrait
        player={player}
        team={team}
        teamName={teamName}
        src={src}
        alt={alt}
        mode={mode}
        layoutPage={layoutPage}
        className="absolute inset-x-0 top-0"
        imageClassName={imageClassName}
        style={{ bottom: `${inset}px`, height: `calc(100% - ${inset}px)` }}
        fallback={fallback || <div className="h-full w-full" aria-hidden="true" />}
      />
    </div>
  );
}
