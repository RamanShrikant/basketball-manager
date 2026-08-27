import React, { createContext, useContext } from "react";
import "./PageFade.css";

const PageFadeContext = createContext(false);

export default function PageFade({ children, className = "" }) {
  const alreadyFading = useContext(PageFadeContext);

  // App.jsx now applies the existing PageFade globally. Pages that already
  // wrapped themselves in PageFade become transparent pass-throughs here so
  // they do not stack the same animation twice.
  if (alreadyFading) return <>{children}</>;

  return (
    <PageFadeContext.Provider value={true}>
      <div className={`bm-page-fade ${className}`}>
        {children}
      </div>
    </PageFadeContext.Provider>
  );
}
