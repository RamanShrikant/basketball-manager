import React, { createContext, useContext } from "react";
import { NAVIGATION_FADE_TUNING } from "../config/navigationFadeTuning.js";
import "./PageFade.css";

const PageFadeContext = createContext(false);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export default function PageFade({ children, className = "" }) {
  const alreadyFading = useContext(PageFadeContext);

  // App.jsx applies PageFade globally. Pages that already wrap themselves in
  // PageFade pass straight through so the navigation animation never stacks.
  if (alreadyFading) return <>{children}</>;

  const durationMs = Math.max(0, finiteNumber(NAVIGATION_FADE_TUNING.durationMs, 190));
  const startOpacity = Math.max(0, Math.min(1, finiteNumber(NAVIGATION_FADE_TUNING.startOpacity, 0.78)));
  const moveY = finiteNumber(NAVIGATION_FADE_TUNING.moveY, 2);
  const startScale = Math.max(0.8, Math.min(1.2, finiteNumber(NAVIGATION_FADE_TUNING.startScale, 0.998)));

  const tuningStyle = {
    "--bm-nav-fade-duration": `${durationMs}ms`,
    "--bm-nav-fade-start-opacity": startOpacity,
    "--bm-nav-fade-move-y": `${moveY}px`,
    "--bm-nav-fade-start-scale": startScale,
  };

  return (
    <PageFadeContext.Provider value={true}>
      <div className={`bm-page-fade ${className}`} style={tuningStyle}>
        {children}
      </div>
    </PageFadeContext.Provider>
  );
}
