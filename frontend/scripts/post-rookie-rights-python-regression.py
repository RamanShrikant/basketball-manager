import copy
import os
import sys

PUBLIC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "python"))
if PUBLIC_PYTHON not in sys.path:
    sys.path.insert(0, PUBLIC_PYTHON)

from free_agency_logic import consume_stale_post_rookie_control, should_extend_qualifying_offer

passed = 0
failed = 0

def check(ok, name):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}")


def make_player(name="Paolo Banchero"):
    return {
        "name": name,
        "age": 23,
        "overall": 88,
        "potential": 92,
        "meta": {"draftYear": 2022, "draftRound": 1, "proSeasons": 4},
        "rights": {
            "heldByTeam": "Orlando Magic",
            "seasonsTowardBird": 3,
            "birdLevel": "bird",
            "rookieScale": True,
            "restrictedFreeAgent": False,
        },
        "contract": {
            "startYear": 2026,
            "salaryByYear": [41_240_250, 44_539_470, 47_838_690, 51_137_910, 54_437_130],
        },
        "qualifyingOfferEligible": {"status": "pending", "amount": 40_000_000},
    }

paolo = make_player()
check(consume_stale_post_rookie_control(paolo) is True, "Python runtime consumes Paolo-style stale control")
check(paolo["rights"]["rookieScale"] is False, "Python runtime sets rookieScale false")
check(paolo["rights"]["restrictedFreeAgent"] is False, "Python runtime clears RFA")
check("qualifyingOfferEligible" not in paolo, "Python runtime clears stale QO eligibility")
check(should_extend_qualifying_offer({}, paolo, "expired_contract") is False, "Post-rookie extension cannot receive qualifying offer")

anthony = make_player("Anthony Black")
anthony["meta"] = {"draftYear": 2023, "draftRound": 1, "proSeasons": 3}
anthony["contract"] = {"startYear": 2026, "salaryByYear": [10_106_316]}
anthony.pop("qualifyingOfferEligible", None)
check(consume_stale_post_rookie_control(anthony) is False, "True final rookie-year contract is preserved")
check(anthony["rights"]["rookieScale"] is True, "True rookie-scale player retains control")
check(should_extend_qualifying_offer({}, anthony, "expired_contract") is True, "True rookie-scale player can still enter QO path")

stale_fa = make_player("Expired Extension FA")
stale_fa["previousContract"] = stale_fa.pop("contract")
stale_fa["rights"]["restrictedFreeAgent"] = True
stale_fa["qualifyingOffer"] = {"teamName": "Orlando Magic", "amount": 42_000_000}
check(consume_stale_post_rookie_control(stale_fa) is True, "Stale FA repaired using previousContract")
check("qualifyingOffer" not in stale_fa and stale_fa["rights"]["restrictedFreeAgent"] is False, "Stale FA QO/RFA state removed")

print(f"\nPython post-rookie rights regression: {passed}/{passed + failed} PASS")
if failed:
    raise SystemExit(1)
