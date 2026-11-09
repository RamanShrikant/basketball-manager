"""Private Node-service adapter for the EXACT shipped single-player CPU evaluator.
Reads one JSON proposal from stdin and emits exactly one JSON result to stdout.
The frontend is never allowed to supply arbitrary objects to this runner.
"""
import json
import sys
from pathlib import Path
# -I removes the script directory from sys.path; add back only our shipped modules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from trade_negotiation_logic import evaluate_trade, find_trade_offers, NEGOTIATION_KNOBS


def main():
    proposal = json.load(sys.stdin)
    if isinstance(proposal, dict) and proposal.get("operation") == "find":
        # Same shipped single-player trade-finder and CPU scoring code, with a
        # bounded search envelope to protect the trusted online service.
        NEGOTIATION_KNOBS["finderTopCandidates"] = 7.0
        NEGOTIATION_KNOBS["maxFinderOfferAssets"] = 2.0
        NEGOTIATION_KNOBS["finderMaxOffers"] = 12.0
        result = find_trade_offers(proposal.get("search") or {})
        # Only identifiers and the decision leave the Python subprocess.
        # Whole NBA rosters and nested evaluation debug objects are unnecessary
        # and can exceed the Node service output budget.
        result = {
            "ok": result.get("ok") is True,
            "offers": [
                {
                    "teamName": row.get("teamName"),
                    "decision": row.get("decision"),
                    "accepted": row.get("accepted") is True,
                    "score": row.get("score"),
                    "offer": [
                        {"type": item.get("type"), "player": {
                            "id": str((item.get("player") or {}).get("id") or
                                      (item.get("player") or {}).get("playerId") or "")}}
                        for item in row.get("offer", []) if isinstance(item, dict)
                    ],
                }
                for row in result.get("offers", []) if isinstance(row, dict)
            ],
        }
    else:
        result = evaluate_trade(proposal)
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
