// Phase 2E.1 — immutable draft lottery from the completed, shared NBA postseason.
// Reuse the original single-player Python lottery for the draw. This adapter
// constructs its team-record input from authoritative, frozen postseason data.
const fail=message=>{const e=new Error(message);e.status=409;throw e;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validName=value=>typeof value==='string'&&value.length>0&&value.length<=100;

export function buildAuthoritativeLotteryRecords(state){
  const bracket=state?.onlinePostseason;
  const year=Number(bracket?.seasonYear);
  if(bracket?.phase!=='postseasonComplete'||!validName(bracket?.champion)||
    !Number.isInteger(year)||year<2025||year>2094||
    Number(state?.onlineSchedule?.seasonYear)!==year||state?.onlineSchedule?.phase!=='postseason')
    fail('Finish the authoritative NBA Finals before drawing the next draft lottery.');
  if(state?.onlineDraftLottery||state?.draftState?.draftLotteryComplete)
    fail('A draft lottery already exists; it cannot be redrawn.');
  const snapshot=bracket.regularSeasonSnapshot;
  if(!Array.isArray(snapshot)||snapshot.length!==30)fail('The frozen NBA standings are incomplete.');
  const teams=Array.isArray(state?.teams)?state.teams:Object.values(state?.conferences||{}).flat();
  const teamNames=new Set(teams.map(team=>team?.name));
  if(teamNames.size!==30||teams.length!==30||teamNames.has(undefined))fail('The shared 30-team roster is invalid.');
  const seen=new Set(),ranked=new Set();
  const namesByConf=new Map();
  for(const conf of ['East','West']){
    const seeds=bracket?.seedOrder?.[conf];
    const pi=bracket?.conf?.[conf]?.playIn;
    if(!Array.isArray(seeds)||seeds.length!==10||new Set(seeds).size!==10||
      !pi?.g78?.played||!pi?.g910?.played||!pi?.gFinal?.played||!validName(pi?.seed7)||!validName(pi?.seed8))
      fail('The Play-In and frozen conference seeds are incomplete.');
    if(pi.seed7===pi.seed8||!seeds.includes(pi.seed7)||!seeds.includes(pi.seed8))
      fail('A Play-In qualifier does not match the frozen standings.');
    const firstSix=new Set(seeds.slice(0,6));
    if(firstSix.has(pi.seed7)||firstSix.has(pi.seed8))fail('The Play-In duplicates a top-six playoff team.');
    namesByConf.set(conf,{seeds,pi,playoff:new Set([...firstSix,pi.seed7,pi.seed8])});
    for(const name of seeds){if(!teamNames.has(name)||ranked.has(name))fail('Conference seeds contain a duplicate or unknown team.');ranked.add(name);}
  }
  const records=snapshot.map((row,index)=>{
    const name=row?.teamName,conf=row?.conference;
    const info=namesByConf.get(conf);
    const wins=Number(row?.wins),losses=Number(row?.losses),rank=Number(row?.leagueRank);
    if(!validName(name)||seen.has(name)||!teamNames.has(name)||!info||
       !Number.isInteger(wins)||wins<0||wins>82||!Number.isInteger(losses)||losses<0||wins+losses!==82||
       !Number.isInteger(rank)||rank<1||rank>30||
       (row?.conferenceSeed!=null&&Number(row.conferenceSeed)!==info.seeds.indexOf(name)+1))
      fail(`Frozen regular-season record ${index+1} is invalid.`);
    seen.add(name);
    const seedIndex=info.seeds.indexOf(name);
    return {
      teamName:name,name,conference:conf,wins,losses,gamesPlayed:82,
      leagueRank:rank,pointDifferential:Number(row?.pointDifferential||0),
      conferenceSeed:seedIndex<0?null:seedIndex+1,
      madePlayoffs:info.playoff.has(name),madePlayIn:seedIndex>=6,
      lostSevenEightGame:info.pi.g78.loser===name,
      playoffResult:info.playoff.has(name)?'playoffs':'missed_playoffs'
    };
  });
  if(seen.size!==30||new Set(records.map(r=>r.leagueRank)).size!==30||
     records.filter(r=>r.madePlayoffs).length!==16||records.filter(r=>r.madePlayIn).length!==8||
     records.filter(r=>r.lostSevenEightGame).length!==2||!seen.has(bracket.champion))
    fail('The postseason lottery standings do not reconcile to 30 teams.');
  return {draftYear:year+1,seasonYear:year,records};
}

export function validateOriginalLotteryResult(lottery,records,draftYear){
  if(!object(lottery)||lottery.ok!==true||Number(lottery.seasonYear)!==draftYear||
     lottery?.meta?.system!==(draftYear>=2027?'three_two_one':'legacy_14'))
    fail('The original NBA lottery engine returned an incompatible result.');
  const expected=new Set(records.map(row=>row.teamName));
  const first=lottery.firstRoundOrder,second=lottery.secondRoundOrder,full=lottery.fullDraftOrder;
  if(!Array.isArray(first)||first.length!==30||!Array.isArray(second)||second.length!==30||
     !Array.isArray(full)||full.length!==60||
     !Array.isArray(lottery.lotteryTeams)||lottery.lotteryTeams.length!==(draftYear>=2027?16:14))
    fail('The original NBA lottery engine returned an incomplete draft order.');
  for(const [part,offset] of [[first,0],[second,30]]){
    const found=new Set();
    for(let i=0;i<30;i++){
      const pick=part[i],name=pick?.originalTeamName||pick?.teamName;
      if(pick?.pick!==i+1+offset||pick?.round!==(offset?2:1)||
         pick?.pickInRound!==i+1||!expected.has(name)||found.has(name)||pick?.teamName!==name)
        fail('Original lottery output duplicates or misidentifies a draft entitlement.');
      found.add(name);
      if(JSON.stringify(full[i+offset])!==JSON.stringify(pick))
        fail('Full draft order differs from the original round order.');
    }
    if(found.size!==30)fail('The draft omits a franchise.');
  }
  return lottery;
}
