import React from "react";

/**
 * Shared bottom-anchored portrait lane for hero headers.
 * Keeps transparent PNGs and differently cropped headshots inside the header
 * instead of letting them overlap the divider line beneath the card.
 */
export default function PlayerPortraitFrame({
  src,
  alt = "Player portrait",
  className = "h-[112px] w-[138px]",
  imageClassName = "",
  bottomInset = 4,
  fallback = null,
}) {
  return (
    <div className={`relative shrink-0 self-end overflow-hidden ${className}`}>
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable="false"
          className={`absolute inset-x-0 mx-auto w-full object-contain object-bottom ${imageClassName}`}
          style={{
            bottom: `${Math.max(0, Number(bottomInset) || 0)}px`,
            height: `calc(100% - ${Math.max(0, Number(bottomInset) || 0)}px)`,
          }}
        />
      ) : (
        fallback || <div className="h-full w-full" aria-hidden="true" />
      )}
    </div>
  );
}
