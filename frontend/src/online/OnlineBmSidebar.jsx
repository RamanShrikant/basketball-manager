import React, {useState} from "react";
import {Link, useLocation, useParams} from "react-router-dom";
import styles from "../components/TeamHubSidebar.module.css";
import {SidebarIcon, GroupChevron} from "./OnlineBmIcons.jsx";
import {isOnlinePendingView} from "./onlineNavigationAvailability.mjs";

// Uses the real single-player sidebar's CSS module and exact section labels.
// Online-only navigation never opens single-player routes or writes browser saves.
const SECTIONS = [
  ["Team", [["Roster","/roster-view","users"],["Coach Gameplan","/coach-gameplan","clipboard"]]],
  ["Front Office", [["Trades","/trades","swap"],["Free Agency","/free-agents","userSearch"],["Draft Picks","/draft-picks","ticket"],["Salary Table","/salary-table","wallet"],["Contract Extensions","/contract-extensions","file"]]],
  ["Season", [["Schedule","/calendar","calendar"],["Standings","/standings","standings"],["Power Rankings","/power-rankings","trend"],["Playoff Picture","/playoff-picture","bracket"],["Draft Lottery","/draft-lottery","ticket"],["NBA Draft","/nba-draft","ticket"]]],
  ["Offseason", [["Player Retirements","/retirements","clock"],["Rookie Signings","/rookie-signings","file"],["Player & Team Options","/player-team-options","file"],["Free Agent Rights","/free-agent-rights","wallet"],["Player Progression","/player-progression","trend"],["Next Season","/next-season","calendar"]]],
  ["Stats", [["Stats","/player-stats","chart"],["Playoff Statistics","/playoff-stats","chart"]]],
  ["Scouting", [["Locker Room","/locker-room","users"],["Team Intel","/intel","eye"],["Upcoming Draft","/upcoming-draft","search"]]],
  ["Awards", [["Award Tracker","/award-tracker","award"],["All-Stars","/all-stars","star"]]],
  ["History", [["Transaction History","/league-history","clock"],["Award History","/award-history","trophy"],["Past Champions","/past-champions","crown"]]],
];

export default function OnlineBmSidebar() {
  const {id}=useParams();
  const location=useLocation();
  const view=new URLSearchParams(location.search).get("view")||"";
  const [collapsed,setCollapsed]=useState({});
  const href=(path)=>`/online/franchise/${id}${path?`?view=${encodeURIComponent(path)}`:""}`;
  return <aside className={`${styles.sidebar} bmOnlineSidebar`} aria-label="Basketball Manager Online navigation">
    <div className={styles.brand}><div className={styles.monogram}>BM</div><div className={styles.brandWords}><span>BASKETBALL</span><span>MANAGER</span></div></div>
    <div className={styles.navViewport}>
      <Link className={`${styles.navItem} ${!view?styles.navItemActive:""}`} to={href("")} aria-current={!view?"page":undefined}>
        <span className={styles.icon}><SidebarIcon type="home"/></span><span>Team Hub</span>
      </Link>
      {SECTIONS.map(([group,items])=><section key={group} className={styles.group}>
        <button className={styles.groupHeader} type="button" onClick={()=>setCollapsed(s=>({...s,[group]:!s[group]}))} aria-expanded={!collapsed[group]}>
          <span>{group}</span><GroupChevron collapsed={Boolean(collapsed[group])}/>
        </button>
        {!collapsed[group]&&<div className={styles.groupItems}>{items.map(([label,path,icon])=>{
          if (isOnlinePendingView(path)) return <span
            key={path} className={`${styles.navItem} ${styles.navItemDisabled} bmOnlineNavUnavailable`}
            aria-disabled="true" title={`${label} is not yet available in Basketball Manager Online`}>
            <span className={styles.icon}><SidebarIcon type={icon}/></span>
            <span className={`${styles.label} bmOnlineNavLabel`}><span className="bmOnlineNavLabelText">{label}</span><span className="bmOnlineNavSoon">Soon</span></span>
          </span>;
          return <Link key={path} to={href(path)}
            className={`${styles.navItem} ${view===path?styles.navItemActive:""}`}
            aria-current={view===path?"page":undefined}>
            <span className={styles.icon}><SidebarIcon type={icon}/></span><span className={styles.label}>{label}</span>
          </Link>;
        })}</div>}
      </section>)}
      <section className={styles.group}><div className={styles.groupHeader}>System</div>
        <Link className={styles.navItem} to="/online"><span className={styles.icon}><SidebarIcon type="edit"/></span><span>Exit to Online Home</span></Link>
      </section>
    </div>
  </aside>;
}
