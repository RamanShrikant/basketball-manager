// Online-only isolation of the existing synchronous original-Python engines.
// The original validators and SQL authorization remain unchanged. Node's main
// event loop never executes the synchronous Python process during an HTTP RPC.
import {Worker} from 'node:worker_threads';

const ALLOWED = new Set([
  'draft.initialize','draft.pick','lottery','options','rights',
  'freeagency','rookies','retirements','progression'
]);
const MAX_ACTIVE = 2; // Bound memory and concurrent Python processes.
const MAX_INPUT_BYTES = 48 * 1024 * 1024;
const TIMEOUT_MS = 210_000; // Above original progression's 180s Python timeout.
let active = 0;
const problem=(status,message)=>Object.assign(new Error(message),{status});

export function runOriginalInWorker(kind,args){
  if(!ALLOWED.has(kind)||!Array.isArray(args))
    return Promise.reject(problem(400,'Unknown trusted online calculation.'));
  let bytes;
  try{bytes=Buffer.byteLength(JSON.stringify(args));}
  catch{return Promise.reject(problem(400,'Online calculation contains invalid input.'));}
  if(bytes>MAX_INPUT_BYTES)
    return Promise.reject(problem(413,'Online calculation snapshot is too large.'));
  if(active>=MAX_ACTIVE)
    return Promise.reject(problem(503,'Online calculations are busy. Refresh and retry.'));
  active++;
  return new Promise((resolve,reject)=>{
    let worker,finished=false,timer,slotHeld=true;
    const releaseSlot=()=>{if(slotHeld){slotHeld=false;active--;}};
    const finish=(err,value)=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      if(err)reject(err);else resolve(value);
    };
    try{
      worker=new Worker(new URL('./onlineOriginalWorkerThread.mjs',import.meta.url),{
        workerData:{kind,args},
        // All Python workers are already subprocess-limited by their existing
        // maxBuffer and timeout limits; JS worker has a bounded heap as well.
        resourceLimits:{maxOldGenerationSizeMb:384},
        execArgv:[]
      });
    }catch(e){releaseSlot();finish(problem(503,`Could not start trusted online worker: ${e.message}`));return;}
    timer=setTimeout(()=>{
      // The slot stays occupied until the worker actually exits. No hidden
      // Python process can accumulate behind repeated timeout retries.
      // SQL still exclusively owns the eventual commit.
      worker.terminate().catch(()=>{});
      finish(problem(503,'Trusted online calculation timed out. Refresh the league before retrying.'));
    },TIMEOUT_MS);
    timer.unref?.();
    worker.once('message',message=>{
      if(message?.ok===true)finish(null,message.value);
      else {
        const status=Number.isInteger(message?.status)&&message.status>=400&&message.status<=599?message.status:503;
        finish(problem(status,String(message?.message||'Online calculation could not complete.').slice(0,500)));
      }
    });
    worker.once('error',()=>finish(problem(503,'Trusted online calculation worker failed.')));
    worker.once('exit',code=>{
      releaseSlot();
      if(!finished)finish(problem(503,`Trusted online calculation worker exited (${code}).`));
    });
  });
}
