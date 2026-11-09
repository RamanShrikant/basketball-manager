import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "./onlineApi.js";
import "./online-host-governance.css";

const friendlyDate = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
};

/**
 * Read-only current GM map + authenticated, server-verified actions.
 * Never mutates a roster, selected team, franchise runtime, or browser save.
 */
export default function OnlineHostGovernance({ room, user, onChanged }) {
  const lobbyId = room?.lobby?.id;
  const hostId = room?.lobby?.host_id;
  const members = room?.members || [];
  const isHost = hostId === user?.id;
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState("");
  const heartbeatRef = useRef(0);
  const inflightRef = useRef(false);

  const gmName = useCallback(id => {
    const profile = room?.people?.[id];
    return profile?.display_name ? `${profile.display_name}#${profile.player_tag || "----"}`
      : members.find(m => m.user_id === id)?.team_name || "GM";
  }, [room?.people, members]);

  const refresh = useCallback(async () => {
    if (!lobbyId) return;
    try {
      const value = await rpc("bm_online_host_status", { p_lobby: lobbyId });
      setState(value);
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load commissioner controls.");
    }
  }, [lobbyId]);

  // A tab remaining open does not count as commissioner activity. Only initial
  // viewing and real pointer/keyboard/focus activity send bounded heartbeats.
  const recordActivity = useCallback(async () => {
    if (!isHost || !lobbyId || document.visibilityState !== "visible") return;
    const at = Date.now();
    if (at - heartbeatRef.current < 60000 || inflightRef.current) return;
    heartbeatRef.current = at;
    inflightRef.current = true;
    try {
      await rpc("bm_online_host_heartbeat", { p_lobby: lobbyId });
    } catch (e) {
      // The host may have changed on another device. Refresh role immediately.
      setError(e?.message || "Commissioner activity check failed.");
      if (onChanged) void onChanged();
    } finally {
      inflightRef.current = false;
    }
  }, [isHost, lobbyId, onChanged]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!isHost) return;
    heartbeatRef.current = 0;
    void recordActivity();
    const onInteraction = () => void recordActivity();
    document.addEventListener("pointerdown", onInteraction, { passive: true });
    document.addEventListener("keydown", onInteraction);
    window.addEventListener("focus", onInteraction);
    return () => {
      document.removeEventListener("pointerdown", onInteraction);
      document.removeEventListener("keydown", onInteraction);
      window.removeEventListener("focus", onInteraction);
    };
  }, [isHost, recordActivity]);

  const otherGms = useMemo(() => members.filter(m => m.user_id !== hostId), [members, hostId]);
  const votesByCandidate = useMemo(() => new Map((state?.votes || []).map(x => [x.candidate_id, x.votes])), [state?.votes]);

  async function apply(name, params, successMessage) {
    if (busy || !lobbyId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await rpc(name, { p_lobby: lobbyId, ...params });
      setNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
      await refresh();
      if (onChanged) await onChanged();
    } catch (e) {
      setError(e?.message || "Commissioner action failed. No change confirmed.");
    } finally {
      setBusy(false);
    }
  }

  const activeNominee = state?.nominee_id;
  const canAccept = activeNominee === user?.id;
  const eligible = Boolean(state?.recovery_eligible);
  const until = state?.host_last_seen_at
    ? new Date(new Date(state.host_last_seen_at).getTime() + 48 * 60 * 60 * 1000)
    : null;

  return <details className="bmHostGovernance" aria-label="Online commissioner management">
    <summary>Commissioner &amp; Recovery</summary>
    <div className="bmHostGovernanceBody">
      <p>Current commissioner: <strong>{gmName(hostId)}</strong></p>
      {state && <p className="bmHostGovernanceMuted">Last recorded host activity: {friendlyDate(state.host_last_seen_at)}.</p>}
      {error && <p className="bmHostGovernanceError" role="alert">{error}</p>}
      {notice && <p className="bmHostGovernanceNotice" role="status">{notice}</p>}

      {isHost && <div className="bmHostGovernanceSection">
        <strong>Voluntary transfer</strong>
        <p>Offer commissioner control to another GM. Their team and yours stay unchanged; they must accept.</p>
        <select aria-label="Select next commissioner" value={candidate} disabled={busy}
          onChange={event => setCandidate(event.target.value)}>
          <option value="">Choose another GM</option>
          {otherGms.map(m => <option key={m.user_id} value={m.user_id}>{gmName(m.user_id)} · {m.team_name}</option>)}
        </select>
        <button type="button" disabled={busy || !candidate}
          onClick={() => apply("bm_online_host_nominate", { p_candidate: candidate }, "Handoff offered. Waiting for the other GM to accept.")}>
          Offer host role
        </button>
        {activeNominee && <>
          <p className="bmHostGovernanceMuted">Awaiting {gmName(activeNominee)} until {friendlyDate(state.nominee_until)}.</p>
          <button type="button" disabled={busy} onClick={() => apply("bm_online_host_nominate", { p_candidate: null }, "Host offer cancelled.")}>Cancel offer</button>
        </>}
      </div>}

      {canAccept && <div className="bmHostGovernanceSection">
        <strong>Commissioner invitation</strong>
        <p>{gmName(hostId)} offered you commissioner control. You will keep your existing team.</p>
        <button type="button" disabled={busy}
          onClick={() => apply("bm_online_host_accept", {}, "You're the new commissioner. Other GMs will see the change shortly.")}>Accept host role</button>
      </div>}

      {!isHost && <div className="bmHostGovernanceSection">
        <strong>Emergency host recovery</strong>
        <p>The host must have no recorded activity for 48 hours. A majority of non-host GMs must agree, and the nominee must vote for themselves.</p>
        {!eligible && <p className="bmHostGovernanceMuted">Not eligible yet. Earliest recovery: {until ? friendlyDate(until) : "Unknown"}.</p>}
        {eligible && <>
          <p className="bmHostGovernanceMuted">Recovery available · {state?.quorum} vote{state?.quorum === 1 ? "" : "s"} required · votes expire after 24 hours.</p>
          {otherGms.map(m => <div className="bmHostGovernanceVote" key={m.user_id}>
            <span>{gmName(m.user_id)} <small>({votesByCandidate.get(m.user_id) || 0}/{state?.quorum})</small></span>
            <button type="button" disabled={busy || state?.my_vote === m.user_id}
              onClick={() => apply("bm_online_host_recovery_vote", { p_candidate: m.user_id },
                changed => changed ? "Commissioner elected. League authority transferred." : "Vote recorded. Waiting for quorum and nominee consent.")}>
              {state?.my_vote === m.user_id ? "Voted" : "Vote"}
            </button>
          </div>)}
        </>}
      </div>}
    </div>
  </details>;
}
