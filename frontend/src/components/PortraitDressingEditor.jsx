import React, { useEffect, useMemo, useRef, useState } from "react";
import LayeredPlayerPortrait from "./LayeredPlayerPortrait.jsx";
import { invalidatePortraitRuntimeCache } from "./RuntimePlayerPortrait.jsx";
import {
  DEFAULT_JERSEY_FIT,
  JERSEY_MANIFEST_URL,
  PORTRAIT_DEFAULT_FITS_URL,
  PORTRAIT_DRESSING_STORAGE_KEY,
  PORTRAIT_FIT_VERSION,
  PORTRAIT_STUDIO_MANIFEST_URL,
  REAL_PLAYER_FACE_MANIFEST_URL,
  getJerseyTemplateId,
  getStoredPortraitFitConfig,
  hasJerseyOverride,
  mergePortraitFitConfigs,
  normalizeFaceFitProfile,
  normalizeJerseyFit,
  normalizePortraitFitConfig,
  resolveJerseyFit,
  saveStoredPortraitFitConfig,
} from "../utils/portraitDressing.js";

const downloadJSON = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const FIT_CONTROLS = [
  ["x", "X", -220, 220, 1],
  ["y", "Y", -220, 220, 1],
  ["scale", "Scale", 0.65, 1.45, 0.01],
  ["left", "Expand Left", -120, 220, 1],
  ["right", "Expand Right", -120, 220, 1],
  ["up", "Expand Up", -120, 220, 1],
  ["down", "Expand Down", -120, 220, 1],
];

