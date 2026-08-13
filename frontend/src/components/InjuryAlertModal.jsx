import React from "react";
import { createPortal } from "react-dom";

export default function InjuryAlertModal({
  events = [],
  formatEventLine,
  onAdjustManually,
  onAutoAdjust,
  onAlwaysAutoAdjust,
}) {
  const renderLine = typeof formatEventLine === "function"
    ? formatEventLine
    : (event) => event?.message || event?.playerName || "Injury update";

  return createPortal(
    <div className="fixed inset-0 z-[245] bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-orange-500/40 bg-neutral-950 text-white shadow-[0_0_36px_rgba(0,0,0,0.62)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-600/20 to-red-500/10 px-6 py-5">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300">Controlled Team Alert</div>
          <h2 className="mt-1 text-2xl font-black text-white">Injury Update</h2>
          <p className="mt-1 text-sm font-semibold text-orange-100/80">
            Your rotation has already been auto-rebuilt so injured players cannot start or play minutes.
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="space-y-2">
            {(events || []).map((event, index) => (
              <div
                key={event?.id || `${event?.playerName || "injury"}-${event?.returnDate || index}`}
                className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-bold text-neutral-100"
              >
                {renderLine(event)}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-neutral-200 hover:bg-white/10"
              onClick={onAdjustManually}
            >
              Adjust Rotation Manually
            </button>
            <button
              type="button"
              className="rounded-xl border border-orange-400/35 bg-orange-600/15 px-5 py-3 text-sm font-black text-orange-100 hover:bg-orange-600/25"
              onClick={onAutoAdjust}
            >
              Auto-Adjust Rotation
            </button>
            <button
              type="button"
              className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-black text-white hover:bg-orange-500"
              onClick={onAlwaysAutoAdjust}
            >
              Always Auto-Adjust Rotation
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
