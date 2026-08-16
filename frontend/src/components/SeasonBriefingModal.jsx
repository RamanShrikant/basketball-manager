import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSeasonBriefingLayout } from "../config/seasonBriefingLayout.js";
import styles from "./SeasonBriefingModal.module.css";

const TAB_KEYS = ["team", "league", "prospects", "outlook"];
const EXIT_DURATION_MS = 980;
const CONTENT_ENTER_DELAY_MS = 1250;
const TAB_FADE_OUT_MS = 260;

function boxStyle(box) {
  return { left:`${box.x}%`, top:`${box.y}%`, width:`${box.width}%`, height:`${box.height}%` };
}

function ProgressionList({ title, rows, positive }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return <section className={styles.listSection}>
    <h3 className={styles.listHeading}>{title}</h3>
    <div className={styles.progressionList}>
      {rows.map((row,index)=><div className={styles.progressionRow} key={`${title}-${row.name}-${index}`}>
        <div className={styles.progressionIdentity}><span className={styles.progressionRank}>{index+1}</span><span className={styles.progressionName}>{row.name}</span></div>
        <span className={styles.progressionOriginal}>{row.originalOverall} OVR</span>
        <span className={positive ? styles.deltaUp : styles.deltaDown}>{row.delta > 0 ? `+${row.delta}` : row.delta}</span>
      </div>)}
    </div>
  </section>;
}

function ProspectBoard({ rows, classCount }) {
  if (!Array.isArray(rows) || !rows.length) return <div className={styles.boardEmpty}>The upcoming class has not been prepared yet. Open Upcoming Draft to generate or load the live board, then reopen New Chapter.</div>;
  return <section className={styles.listSection}>
    <div className={styles.boardHeader}><h3 className={styles.listHeading}>Live upcoming draft board</h3><span className={styles.boardCount}>{classCount || rows.length} prospects loaded</span></div>
    <div className={styles.prospectList}>{rows.map((row,index)=><div className={styles.prospectRow} key={`${row.name}-${index}`}>
      <span className={styles.prospectRank}>#{row.projection || index+1}</span><span className={styles.prospectName}>{row.name}</span><span className={styles.prospectPosition}>{row.position || "—"}</span><span className={styles.prospectRatings}>{row.overall || "—"} OVR · {row.potential || "—"} POT</span>
    </div>)}</div>
  </section>;
}