function FitControl({ field, label, min, max, step, value, onChange, disabled = false }) {
  const nudge = field === "scale" ? 0.01 : 1;
  const decimals = field === "scale" ? 2 : 0;
  return (
    <div className={`rounded-2xl border bg-white p-3 ${disabled ? "opacity-40" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-xs font-black text-slate-700">{label}</label>
        <input type="number" value={Number(value).toFixed(decimals)} min={min} max={max} step={step} disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-lg border px-2 py-1 text-right text-xs font-bold disabled:bg-slate-100" />
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-blue-600 disabled:cursor-not-allowed" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled} onClick={() => onChange(Number(value) - nudge)} className="rounded-lg bg-slate-100 py-1 text-xs font-black hover:bg-slate-200 disabled:cursor-not-allowed">−</button>
        <button type="button" disabled={disabled} onClick={() => onChange(Number(value) + nudge)} className="rounded-lg bg-slate-100 py-1 text-xs font-black hover:bg-slate-200 disabled:cursor-not-allowed">+</button>
      </div>
    </div>
  );
}

function withTemplateHashes(config, jerseys) {
  const clean = normalizePortraitFitConfig(config);
  clean.jerseyTemplateHashes = Object.fromEntries(
    (jerseys || []).map((row) => [getJerseyTemplateId(row), row.hash || row.sha256 || ""]).filter(([, hash]) => Boolean(hash))
  );
  return clean;
}

export default function PortraitDressingEditor() {
  const [rookieFaces, setRookieFaces] = useState([]);
  const [realFaces, setRealFaces] = useState([]);
  const [portraitGroup, setPortraitGroup] = useState("rookies");
  const [studioMeta, setStudioMeta] = useState(null);
  const [jerseys, setJerseys] = useState([]);
  const [selectedFaceId, setSelectedFaceId] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("TOR");
  const [fitConfig, setFitConfig] = useState(() => getStoredPortraitFitConfig());
  const [draftFit, setDraftFit] = useState(DEFAULT_JERSEY_FIT);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showGrid, setShowGrid] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [status, setStatus] = useState("Loading portrait studio and jersey manifests...");
  const importRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(PORTRAIT_STUDIO_MANIFEST_URL).then((res) => {
        if (!res.ok) throw new Error(`Portrait Studio manifest returned ${res.status}`);
        return res.json();
      }),
      fetch(REAL_PLAYER_FACE_MANIFEST_URL).then((res) => {
        if (!res.ok) throw new Error(`Real-player portrait manifest returned ${res.status}`);
        return res.json();
      }).catch(() => []),
      fetch(JERSEY_MANIFEST_URL).then((res) => {
        if (!res.ok) throw new Error(`Jersey manifest returned ${res.status}`);
        return res.json();
      }),
      fetch(`${PORTRAIT_DEFAULT_FITS_URL}?editor=${Date.now()}`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ])
      .then(([studio, realPlayerRows, jerseyRows, defaults]) => {
        if (cancelled) return;
        const nextRookieFaces = Array.isArray(studio?.entries) ? studio.entries.filter((row) => row?.id) : [];
        const nextRealFaces = Array.isArray(realPlayerRows) ? realPlayerRows.filter((row) => row?.id) : [];
        const nextJerseys = Array.isArray(jerseyRows) ? jerseyRows.filter((row) => row?.team && row?.url) : [];
        const merged = mergePortraitFitConfigs(defaults || {}, getStoredPortraitFitConfig());
        setStudioMeta(studio);
        setRookieFaces(nextRookieFaces);
        setRealFaces(nextRealFaces);
        setJerseys(nextJerseys);
        setFitConfig(merged);
        const firstReady = nextRookieFaces.find((row) => row.baseReady);
        setSelectedFaceId((prev) => prev || firstReady?.id || nextRookieFaces[0]?.id || nextRealFaces[0]?.id || "");
        setSelectedTeam((prev) => (nextJerseys.some((row) => row.team === prev) ? prev : nextJerseys[0]?.team || ""));
        setStatus(`Ready: ${nextRookieFaces.filter((row) => row.baseReady).length} rookie bases + ${nextRealFaces.filter((row) => row.baseReady).length} real-player bases, ${nextJerseys.length} jerseys.`);
      })
      .catch((error) => !cancelled && setStatus(`Could not load Portrait Studio assets: ${error.message}`));
    return () => { cancelled = true; };
  }, []);

  const faces = portraitGroup === "real" ? realFaces : rookieFaces;

  useEffect(() => {
    const activeFaces = portraitGroup === "real" ? realFaces : rookieFaces;
    if (!activeFaces.length) {
      setSelectedFaceId("");
      return;
    }
    if (!activeFaces.some((face) => face.id === selectedFaceId)) {
      const firstReady = activeFaces.find((row) => row.baseReady);
      setSelectedFaceId(firstReady?.id || activeFaces[0]?.id || "");
    }
  }, [portraitGroup, realFaces, rookieFaces, selectedFaceId]);

  const selectedFace = useMemo(() => faces.find((face) => face.id === selectedFaceId) || faces[0] || null, [faces, selectedFaceId]);
  const fitStage = portraitGroup === "real" ? "real" : "rookie";
  const selectedJersey = useMemo(() => jerseys.find((jersey) => jersey.team === selectedTeam) || jerseys[0] || null, [jerseys, selectedTeam]);
  const selectedTemplateId = getJerseyTemplateId(selectedJersey || {});
  const inheritedFit = useMemo(() => {
    if (!selectedFace?.id) return normalizeJerseyFit(DEFAULT_JERSEY_FIT);
    const profile = fitConfig.fitByFace?.[selectedFace.id] || normalizeFaceFitProfile({});
    const withoutSpecific = {
      ...fitConfig,
      fitByFace: {
        ...fitConfig.fitByFace,
        [selectedFace.id]: { ...profile, jerseys: { ...profile.jerseys, [selectedTemplateId]: undefined } },
      },
    };
    if (withoutSpecific.fitByFace[selectedFace.id].jerseys[selectedTemplateId] === undefined) {
      delete withoutSpecific.fitByFace[selectedFace.id].jerseys[selectedTemplateId];
    }
    return resolveJerseyFit(withoutSpecific, selectedFace.id, selectedTemplateId, fitStage);
  }, [fitConfig, fitStage, selectedFace?.id, selectedTemplateId]);
  const currentResolvedFit = useMemo(
    () => selectedFace?.id ? resolveJerseyFit(fitConfig, selectedFace.id, selectedTemplateId, fitStage) : normalizeJerseyFit(DEFAULT_JERSEY_FIT),
    [fitConfig, fitStage, selectedFace?.id, selectedTemplateId]
  );
  const hasSpecificOverride = selectedFace?.id ? hasJerseyOverride(fitConfig, selectedFace.id, selectedTemplateId, fitStage) : false;

  useEffect(() => { setDraftFit(currentResolvedFit); }, [selectedFaceId, selectedTeam, currentResolvedFit.x, currentResolvedFit.y, currentResolvedFit.scale, currentResolvedFit.left, currentResolvedFit.right, currentResolvedFit.up, currentResolvedFit.down, currentResolvedFit.opacity]);

  const filteredFaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    return faces.filter((face) => {
      if (filter === "ready" && !face.baseReady) return false;
      if (filter === "needs" && !face.needsBase) return false;
      if (!q) return true;
      return `${face.id} ${face.name || ""} ${face.teamName || ""} ${face.appearancePool || ""} ${face.defaultHairStyle || ""} ${face.skinTone || ""}`.toLowerCase().includes(q);
    });
  }, [faces, search, filter]);

  const updateConfig = (updater, message) => {
    setFitConfig((prev) => {
      const next = normalizePortraitFitConfig(typeof updater === "function" ? updater(prev) : updater);
      saveStoredPortraitFitConfig(next);
      return next;
    });
    if (message) setStatus(message);
  };

  const saveAsDefault = () => {
    if (!selectedFace?.id) return;
    updateConfig((prev) => {
      const profile = prev.fitByFace?.[selectedFace.id] || normalizeFaceFitProfile({});
      return { ...prev, fitByFace: { ...prev.fitByFace, [selectedFace.id]: { ...profile, default: normalizeJerseyFit(draftFit) } } };
    }, `Saved ${selectedFace.id} default fit. Jerseys without a specific override inherit it.`);
  };

  const saveTeamOverride = () => {
    if (!selectedFace?.id || !selectedTemplateId) return;
    updateConfig((prev) => {
      const profile = prev.fitByFace?.[selectedFace.id] || normalizeFaceFitProfile({});
      return {
        ...prev,
        fitByFace: {
          ...prev.fitByFace,
          [selectedFace.id]: { ...profile, jerseys: { ...profile.jerseys, [selectedTemplateId]: normalizeJerseyFit(draftFit) } },
        },
      };
    }, `Saved ${selectedFace.id} × ${selectedTeam} jersey override.`);
  };

  const clearTeamOverride = () => {
    if (!selectedFace?.id || !selectedTemplateId) return;
    updateConfig((prev) => {
      const profile = prev.fitByFace?.[selectedFace.id] || normalizeFaceFitProfile({});
      const jerseysNext = { ...profile.jerseys };
      delete jerseysNext[selectedTemplateId];
      return { ...prev, fitByFace: { ...prev.fitByFace, [selectedFace.id]: { ...profile, jerseys: jerseysNext } } };
    }, `Removed ${selectedFace.id} × ${selectedTeam} override; this jersey now inherits the default fit.`);
  };

  const saveWorkingCopy = () => {
    const clean = saveStoredPortraitFitConfig(withTemplateHashes(fitConfig, jerseys));
    setFitConfig(clean);
    invalidatePortraitRuntimeCache();
    setStatus(`Saved working fits to ${PORTRAIT_DRESSING_STORAGE_KEY}.`);
  };

  const saveToProject = async () => {
    const clean = withTemplateHashes(fitConfig, jerseys);
    try {
      const response = await fetch("/__bm/portrait-fits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
      saveStoredPortraitFitConfig(clean);
      setFitConfig(clean);
      invalidatePortraitRuntimeCache();
      setStatus("Saved canonical fits directly to public/assets/portrait_studio/fits/portrait_fits.json.");
    } catch (error) {
      setStatus(`Direct project save unavailable (${error.message}). Use Export Fits and replace portrait_fits.json.`);
    }
  };

  const exportFits = () => downloadJSON("portrait_fits.json", { ...withTemplateHashes(fitConfig, jerseys), savedAt: new Date().toISOString() });

  const importFits = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = normalizePortraitFitConfig(parsed);
      const merged = mergePortraitFitConfigs(fitConfig, incoming);
      setFitConfig(merged);
      saveStoredPortraitFitConfig(merged);
      setStatus(`Imported ${Object.keys(incoming.fitByFace).length} portrait fit profiles.`);
    } catch (error) {
      setStatus(`Fit import failed: ${error.message}`);
    }
  };

  const templateMismatchCount = useMemo(() => {
    const savedHashes = fitConfig.jerseyTemplateHashes || {};
    return jerseys.filter((row) => {
      const id = getJerseyTemplateId(row);
      return savedHashes[id] && row.hash && savedHashes[id] !== row.hash;
    }).length;
  }, [fitConfig.jerseyTemplateHashes, jerseys]);

  const readyCount = faces.filter((row) => row.baseReady).length;
  const needsCount = faces.filter((row) => row.needsBase).length;
  const referenceCount = portraitGroup === "real"
    ? realFaces.filter((row) => row.sourceUrl).length
    : (studioMeta?.counts?.draftReferences ?? rookieFaces.filter((row) => row.draftUrl).length);
  const referenceLabel = portraitGroup === "real" ? "Source Headshots" : "Draft References";

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border bg-slate-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.28em] text-blue-300">League Editor — Portrait Studio v2</div>
            <h1 className="mt-1 text-3xl font-black">Dressing / Jersey Fit Editor</h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-300">Set one player default, then save only the jersey-specific exceptions that actually need different placement. Runtime portraits use the same canonical data after drafts, trades, free agency and signings.</p>
            <div className="mt-2 text-xs font-bold text-emerald-300">{status}</div>
            {templateMismatchCount > 0 && <div className="mt-1 text-xs font-black text-amber-300">⚠ {templateMismatchCount} jersey template file(s) changed since the canonical fits were saved. Review affected teams.</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveWorkingCopy} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black hover:bg-emerald-600">Save Working Copy</button>
            <button type="button" onClick={saveToProject} className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-black hover:bg-orange-500">Save to Project</button>
            <button type="button" onClick={exportFits} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black hover:bg-blue-500">Export Fits</button>
            <button type="button" onClick={() => importRef.current?.click()} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-black hover:bg-slate-600">Import Fits</button>
            <input ref={importRef} type="file" accept="application/json,.json" onChange={importFits} className="hidden" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] font-black uppercase text-slate-500">Base Ready</div><div className="text-2xl font-black text-emerald-700">{readyCount}</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] font-black uppercase text-slate-500">Need Base</div><div className="text-2xl font-black text-amber-700">{needsCount}</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] font-black uppercase text-slate-500">{referenceLabel}</div><div className="text-2xl font-black">{referenceCount}</div></div>
        <div className="rounded-2xl border bg-white p-4"><div className="text-[10px] font-black uppercase text-slate-500">Team Jerseys</div><div className="text-2xl font-black">{jerseys.length}</div></div>
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[340px_minmax(0,1fr)_390px]">
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="mb-3"><h2 className="text-lg font-black">{portraitGroup === "real" ? "NBA Players" : "Rookie Identities"}</h2><p className="text-xs text-slate-500">{portraitGroup === "real" ? "Choose a real player. Existing roster headshots stay visible until you add a jerseyless base." : "Choose a jerseyless base to fit."}</p></div>
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1">
            <button type="button" onClick={() => { setPortraitGroup("rookies"); setFilter("all"); setSearch(""); }} className={`rounded-lg px-2 py-2 text-[11px] font-black ${portraitGroup === "rookies" ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:text-white"}`}>Rookies ({rookieFaces.length})</button>
            <button type="button" onClick={() => { setPortraitGroup("real"); setFilter("all"); setSearch(""); }} className={`rounded-lg px-2 py-2 text-[11px] font-black ${portraitGroup === "real" ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:text-white"}`}>NBA Players ({realFaces.length})</button>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {[["all","All"],["ready","Base Ready"],["needs","Need Base"]].map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-2 py-2 text-[11px] font-black ${filter===value?"bg-white shadow-sm":"text-slate-500 hover:text-slate-900"}`}>{label}</button>)}
          </div>
          <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder={portraitGroup === "real" ? "Search player or team..." : "Search face, pool, hair..."} className="mb-3 w-full rounded-xl border px-3 py-2 text-sm" />
          <div className="grid max-h-[760px] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {filteredFaces.map((face) => {
              const profile = fitConfig.fitByFace?.[face.id];
              const overrideCount = Object.keys(profile?.jerseys || {}).length;
              return <button key={face.id} type="button" onClick={()=>setSelectedFaceId(face.id)} className={`overflow-hidden rounded-xl border text-left ${face.id===selectedFace?.id?"border-blue-600 ring-2 ring-blue-500":"hover:border-slate-400"}`}>
                <div className="relative aspect-[1040/760] bg-slate-100">{(face.baseReady ? face.baseUrl : (face.sourceUrl || face.draftUrl || face.baseUrl)) && <img src={face.baseReady ? face.baseUrl : (face.sourceUrl || face.draftUrl || face.baseUrl)} alt={face.name || face.id} loading="lazy" className="h-full w-full object-contain" />}</div>
                <div className="p-2"><div className="truncate text-[11px] font-black">{portraitGroup === "real" ? (face.name || face.id) : face.id}</div><div className="truncate text-[10px] text-slate-500">{portraitGroup === "real" ? (face.teamName || (face.baseReady ? "Base ready" : "Needs base")) : (overrideCount ? `${overrideCount} jersey override${overrideCount===1?"":"s"}` : "Default only")}</div>{portraitGroup === "real" && <div className={`mt-1 text-[9px] font-black uppercase ${face.baseReady ? "text-emerald-600" : "text-amber-600"}`}>{face.baseReady ? "Base Ready" : "Needs Base"}</div>}</div>
              </button>;
            })}
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-black">Live 1040 × 760 Preview</h2><p className="text-xs text-slate-500">Drag the jersey for X/Y, then tune precisely. Current controls are a working preview until you save them as a default or team override.</p></div><label className="flex items-center gap-2 text-xs font-black text-slate-600"><input type="checkbox" checked={showGrid} onChange={(e)=>setShowGrid(e.target.checked)} /> Alignment grid</label></div>
          {selectedFace?.baseReady ? <LayeredPlayerPortrait bodySrc={selectedFace.baseUrl} jerseySrc={selectedJersey?.url} fit={draftFit} showGrid={showGrid} draggableJersey onFitChange={(next)=>setDraftFit(normalizeJerseyFit(next))} alt={selectedFace.name || selectedFace.id} /> : (selectedFace?.sourceUrl ? <div className="relative aspect-[1040/760] overflow-hidden rounded-2xl border bg-slate-100"><img src={selectedFace.sourceUrl} alt={selectedFace.name || selectedFace.id} className="h-full w-full object-contain" /><div className="absolute bottom-3 left-3 rounded-lg bg-slate-950/90 px-3 py-2 text-xs font-black text-amber-300">SOURCE HEADSHOT — JERSEYLESS BASE REQUIRED</div></div> : <div className="grid aspect-[1040/760] place-items-center rounded-2xl border bg-slate-100 text-sm font-black text-amber-700">Jerseyless base required</div>)}
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-500">IDENTITY</div><div className="truncate font-black">{portraitGroup === "real" ? (selectedFace?.name || selectedFace?.id || "—") : (selectedFace?.id || "—")}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-500">TEAM</div><div className="font-black">{selectedJersey?.team||"—"}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-500">FIT SOURCE</div><div className={`font-black ${hasSpecificOverride?"text-purple-700":"text-emerald-700"}`}>{hasSpecificOverride?"TEAM OVERRIDE":"INHERITED DEFAULT"}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-black text-slate-500">TEMPLATE</div><div className="truncate font-black">{selectedTemplateId||"—"}</div></div></div>
          <button type="button" onClick={()=>setShowAllTeams((v)=>!v)} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">{showAllTeams?"Hide 30-Team QA":"Preview All 30 Jerseys"}</button>
          {showAllTeams && selectedFace?.baseReady && <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">{jerseys.map((jersey)=>{ const templateId=getJerseyTemplateId(jersey); const fit=resolveJerseyFit(fitConfig, selectedFace.id, templateId, fitStage); const override=hasJerseyOverride(fitConfig, selectedFace.id, templateId, fitStage); return <button key={templateId} type="button" onClick={()=>setSelectedTeam(jersey.team)} className={`rounded-xl border p-1 text-left ${jersey.team===selectedTeam?"border-blue-600":"border-slate-200"}`}><LayeredPlayerPortrait bodySrc={selectedFace.baseUrl} jerseySrc={jersey.url} fit={fit} className="rounded-lg" /><div className="px-1 py-1 text-[10px] font-black">{jersey.team} {override?<span className="text-purple-700">• override</span>:<span className="text-slate-400">• default</span>}</div></button>;})}</div>}
        </div>

        <div className="space-y-4 rounded-3xl border bg-white p-4 shadow-sm">
          <div><h2 className="text-lg font-black">Jersey + Fit</h2><p className="text-xs text-slate-500">Default fit covers most jerseys. Save a team override only where this player needs special treatment.</p></div>
          <div className="grid grid-cols-[44px_1fr_44px] gap-2"><button type="button" onClick={()=>{const i=Math.max(0,jerseys.findIndex((j)=>j.team===selectedTeam));setSelectedTeam(jerseys[(i-1+jerseys.length)%jerseys.length]?.team||"");}} className="rounded-xl bg-slate-100 text-lg font-black">‹</button><select value={selectedTeam} onChange={(e)=>setSelectedTeam(e.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm font-black">{jerseys.map((jersey)=><option key={jersey.team} value={jersey.team}>{jersey.team} — {jersey.displayName}</option>)}</select><button type="button" onClick={()=>{const i=Math.max(0,jerseys.findIndex((j)=>j.team===selectedTeam));setSelectedTeam(jerseys[(i+1)%jerseys.length]?.team||"");}} className="rounded-xl bg-slate-100 text-lg font-black">›</button></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-1">{FIT_CONTROLS.map(([field,label,min,max,step])=><FitControl key={field} field={field} label={label} min={min} max={max} step={step} value={draftFit[field]} disabled={!selectedFace?.baseReady} onChange={(value)=>setDraftFit((prev)=>normalizeJerseyFit({...prev,[field]:value}))} />)}</div>
          <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!selectedFace?.baseReady} onClick={()=>setDraftFit(inheritedFit)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black hover:bg-slate-200 disabled:opacity-40">Revert Preview</button><button type="button" disabled={!selectedFace?.baseReady} onClick={saveAsDefault} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-40">Save Player Default</button><button type="button" disabled={!selectedFace?.baseReady} onClick={saveTeamOverride} className="rounded-xl bg-purple-600 px-3 py-2 text-xs font-black text-white hover:bg-purple-700 disabled:opacity-40">Save {selectedTeam} Override</button><button type="button" disabled={!selectedFace?.baseReady||!hasSpecificOverride} onClick={clearTeamOverride} className="rounded-xl bg-rose-100 px-3 py-2 text-xs font-black text-rose-800 hover:bg-rose-200 disabled:opacity-40">Clear {selectedTeam} Override</button></div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950"><div className="font-black">Persistence</div><div className="mt-1">Save Working Copy protects edits in this browser. Save to Project writes the canonical JSON directly while running the local Vite dev server. Export Fits is the fallback/backup.</div></div>
        </div>
      </div>
    </div>
  );
}
