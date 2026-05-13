import React from "react";
import "./PageFade.css";

export default function PageFade({ children, className = "" }) {
  return (
    <div className={`bm-page-fade ${className}`}>
      {children}
    </div>
  );
}
