// Phase G3B-A — quiet, dismissible, confirmed league-activity notices.
// Source: the RLS-protected revision journal, not optimistic local actions.
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../auth/supabaseClient.js';
import {collectFreshOnlineAlerts} from './onlineTransactionAlerts.mjs';
import './online-transaction-alerts.css';

const revisionOf=value=>/^[1-9]\d*$/.test(String(value??''))?BigInt(value):0n;
const MAX_VISIBLE=3;
const PAGE_SIZE=75;

export default function OnlineTransactionAlerts({lobbyId,revision,currentUserId,leagueData,members=[],people={}}){
  const [alerts,setAlerts]=useState([]);
  const cursor=useRef(revisionOf(revision));
  const running=useRef(false);
  const live=useRef({revision,leagueData,members,people,currentUserId});
  live.current={revision,leagueData,members,people,currentUserId};

  useEffect(()=>{
    // First visit is a baseline, not a replay of the league's entire history.
    cursor.current=revisionOf(live.current.revision);
    setAlerts([]);
  },[lobbyId]);

  const sync=useCallback(async()=>{
    if(running.current||!lobbyId)return;
    const upTo=revisionOf(live.current.revision);
    if(upTo<=cursor.current)return;
    running.current=true;
    try{
      // Only read already-committed journal rows in increasing revision order.
      // Maximum four batches per pass so a long offline session cannot freeze UI.
      for(let page=0;page<4 && cursor.current<upTo;page++){
        const {data,error}=await supabase.from('bm_online_franchise_events')
          .select('revision,request_id,actor_id,action_type,details')
          .eq('lobby_id',lobbyId)
          .gt('revision',cursor.current.toString())
          .lte('revision',upTo.toString())
          .order('revision',{ascending:true})
          .limit(PAGE_SIZE);
        if(error)throw error;
        const rows=Array.isArray(data)?data:[];
        if(!rows.length){cursor.current=upTo;break;}
        const result=collectFreshOnlineAlerts(rows,cursor.current.toString(),{
          leagueData:live.current.leagueData,members:live.current.members,
          people:live.current.people,currentUserId:live.current.currentUserId,
        },MAX_VISIBLE);
        cursor.current=BigInt(result.cursor);
        if(result.alerts.length){
          setAlerts(old=>{
            const ids=new Set(old.map(x=>x.id));
            return [...old,...result.alerts.filter(x=>!ids.has(x.id))].slice(-MAX_VISIBLE);
          });
        }
        if(rows.length<PAGE_SIZE){cursor.current=upTo;break;}
      }
    }catch{
      // Notification delivery is best-effort; do not block or misreport game state.
      // The cursor stays put and the next poll/focus retries the same rows.
    }finally{running.current=false;}
  },[lobbyId]);

  useEffect(()=>{void sync();},[sync,revision]);
  useEffect(()=>{
    const focus=()=>{if(document.visibilityState==='visible')void sync();};
    const timer=window.setInterval(()=>void sync(),20000);
    document.addEventListener('visibilitychange',focus);
    window.addEventListener('online',focus);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',focus);window.removeEventListener('online',focus);};
  },[sync]);
  useEffect(()=>{
    if(!alerts.length)return;
    const timer=window.setTimeout(()=>setAlerts(old=>old.slice(1)),14000);
    return()=>window.clearTimeout(timer);
  },[alerts]);
  if(!alerts.length)return null;
  return <div className="bmOnlineActivityStack" aria-label="Recent transactions by other managers" aria-live="polite" aria-atomic="false">
    {alerts.map(item=><section key={item.id} className={`bmOnlineActivityCard bmOnlineActivity-${item.kind}`}>
      <div className="bmOnlineActivityAccent" aria-hidden="true"/>
      <div className="bmOnlineActivityContent">
        <div className="bmOnlineActivityEyebrow"><span className="bmOnlineActivityPulse" aria-hidden="true"/> LEAGUE WIRE <span className="bmOnlineActivityType">{item.kind}</span></div>
        <strong className="bmOnlineActivityHeadline">{item.headline}</strong>
        <div className="bmOnlineActivityDetails">{item.detail}</div>
        <div className="bmOnlineActivityBy">Confirmed by {item.by}</div>
      </div>
      <button type="button" className="bmOnlineActivityClose" aria-label={`Dismiss ${item.kind} notification`} title="Dismiss"
        onClick={()=>setAlerts(old=>old.filter(row=>row.id!==item.id))}>×</button>
    </section>)}
  </div>;
}
