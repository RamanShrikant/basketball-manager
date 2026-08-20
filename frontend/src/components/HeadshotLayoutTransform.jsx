import React from "react";
import { useLocation } from "react-router-dom";
import {
  getHeadshotTransformStyle,
  normalizeHeadshotPageKey,
} from "../config/headshotLayout.js";

/**
 * Invisible centralized page-position wrapper.
 * Configuration lives ONLY in src/config/headshotLayout.js.
 */
export default function HeadshotLayoutTransform({
  children,
  page = "",
  className = "",
  style = undefined,
  layout = null,
}) {
  const location = useLocation();
  const pageKey = page || normalizeHeadshotPageKey(location.pathname);
  const resolvedStyle = layout && typeof layout === "object"
    ? { ...getHeadshotTransformStyle(pageKey), ...layout }
    : getHeadshotTransformStyle(pageKey);

  return (
    <div
      className={className}
      style={{ ...resolvedStyle, ...(style || {}) }}
      data-bm-headshot-page={pageKey}
    >
      {children}
    </div>
  );
}
