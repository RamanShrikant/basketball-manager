import React, { useMemo } from "react";
import { createPortal } from "react-dom";

function buildRosterLookupFromLeague(leagueData) {
  const byKey = {};
  const byName = {};

  const confs = Object.values(leagueData?.conferences || {});
  const allTeams = confs.flat();

  for (const team of allTeams) {
    const teamName = team?.name || team?.team;
    const teamLogo = team?.logo || "";

    for (const p of team?.players || []) {
      const playerName = p?.name || p?.player;
      if (!playerName || !teamName) continue;

      const info = {
        headshot: p?.headshot || "",
        overall:
          p?.overall ??
          p?.ovr ??
          p?.rating ??
          p?.overall_rating ??
          null,
        pos: p?.pos || p?.position || "",
        secondaryPos: p?.secondaryPos || p?.secondary_pos || "",
        teamLogo,
      };

      byKey[`${playerName}__${teamName}`] = info;

      if (!byName[playerName]) {
        byName[playerName] = info;
      }
    }
  }

  return { byKey, byName };
}

function getRosterInfo(player, lookup) {
  if (!player) return {};

  const exact = lookup.byKey?.[`${player.player}__${player.team}`];
  if (exact) return exact;

  return lookup.byName?.[player.player] || {};
}

function PlayerRow({ player, index, snub = false, lookup }) {
  const info = getRosterInfo(player, lookup);

  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-3 py-3 ${
        snub
          ? "border-neutral-800 bg-neutral-900/60"
          : "border-neutral-700 bg-neutral-800/90"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-5 shrink-0 text-xs text-neutral-400">{index + 1}</span>

        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-950 ring-1 ring-white/10">
          {info.headshot ? (
            <img
              src={info.headshot}
              alt={player.player}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-xs text-neutral-500">N/A</div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {info.teamLogo ? (
              <img
                src={info.teamLogo}
                alt={player.team}
                className="h-5 w-5 shrink-0 object-contain"
              />
            ) : null}

            <span className="truncate text-lg font-semibold text-white">
              {player.player}
            </span>
          </div>

          <div className="mt-1 text-xs text-neutral-400">
            {player.team} • {player.team_wins} wins
          </div>
        </div>
      </div>

      <div className="ml-4 flex shrink-0 items-center gap-4">
        <div className="rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-center">
          <div className="text-[10px] font-semibold tracking-wide text-neutral-400">
            OVR
          </div>
          <div className="text-lg font-extrabold leading-none text-orange-400">
            {info.overall ?? "--"}
          </div>
        </div>

        <div className="text-right text-xs text-neutral-300">
          <div>{player.ppg} PPG</div>
          <div>{player.rpg} RPG • {player.apg} APG</div>
          <div>{player.spg} SPG • {player.bpg} BPG</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, players, snub = false, lookup }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold uppercase tracking-wide text-orange-400">
        {title}
      </h4>

      {players.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-3 text-sm text-neutral-400">
          No players
        </div>
      ) : (
        players.map((player, index) => (
          <PlayerRow
            key={`${title}_${player.player}_${player.team}`}
            player={player}
            index={index}
            snub={snub}
            lookup={lookup}
          />
        ))
      )}
    </div>
  );
}

function ConferenceColumn({ title, data, lookup }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-neutral-950/80 p-4">
      <h3 className="mb-4 text-xl font-bold text-white">{title}</h3>

      <div className="space-y-5">
        <Section title="Starters" players={data?.starters || []} lookup={lookup} />
        <Section title="Reserves" players={data?.reserves || []} lookup={lookup} />
        <Section title="Snubs" players={data?.snubs || []} snub lookup={lookup} />
      </div>
    </div>
  );
}

export default function AllStars({ open, data, onClose }) {
  const leagueData = window.__leagueData;

  const lookup = useMemo(() => {
    return buildRosterLookupFromLeague(leagueData);
  }, [leagueData]);

  if (!open || !data) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-7xl overflow-auto rounded-2xl border border-white/20 bg-neutral-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-orange-400">All-Star Weekend</h2>
            <p className="mt-1 text-sm text-neutral-300">
              {data.season} • Cutoff: {data.cutoff_date || "Midseason"}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              Top 12 per conference. Top 5 are starters, next 7 are reserves.
            </p>
          </div>

          <button
            className="rounded-lg bg-neutral-700 px-4 py-2 font-semibold text-white hover:bg-neutral-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ConferenceColumn title="Eastern Conference" data={data.east} lookup={lookup} />
          <ConferenceColumn title="Western Conference" data={data.west} lookup={lookup} />
        </div>
      </div>
    </div>,
    document.body
  );
}