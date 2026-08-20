import React, { useRef } from "react";
import {
  PORTRAIT_CANVAS_HEIGHT,
  PORTRAIT_CANVAS_WIDTH,
  jerseyLayerStyle,
  normalizeJerseyFit,
} from "../utils/portraitDressing.js";

export default function LayeredPlayerPortrait({
  bodySrc,
  jerseySrc,
  fit,
  alt = "Player portrait",
  className = "",
  showGrid = false,
  draggableJersey = false,
  onFitChange = null,
}) {
  const dragRef = useRef(null);
  const safeFit = normalizeJerseyFit(fit);

  const startDrag = (event) => {
    if (!draggableJersey || !onFitChange) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: safeFit.x,
      startY: safeFit.y,
    };
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !onFitChange) return;
    const canvas = event.currentTarget.parentElement?.getBoundingClientRect();
    const width = Math.max(1, canvas?.width || PORTRAIT_CANVAS_WIDTH);
    const height = Math.max(1, canvas?.height || PORTRAIT_CANVAS_HEIGHT);
    onFitChange({
      ...safeFit,
      x: drag.startX + ((event.clientX - drag.startClientX) / width) * PORTRAIT_CANVAS_WIDTH,
      y: drag.startY + ((event.clientY - drag.startClientY) / height) * PORTRAIT_CANVAS_HEIGHT,
    });
  };

  const stopDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border bg-slate-100 shadow-sm ${className}`}
      style={{ aspectRatio: "1040 / 760" }}
    >
      {showGrid && (
        <div
          className="pointer-events-none absolute inset-0 z-30 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(15,23,42,.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,.22) 1px, transparent 1px)",
            backgroundSize: "52px 38px",
          }}
        />
      )}

      {bodySrc ? (
        <img
          src={bodySrc}
          alt={alt}
          draggable="false"
          className="absolute inset-0 z-10 h-full w-full select-none object-contain"
        />
      ) : (
        <div className="absolute inset-0 z-10 grid place-items-center text-sm font-bold text-slate-500">
          No rookie portrait selected
        </div>
      )}

      {jerseySrc && (
        <div
          className={`absolute z-20 select-none ${draggableJersey ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
          style={{ ...jerseyLayerStyle(safeFit), touchAction: "none" }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <img
            src={jerseySrc}
            alt="Team jersey overlay"
            draggable="false"
            className="h-full w-full select-none object-fill"
          />
        </div>
      )}
    </div>
  );
}
