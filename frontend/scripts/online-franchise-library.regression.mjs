import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=(p)=>readFileSync(resolve(root,p),'utf8');
const api=source('src/online/onlineFranchiseLibraryApi.js');
const page=source('src/online/OnlineFranchiseLibrary.jsx');
const home=source('src/online/OnlineHome.jsx');
const app=source('src/online/OnlineApp.jsx');
const panel=source('src/online/OnlineGmPanel.jsx');
const css=source('src/online/online.css');
const sql=source('../supabase/bm_online_franchise_library_v1.sql');
assert(api.includes('listOnlineFranchiseLibrary') && api.includes('setOnlineFranchiseArchived'));
assert(api.includes('lobby_id,host_id,roster_kind,revision,created_at,updated_at'));
assert(!api.match(/\.select\(\s*["']\*["']/),'never fetch full seed by star query');
assert(!/\.select\(\s*["'`][^"'`]*\bseed_state\b/.test(api),'library must never request the full seed_state');
assert(api.includes('bm_online_franchise_visibility'));
assert(api.includes('user_id",userId'),'membership/visibility must be user scoped');
assert(page.includes('Archive for Me') && page.includes('Restore to My Leagues'));
assert(page.includes('window.confirm'),'archiving needs confirmation');
assert(page.includes('every manager') || page.includes("another GM's save") || page.includes('other managers'));
assert(app.includes('path="/online/library"'),'library route must be reachable');
assert(home.includes('navigate("/online/library")'),'Online Home must link to library');
assert(panel.includes('to="/online/library"'),'franchise sidebar must link to library');
assert(css.includes('Phase 2B.3 Online Franchise Library'));
assert(sql.includes('enable row level security'));
assert(sql.includes('grant select on public.bm_online_franchise_visibility to authenticated'));
assert(sql.includes('m.user_id=v_user'),'archive RPC only applies to current member');
assert(sql.includes('from public,anon,authenticated'),'no public execution privileges');
assert(!sql.match(/delete\s+from\s+public\.bm_online_franchises/i),'archive never deletes saved franchise');
assert(!sql.match(/update\s+public\.bm_online_franchises/i),'archive never modifies franchise seed');
let count=0;
for (const file of ['OnlineApp.jsx','OnlineHome.jsx','OnlineGmPanel.jsx','OnlineFranchiseLibrary.jsx','onlineFranchiseLibraryApi.js']) {
  const abs=resolve(root,'src/online',file);
  const content=readFileSync(abs,'utf8');
  for(const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)){
    const target=resolve(dirname(abs),match[1].split('?')[0]);
    assert([target,`${target}.jsx`,`${target}.js`,`${target}.css`].some(x=>existsSync(x)&&statSync(x).isFile()),`${file}: import missing ${match[1]}`);
    count++;
  }
}
assert(!api.includes('GameContext') && !api.includes('localStorage') && !api.includes('indexedDB'));
console.log(`PASS: online franchise library, personal archive permissions, ${count} frontend imports, and SP isolation`);

// Execute library data loading against a strict, in-memory Supabase double.
// This catches broken query shapes that a simple substring check would miss.
const {runInNewContext}=await import('node:vm');
const user='account-A', other='account-B', idA='league-1', idB='league-2';
const fixture={
  bm_online_franchises:[
    {lobby_id:idA,host_id:user,roster_kind:'default',revision:1,created_at:'2026-10-31T00:00:00Z'},
    {lobby_id:idB,host_id:other,roster_kind:'custom',revision:1,created_at:'2026-10-30T00:00:00Z'},
  ],
  bm_online_lobbies:[{id:idA,status:'started'},{id:idB,status:'started'}],
  bm_online_lobby_members:[
    {lobby_id:idA,user_id:user,team_name:'Atlanta Hawks'},
    {lobby_id:idA,user_id:other,team_name:'Boston Celtics'},
    {lobby_id:idB,user_id:user,team_name:'Brooklyn Nets'},
    {lobby_id:idB,user_id:other,team_name:'Toronto Raptors'},
  ],
  bm_online_franchise_visibility:[{lobby_id:idB,user_id:user,hidden:true}],
};
const requests=[],rpcCalls=[];
const mockDb={
  from(table){
    const spec={table,cols:null,filters:[]};
    const chain={
      select(cols){spec.cols=cols;return chain},
      order(){return chain},limit(){return chain},
      eq(key,value){spec.filters.push(row=>row[key]===value);return chain},
      in(key,values){spec.filters.push(row=>values.includes(row[key]));return chain},
      then(resolve,reject){
        requests.push({...spec});
        if(!Object.hasOwn(fixture,table))return Promise.resolve({data:null,error:{message:'Unrecognized table '+table}}).then(resolve,reject);
        if(spec.cols.includes('seed_state'))return Promise.reject(new Error('Forbidden full NBA snapshot query')).then(resolve,reject);
        const rows=fixture[table].filter(row=>spec.filters.every(f=>f(row))).map(row=>Object.fromEntries(
          spec.cols.split(',').map(c=>c.trim()).map(k=>[k,row[k]])
        ));
        return Promise.resolve({data:rows,error:null}).then(resolve,reject);
      },
    };
    return chain;
  },
  rpc(name,args){rpcCalls.push({name,args});return Promise.resolve({data:args.p_hidden,error:null})},
};
const rewritten=api.replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')+'\n;globalThis.__library={listOnlineFranchiseLibrary,setOnlineFranchiseArchived};';
const sandbox={supabase:mockDb,profilesFor:async()=>({[user]:{display_name:'Rasta',player_tag:'5082'},[other]:{display_name:'Friend',player_tag:'2982'}}),Promise,Map,Set,Error,Object};
sandbox.globalThis=sandbox;
runInNewContext(rewritten,sandbox);
const leagues=await sandbox.__library.listOnlineFranchiseLibrary(user);
assert.equal(leagues.length,2,'every shared league appears, not only the newest');
assert.equal(leagues[0].myTeam,'Atlanta Hawks');
assert.equal(leagues[1].myTeam,'Brooklyn Nets');
assert.equal(leagues[0].hidden,false);assert.equal(leagues[1].hidden,true);
assert.equal(leagues[0].members.length,2);
assert(requests.every(req=>!req.cols.includes('seed_state')));
await sandbox.__library.setOnlineFranchiseArchived(idA,true);
assert.equal(rpcCalls[0].name,'bm_set_online_franchise_hidden');
assert.equal(rpcCalls[0].args.p_lobby,idA);assert.equal(rpcCalls[0].args.p_hidden,true);
console.log('PASS: two-league listing, GM ownership, per-user archived visibility and archive RPC against mock Supabase');
