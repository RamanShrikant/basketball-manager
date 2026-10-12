/**
 * Presentation-only explanations for League Intel scouting evidence.
 * This module NEVER calculates a CPU preference, changes its decision, or
 * turns a watchlist candidate into a confirmed offer. Each case corresponds
 * to evidence.kind produced by teamIntelCpuOverlay / the saved observer.
 */
export function explainIntelEvidence({ row = {}, section = "", scoutedTeamName = "" } = {}) {
  const name = String(row?.name || row?.label || "This asset").trim();
  const team = String(scoutedTeamName || "the scouted team").trim();
  const source = String(row?.sourceTeam || row?.sourceTeamName || "the player's current team").trim();
  const kind = String(row?.evidence?.kind || "");
  const projected = /PROJECTED OFFSEASON/i.test(String(row?.evidence?.label || ""));
  switch (kind) {
    case "cpu_hard_core":
      return { heading: "CPU core protection", summary: `${name} passes the existing CPU-to-CPU generator's protected-core check for ${team}. That protects him from that generator's outgoing proposals, but does not make him untradeable in every game mode.`, confidence: "CPU rule verified · limited to this trade-generation lane" };
    case "cpu_outgoing_board":
      return { heading: "Potentially movable", summary: `${name} appears on ${team}'s outgoing-player candidate board, built by the game's existing CPU trade logic for the team's current situation. This is a possible trade piece, not a player ${team} has agreed to give up.`, confidence: "Existing CPU outgoing board · no deal approved" };
    case "cpu_market_watch":
      return { heading: "Market watchlist", summary: `${source}'s CPU trade board identifies ${name} as a possible outgoing player. The game's existing buyer-fit and trade-value models also rank him for ${team}, but that does not establish an active pursuit or an acceptable trade package.`, confidence: "CPU roster fit and market board · unconfirmed interest" };
    case "cpu_mutual_scan":
      return { heading: "Hypothetical trade passed", summary: `A specific ${projected ? "projected offseason " : ""}package involving ${name} passed both sides of the existing CPU trade evaluator when Intel checked it. It is not an actual offer, and the Trade Center must still check the current rules and rosters before any deal could happen.`, confidence: projected ? "Projected offseason evaluator result · not executable confirmation" : "Two-sided evaluator result · not a saved offer" };
    case "user_cpu_accepted_framework":
      return { heading: "Accepted hypothetical framework", summary: `An Intel-tested package involving ${name} passed both the existing market checks and the CPU's user-facing acceptance evaluator. This is still a simulation of a proposed deal—not an offer—and the Trade Center must verify it again against live rules.`, confidence: "User-facing CPU evaluator accepted a hypothetical package" };
    case "cpu_bank_at_generation":
      return { heading: "Recorded CPU trade candidate", summary: `${name} appears in a candidate saved by the game's CPU trade bank. The bank records activity from its generation step; it does not guarantee the same player or package is still available now.`, confidence: "Saved CPU trade-bank evidence · current acceptance unverified" };
    case "trade_desk_report":
      return { heading: "Trade Desk report", summary: `The saved Trade Desk feed links ${name} to a rumor or discussion. Reports are useful scouting context, but are not proof that ${team} has submitted or accepted an actual trade.`, confidence: "Saved rumor or discussion · not confirmed" };
    case "cpu_valuation_only":
      return { heading: "Asset value, not an offer", summary: `The game's existing trade-value model assigns a positive value to ${name} from ${team}'s perspective. That does not mean ${team} has requested the asset or would accept a proposed exchange.${row?.type === "pick" ? " Pick availability also depends on the game's existing draft-pick trade rules." : ""}`, confidence: "Existing CPU asset valuation · no deal approved" };
    case "cpu_preference":
      return { heading: "General team priority", summary: `The game's existing CPU direction model indicates this type of asset may suit ${team}'s current strategy. It does not identify a specific player, pick, negotiation or accepted offer.`, confidence: "Team-wide strategy · not a specific offer" };
    case "roster_analysis":
    case "saved_roster":
    case "roster_leader":
      return { heading: "Roster-based scouting", summary: `${name} is listed using the current saved roster and scouting summary for ${team}. This alone does not mean the CPU's hard protection rules apply or that the player is off the trade market.`, confidence: "Current saved roster · no CPU trade decision" };
    default:
      if (section === "expiring") return { heading: "Contract outlook", summary: `${name} appears on ${team}'s expiring-contract list for the displayed season. The listing comes from the current saved contract information; it is not a prediction of whether the player will re-sign or leave.`, confidence: "Current contract data · future decision unknown" };
      return { heading: "Scouting information", summary: `This listing comes from the current league snapshot or Intel's read-only scouting data. It does not establish CPU trade approval, player availability or an actual negotiation.`, confidence: "Read-only scouting · no confirmed deal" };
  }
}
