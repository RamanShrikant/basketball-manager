// Retain only retry identifiers, never basketball or single-player save state.
// A lost HTTP response is retried with the same request ID for DB idempotency.
const key=(lobby,action)=>`bm-online-postseason:${lobby}:${action}`;
export function onlinePostseasonRequestId(lobby,action){
  try{
    const old=sessionStorage.getItem(key(lobby,action));
    if(old&&/^[a-f\d-]{36}$/i.test(old))return old;
    const id=crypto.randomUUID();sessionStorage.setItem(key(lobby,action),id);return id;
  }catch{return crypto.randomUUID();}
}
export function clearOnlinePostseasonRequestId(lobby,action){
  try{sessionStorage.removeItem(key(lobby,action));}catch{}
}
