import React, { createContext, useContext, useEffect, useState } from "react";
import { NAVIGATION_FADE_TUNING } from "../config/navigationFadeTuning.js";
import "./PageFade.css";

const PageFadeContext = createContext(false);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export default function PageFade({ children, className = "" }) {
  const alreadyFading = useContext(PageFadeContext);
  const [entered, setEntered] = useState(false);

  const durationMs = Math.max(0, finiteNumber(NAVIGATION_FADE_TUNING.durationMs, 290));
  const startOpacity = Math.max(0, Math.min(1, finiteNumber(NAVIGATION_FADE_TUNING.startOpacity, 0.58)));
  const moveY = finiteNumber(NAVIGATION_FADE_TUNING.moveY, 3);
  const startScale = Math.max(0.8, Math.min(1.2, finiteNumber(NAVIGATION_FADE_TUNING.startScale, 1)));

  useEffect(() => {
    // Nested page-level wrappers are intentionally inert because App.jsx owns
    // the single global route transition. Keep hook order stable either way.
    if (alreadyFading) return undefined;

    // Do not start the transition in the same commit that mounts the route.
    // Heavy pages (Calendar/Stats/Playoffs) can spend most of a CSS animation
    // rendering before the browser ever paints it. Two RAFs guarantee the
    // destination's starting visual state reaches a real frame first.
    setEntered(false);
    let frameTwo = 0;
    const frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      if (frameTwo) window.cancelAnimationFrame(frameTwo);
    };
  }, [alreadyFading]);

  // App.jsx applies PageFade globally. Pages that already wrap themselves in
  // PageFade pass straight through so the navigation animation never stacks.
  if (alreadyFading) return <>{children}</>;

  const tuningStyle = {
    "--bm-nav-fade-duration": `${durationMs}ms`,
    "--bm-nav-fade-start-opacity": startOpacity,
    "--bm-nav-fade-move-y": `${moveY}px`,
    "--bm-nav-fade-start-scale": startScale,
  };

  return (
    <PageFadeContext.Provider value={true}>
      <div
        className={`bm-page-fade ${entered ? "bm-page-fade--entered" : ""} ${className}`}
        style={tuningStyle}
      >
        {children}
      </div>
    </PageFadeContext.Provider>
  );
}
