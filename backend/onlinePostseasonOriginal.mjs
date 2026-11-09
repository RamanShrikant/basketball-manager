// Single-player postseason bracket initialization and regular-season snapshot routines.
// Function bodies are copied from frontend/src/pages/Playoffs.jsx (read-only original).
import {sortCanonicalTeamNames} from "./onlinePostseasonCanonical.mjs";
function homeOrderForBestOf7HigherSeedHome() {
  // 2-2-1-1-1 (higher seed home in G1,2,5,7)
  return ["H", "H", "A", "A", "H", "A", "H"];
}
function buildRegularSeasonSnapshot({ standings, seeds }) {
  const rows = Object.values(standings || {}).filter((row) => row?.team);

  const leagueSortedNames = sortCanonicalTeamNames(rows.map((row) => row.team), standings);
  const leagueSorted = leagueSortedNames
    .map((teamName) => standings?.[teamName] || rows.find((row) => row.team === teamName))
    .filter(Boolean);

  const leagueRankByTeam = {};
  leagueSorted.forEach((row, idx) => {
    leagueRankByTeam[row.team] = idx + 1;
  });

  const seedByTeam = {};
  for (const [confKey, teamNames] of Object.entries(seeds || {})) {
    (teamNames || []).forEach((teamName, idx) => {
      seedByTeam[teamName] = {
        conference: confKey,
        conferenceSeed: idx + 1,
      };
    });
  }

  return rows.map((row) => {
    const seedInfo = seedByTeam[row.team] || {};
    const wins = Number(row?.wins || 0);
    const losses = Number(row?.losses || 0);
    const gp = wins + losses;
    const conferenceSeed = Number(seedInfo.conferenceSeed || 0) || null;

    return {
      teamName: row.team,
      conference: row.conf || seedInfo.conference || null,
      wins,
      losses,
      gamesPlayed: gp,
      winPct: gp ? Number((wins / gp).toFixed(3)) : 0,
      pointDifferential: Number(row?.diff || 0),
      pointsFor: Number(row?.pf || 0),
      pointsAgainst: Number(row?.pa || 0),
      conferenceWins: Number(row?.confWins || 0),
      conferenceLosses: Number(row?.confLosses || 0),
      conferenceSeed,
      leagueRank: leagueRankByTeam[row.team] || null,
      topSixSeed: Boolean(conferenceSeed && conferenceSeed <= 6),
      madePlayIn: Boolean(conferenceSeed && conferenceSeed >= 7 && conferenceSeed <= 10),
    };
  });
}
function buildInitialPostseason({ seasonYear, seeds, regularSeasonSnapshot = [] }) {
    const confs = Object.keys(seeds || {});
    const westKey =
      confs.find((k) => String(k).toLowerCase().includes("west")) || confs[0] || "West";
    const eastKey =
      confs.find((k) => String(k).toLowerCase().includes("east")) || confs[1] || "East";

    const mkSeries = (conf, round, label, highSeedTeam, lowSeedTeam, highSeedNum, lowSeedNum) => {
      const homeOrder = homeOrderForBestOf7HigherSeedHome();
      const gameIds = homeOrder.map((_, i) => `PO_${seasonYear}_${conf}_R${round}_${label}_G${i + 1}`);
      return {
        type: "series",
        conf,
        round,
        label,
        highSeedTeam,
        lowSeedTeam,
        highSeedNum,
        lowSeedNum,
        winsHigh: 0,
        winsLow: 0,
        gameIds,
        nextGameIndex: 0,
        complete: false,
      };
    };

    const mkPlayIn = (conf) => {
      const list = seeds[conf] || [];
      const s7 = list[6],
        s8 = list[7],
        s9 = list[8],
        s10 = list[9];
      return {
        conf,
        g78: { id: `PI_${seasonYear}_${conf}_7v8`, home: s7, away: s8, played: false, winner: null, loser: null },
        g910: { id: `PI_${seasonYear}_${conf}_9v10`, home: s9, away: s10, played: false, winner: null, loser: null },
        gFinal: { id: `PI_${seasonYear}_${conf}_8seed`, home: null, away: null, played: false, winner: null, loser: null },
        seed7: null,
        seed8: null,
      };
    };

    const mkConf = (conf) => {
      const list = seeds[conf] || [];
      const s1 = list[0],
        s2 = list[1],
        s3 = list[2],
        s4 = list[3],
        s5 = list[4],
        s6 = list[5];

      return {
        conf,
        playIn: mkPlayIn(conf),
        rounds: {
          r1: {
            s1v8: mkSeries(conf, 1, "1v8", s1, null, 1, 8),
            s4v5: mkSeries(conf, 1, "4v5", s4, s5, 4, 5),
            s3v6: mkSeries(conf, 1, "3v6", s3, s6, 3, 6),
            s2v7: mkSeries(conf, 1, "2v7", s2, null, 2, 7),
          },
          r2: {
            top: mkSeries(conf, 2, "R2_TOP", null, null, null, null),
            bot: mkSeries(conf, 2, "R2_BOT", null, null, null, null),
          },
          r3: {
            confFinals: mkSeries(conf, 3, "CONF_FINALS", null, null, null, null),
          },
        },
      };
    };

    return {
      seasonYear,
      seedOrder: seeds,
      regularSeasonSnapshot,
      layout: { left: westKey, right: eastKey },
      conf: {
        [westKey]: mkConf(westKey),
        [eastKey]: mkConf(eastKey),
      },
      finals: mkSeries("NBA", 4, "FINALS", null, null, null, null),
    };
  }
export {buildRegularSeasonSnapshot,buildInitialPostseason};
