import React from "react";

// Fits your engine shape: result.totals + result.box.home/away
export default function BoxScoreModal({ result, onClose }) {
  if (!result) return null;

  const homeName =
    result.homeName || result.homeTeamName || result.home || "Home";
  const awayName =
    result.awayName || result.awayTeamName || result.away || "Away";

  const homeScore = result?.totals?.home ?? 0;
  const awayScore = result?.totals?.away ?? 0;

  const homePlayers = result?.box?.home || [];
  const awayPlayers = result?.box?.away || [];

  const parsePair = (s) => {
    if (typeof s !== "string" || !s.includes("/")) return { made: 0, att: 0 };
    const [a, b] = s.split("/").map((x) => parseInt(x, 10) || 0);
    return { made: a, att: b };
  };

  const Row = ({ p }) => {
    const fg = parsePair(p.fg);
    const tp = parsePair(p["3p"]);
    const ft = parsePair(p.ft);
    return (
      <tr className="text-sm">
        <td className="py-1 pr-3">{p.player || p.name || "Player"}</td>
        <td className="text-center">{p.min ?? "-"}</td>
        <td className="text-center">{p.pts ?? "-"}</td>
        <td className="text-center">{fg.made}</td>
        <td className="text-center">{fg.att}</td>
        <td className="text-center">{tp.made}</td>
        <td className="text-center">{tp.att}</td>
        <td className="text-center">{ft.made}</td>
        <td className="text-center">{ft.att}</td>
        <td className="text-center">{p.reb ?? 0}</td>
        <td className="text-center">{p.ast ?? 0}</td>
        <td className="text-center">{p.stl ?? 0}</td>
        <td className="text-center">{p.blk ?? 0}</td>
        <td className="text-center">{p.to ?? p.tov ?? 0}</td>
        <td className="text-center">{p.pf ?? 0}</td>
      </tr>
    );
  };

  const TeamTable = ({ title, arr }) => (
    <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
      <h4 className="font-semibold mb-2">{title}</h4>
      <div className="overflow-x-auto">
        <table className="min-w-[650px] w-full text-left">
          <thead className="text-xs text-gray-300">
            <tr>
              <th className="py-1 pr-3">Player</th>
              <th className="py-1 text-center">MIN</th>
              <th className="py-1 text-center">PTS</th>
              <th className="py-1 text-center">FGM</th>
              <th className="py-1 text-center">FGA</th>
              <th className="py-1 text-center">3PM</th>
              <th className="py-1 text-center">3PA</th>
              <th className="py-1 text-center">FTM</th>
              <th className="py-1 text-center">FTA</th>
              <th className="py-1 text-center">REB</th>
              <th className="py-1 text-center">AST</th>
              <th className="py-1 text-center">STL</th>
              <th className="py-1 text-center">BLK</th>
              <th className="py-1 text-center">TOV</th>
              <th className="py-1 text-center">PF</th>
            </tr>
          </thead>
          <tbody className="text-gray-100">
            {arr && arr.length ? (
              arr.map((p, i) => <Row key={i} p={p} />)
            ) : (
              <tr>
                <td className="py-2 text-gray-400" colSpan={15}>
                  No player lines available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-[960px] max-w-[95vw] max-h-[90vh] overflow-y-auto p-5" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">Box Score</h3>
          <button className="px-3 py-1.5 bg-neutral-700 rounded hover:bg-neutral-600" onClick={onClose}>Close</button>
        </div>

        <div className="flex items-center justify-center gap-6 mb-4">
          <div className="text-center">
            <div className="text-lg font-semibold">{awayName}</div>
            <div className="text-3xl font-extrabold">{awayScore}</div>
          </div>
          <div className="text-gray-400 font-semibold">at</div>
          <div className="text-center">
            <div className="text-lg font-semibold">{homeName}</div>
            <div className="text-3xl font-extrabold">{homeScore}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TeamTable title={awayName} arr={awayPlayers} />
          <TeamTable title={homeName} arr={homePlayers} />
        </div>
      </div>
    </div>
  );
}
