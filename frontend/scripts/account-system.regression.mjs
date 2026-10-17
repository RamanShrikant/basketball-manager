// Run with: node scripts/account-system.regression.mjs
// Runs actual account-vault browser-storage routines against an in-memory
// IndexedDB model; no Supabase request and no changes to real franchise saves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class MemoryStorage {
  #values = new Map();
  get length() { return this.#values.size; }
  key(i) { return [...this.#values.keys()][i] ?? null; }
  getItem(k) { return this.#values.get(String(k)) ?? null; }
  setItem(k,v) { this.#values.set(String(k), String(v)); }
  removeItem(k) { this.#values.delete(String(k)); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
const schema = new Map();
function addDb(name, storeNames) {
  const stores = new Map();
  for (const [store,keyPath] of storeNames) stores.set(store,{ keyPath, rows:new Map() });
  schema.set(name, { version:1, stores });
}
addDb("basketball_manager_storage_v1", [["boxScores","gameId"],["appData","key"]]);
addDb("basketball_manager_league_storage_v2", [["league_saves","id"]]);
addDb("basketball_manager_local_save_slots_v1", [["leagueSaves","saveId"]]);
const defer = task => queueMicrotask(task);
function request(getter) {
  const req={result:null,error:null,onsuccess:null,onerror:null};
  defer(()=>{try{req.result=getter();req.onsuccess?.({target:req});}catch(e){req.error=e;req.onerror?.({target:req});}});
  return req;
}
function makeDatabase(name) {
  const state = schema.get(name);
  return {
    get objectStoreNames(){const arr=[...state.stores.keys()];arr.contains=(name)=>arr.includes(name);return arr;},
    close(){},
    createObjectStore(store,{keyPath}) {
      state.stores.set(store,{keyPath,rows:new Map()});
    },
    transaction(storeNames) {
      const tx={ oncomplete:null,onerror:null,onabort:null };
      const pending=[];
      tx.objectStore=(storeName)=>{
        const store=state.stores.get(storeName);
        if(!store) throw new Error('Missing store '+storeName);
        const queue=(get)=>{const req=request(get);pending.push(req);return req};
        return {
          getAll:()=>queue(()=>[...store.rows.values()].map(x=>structuredClone(x))),
          get:key=>queue(()=>structuredClone(store.rows.get(key))),
          put:row=>queue(()=>{store.rows.set(row[store.keyPath],structuredClone(row));return row[store.keyPath]}),
          clear:()=>queue(()=>{store.rows.clear();return undefined}),
        };
      };
      setTimeout(()=>tx.oncomplete?.({target:tx}),2);
      return tx;
    },
  };
}

globalThis.indexedDB={
  async databases(){return [...schema].map(([name,db])=>({name,version:db.version}))},
  open(name,version) {
    const req={result:null,error:null,onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null};
    defer(()=>{
      const fresh=!schema.has(name);
      if (fresh) addDb(name,[]);
      const db=schema.get(name);
      if(version && db.version>version){req.error=new Error('VersionError');req.onerror?.();return}
      req.result=makeDatabase(name);
      if(fresh){req.onupgradeneeded?.({target:req})}
      req.onsuccess?.({target:req});
    });
    return req;
  },
};

const vault = await import("../src/auth/accountLocalVault.js");
const A="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const stores=schema.get("basketball_manager_local_save_slots_v1").stores.get("leagueSaves").rows;
const boxScores=schema.get("basketball_manager_storage_v1").stores.get("boxScores").rows;

localStorage.setItem("sb-example-auth-token", "DO_NOT_TOUCH");
localStorage.setItem("selectedTeam", '"Celtics"');
localStorage.setItem("bm_test", "A");
localStorage.setItem("bm_active_league_save_id_v1", "slotA");
stores.set("slotA",{saveId:"slotA",leagueName:"Celtics"});
boxScores.set("gameA",{gameId:"gameA",points:115});
assert.equal((await vault.inspectInitialOwnership(A)).needsDecision,true);
await vault.activateAccount(A,{adoptLegacy:true});
assert.equal(vault.activeBrowserAccountId(),A);
assert.equal(stores.get('slotA').leagueName,'Celtics');
await vault.activateAccount(B);
assert.equal(vault.activeBrowserAccountId(),B);
assert.equal(stores.has('slotA'),false);
assert.equal(boxScores.has('gameA'),false);
assert.equal(localStorage.getItem('selectedTeam'),null);
assert.equal(localStorage.getItem('bm_active_league_save_id_v1'),null);
stores.set('slotB',{saveId:'slotB',leagueName:'Lakers'});
localStorage.setItem('selectedTeam','"Lakers"');
localStorage.setItem('bm_active_league_save_id_v1','slotB');
await vault.activateAccount(A);
assert.equal(stores.has('slotA'),true);
assert.equal(stores.has('slotB'),false);
assert.equal(localStorage.getItem('selectedTeam'),'"Celtics"');
assert.equal(localStorage.getItem('bm_active_league_save_id_v1'),'slotA');
await vault.activateAccount(B);
assert.equal(stores.has('slotB'),true);
assert.equal(stores.has('slotA'),false);
assert.equal(localStorage.getItem('selectedTeam'),'"Lakers"');
assert.equal(localStorage.getItem('bm_active_league_save_id_v1'),'slotB');
assert.equal(localStorage.getItem('sb-example-auth-token'),'DO_NOT_TOUCH');
// Failure midway through a switch restores last complete archived source.
localStorage.setItem('bm_account_vault_pending_v1',JSON.stringify({from:B,to:A}));
stores.set('partial',{saveId:'partial',leagueName:'Broken'});
await vault.recoverInterruptedSwitch();
assert.equal(stores.has('partial'),false);
assert.equal(stores.has('slotB'),true);
assert.equal(vault.activeBrowserAccountId(),B);
await assert.rejects(()=>vault.activateAccount('not-a-user-id'),/invalid authenticated account/);

const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
assert(main.includes('await import("./game/BasketballManagerGame.jsx")'), 'Gameplay code must be dynamically imported behind authentication');
assert(!main.includes('GameProvider'), 'Do not import gameplay into the public login shell');
const game=readFileSync(new URL('../src/game/BasketballManagerGame.jsx',import.meta.url),'utf8');
assert(game.includes('<CloudAutosaveBridge user={user} />'));
assert(!game.includes('<AccountControls user={user} />'), 'Account controls must not overlay gameplay');
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
assert(!app.includes("AccountOnPlayOnly"), "The floating account bar must not render on Play");
assert(app.includes('<GameModeLanding user={user} />'));
assert(main.includes('<AccountRoot onInitialize={prepareAuthenticatedGame}>'));
// Strict mode separation for the same account B: Local lives in its own vault.
assert.equal(vault.getAccountSaveMode(B), "local");
await vault.switchAccountSaveMode(B, "cloud");
assert.equal(vault.getAccountSaveMode(B), "cloud");
assert.equal(stores.size, 0, "Local slots must not appear in Cloud mode");
stores.set("cloudA", {saveId:"cloudA",slotIndex:0,leagueName:"Cloud Lakers"});
boxScores.set("cloud-game", {gameId:"cloud-game",points:133});
await vault.switchAccountSaveMode(B, "local");
assert.equal(vault.getAccountSaveMode(B), "local");
assert.equal(stores.get("slotB")?.leagueName, "Lakers");
assert.equal(stores.has("cloudA"), false);
assert.equal(boxScores.has("cloud-game"), false);
await vault.switchAccountSaveMode(B, "cloud");
assert.equal(stores.get("cloudA")?.leagueName,"Cloud Lakers");
assert.equal(stores.has("slotB"), false);
assert.equal(boxScores.get("cloud-game")?.points,133);
await vault.switchAccountSaveMode(B, "local");
assert.equal(stores.get("slotB")?.leagueName, "Lakers");
console.log("PASS: account vault, Local/Cloud mode isolation, box scores, sessions and recovery");
