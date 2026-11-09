// Read-only Online championship presentation; authoritative selection remains on backend.
const home=['H','H','A','A','H','A','H'];
export function findPendingOnlinePlayoffGame(post){
 if(!post||post.phase!=='playoffs')return null;
 const rows=[];
 for(const round of ['r1','r2','r3','finals']){
   for(const conf of round==='finals'?['NBA']:['West','East']){
     const group=round==='finals'?{finals:post.finals}:post.conf?.[conf]?.rounds?.[round];
     for(const [key,s] of Object.entries(group||{})){
       const i=Number(s?.nextGameIndex||0);
       if(s?.complete||!s?.highSeedTeam||!s?.lowSeedTeam||!Number.isInteger(i)||i<0||i>6)continue;
       const id=s.gameIds?.[i],date=s.gameDates?.[i];
       if(!id||!date)continue;
       rows.push({id,date,round,conf,key,index:i,gameNumber:i+1,
         home:home[i]==='H'?s.highSeedTeam:s.lowSeedTeam,
         away:home[i]==='H'?s.lowSeedTeam:s.highSeedTeam});
     }
   }
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 return rows[0]||null;
}
export function onlineSeriesPlayedGames(series,results){
 if(!series||!Array.isArray(series.gameIds))return [];
 return series.gameIds.slice(0,Math.min(7,Number(series.nextGameIndex)||0)).map((id,i)=>({
   id,gameNumber:i+1,result:results?.[id]||null
 }));
}
export function onlinePlayoffCompletion(post){
 let finished=0,active=0;
 for(const conf of ['West','East'])for(const round of ['r1','r2','r3']){
   for(const s of Object.values(post?.conf?.[conf]?.rounds?.[round]||{})){
     if(s?.complete)finished++;else if(s?.highSeedTeam&&s?.lowSeedTeam)active++;
   }
 }
 if(post?.finals?.complete)finished++;else if(post?.finals?.highSeedTeam&&post?.finals?.lowSeedTeam)active++;
 return {finished,active,total:15};
}
