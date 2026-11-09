// Only these explicitly listed pure calculation functions run in worker threads.
// No browser-provided module path, function name, or code is executed.
import {parentPort,workerData} from 'node:worker_threads';

const TASKS=Object.freeze({
  'draft.initialize':['onlineDraftActions.js','initializeAuthoritativeOnlineDraft'],
  'draft.pick':['onlineDraftActions.js','makeAuthoritativeOnlinePick'],
  lottery:['onlineDraftLottery.js','runOriginalDraftLottery'],
  options:['onlineOptions.js','runOriginalOptions'],
  rights:['onlineRights.js','originalRights'],
  freeagency:['onlineFreeAgency.js','runOriginalFreeAgency'],
  rookies:['onlineRookieSignings.js','runOriginalRookieEngine'],
  retirements:['onlineRetirements.js','originalRetirementRun'],
  progression:['onlineProgression.js','originalProgression']
});
try{
  const [file,name]=TASKS[workerData?.kind]||[];
  if(!file||!Array.isArray(workerData?.args))throw Object.assign(new Error('Unknown trusted calculation.'),{status:400});
  const mod=await import(new URL(`./${file}`,import.meta.url));
  if(typeof mod[name]!=='function')throw new Error('Trusted calculation is unavailable.');
  const value=await mod[name](...workerData.args);
  parentPort.postMessage({ok:true,value});
}catch(error){
  parentPort.postMessage({ok:false,status:error?.status,message:String(error?.message||'Calculation failed.').slice(0,500)});
}
