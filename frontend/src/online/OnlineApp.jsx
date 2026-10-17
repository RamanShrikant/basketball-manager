import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../auth/supabaseClient.js";
import { profile } from "./onlineApi.js";
import OnlineHome from "./OnlineHome.jsx";
import OnlineLobby from "./OnlineLobby.jsx";
import "./online.css";

function Gate({ children }) {
  const [user,setUser] = useState(null);
  const [checked,setChecked] = useState(false);
  const [screen,setScreen] = useState("sign-in");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [onlineProfile,setOnlineProfile] = useState(undefined);
  const [nickname,setNickname] = useState("");
  useEffect(()=> {
    let active=true;
    supabase.auth.getUser().then(({data,error})=>{if(active){setUser(error?null:data?.user||null);setChecked(true);}}).catch(e=>{if(active){setError(e.message);setChecked(true);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event, session)=>{if(active) setUser(session?.user||null);});
    return ()=>{active=false;subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!user){setOnlineProfile(undefined);return;}
    let active=true;
    profile().then(p=>{if(active){setOnlineProfile(p);setError("");}}).catch(e=>{
      if(active){setError(e.message);setOnlineProfile(null);}
    });
    return()=>{active=false;};
  },[user?.id]);
  async function submitAuth(e){
    e.preventDefault();setBusy(true);setError("");
    try{
      const address=email.trim().toLowerCase();
      if(password.length<6) throw new Error("Password must be at least 6 characters.");
      const response=screen==="register"?await supabase.auth.signUp({email:address,password}):await supabase.auth.signInWithPassword({email:address,password});
      if(response.error) throw response.error;
      if(screen==="register"&&!response.data?.session) setError("Check your email for confirmation, then sign in.");
      else setUser(response.data.user);
      setPassword("");
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function createProfile(e){e.preventDefault();setBusy(true);setError("");try{const p=await profile(nickname);setOnlineProfile(p);}catch(e){setError(e.message);}finally{setBusy(false);}}
  if(!checked||user&&onlineProfile===undefined) return <div className="on-center">Connecting to Basketball Manager Online…</div>;
  if(!user) return <main className="on-center"><form className="on-panel on-auth" onSubmit={submitAuth}>
    <p className="on-kicker">BASKETBALL MANAGER • ONLINE BETA</p><h1>Sign in to play online</h1>
    <p className="on-sub">Uses your existing Basketball Manager account. No single-player save data is loaded.</p>
    <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label>
    <label>Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={screen==="register"?"new-password":"current-password"}/></label>
    {error&&<p role="alert" className="on-error">{error}</p>}
    <button className="on-primary" type="submit" disabled={busy}>{busy?"Working…":screen==="register"?"Create account":"Sign in"}</button>
    <button className="on-text-btn" type="button" onClick={()=>setScreen(s=>s==="register"?"sign-in":"register")}>{screen==="register"?"Already have an account? Sign in":"Create an account"}</button>
    <a href="/game-modes" className="on-link">← Back to game modes</a>
  </form></main>;
  if(!onlineProfile) return <main className="on-center"><form className="on-panel on-auth" onSubmit={createProfile}>
    <p className="on-kicker">FIRST TIME ONLINE</p><h1>Choose your player name</h1>
    <p className="on-sub">We'll give you a unique four-digit ID. Your email stays private.</p>
    <label>Display name<input required maxLength={24} minLength={2} value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Your nickname"/></label>
    {error&&<p role="alert" className="on-error">{error}</p>}
    <button className="on-primary" type="submit" disabled={busy}>Create online profile</button>
    <button className="on-text-btn" type="button" onClick={()=>supabase.auth.signOut()}>Sign out</button>
  </form></main>;
  return children({user,onlineProfile, setOnlineProfile});
}
export default function OnlineApp(){return <BrowserRouter><Gate>{ctx=><div className="on-root">
  <header className="on-header"><a className="on-logo" href="/game-modes">BM <span>ONLINE BETA</span></a>
  <div className="on-player-id">{ctx.onlineProfile.display_name}<b>#{ctx.onlineProfile.player_tag}</b></div></header>
  <Routes>
    <Route path="/online" element={<OnlineHome {...ctx}/>}/>
    <Route path="/online/lobby/:id" element={<OnlineLobby {...ctx}/>}/>
    <Route path="*" element={<main className="on-center"><Link to="/online">← Online Home</Link></main>}/>
  </Routes>
</div>}</Gate></BrowserRouter>}
