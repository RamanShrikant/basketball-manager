import React from "react";
import { Link } from "react-router-dom";
import { AccountControls } from "../auth/AccountControls.jsx";

const card = "group flex min-h-[245px] flex-col justify-between rounded-2xl border border-white/10 bg-[#0d0d0d] p-7 text-left transition hover:border-orange-500/45 hover:bg-[#16100d]";
export default function GameModeLanding({ user }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#050505] px-5 py-12 text-white">
    <section className="w-full max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link to="/studio" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45 hover:text-orange-200">← Samsara Studios</Link><AccountControls user={user} /></div>
      <p className="mt-8 text-[11px] font-black uppercase tracking-[0.2em] text-orange-300">Basketball Manager</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-0.06em] md:text-5xl">Choose Your Mode</h1>
      <p className="mt-3 max-w-xl text-sm text-white/50">Your NBA universe starts here. Each mode keeps its own franchise experience.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link to="/singleplayer" className={card}>
          <div><span className="text-[11px] font-black uppercase tracking-widest text-orange-300">Available • Beta</span>
            <h2 className="mt-4 text-2xl font-black">Singleplayer</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">Control an NBA franchise, manage trades, contracts and draft picks, and simulate years of league history on your own schedule.</p></div>
          <span className="mt-7 text-sm font-black text-orange-200">Choose saves →</span>
        </Link>
        <a href="/online" className={card}>
          <div><span className="text-[11px] font-black uppercase tracking-widest text-white/40">Available • Social Beta</span>
            <h2 className="mt-4 text-2xl font-black">Multiplayer</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">Host a shared franchise, invite friends, select rival NBA teams and manage one synchronized league together.</p></div>
          <span className="mt-7 text-sm font-bold text-white/45">Open Online →</span>
        </a>
      </div>
    </section>
  </main>;
}
