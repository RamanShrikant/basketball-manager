import React, { useState } from "react";
import FaceDNAEditor from "./FaceDNAEditor.jsx";
import PortraitDressingEditor from "./PortraitDressingEditor.jsx";

export default function PlayerCreatorStudio() {
  const [mode, setMode] = useState("dressing");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-2xl border bg-slate-50 p-2">
        <button
          type="button"
          onClick={() => setMode("dressing")}
          className={`rounded-xl px-4 py-2 text-sm font-black ${mode === "dressing" ? "bg-slate-950 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
        >
          Dressing / Portrait Editor
        </button>
        <button
          type="button"
          onClick={() => setMode("dna")}
          className={`rounded-xl px-4 py-2 text-sm font-black ${mode === "dna" ? "bg-slate-950 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
        >
          Face DNA / Aging Lab
        </button>
      </div>

      {mode === "dressing" ? <PortraitDressingEditor /> : <FaceDNAEditor />}
    </div>
  );
}
