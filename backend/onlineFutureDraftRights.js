// Phase 2E.4-F3B2: deterministic, fail-closed future draft-entitlement rollover.
// This runs only on the trusted backend. The original single-player module is read-only.
import {makeDraftPickId,normalizeTeamName} from './online_draft_shared/draftPicks.js';

const fail = message => {const error=new Error(message);error.status=409;throw error;};
const isObject = x => x!==null&&typeof x==='object'&&!Array.isArray(x);
const yearOf = x => Number(x?.year??x?.seasonYear);
const teamList = state => Array.isArray(state?.teams)?state.teams:
  [...(state?.conferences?.East||[]),...(state?.conferences?.West||[])];

export function planOnlineFutureDraftRights(state,toYear){
  if(!isObject(state)||!Number.isInteger(toYear)||toYear<2027||toYear>2087)
    fail('Future draft rollover requires a supported next season.');
  const completedDraftYear=toYear;
  const futureYear=toYear+7;
  const teams=teamList(state);
  const names=teams.map(t=>String(t?.name||'').trim());
  if(names.length!==30||names.some(n=>!n)||new Set(names.map(normalizeTeamName)).size!==30)
    fail('Future draft rollover needs 30 unique NBA franchises.');
  if(state?.onlineDraft?.status!=='complete'||Number(state.onlineDraft.draftYear)!==completedDraftYear||
     state?.onlineDraftRights?.status!=='settled'||Number(state.onlineDraftRights.draftYear)!==completedDraftYear)
    fail('Draft ownership must be settled and the NBA Draft completed before extending future entitlements.');
  const picks=state.draftPicks;
  if(!Array.isArray(picks)||picks.length<60||picks.length>2000||
      (state.draftPickMeta!=null&&!isObject(state.draftPickMeta)))
    fail('The canonical draft-pick ledger or its metadata is malformed.');
  if(Number(state.draftPickMeta?.lastRolledCompletedSeasonYear||0)>=completedDraftYear)
    fail('This completed draft year has already been rolled forward.');
  const known=new Set(names.map(normalizeTeamName));
  const ids=new Set();
  for(const p of picks){
    if(!isObject(p)||!p.id||ids.has(String(p.id))||!Number.isInteger(yearOf(p))||
      ![1,2].includes(Number(p.round))||!known.has(normalizeTeamName(p.originalTeam))||
      !known.has(normalizeTeamName(p.ownerTeam)))
      fail('The future draft ledger has invalid or duplicated asset identities or ownership.');
    ids.add(String(p.id));
  }
  if(picks.some(p=>yearOf(p)===futureYear))
    fail('The new outer draft year already has entitlements; reconcile these rights before automatic replenishment.');
  if(!picks.some(p=>yearOf(p)===futureYear-1))
    fail('The prior outer draft year is missing; refusing to invent an unsupported draft horizon.');
  // The original game has a separate forfeiture register; do not remint a revoked slot.
  if(state.draftPickForfeitures!=null&&!Array.isArray(state.draftPickForfeitures))
    fail('Malformed draft-pick forfeiture register.');
  const forfeitures=[...(state.draftPickForfeitures||[]),...picks.filter(p=>
    p.forfeited===true||String(p.status||'').toLowerCase()==='forfeited'||
    String(p.protectionType||p.protections||'').toLowerCase().includes('forfeit'))];
  if(forfeitures.some(p=>yearOf(p)===futureYear))
    fail('An outer-year pick is forfeited; review penalties before creating future draft entitlements.');
  if(picks.some(p=>yearOf(p)>futureYear))
    fail('A later future draft year already exists; review the horizon before minting more picks.');
  // Keep exact JSON identities, protected ranges, swaps and contracts for all future years.
  const retained=picks.filter(p=>yearOf(p)>completedDraftYear);
  const minted=[];
  for(const name of names){
    for(const round of [1,2]){
      const id=makeDraftPickId({assetType:'pick',year:futureYear,round,
        originalTeam:name,ownerTeam:name,seed:'own_future'});
      if(ids.has(id))fail('New future draft entitlement collides with an existing asset ID.');
      ids.add(id);
      const roundName=round===1?'1st':'2nd';
      const note=`${name} owns its own ${futureYear} ${roundName} round pick.`;
      minted.push({id,assetType:'pick',type:'pick',year:futureYear,round,
        originalTeam:name,ownerTeam:name,protections:'Unprotected',displayProtection:'Unprotected',
        protectionType:'unprotected',logicType:'auto_future_pick',status:'active',notes:note,
        source:'Auto-added rolling future draft assets',realLifeDetails:{
          source:'Auto-added rolling future draft assets',cleanupVersion:'auto_future_pick',
          playableDisplayRule:note}});
    }
  }
  if(retained.length+minted.length>2000)
    fail('Future draft ledger size exceeds the supported limit.');
  return {draftPicks:[...retained,...minted],draftPickMeta:{...(state.draftPickMeta||{}),
    lastRolledCompletedSeasonYear:completedDraftYear,
    lastAutoAddedFutureYear:futureYear,
    rollingWindowVersion:'online_future_draft_rights_f3b2'},
    futureYear,addedCount:minted.length,retiredCount:picks.length-retained.length};
}
