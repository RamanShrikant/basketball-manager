import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isAuthConfigured } from "./supabaseClient.js";
import {
  activateAccount, activeBrowserAccountId, checkpointAccount,
  inspectInitialOwnership, recoverInterruptedSwitch, BM_ACCOUNT_OWNER_KEY,
} from "./accountLocalVault.js";
import { acquireAccountGameLock } from "./accountTabLock.js";
import "./AccountRoot.css";

const SIGNIN = "signin";
const REGISTER = "register";

export default function AccountRoot({ children, onInitialize }) {
  const [phase, setPhase] = useState("loading");
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState(SIGNIN);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const activeUserIdRef = useRef("");

  const continueAs = useCallback(async (signedInUser, legacyChoice = null) => {
    const userId = signedInUser?.id;
    if (!userId) { setPhase("auth"); return; }
    activeUserIdRef.current = userId;
    setUser(signedInUser); setPhase("loading"); setError("");
    try {
      if (!await acquireAccountGameLock()) {
        throw new Error("Basketball Manager is already open in another tab. Close that tab and refresh here before switching accounts.");
      }
      await recoverInterruptedSwitch();
      const { needsDecision } = await inspectInitialOwnership(userId);
      if (needsDecision && legacyChoice == null) { setPhase("adopt"); return; }
      const priorOwner = activeBrowserAccountId();
      const result = await activateAccount(userId, { adoptLegacy: legacyChoice === "keep" });
      if ((priorOwner !== userId || result.switched) && window.location.pathname !== "/play") {
        window.history.replaceState(null, "", "/play");
      }
      await onInitialize();
      setPhase("game");
    } catch (err) { setError(err?.message || "Couldn't safely open this account."); setPhase("blocked"); }
  }, [onInitialize]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthConfigured) {
      setError("Supabase is not configured. Check frontend/.env.local and restart npm run dev.");
      setPhase("blocked");
      return;
    }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (cancelled) return;
      if (sessionError) { setError(sessionError.message); setPhase("blocked"); return; }
      if (data?.session?.user) continueAs(data.session.user);
      else setPhase("auth");
    }).catch(err => { if (!cancelled) { setError(err.message); setPhase("blocked"); } });
    // If a separate tab changes the persisted user, never keep using the old
    // in-memory league; force an account check before any further navigation.
    const onStorage = event => {
      if (event.key === BM_ACCOUNT_OWNER_KEY && activeUserIdRef.current && event.newValue !== activeUserIdRef.current) {
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { cancelled = true; window.removeEventListener("storage", onStorage); };
  }, [continueAs]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!supabase) throw new Error("Supabase isn't configured.");
      const cleanEmail = email.trim().toLowerCase();
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");
      if (mode === REGISTER) {
        const { data, error: authError } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (authError) throw authError;
        if (data?.session?.user) await continueAs(data.session.user);
        else setMessage("Account created. If email confirmation is enabled, check your inbox, then sign in.");
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (authError) throw authError;
        await continueAs(data.user);
      }
    } catch (err) { setError(err?.message || "Authentication failed."); }
    finally { setBusy(false); }
  }

  if (phase === "game") return <>{children(user)}</>;

  const blocked = phase === "blocked";
  const adopting = phase === "adopt";
  return (
    <main className="bmAuthScreen">
      <section className="bmAuthPanel" aria-label="Basketball Manager account sign in">
        <div className="bmAuthBrand">BM <span>BASKETBALL MANAGER</span></div>
        <p className="bmAuthEyebrow">YOUR FRANCHISE. YOUR LEGACY.</p>
        {phase === "loading" ? <><h1>Loading your account</h1><p className="bmAuthSubtext">Preparing local franchise data safely…</p></> :
          adopting ? <>
            <h1>Your existing franchises</h1>
            <p className="bmAuthSubtext">We found local Basketball Manager data already in this browser. What should this account use?</p>
            <div className="bmAuthAdoptButtons">
              <button type="button" onClick={() => continueAs(user, "keep")}>Keep existing local franchises</button>
              <button type="button" onClick={() => continueAs(user, "empty")}>Start with an empty account</button>
            </div>
            <p className="bmAuthNote">We archive the existing data locally before switching. Nothing uploads to Supabase.</p>
          </> : blocked ? <>
            <h1>Account setup needs attention</h1>
            <p className="bmAuthError" role="alert">{error}</p>
            <button type="button" className="bmAuthPrimary" onClick={() => window.location.reload()}>Try again</button>
          </> : <>
            <h1>{mode === REGISTER ? "Create your account" : "Welcome back"}</h1>
            <p className="bmAuthSubtext">{mode === REGISTER ? "Build your NBA legacy." : "Sign in to manage your franchise."}</p>
            <form onSubmit={submit} className="bmAuthForm">
              <label htmlFor="bm-auth-email">Email address</label>
              <input id="bm-auth-email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
              <label htmlFor="bm-auth-password">Password</label>
              <input id="bm-auth-password" type="password" autoComplete={mode === REGISTER ? "new-password" : "current-password"} minLength={6} required placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)} />
              <button className="bmAuthPrimary" disabled={busy} type="submit">{busy ? "Please wait…" : mode === REGISTER ? "CREATE ACCOUNT" : "SIGN IN"}</button>
            </form>
            {error && <p className="bmAuthError" role="alert">{error}</p>}
            {message && <p className="bmAuthInfo" role="status">{message}</p>}
            <button type="button" className="bmAuthSwitch" onClick={() => { setMode(mode === REGISTER ? SIGNIN : REGISTER); setError(""); setMessage(""); }}>
              {mode === REGISTER ? "Already have an account? Sign in" : "New player? Create an account"}
            </button>
            <p className="bmAuthNote">Franchises are saved on this browser, not in the cloud. Different devices do not share saves.</p>
          </>}
      </section>
    </main>
  );
}
