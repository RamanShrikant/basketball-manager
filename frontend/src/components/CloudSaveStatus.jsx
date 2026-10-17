import React, { useEffect, useState } from "react";

// Only displayed inside the Cloud Saves slot menu. No floating UI in gameplay.
// The game-level CloudAutosaveBridge remains unchanged and keeps doing the work.
export default function CloudSaveStatus() {
  const [cloud, setCloud] = useState(() => window.__bmCloudSaveStatus || { status: "checking", detail: "" });
  useEffect(() => {
    const listener = event => setCloud(event.detail || { status: "checking", detail: "" });
    window.addEventListener("bm:cloud-save-status", listener);
    return () => window.removeEventListener("bm:cloud-save-status", listener);
  }, []);
  const status = cloud?.status;
  const message = status === "saved" ? "Cloud saved"
    : status === "saving" ? "Cloud syncing…"
    : status === "waiting" ? "Cloud sync paused"
    : status === "error" ? "Cloud needs attention" : "Checking cloud…";
  return <div className="flex items-center gap-2 text-[11px] font-bold text-white/60" role="status" title={cloud?.detail || message}>
    <span className={status === "error" ? "text-red-300" : status === "saved" ? "text-green-300" : "text-white/50"}>{message}</span>
    {status === "error" && <button type="button" className="rounded-md border border-white/15 px-2 py-1 text-orange-200 hover:border-orange-400/40" onClick={() => window.dispatchEvent(new Event("bm:cloud-save-request"))}>Retry</button>}
  </div>;
}
