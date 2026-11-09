// Pure, testable authorization decision. The SQL draft commit independently
// enforces human ownership and the server-derived 24-hour deadline.
export function chooseTrustedDraftPickMode({human,isHost,actorOwnsPick,submittedProspect,expired}){
  if(human&&actorOwnsPick){
    if(!submittedProspect)return {ok:false,status:400,error:'Choose a prospect for your own pick.'};
    return {ok:true,forceCpu:false};
  }
  if(!isHost)return {ok:false,status:403,error:human?'Only this GM can select before their deadline.':'Only the commissioner can advance CPU picks.'};
  if(submittedProspect)return {ok:false,status:400,error:'CPU and fallback picks cannot be directed by a browser.'};
  if(human&&!expired)return {ok:false,status:403,error:'This human GM still has time to select their prospect.'};
  return {ok:true,forceCpu:true};
}