export default function SeasonBriefingModal({ open, wallpaperUrl, briefing, onClose, onEnterSeason }) {
  const [activeTab,setActiveTab]=useState("team");
  const [rendered,setRendered]=useState(Boolean(open));
  const [visible,setVisible]=useState(false);
  const [contentVisible,setContentVisible]=useState(false);
  const [tabContentVisible,setTabContentVisible]=useState(true);
  const scrollRef=useRef(null); const tabTimerRef=useRef(null);
  const layout=useMemo(()=>getSeasonBriefingLayout(briefing?.teamSlug || ""),[briefing?.teamSlug]);

  useEffect(()=>{
    if(open && wallpaperUrl && briefing){ setRendered(true); setContentVisible(false); const frame=window.requestAnimationFrame(()=>setVisible(true)); const timer=window.setTimeout(()=>setContentVisible(true),CONTENT_ENTER_DELAY_MS); return ()=>{window.cancelAnimationFrame(frame);window.clearTimeout(timer);}; }
    if(!rendered) return undefined; setContentVisible(false); setVisible(false); const timer=window.setTimeout(()=>setRendered(false),EXIT_DURATION_MS); return ()=>window.clearTimeout(timer);
  },[open,wallpaperUrl,briefing,rendered]);
  useEffect(()=>{ if(!open)return; if(tabTimerRef.current)window.clearTimeout(tabTimerRef.current); setActiveTab("team");setTabContentVisible(true);},[open,briefing?.teamSlug]);
  useEffect(()=>{ if(open||!tabTimerRef.current)return; window.clearTimeout(tabTimerRef.current);tabTimerRef.current=null;setTabContentVisible(true);},[open]);
  useEffect(()=>{ if(scrollRef.current)scrollRef.current.scrollTop=0;},[activeTab]);
  useEffect(()=>()=>{if(tabTimerRef.current)window.clearTimeout(tabTimerRef.current);},[]);
  const handleTabChange=(nextTab)=>{ if(!TAB_KEYS.includes(nextTab)||nextTab===activeTab)return; if(tabTimerRef.current)window.clearTimeout(tabTimerRef.current); setTabContentVisible(false); tabTimerRef.current=window.setTimeout(()=>{setActiveTab(nextTab);window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>setTabContentVisible(true)));},TAB_FADE_OUT_MS); };
  useEffect(()=>{ if(!rendered)return undefined; const onKeyDown=(event)=>{ if(!open)return; if(event.key==="Escape"){onClose?.();return;} if(event.key==="ArrowRight"){event.preventDefault();const i=TAB_KEYS.indexOf(activeTab);handleTabChange(TAB_KEYS[(i+1)%TAB_KEYS.length]);} if(event.key==="ArrowLeft"){event.preventDefault();const i=TAB_KEYS.indexOf(activeTab);handleTabChange(TAB_KEYS[(i-1+TAB_KEYS.length)%TAB_KEYS.length]);} }; window.addEventListener("keydown",onKeyDown); const prior=document.body.style.overflow;document.body.style.overflow="hidden"; return()=>{window.removeEventListener("keydown",onKeyDown);document.body.style.overflow=prior;};},[rendered,open,onClose,activeTab]);
  if(!rendered||!wallpaperUrl||!briefing||typeof document==="undefined")return null;
  const tab=briefing.tabs?.[activeTab]||briefing.tabs?.team; const paragraphs=Array.isArray(tab?.paragraphs)?tab.paragraphs.filter(Boolean):[tab?.summary].filter(Boolean); const progression=tab?.progression||{};
  return createPortal(<div className={`${styles.backdrop} ${visible?styles.backdropVisible:""}`} role="dialog" aria-modal="true" aria-label={`${briefing.teamName} season briefing`}>
    <div className={`${styles.stage} ${visible?styles.stageVisible:""}`}>
      <img className={styles.wallpaper} src={wallpaperUrl} alt={`${briefing.teamName} ${briefing.seasonLabel} season briefing artwork`} draggable="false" />
      <section className={`${styles.content} ${contentVisible?styles.contentVisible:""}`} style={boxStyle(layout.content)} aria-live="polite"><div className={styles.contentScroller} ref={scrollRef}><div className={`${styles.contentInner} ${tabContentVisible?styles.contentInnerVisible:""}`} key={activeTab}>
        <div className={styles.eyebrow}>{tab?.eyebrow}</div><h2 className={styles.title}>{tab?.title}</h2>
        {activeTab==="league"&&(progression.improved?.length||progression.regressed?.length)?<div className={styles.progressionGrid}><ProgressionList title="Biggest improvements" rows={progression.improved} positive/><ProgressionList title="Biggest regressions" rows={progression.regressed}/></div>:null}
        <div className={styles.paragraphs}>{paragraphs.map((p,index)=><p className={styles.paragraph} key={`${activeTab}-${index}`}>{p}</p>)}</div>
        {activeTab==="prospects"?<ProspectBoard rows={tab?.prospects} classCount={tab?.classCount}/>:null}
      </div></div></section>
      {TAB_KEYS.map((key)=><button key={key} type="button" className={`${styles.hotspot} ${activeTab===key?styles.hotspotActive:""}`} style={boxStyle(layout[`${key}Button`])} onClick={()=>handleTabChange(key)} aria-label={`Open ${key} briefing`} aria-pressed={activeTab===key}><span className={styles.srOnly}>{key}</span></button>)}
      <button type="button" className={`${styles.hotspot} ${styles.enterHotspot}`} style={boxStyle(layout.enterSeasonButton)} onClick={onEnterSeason||onClose} aria-label="Enter season"><span className={styles.srOnly}>Enter season</span></button>
      <button type="button" className={`${styles.hotspot} ${styles.closeHotspot}`} style={boxStyle(layout.closeButton)} onClick={onClose} aria-label="Close season briefing"><span className={styles.srOnly}>Close</span></button>
    </div>
  </div>,document.body);
}
