import copy
import json
import random
import sys
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SALARY_CAP = 154_647_000
REGULAR_SEASON_MIN_ROSTER = 14
REGULAR_SEASON_MAX_ROSTER = 15
DEFAULT_ROSTER_LIMIT = REGULAR_SEASON_MAX_ROSTER
DEFAULT_SEASON_YEAR = 2026
TWO_WAY_MAX = 3
TWO_WAY_SALARY = 580_000
OFFSEASON_CONTROLLED_MAX = 20

MIN_DEAL = 1_200_000
DEFAULT_MINIMUM_EXCEPTION = 1_500_000
MAX_SALARY = 54_000_000
YEARLY_RAISE = 0.05

DEFAULT_FREE_AGENCY_DAYS = 10
MAX_ACTIVE_OFFERS_PER_TEAM = 5
DEFAULT_ROOM_EXCEPTION = 8_781_000
DEFAULT_NON_TAXPAYER_MLE = 14_104_000
DEFAULT_TAXPAYER_MLE = 5_685_000
TAXPAYING_TEAM_BUFFER = 20_000_000

# Soft CBA/apron defaults
DEFAULT_LUXURY_TAX_LINE = 187_895_000
DEFAULT_FIRST_APRON = 195_945_000
DEFAULT_SECOND_APRON = 207_824_000

# Bird-right offer limits
NON_BIRD_RAISE_MULT = 1.20
EARLY_BIRD_RAISE_MULT = 1.75


def get_room_exception_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("roomException")
        or league_data.get("roomExceptionAmount")
        or DEFAULT_ROOM_EXCEPTION
    )


def get_non_taxpayer_mle_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("midLevelException")
        or league_data.get("nonTaxpayerMLE")
        or league_data.get("nonTaxpayerMidLevelException")
        or DEFAULT_NON_TAXPAYER_MLE
    )


def get_taxpayer_mle_amount(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("taxpayerMLE")
        or league_data.get("taxpayerMidLevelException")
        or DEFAULT_TAXPAYER_MLE
    )


def get_minimum_exception_amount(league_data: Dict[str, Any]) -> int:
    return int(max(
        MIN_DEAL,
        league_data.get("minimumException")
        or league_data.get("minimumSalary")
        or league_data.get("veteranMinimum")
        or DEFAULT_MINIMUM_EXCEPTION,
    ))
OFFSEASON_MIN_ROSTER = REGULAR_SEASON_MIN_ROSTER

def num(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def round_to_nearest(value: float, base: int = 1_000) -> int:
    return int(base * round(float(value) / base))


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def stable_text_seed(text: str) -> int:
    out = 0
    for idx, ch in enumerate(str(text)):
        out += (idx + 1) * ord(ch)
    return out


def get_current_season_year(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("seasonYear")
        or league_data.get("currentSeasonYear")
        or DEFAULT_SEASON_YEAR
    )

def get_operating_season_year(league_data: Dict[str, Any]) -> int:
    season_year = get_current_season_year(league_data)
    state = league_data.get("freeAgencyState", {})
    if isinstance(state, dict) and state.get("isActive"):
        return season_year + 1
    return season_year


def get_salary_cap(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("salaryCap")
        or league_data.get("capLimit")
        or DEFAULT_SALARY_CAP
    )


def get_luxury_tax_line(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("luxuryTaxLine")
        or league_data.get("taxLine")
        or DEFAULT_LUXURY_TAX_LINE
    )


def get_first_apron(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("firstApron")
        or league_data.get("apron1")
        or DEFAULT_FIRST_APRON
    )


def get_second_apron(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("secondApron")
        or league_data.get("apron2")
        or DEFAULT_SECOND_APRON
    )


def get_payroll_zone_for_amount(league_data: Dict[str, Any], payroll: int) -> str:
    payroll = int(num(payroll, 0))

    if payroll >= get_second_apron(league_data):
        return "second_apron"
    if payroll >= get_first_apron(league_data):
        return "first_apron"
    if payroll >= get_luxury_tax_line(league_data):
        return "tax"
    if payroll >= get_salary_cap(league_data):
        return "over_cap"
    return "below_cap"


def calculate_bird_level(seasons_toward_bird: int) -> str:
    seasons = int(num(seasons_toward_bird, 0))

    if seasons >= 3:
        return "bird"
    if seasons == 2:
        return "early_bird"
    if seasons == 1:
        return "non_bird"
    return "none"


def normalize_bird_level(raw_level: Any, seasons_toward_bird: int = 0) -> str:
    level = str(raw_level or "").strip().lower().replace("-", "_").replace(" ", "_")

    aliases = {
        "full_bird": "bird",
        "fullbird": "bird",
        "bird_rights": "bird",
        "earlybird": "early_bird",
        "early_bird": "early_bird",
        "nonbird": "non_bird",
        "non_bird": "non_bird",
        "none": "none",
        "no_rights": "none",
        "": "",
    }

    mapped = aliases.get(level, level)
    if mapped in ["bird", "early_bird", "non_bird", "none"]:
        return mapped

    return calculate_bird_level(seasons_toward_bird)


def get_player_rights(player: Dict[str, Any]) -> Dict[str, Any]:
    raw = player.get("rights")
    if not isinstance(raw, dict):
        raw = {}

    # Surgical RFA/UFA guard:
    # Once rights are renounced, the player must be treated as a true UFA
    # even if an older save still has stale RFA/QO fields on the object.
    if bool(player.get("rightsRenounced")):
        return {
            "heldByTeam": None,
            "seasonsTowardBird": 0,
            "birdLevel": "none",
            "rookieScale": bool(raw.get("rookieScale", False)),
            "restrictedFreeAgent": False,
        }

    seasons = int(num(raw.get("seasonsTowardBird"), 0))
    seasons = max(0, min(3, seasons))
    level = normalize_bird_level(raw.get("birdLevel"), seasons)

    return {
        "heldByTeam": raw.get("heldByTeam"),
        "seasonsTowardBird": seasons,
        "birdLevel": level,
        "rookieScale": bool(raw.get("rookieScale", False)),
        "restrictedFreeAgent": bool(raw.get("restrictedFreeAgent", False)),
    }


def set_player_rights(
    player: Dict[str, Any],
    held_by_team: Optional[str],
    seasons_toward_bird: int,
    rookie_scale: Optional[bool] = None,
    restricted_free_agent: Optional[bool] = None,
) -> Dict[str, Any]:
    old_rights = get_player_rights(player)
    seasons = max(0, min(3, int(num(seasons_toward_bird, 0))))

    player["rights"] = {
        "heldByTeam": held_by_team,
        "seasonsTowardBird": seasons,
        "birdLevel": calculate_bird_level(seasons),
        "rookieScale": old_rights["rookieScale"] if rookie_scale is None else bool(rookie_scale),
        "restrictedFreeAgent": old_rights["restrictedFreeAgent"] if restricted_free_agent is None else bool(restricted_free_agent),
    }

    return player["rights"]


def get_rights_team(player: Dict[str, Any]) -> Optional[str]:
    rights = get_player_rights(player)
    held_by = rights.get("heldByTeam")
    return str(held_by) if held_by not in [None, ""] else None


def is_rights_team(player: Dict[str, Any], team_name: Optional[str]) -> bool:
    if not team_name:
        return False

    rights_team = get_rights_team(player)
    return bool(rights_team and rights_team == team_name)


def get_previous_salary_reference(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
) -> int:
    season_year = get_current_season_year(league_data)

    previous_contract = normalize_contract(player.get("previousContract"))
    current_contract = normalize_contract(player.get("contract"))

    for contract in [previous_contract, current_contract]:
        if not contract:
            continue

        salary = get_contract_salary_for_year(contract, season_year)
        if salary > 0:
            return int(salary)

        salary_by_year = contract.get("salaryByYear", [])
        if salary_by_year:
            return int(num(salary_by_year[-1], 0))

    market_value = player.get("marketValue") or estimate_market_value(player)
    return int(num(market_value.get("expectedYear1Salary"), MIN_DEAL))


def get_bird_rights_salary_ceiling(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
) -> int:
    if not is_rights_team(player, team_name):
        return 0

    rights = get_player_rights(player)
    bird_level = rights.get("birdLevel", "none")
    previous_salary = get_previous_salary_reference(league_data, player)

    if bird_level == "bird":
        return int(MAX_SALARY)

    if bird_level == "early_bird":
        return int(min(MAX_SALARY, max(
            MIN_DEAL,
            get_non_taxpayer_mle_amount(league_data),
            previous_salary * EARLY_BIRD_RAISE_MULT,
        )))

    if bird_level == "non_bird":
        return int(min(MAX_SALARY, max(
            MIN_DEAL,
            previous_salary * NON_BIRD_RAISE_MULT,
        )))

    return 0


def normalize_player_rights_for_location(
    player: Dict[str, Any],
    current_team_name: Optional[str] = None,
) -> Dict[str, Any]:
    # A renounced free agent should not silently regain rights from
    # freeAgencyMeta.fromTeam during later normalization passes.
    # If he is already back on a roster, clear the stale renounced flag first.
    if current_team_name and player.get("rightsRenounced"):
        player.pop("rightsRenounced", None)

    rights = get_player_rights(player)

    if player.get("rightsRenounced") and not current_team_name:
        return set_player_rights(
            player = player,
            held_by_team = None,
            seasons_toward_bird = 0,
            rookie_scale = rights["rookieScale"],
            restricted_free_agent = False,
        )

    if current_team_name:
        held_by_team = current_team_name
        seasons = rights["seasonsTowardBird"]

        if seasons <= 0:
            meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
            years_with_team = int(num(meta.get("yearsWithCurrentTeam"), 1))
            seasons = max(1, min(3, years_with_team))

        return set_player_rights(
            player = player,
            held_by_team = held_by_team,
            seasons_toward_bird = seasons,
            rookie_scale = rights["rookieScale"],
            restricted_free_agent = rights["restrictedFreeAgent"],
        )

    held_by_team = rights.get("heldByTeam")
    seasons = rights["seasonsTowardBird"]

    if not held_by_team:
        meta = player.get("freeAgencyMeta") if isinstance(player.get("freeAgencyMeta"), dict) else {}
        from_team = meta.get("fromTeam")
        if from_team and seasons > 0:
            held_by_team = from_team

    if not held_by_team:
        seasons = 0

    return set_player_rights(
        player = player,
        held_by_team = held_by_team,
        seasons_toward_bird = seasons,
        rookie_scale = rights["rookieScale"],
        restricted_free_agent = rights["restrictedFreeAgent"],
    )


def normalize_all_player_rights(league_data: Dict[str, Any]) -> None:
    for _, _, team in iter_teams(league_data):
        team_name = team.get("name")
        for player in team.get("players", []):
            normalize_player_rights_for_location(player, team_name)

    for player in league_data.get("freeAgents", []):
        normalize_player_rights_for_location(player, None)


def update_player_rights_after_signing(
    player: Dict[str, Any],
    team_name: str,
    signing_source: str = "free_agency",
    matched_rfa: bool = False,
) -> None:
    old_rights = get_player_rights(player)
    old_rights_team = old_rights.get("heldByTeam")
    same_rights_team = bool(old_rights_team and old_rights_team == team_name)

    if same_rights_team:
        seasons = max(1, old_rights["seasonsTowardBird"])
    else:
        seasons = 1

    set_player_rights(
        player = player,
        held_by_team = team_name,
        seasons_toward_bird = seasons,
        rookie_scale = old_rights["rookieScale"],
        restricted_free_agent = False,
    )
    player.pop("rightsRenounced", None)

    meta = player.setdefault("meta", {})
    if not isinstance(meta, dict):
        player["meta"] = {}
        meta = player["meta"]

    if matched_rfa:
        meta["acquiredVia"] = "rfa_matched"
    elif same_rights_team:
        meta["acquiredVia"] = "re_signed"
    else:
        meta["acquiredVia"] = signing_source

    if same_rights_team:
        meta["yearsWithCurrentTeam"] = max(1, int(num(meta.get("yearsWithCurrentTeam"), 1)))
    else:
        meta["yearsWithCurrentTeam"] = 1

    player.pop("qualifyingOffer", None)
    player.pop("freeAgencyMeta", None)


def should_extend_qualifying_offer(
    team: Dict[str, Any],
    player: Dict[str, Any],
    reason: str,
) -> bool:
    rights = get_player_rights(player)

    if not rights.get("rookieScale"):
        return False

    if reason == "declined_team_option":
        return False

    age = int(num(player.get("age"), 24))
    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))

    if age > 27:
        return False

    if overall >= 70:
        return True

    if potential >= overall + 3:
        return True

    if potential >= 73:
        return True

    return False


def get_qualifying_offer_amount(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
) -> int:
    previous_salary = get_previous_salary_reference(league_data, player)
    amount = max(MIN_DEAL, int(round(previous_salary * 1.25)))
    return int(round_to_nearest(amount, base = 1_000))


def apply_qualifying_offer_if_needed(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    reason: str,
) -> None:
    if not should_extend_qualifying_offer(team, player, reason):
        return

    rights = get_player_rights(player)
    set_player_rights(
        player = player,
        held_by_team = team_name,
        seasons_toward_bird = max(1, rights["seasonsTowardBird"]),
        rookie_scale = rights["rookieScale"],
        restricted_free_agent = True,
    )

    player["qualifyingOffer"] = {
        "teamName": team_name,
        "amount": get_qualifying_offer_amount(league_data, player),
        "seasonYear": season_year + 1,
        "status": "extended",
    }


def mark_qualifying_offer_pending_if_needed(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    reason: str,
) -> None:
    if not should_extend_qualifying_offer(team, player, reason):
        return

    rights = get_player_rights(player)
    set_player_rights(
        player = player,
        held_by_team = team_name,
        seasons_toward_bird = max(1, rights["seasonsTowardBird"]),
        rookie_scale = rights["rookieScale"],
        restricted_free_agent = False,
    )

    player.pop("qualifyingOffer", None)
    player["qualifyingOfferEligible"] = {
        "teamName": team_name,
        "amount": get_qualifying_offer_amount(league_data, player),
        "seasonYear": season_year + 1,
        "status": "pending",
    }


def process_qualifying_offer_after_entry(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    reason: str,
    user_team_name: Optional[str] = None,
) -> None:
    if user_team_name and team_name == user_team_name:
        mark_qualifying_offer_pending_if_needed(
            league_data = league_data,
            team = team,
            player = player,
            team_name = team_name,
            season_year = season_year,
            reason = reason,
        )
        return

    apply_qualifying_offer_if_needed(
        league_data = league_data,
        team = team,
        player = player,
        team_name = team_name,
        season_year = season_year,
        reason = reason,
    )


def get_roster_limit(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("rosterLimit")
        or league_data.get("maxRosterSize")
        or REGULAR_SEASON_MAX_ROSTER
    )


def get_min_roster_target(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("minRosterSize")
        or league_data.get("minRosterLimit")
        or REGULAR_SEASON_MIN_ROSTER
    )

def get_free_agency_min_roster_target(league_data: Dict[str, Any]) -> int:
    return int(
        league_data.get("freeAgencyMinRosterSize")
        or league_data.get("offseasonMinRosterSize")
        or league_data.get("minRosterSize")
        or league_data.get("minRosterLimit")
        or REGULAR_SEASON_MIN_ROSTER
    )


def iter_teams(league_data: Dict[str, Any]):
    conferences = league_data.get("conferences", {})
    for conf_name in ["East", "West"]:
        for idx, team in enumerate(conferences.get(conf_name, [])):
            yield conf_name, idx, team


def find_team_entry(
    league_data: Dict[str, Any],
    team_name: str
) -> Tuple[Optional[str], Optional[int], Optional[Dict[str, Any]]]:
    for conf_name, idx, team in iter_teams(league_data):
        if team.get("name") == team_name:
            return conf_name, idx, team
    return None, None, None


def get_option_year_indices(option: Optional[Dict[str, Any]]) -> List[int]:
    if not option:
        return []

    if isinstance(option.get("yearIndices"), list):
        raw = option.get("yearIndices", [])
    elif option.get("yearIndex") is not None:
        raw = [option.get("yearIndex")]
    else:
        raw = []

    out = []
    seen = set()

    for item in raw:
        try:
            n = int(item)
        except (TypeError, ValueError):
            continue
        if n < 0 or n in seen:
            continue
        seen.add(n)
        out.append(n)

    out.sort()
    return out


def normalize_contract(contract: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if contract is None:
        return None

    start_year = int(contract.get("startYear", DEFAULT_SEASON_YEAR))
    salary_by_year = contract.get("salaryByYear", [8_000_000])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        salary_by_year = [8_000_000]

    safe_salary_by_year = [int(round(num(x, 0))) for x in salary_by_year]
    raw_option = contract.get("option")

    safe_option = None
    if raw_option:
        option_type = raw_option.get("type")
        if option_type in ["team", "player"]:
            safe_option = {
                "type": option_type,
                "yearIndices": get_option_year_indices(raw_option),
                "picked": raw_option.get("picked"),
            }

    return {
        "startYear": start_year,
        "salaryByYear": safe_salary_by_year,
        "option": safe_option,
    }


def build_salary_by_year(year1_salary: int, years: int) -> List[int]:
    out = []
    for i in range(int(clamp(years, 1, 4))):
        salary = year1_salary * ((1 + YEARLY_RAISE) ** i)
        out.append(int(round_to_nearest(salary, base = 1_000)))
    return out


# ------------------------------------------------------------
# FREE AGENCY CONTRACT LENGTH / OPTION SHAPE HELPERS
# ------------------------------------------------------------
def get_realistic_expected_contract_years(player: Dict[str, Any]) -> int:
    """More aggressive NBA-lite expected free-agency contract length, capped at 4 years.

    Surgical contract-shape rule:
    - 76+ OVR players in their 20s can get 4-year deals.
    - 81+ OVR players through age 31 can still expect 4-year deals.
    - 85+ OVR players through age 34 can still expect 4-year deals.
    - Useful 2-year cases become 3 years more often.
    - Useful older 1-year cases become 2 years more often.
    - True fringe/minimum players and old low-end vets stay short.
    - This helper is shared by market-value expectations and CPU offer building
      so realistic offers are not punished for matching the new expectedYears.
    """
    overall = float(num(player.get("overall"), 75))
    age = int(num(player.get("age"), 27))
    potential = float(num(player.get("potential"), overall))
    upside = max(0.0, potential - overall)

    minimum_bucket = (
        overall <= 72
        or (overall <= 73 and age >= 30 and upside <= 1)
        or (overall <= 74 and age >= 32 and upside <= 1)
    )

    if minimum_bucket:
        if age <= 25 and upside >= 4:
            return 2
        return 1 if age >= 30 else 2

    if overall >= 90:
        if age <= 34:
            years = 4
        elif age <= 36:
            years = 3
        elif age <= 38:
            years = 2
        else:
            years = 1

    elif overall >= 88:
        if age <= 34:
            years = 4
        elif age <= 35:
            years = 3
        elif age <= 38:
            years = 2
        else:
            years = 1

    elif overall >= 85:
        if age <= 34:
            years = 4
        elif age <= 36:
            years = 2
        elif age <= 37 and overall >= 87:
            years = 2
        else:
            years = 1

    elif overall >= 81:
        if age <= 31:
            years = 4
        elif age <= 34:
            years = 3
        elif age <= 37:
            years = 2
        else:
            years = 1

    elif overall >= 78:
        if age <= 29:
            years = 4
        elif age <= 31:
            years = 3
        elif age <= 34:
            years = 2
        elif age <= 36 and overall >= 80:
            years = 2
        else:
            years = 1

    elif overall >= 76:
        if age <= 29:
            years = 4
        elif age <= 31:
            years = 3
        elif age <= 33:
            years = 2
        else:
            years = 1

    elif overall >= 74:
        if age <= 25 and upside >= 3:
            years = 3
        elif age <= 28:
            years = 2
        elif age <= 31 and overall >= 75:
            years = 2
        else:
            years = 1

    elif overall >= 73:
        if age <= 25 and upside >= 3:
            years = 3
        elif age <= 29:
            years = 2
        else:
            years = 1

    else:
        years = 1

    # Young upside players should get more team commitment.
    if age <= 24 and upside >= 4 and overall >= 74:
        years = min(4, years + 1)

    # Prime/near-prime players who are already good should not be stuck short.
    if age <= 29 and overall >= 76:
        years = max(years, 4)

    if age <= 31 and overall >= 81:
        years = max(years, 4)

    if age <= 34 and overall >= 85:
        years = max(years, 4)

    # Useful older players should not all collapse to one-year deals.
    if 35 <= age <= 37 and overall >= 82:
        years = max(years, 2)

    if 36 <= age <= 38 and overall >= 90:
        years = max(years, 2)

    return int(clamp(years, 1, 4))

def build_cpu_offer_option(
    player: Dict[str, Any],
    years: int,
    target_tier: str,
    salary_ratio: float,
    rng: random.Random,
) -> Optional[Dict[str, Any]]:
    """Choose a light, realistic final-year option for CPU FA offers.

    Player options go to high-leverage targets when the team is making a real
    multi-year push, and to older stars/vets. Team options stay limited to
    young depth/reclamation players where the team is taking risk.
    """
    years = int(num(years, 1))
    if years <= 1:
        return None

    overall = int(round(num(player.get("overall"), 75)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)
    target_tier = str(target_tier or "value")
    salary_ratio = float(num(salary_ratio, 1.0))
    rights = get_player_rights(player)

    premium_multi_year_target = bool(
        years >= 3
        and target_tier in ["primary", "incumbent"]
    )
    rfa_core_target = bool(
        premium_multi_year_target
        and rights.get("restrictedFreeAgent")
        and age <= 27
        and (overall >= 78 or potential >= 84 or upside >= 4)
    )

    # Premium target structures:
    # If a team is chasing one of its top multi-year targets, especially a star,
    # young core piece, or RFA/core player, it should be willing to include a
    # final-year player option as a selling point.
    player_option_chance = 0.0
    if premium_multi_year_target:
        if overall >= 90 or potential >= 92:
            player_option_chance = 0.90
        elif overall >= 86 or potential >= 89:
            player_option_chance = 0.80
        elif overall >= 82 or potential >= 86:
            player_option_chance = 0.68
        elif overall >= 80 and (upside >= 4 or rfa_core_target):
            player_option_chance = 0.55
        elif overall >= 78 and potential >= 84 and years >= 4:
            player_option_chance = 0.42

        if rfa_core_target:
            player_option_chance = max(player_option_chance, 0.66)

        if salary_ratio < 0.985 and player_option_chance > 0:
            player_option_chance += 0.06

    # High-leverage veteran/star structures: final-year player option is common.
    if overall >= 88 and age >= 34:
        player_option_chance = max(player_option_chance, 0.50)
    if overall >= 86 and age >= 35:
        player_option_chance = max(player_option_chance, 0.64)
    if overall >= 84 and age >= 36:
        player_option_chance = max(player_option_chance, 0.56)
    if overall >= 82 and age >= 36 and years == 2:
        player_option_chance = max(player_option_chance, 0.40)
    if overall >= 84 and salary_ratio < 0.965 and target_tier in ["primary", "incumbent", "backup"]:
        player_option_chance = max(player_option_chance, 0.36)

    # Young non-premium offers should still usually stay clean guaranteed deals.
    if age <= 28 and not premium_multi_year_target and not rfa_core_target:
        player_option_chance = 0.0

    if player_option_chance > 0 and rng.random() < min(0.92, player_option_chance):
        return {
            "type": "player",
            "yearIndices": [years - 1],
            "picked": None,
        }

    # Team options should be for low-leverage upside/depth, never real starters.
    team_option_chance = 0.0
    if overall <= 74 and age <= 27:
        team_option_chance = 0.58
    elif overall <= 76 and age <= 27:
        team_option_chance = 0.44 if upside >= 2 or target_tier in ["value", "depth"] else 0.28
    elif overall <= 78 and age <= 25 and target_tier == "depth":
        team_option_chance = 0.26

    if salary_ratio >= 1.03 and overall <= 76 and age <= 28:
        team_option_chance += 0.10

    if overall >= 79 or target_tier in ["primary", "incumbent"]:
        team_option_chance = 0.0

    if team_option_chance > 0 and rng.random() < min(0.70, team_option_chance):
        return {
            "type": "team",
            "yearIndices": [years - 1],
            "picked": None,
        }

    return None


def get_contract_year_index(contract: Optional[Dict[str, Any]], season_year: int) -> Optional[int]:
    contract = normalize_contract(contract)
    if not contract:
        return None
    return season_year - contract["startYear"]


def get_contract_last_year(contract: Optional[Dict[str, Any]]) -> Optional[int]:
    contract = normalize_contract(contract)
    if not contract:
        return None
    return contract["startYear"] + len(contract["salaryByYear"]) - 1


def get_contract_salary_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    contract = normalize_contract(contract)
    if not contract:
        return 0

    idx = season_year - contract["startYear"]
    salary_by_year = contract["salaryByYear"]

    if idx < 0 or idx >= len(salary_by_year):
        return 0

    return int(salary_by_year[idx])


def get_next_season_salary(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    return get_contract_salary_for_year(contract, season_year + 1)


def get_option_pick_value(option: Optional[Dict[str, Any]], year_index: int):
    if not option:
        return None

    raw_picked = option.get("picked")

    if isinstance(raw_picked, dict):
        if str(year_index) in raw_picked:
            return raw_picked[str(year_index)]
        if "default" in raw_picked:
            return raw_picked["default"]
        return None

    return raw_picked


def get_active_option_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> Optional[Dict[str, Any]]:
    contract = normalize_contract(contract)
    if not contract:
        return None

    option = contract.get("option")
    if not option:
        return None

    salary_by_year = contract["salaryByYear"]
    year_indices = get_option_year_indices(option)
    target_idx = season_year - contract["startYear"]

    # Normal case: the option year already exists as a real future salary slot
    if 0 <= target_idx < len(salary_by_year) and target_idx in year_indices:
        picked_value = get_option_pick_value(option, target_idx)
        if picked_value is not None:
            return None

        return {
            "type": option.get("type"),
            "yearIndex": target_idx,
            "salary": int(salary_by_year[target_idx]),
            "picked": picked_value,
            "bridgeOption": False,
            "targetSeasonYear": season_year,
        }

    # Bridge case: one stored salary year with option index [0]
    # Treat that as a pending option decision for the following offseason.
    # Player-specific rookie-scale final-year cases are filtered by
    # get_active_option_for_player_for_year(...) before this generic bridge is used.
    source_idx = target_idx - 1
    if (
        len(salary_by_year) == 1
        and source_idx == 0
        and source_idx in year_indices
    ):
        picked_value = get_option_pick_value(option, source_idx)
        if picked_value is not None:
            return None

        return {
            "type": option.get("type"),
            "yearIndex": source_idx,
            "salary": int(salary_by_year[source_idx]),
            "picked": picked_value,
            "bridgeOption": True,
            "targetSeasonYear": season_year,
        }

    return None


def get_player_pro_seasons(player: Dict[str, Any]) -> int:
    direct_keys = [
        "proSeasons",
        "seasonsPro",
        "yearsPro",
        "yearsOfExperience",
        "yoe",
    ]

    for key in direct_keys:
        if player.get(key) not in [None, ""]:
            return int(num(player.get(key), 0))

    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    for key in direct_keys:
        if meta.get(key) not in [None, ""]:
            return int(num(meta.get(key), 0))

    return 0


def is_completed_final_rookie_scale_team_option(
    player: Dict[str, Any],
    current_season_year: int,
) -> bool:
    contract = normalize_contract(player.get("contract"))
    if not contract:
        return False

    rights = get_player_rights(player)
    if not rights.get("rookieScale"):
        return False

    if get_player_pro_seasons(player) < 4:
        return False

    option = contract.get("option")
    if not option or option.get("type") != "team":
        return False

    salary_by_year = contract.get("salaryByYear", [])
    year_indices = get_option_year_indices(option)

    if year_indices != [0]:
        return False

    picked_value = get_option_pick_value(option, 0)
    if picked_value is not None and picked_value is False:
        return False

    start_year = int(contract.get("startYear", DEFAULT_SEASON_YEAR))
    if start_year > int(current_season_year):
        return False

    # Normal raw data shape: one final rookie-scale option salary.
    # That option carried the player through the just-finished season.
    # The next offseason control mechanism is the qualifying offer.
    if len(salary_by_year) == 1:
        return True

    # Recovery shape from older logic / old saves:
    # a bridge-option exercise duplicated the same final rookie-option salary
    # into the next year, e.g. [4878938, 4878938] with picked {"0": true}.
    # This is not a real extra cheap team option year. It still goes to QO/RFA.
    if (
        len(salary_by_year) == 2
        and picked_value is True
        and int(num(salary_by_year[0], 0)) == int(num(salary_by_year[1], 0))
    ):
        return True

    return False

def get_active_option_for_player_for_year(
    player: Dict[str, Any],
    contract: Optional[Dict[str, Any]],
    option_season_year: int,
    current_season_year: int,
) -> Optional[Dict[str, Any]]:
    if is_completed_final_rookie_scale_team_option(player, current_season_year):
        return None

    return get_active_option_for_year(contract, option_season_year)

def set_option_pick_for_year(contract: Dict[str, Any], year_index: int, picked_value: bool) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    if not normalized or not normalized.get("option"):
        return normalized

    raw_picked = normalized["option"].get("picked")

    if isinstance(raw_picked, dict):
        picked_map = dict(raw_picked)
    elif raw_picked is None:
        picked_map = {}
    else:
        picked_map = {"default": raw_picked}

    picked_map[str(year_index)] = bool(picked_value)
    normalized["option"]["picked"] = picked_map
    return normalized

def apply_option_exercise_to_contract(
    contract: Dict[str, Any],
    active_option: Dict[str, Any]
) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    if not normalized or not active_option:
        return normalized

    if active_option.get("bridgeOption"):
        target_season_year = int(active_option.get("targetSeasonYear"))
        target_idx = target_season_year - normalized["startYear"]
        salary_by_year = list(normalized.get("salaryByYear", []))

        while len(salary_by_year) <= target_idx:
            salary_by_year.append(int(active_option.get("salary", 0)))

        salary_by_year[target_idx] = int(active_option.get("salary", 0))
        normalized["salaryByYear"] = salary_by_year

    normalized = set_option_pick_for_year(
        contract = normalized,
        year_index = int(active_option.get("yearIndex", 0)),
        picked_value = True,
    )
    return normalized


def get_player_salary_for_year(player: Dict[str, Any], season_year: int) -> int:
    return get_contract_salary_for_year(player.get("contract"), season_year)


def get_team_players(team: Dict[str, Any]) -> List[Dict[str, Any]]:
    return team.get("players", [])


def get_dead_cap_map(league_data: Dict[str, Any]) -> Dict[str, Any]:
    raw = league_data.setdefault("deadCapByTeam", {})
    if not isinstance(raw, dict):
        league_data["deadCapByTeam"] = {}
    return league_data["deadCapByTeam"]


def get_team_dead_cap_rows(league_data: Dict[str, Any], team_name: str) -> List[Dict[str, Any]]:
    dead_cap_map = get_dead_cap_map(league_data)
    rows = dead_cap_map.setdefault(team_name, [])
    if not isinstance(rows, list):
        dead_cap_map[team_name] = []
        rows = dead_cap_map[team_name]

    # Recovery for old saves from the stretch-test build. The active game rule
    # is now normal release dead cap, so stale stretched rows are converted back
    # before payroll/cap snapshots read them.
    if any(isinstance(row, dict) and row.get("stretchApplied") and row.get("originalRemainingRows") for row in rows):
        normalize_dead_cap_rows_no_stretch_for_team(league_data, team_name)
        rows = dead_cap_map.setdefault(team_name, [])

    return rows


def get_team_dead_cap_for_year(league_data: Dict[str, Any], team_name: str, season_year: int) -> int:
    total = 0
    for row in get_team_dead_cap_rows(league_data, team_name):
        if int(num(row.get("seasonYear"), -1)) == int(season_year):
            total += int(num(row.get("amount"), 0))
    return total


def get_dead_cap_setoff_minimum(league_data: Dict[str, Any]) -> int:
    # NBA-lite set-off baseline.
    # Real NBA set-off is based on salary above a minimum-style baseline.
    # Use the same minimum amount the rest of the free-agency engine reads,
    # not the hardcoded MIN_DEAL, so backend cap math and Salary Table match.
    return int(get_minimum_exception_amount(league_data))


def get_dead_cap_setoff_credit(league_data: Dict[str, Any], replacement_salary: int) -> int:
    salary = int(num(replacement_salary, 0))
    baseline = get_dead_cap_setoff_minimum(league_data)
    raw_credit = max(0, (salary - baseline) * 0.5)
    return int(round_to_nearest(raw_credit, base = 1_000))


def apply_dead_cap_setoff_for_signed_player(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    signing_team_name: str,
    contract: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    meta = player.get("freeAgencyMeta") if isinstance(player.get("freeAgencyMeta"), dict) else {}
    from_team_name = meta.get("fromTeam") or player.get("releasedFromTeam")
    reason = str(meta.get("reason") or player.get("releaseReason") or "").lower()

    if not from_team_name or from_team_name == signing_team_name:
        return []

    if reason not in ["released", "release", "release_to_free_agency", "waived"]:
        return []

    normalized_contract = normalize_contract(contract)
    if not normalized_contract:
        return []

    rows = get_team_dead_cap_rows(league_data, from_team_name)
    updated_rows = []
    player_id = player.get("id")
    player_name = player.get("name")

    for row in rows:
        same_player = False
        if player_id not in [None, ""] and row.get("playerId") == player_id:
            same_player = True
        elif player_name and row.get("playerName") == player_name:
            same_player = True

        if not same_player:
            continue

        season_year = int(num(row.get("seasonYear"), -1))
        replacement_salary = get_contract_salary_for_year(normalized_contract, season_year)
        if replacement_salary <= 0:
            continue

        original_amount = int(num(row.get("originalAmount"), row.get("amount")))
        if original_amount <= 0:
            continue

        credit = get_dead_cap_setoff_credit(league_data, replacement_salary)
        target_credit = min(credit, original_amount)
        already_credited = int(num(
            row.get("setOffCredit")
            or row.get("setOffAmount")
            or row.get("offsetAmount"),
            0,
        ))

        # Idempotent set-off:
        # the credit for a season should be the formula result, not a value that
        # gets added again every time the same signing is processed or re-saved.
        final_credit = max(already_credited, target_credit)
        if final_credit <= 0:
            continue

        row["originalAmount"] = original_amount
        row["setOffCredit"] = final_credit
        row["setOffAmount"] = final_credit
        row["offsetAmount"] = final_credit
        row["amount"] = max(0, original_amount - final_credit)
        row["netAmount"] = row["amount"]

        # Save both old/new field names so every existing frontend table and
        # popup can read the same set-off result without extra migration work.
        row["setOffSignedWith"] = signing_team_name
        row["setOffTeamName"] = signing_team_name
        row["offsetTeamName"] = signing_team_name
        row["setOffReplacementSalary"] = int(replacement_salary)
        row["setOffSignedSalary"] = int(replacement_salary)
        row["offsetSignedSalary"] = int(replacement_salary)
        row["setOffMinimumBaseline"] = get_dead_cap_setoff_minimum(league_data)
        row["setOffFormula"] = "50% of replacement salary above minimum salary, capped by original dead cap"
        updated_rows.append(copy.deepcopy(row))

    return updated_rows



def build_release_dead_cap_rows(
    player: Dict[str, Any],
    team_name: str,
    contract: Dict[str, Any],
    current_season_year: int,
    reason: str = "release",
) -> List[Dict[str, Any]]:
    """Build normal released-player dead-cap rows.

    This game now treats a standard Release to Free Agency as a normal release,
    not a stretch-waive. The old team keeps the player's original remaining
    guaranteed salary on the original contract seasons. If another team signs
    the released player later, apply_dead_cap_setoff_for_signed_player(...) can
    reduce those rows using the saved set-off formula.
    """
    remaining_rows = []

    for idx, amount in enumerate(contract["salaryByYear"]):
        season_year = int(contract["startYear"] + idx)
        amount_int = int(num(amount, 0))

        if season_year < int(current_season_year):
            continue
        if amount_int <= 0:
            continue

        remaining_rows.append({
            "seasonYear": season_year,
            "amount": amount_int,
        })

    if not remaining_rows:
        return []

    remaining_years = len(remaining_rows)
    total_guaranteed = int(sum(row["amount"] for row in remaining_rows))
    first_dead_cap_year = int(remaining_rows[0]["seasonYear"])
    last_dead_cap_year = int(remaining_rows[-1]["seasonYear"])
    group_id = f"release-normal:{player.get('id') or player.get('name')}:{team_name}:{current_season_year}"

    created_rows = []

    for row in remaining_rows:
        amount_int = int(num(row.get("amount"), 0))
        season_year = int(num(row.get("seasonYear"), current_season_year))

        created_rows.append({
            "playerName": player.get("name"),
            "playerId": player.get("id"),
            "teamName": team_name,
            "seasonYear": season_year,
            "amount": amount_int,
            "originalAmount": amount_int,
            "setOffCredit": 0,
            "setOffAmount": 0,
            "offsetAmount": 0,
            "netAmount": amount_int,
            "reason": reason,
            "source": "released_player_contract",
            "deadCapMethod": "normal_release",
            "stretchApplied": False,
            "stretchYears": int(remaining_years),
            "stretchAnnualAmount": 0,
            "remainingContractYears": int(remaining_years),
            "totalGuaranteedOwed": int(total_guaranteed),
            "originalRemainingRows": remaining_rows,
            "firstDeadCapSeason": int(first_dead_cap_year),
            "lastDeadCapSeason": int(last_dead_cap_year),
            "deadCapGroupId": group_id,
            "pos": player.get("pos") or player.get("position"),
            "position": player.get("pos") or player.get("position"),
            "overall": player.get("overall"),
            "headshot": player.get("headshot") or player.get("playerHeadshot") or player.get("image"),
        })

    return created_rows


def normalize_dead_cap_rows_no_stretch_for_team(
    league_data: Dict[str, Any],
    team_name: str,
) -> None:
    """Convert old saved stretch rows back to normal original-contract rows.

    Earlier test builds saved stretched dead-cap rows with originalRemainingRows.
    This keeps old saves from continuing to show stretched salary after the
    release model was changed back to normal dead cap.
    """
    dead_cap_map = get_dead_cap_map(league_data)
    rows = dead_cap_map.setdefault(team_name, [])
    if not isinstance(rows, list):
        dead_cap_map[team_name] = []
        return

    next_rows = []
    converted_groups = set()
    existing_keys = set()

    def add_row_once(row: Dict[str, Any]) -> None:
        key = (
            row.get("playerId"),
            row.get("playerName"),
            int(num(row.get("seasonYear"), -1)),
            int(num(row.get("originalAmount", row.get("amount")), 0)),
            row.get("reason"),
        )
        if key in existing_keys:
            return
        existing_keys.add(key)
        next_rows.append(row)

    for row in rows:
        if not isinstance(row, dict):
            continue

        original_rows = row.get("originalRemainingRows")
        should_convert = bool(row.get("stretchApplied")) and isinstance(original_rows, list) and len(original_rows) > 0

        if not should_convert:
            add_row_once(row)
            continue

        group_id = row.get("deadCapGroupId") or f"{row.get('playerId')}|{row.get('playerName')}|{row.get('reason')}"
        if group_id in converted_groups:
            continue
        converted_groups.add(group_id)

        clean_original_rows = []
        for original in original_rows:
            if not isinstance(original, dict):
                continue
            season_year = int(num(original.get("seasonYear"), -1))
            amount = int(num(original.get("amount"), 0))
            if season_year < 0 or amount <= 0:
                continue
            clean_original_rows.append({"seasonYear": season_year, "amount": amount})

        if not clean_original_rows:
            continue

        clean_original_rows.sort(key = lambda item: int(item.get("seasonYear", 0)))
        total_guaranteed = int(sum(item["amount"] for item in clean_original_rows))
        remaining_years = len(clean_original_rows)
        first_dead_cap_year = int(clean_original_rows[0]["seasonYear"])
        last_dead_cap_year = int(clean_original_rows[-1]["seasonYear"])
        normal_group_id = str(group_id).replace("release-stretch:", "release-normal:")

        for original in clean_original_rows:
            amount = int(original["amount"])
            season_year = int(original["seasonYear"])
            rebuilt = {
                **row,
                "teamName": team_name,
                "seasonYear": season_year,
                "amount": amount,
                "originalAmount": amount,
                "setOffCredit": 0,
                "setOffAmount": 0,
                "offsetAmount": 0,
                "netAmount": amount,
                "source": "released_player_contract",
                "deadCapMethod": "normal_release",
                "stretchApplied": False,
                "stretchYears": remaining_years,
                "stretchAnnualAmount": 0,
                "remainingContractYears": remaining_years,
                "totalGuaranteedOwed": total_guaranteed,
                "originalRemainingRows": clean_original_rows,
                "firstDeadCapSeason": first_dead_cap_year,
                "lastDeadCapSeason": last_dead_cap_year,
                "deadCapGroupId": normal_group_id,
            }
            add_row_once(rebuilt)

    dead_cap_map[team_name] = next_rows

def add_dead_cap_from_player_contract(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    current_season_year: int,
    reason: str = "release"
) -> List[Dict[str, Any]]:
    contract = normalize_contract(player.get("contract"))
    if not contract:
        return []

    rows = get_team_dead_cap_rows(league_data, team_name)
    created = []
    candidate_rows = build_release_dead_cap_rows(
        player = player,
        team_name = team_name,
        contract = contract,
        current_season_year = current_season_year,
        reason = reason,
    )

    for row in candidate_rows:
        amount_int = int(num(row.get("originalAmount", row.get("amount")), 0))
        season_year = int(num(row.get("seasonYear"), -1))
        group_id = row.get("deadCapGroupId")

        # Guard against repeated UI clicks / stale retries duplicating dead cap.
        already_exists = any(
            existing.get("playerId") == row.get("playerId")
            and existing.get("playerName") == row.get("playerName")
            and int(num(existing.get("seasonYear"), -1)) == int(season_year)
            and int(num(existing.get("originalAmount", existing.get("amount")), 0)) == amount_int
            and existing.get("reason") == reason
            and (
                not group_id
                or existing.get("deadCapGroupId") == group_id
                or existing.get("source") == row.get("source")
            )
            for existing in rows
        )

        if already_exists:
            continue

        rows.append(row)
        created.append(row)

    return created




def get_team_player_payroll(team: Dict[str, Any], season_year: int) -> int:
    payroll = 0
    for player in get_team_players(team):
        payroll += get_player_salary_for_year(player, season_year)
    return payroll


def get_team_payroll(
    team: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
    team_name: Optional[str] = None
) -> int:
    payroll = get_team_player_payroll(team, season_year)
    if league_data is not None and team_name:
        payroll += get_team_dead_cap_for_year(league_data, team_name, season_year)
    return payroll

def get_cap_hold_player_key(player: Dict[str, Any]) -> str:
    return get_player_key(player.get("id"), player.get("name"))


def get_player_cap_hold_amount(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
) -> int:
    rights = get_player_rights(player)

    if player.get("rightsRenounced"):
        return 0

    if rights.get("heldByTeam") != team_name:
        return 0

    bird_level = rights.get("birdLevel", "none")
    if bird_level == "none":
        return 0

    qualifying_offer = player.get("qualifyingOffer")
    if (
        rights.get("restrictedFreeAgent")
        and isinstance(qualifying_offer, dict)
        and qualifying_offer.get("status", "extended") == "extended"
    ):
        qo_amount = int(num(qualifying_offer.get("amount"), 0))
        if qo_amount > 0:
            return int(round_to_nearest(max(MIN_DEAL, qo_amount), base = 1_000))

    previous_salary = get_previous_salary_reference(league_data, player)
    market_value = player.get("marketValue") or estimate_market_value(player)
    market_year_one = int(num(market_value.get("expectedYear1Salary"), MIN_DEAL))

    if bird_level == "bird":
        hold = max(previous_salary, market_year_one, MIN_DEAL)
    elif bird_level == "early_bird":
        hold = max(previous_salary * 1.30, MIN_DEAL)
    elif bird_level == "non_bird":
        hold = max(previous_salary * 1.20, MIN_DEAL)
    else:
        hold = 0

    return int(round_to_nearest(hold, base = 1_000))


def get_team_cap_hold_rows(
    league_data: Dict[str, Any],
    team_name: str,
) -> List[Dict[str, Any]]:
    rows = []

    for player in league_data.get("freeAgents", []):
        rights = get_player_rights(player)
        if rights.get("heldByTeam") != team_name:
            continue

        cap_hold = get_player_cap_hold_amount(
            league_data = league_data,
            player = player,
            team_name = team_name,
        )

        if cap_hold <= 0:
            continue

        qualifying_offer = player.get("qualifyingOffer")
        qualifying_offer_eligible = player.get("qualifyingOfferEligible")
        market_value = player.get("marketValue") or estimate_market_value(player)

        rows.append({
            "playerKey": get_cap_hold_player_key(player),
            "playerId": player.get("id"),
            "playerName": player.get("name"),
            "name": player.get("name"),
            "position": player.get("pos") or player.get("position"),
            "pos": player.get("pos") or player.get("position"),
            "age": player.get("age"),
            "overall": player.get("overall"),
            "potential": player.get("potential"),
            "teamName": team_name,
            "rights": rights,
            "birdLevel": rights.get("birdLevel", "none"),
            "restrictedFreeAgent": bool(rights.get("restrictedFreeAgent")),
            "rookieScale": bool(rights.get("rookieScale")),
            "qualifyingOffer": qualifying_offer if isinstance(qualifying_offer, dict) else None,
            "qualifyingOfferEligible": qualifying_offer_eligible if isinstance(qualifying_offer_eligible, dict) else None,
            "marketValue": market_value,
            "previousSalary": get_previous_salary_reference(league_data, player),
            "capHold": cap_hold,
            "capHoldAmount": cap_hold,
        })

    rows.sort(
        key = lambda row: (
            -int(num(row.get("capHoldAmount"), 0)),
            str(row.get("playerName", "")),
        )
    )

    return rows


def get_team_cap_hold_total(
    league_data: Dict[str, Any],
    team_name: str,
    exclude_player_key: Optional[str] = None,
) -> int:
    total = 0

    for row in get_team_cap_hold_rows(league_data, team_name):
        if exclude_player_key and row.get("playerKey") == exclude_player_key:
            continue
        total += int(num(row.get("capHoldAmount"), 0))

    return int(total)



def get_player_asset_value_score(player: Optional[Dict[str, Any]]) -> float:
    if not player:
        return 0.0

    overall = float(num(player.get("overall"), 0))
    potential = float(num(player.get("potential"), overall))
    age = int(num(player.get("age"), 27))
    upside = max(0.0, potential - overall)

    score = (overall * 0.105) + (potential * 0.045) + min(1.15, upside * 0.18)

    if overall >= 88:
        score += 2.20
    elif overall >= 85:
        score += 1.45
    elif overall >= 82:
        score += 0.85
    elif overall >= 80:
        score += 0.45

    if age <= 23:
        score += 0.70
    elif age <= 26:
        score += 0.42
    elif age >= 33:
        score -= 0.38
    elif age >= 31:
        score -= 0.20

    return round(score, 3)


def get_cap_hold_row_asset_value_score(row: Dict[str, Any]) -> float:
    player_like = {
        "overall": row.get("overall"),
        "potential": row.get("potential"),
        "age": row.get("age"),
    }
    value = get_player_asset_value_score(player_like)
    rights = row.get("rights") if isinstance(row.get("rights"), dict) else {}

    if rights.get("restrictedFreeAgent"):
        value += 0.85
    if rights.get("rookieScale"):
        value += 0.55
    if rights.get("birdLevel") == "bird":
        value += 0.20

    return round(value, 3)


def get_projected_team_rank_with_cap_hold(
    league_data: Dict[str, Any],
    team_name: str,
    row: Dict[str, Any],
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    candidates = []

    if team:
        for roster_player in team.get("players", []):
            candidates.append({
                "key": get_player_key(roster_player.get("id"), roster_player.get("name")),
                "overall": num(roster_player.get("overall"), 0),
                "potential": num(roster_player.get("potential"), num(roster_player.get("overall"), 0)),
                "age": num(roster_player.get("age"), 27),
            })

    for hold_row in get_team_cap_hold_rows(league_data, team_name):
        candidates.append({
            "key": hold_row.get("playerKey"),
            "overall": num(hold_row.get("overall"), 0),
            "potential": num(hold_row.get("potential"), num(hold_row.get("overall"), 0)),
            "age": num(hold_row.get("age"), 27),
        })

    target_key = row.get("playerKey")
    candidates.sort(
        key = lambda item: (
            -float(num(item.get("overall"), 0)),
            -float(num(item.get("potential"), num(item.get("overall"), 0))),
            float(num(item.get("age"), 27)),
        )
    )

    for idx, item in enumerate(candidates, start = 1):
        if item.get("key") == target_key:
            return idx

    return len(candidates) + 1


def get_cpu_cap_hold_protection_reason(
    league_data: Dict[str, Any],
    team_name: str,
    row: Dict[str, Any],
    target_player: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    overall = int(round(num(row.get("overall"), 0)))
    age = int(num(row.get("age"), 27))
    potential = int(round(num(row.get("potential"), overall)))
    rights = row.get("rights") if isinstance(row.get("rights"), dict) else {}
    upside = potential - overall

    if target_player is not None:
        target_key = get_player_key(target_player.get("id"), target_player.get("name"))
        if row.get("playerKey") == target_key:
            return "target_player_cap_hold"

    if rights.get("restrictedFreeAgent") and age <= 27 and (overall >= 74 or potential >= 78):
        return "protected_rfa_or_qo_player"
    if overall >= 88:
        return "protected_franchise_player"
    if overall >= 85 and age <= 31:
        return "protected_star_player"
    if age <= 25 and overall >= 80:
        return "protected_young_core_player"
    if age <= 26 and potential >= 84:
        return "protected_high_potential_player"
    if rights.get("rookieScale") and age <= 26 and (overall >= 76 or potential >= 80 or upside >= 3):
        return "protected_rookie_scale_asset"

    projected_rank = get_projected_team_rank_with_cap_hold(
        league_data = league_data,
        team_name = team_name,
        row = row,
    )
    if projected_rank <= 3 and overall >= 78:
        target_overall = int(round(num(target_player.get("overall"), 0))) if target_player is not None else 0
        if not (target_overall >= 84 and target_overall >= overall + 3):
            return "protected_projected_top_three_player"

    return None


def should_allow_cpu_cap_hold_renounce_for_target(
    league_data: Dict[str, Any],
    team_name: str,
    row: Dict[str, Any],
    target_player: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    hold_value = get_cap_hold_row_asset_value_score(row)
    protection_reason = get_cpu_cap_hold_protection_reason(
        league_data = league_data,
        team_name = team_name,
        row = row,
        target_player = target_player,
    )

    if protection_reason:
        return {
            "allow": False,
            "blockedReason": protection_reason,
            "holdValueScore": hold_value,
            "targetValueScore": get_player_asset_value_score(target_player),
        }

    if target_player is None:
        return {
            "allow": True,
            "blockedReason": None,
            "holdValueScore": hold_value,
            "targetValueScore": None,
        }

    target_value = get_player_asset_value_score(target_player)
    row_overall = int(round(num(row.get("overall"), 0)))
    row_age = int(num(row.get("age"), 27))
    row_potential = int(round(num(row.get("potential"), row_overall)))
    target_overall = int(round(num(target_player.get("overall"), 0)))
    target_age = int(num(target_player.get("age"), 27))
    target_potential = int(round(num(target_player.get("potential"), target_overall)))

    # Never sacrifice a clearly better useful hold for a weaker target.
    if row_overall >= 76 and row_overall >= target_overall + 2:
        return {
            "allow": False,
            "blockedReason": "renounced_player_is_better_than_target",
            "holdValueScore": hold_value,
            "targetValueScore": target_value,
        }

    # Do not dump a young asset to chase an older non-star who is not a real upgrade.
    if row_age <= 26 and target_age >= 30 and row_potential >= target_potential - 1 and target_overall < 84:
        return {
            "allow": False,
            "blockedReason": "young_asset_for_older_non_upgrade",
            "holdValueScore": hold_value,
            "targetValueScore": target_value,
        }

    # If the hold is close to the target in value, keep the hold unless the target is a strong starter/star upgrade.
    if row_overall >= 77 and target_overall < 82 and hold_value >= target_value - 0.10:
        return {
            "allow": False,
            "blockedReason": "target_not_enough_of_an_upgrade",
            "holdValueScore": hold_value,
            "targetValueScore": target_value,
        }

    if row_overall >= 78 and hold_value >= target_value + 0.45:
        return {
            "allow": False,
            "blockedReason": "hold_value_exceeds_target_value",
            "holdValueScore": hold_value,
            "targetValueScore": target_value,
        }

    return {
        "allow": True,
        "blockedReason": None,
        "holdValueScore": hold_value,
        "targetValueScore": target_value,
    }



def get_return_team_interest_bonus(
    league_data: Dict[str, Any],
    team_name: Optional[str],
    player: Dict[str, Any],
    rights_bonus: bool = False,
) -> float:
    """Small earned return-team interest bonus.

    Surgical rule:
    - No default loyalty / familiarity bonus.
    - Bird/RFA rights help the team create offers, but do not automatically
      make the player prefer the old team.
    - Returning interest is earned by prior-season success and situation.
    """
    if not team_name:
        return 0.0

    profile = build_recent_team_results_profile(league_data, team_name)
    if not profile.get("historyAvailable"):
        return 0.0

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    recent_win_pct = profile.get("recentWinPct")
    last_wins = profile.get("lastSeasonWins")
    last_round = int(num(profile.get("lastSeasonRoundReached"), 0))

    base = 0.0

    if profile.get("lastSeasonChampion"):
        base = 0.052
    elif profile.get("lastSeasonFinals"):
        base = 0.047
    elif profile.get("lastSeasonConferenceFinals"):
        base = 0.040
    elif last_wins is not None and int(num(last_wins, 0)) >= 54:
        base = 0.035
    elif last_wins is not None and int(num(last_wins, 0)) >= 48:
        base = 0.027
    elif last_wins is not None and int(num(last_wins, 0)) >= 42 and last_round >= 1:
        base = 0.018
    elif recent_win_pct is not None and float(num(recent_win_pct, 0)) >= 0.500:
        base = 0.010
    else:
        base = 0.0

    # Strong players can value continuity on a winning team, but only if the
    # team quality already earned a bonus above.
    if base > 0:
        if overall >= 88:
            base += 0.006
        elif overall >= 84:
            base += 0.004

        if age <= 25 and overall >= 80:
            base += 0.004

        # Rights should not create free loyalty. Keep only a tiny tiebreaker
        # when the team was already a good situation.
        if rights_bonus:
            base += 0.004

    # Older players should not get pulled back to bad old teams.
    if age >= 32 and recent_win_pct is not None and float(num(recent_win_pct, 0)) < 0.420:
        base -= 0.012

    return round(clamp(base, 0.000, 0.060), 3)


def get_team_quality_player_interest_adjustment(
    league_data: Dict[str, Any],
    team_name: Optional[str],
    player: Dict[str, Any],
    direction: str = "balanced",
) -> float:
    """Small team-quality adjustment used after money in player interest.

    Money remains the main driver. This only nudges offers toward better team
    situations, contenders for older players, and rebuilding/retooling teams for
    young upside players.
    """
    if not team_name:
        return 0.0

    profile = build_recent_team_results_profile(league_data, team_name)
    age = int(num(player.get("age"), 27))
    overall = float(num(player.get("overall"), 75))
    potential = float(num(player.get("potential"), overall))
    upside = max(0.0, potential - overall)

    adjustment = 0.0

    if profile.get("historyAvailable"):
        standings_score = float(num(profile.get("recentStandingsScore"), 0.50))
        playoff_score = float(num(profile.get("recentPlayoffScore"), 0.35))
        quality_score = clamp((standings_score * 0.62) + (playoff_score * 0.38), 0.0, 1.0)

        # Range is intentionally small so contract quality still dominates.
        adjustment += (quality_score - 0.50) * 0.070

        recent_win_pct = profile.get("recentWinPct")
        if recent_win_pct is not None and float(num(recent_win_pct, 0)) < 0.340:
            adjustment -= 0.010
        if profile.get("lastSeasonChampion") or profile.get("lastSeasonFinals"):
            adjustment += 0.010
        elif profile.get("lastSeasonConferenceFinals"):
            adjustment += 0.006

    if age >= 30:
        if direction in ["contending", "win now"]:
            adjustment += 0.014
        elif direction == "rebuilding":
            adjustment -= 0.014

    if age <= 25:
        if direction in ["rebuilding", "retooling"]:
            adjustment += 0.012
        elif direction in ["contending", "win now"] and overall < 78:
            adjustment -= 0.006

    if upside >= 3 and age <= 26 and direction in ["rebuilding", "retooling"]:
        adjustment += 0.008

    return round(clamp(adjustment, -0.035, 0.055), 3)


def record_cpu_cap_hold_renounce_audit(
    league_data: Dict[str, Any],
    team_name: str,
    current_day: Optional[int],
    target_player: Optional[Dict[str, Any]],
    plan: Dict[str, Any],
    renounced: Optional[List[Dict[str, Any]]] = None,
) -> None:
    state = ensure_free_agency_state(league_data)
    day = int(num(current_day, state.get("currentDay", 0))) if current_day is not None else int(num(state.get("currentDay"), 0))
    target_name = target_player.get("name") if target_player is not None else plan.get("targetPlayerName")
    target_key = get_player_key(target_player.get("id"), target_player.get("name")) if target_player is not None else plan.get("targetPlayerKey")

    existing_keys = set()
    for item in state.setdefault("rightsRenounceLog", []):
        existing_keys.add((
            int(num(item.get("day"), 0)),
            item.get("teamName"),
            item.get("playerKey"),
            item.get("targetPlayerKey"),
            int(num(item.get("capHoldCleared"), 0)),
            item.get("type"),
        ))

    for row in renounced or []:
        key = (
            day,
            team_name,
            row.get("playerKey"),
            target_key,
            int(num(row.get("capHoldCleared") or row.get("capHoldAmount"), 0)),
            "cpu_auto_renounce",
        )
        if key in existing_keys:
            continue
        existing_keys.add(key)
        state.setdefault("rightsRenounceLog", []).append({
            "day": day,
            "type": "cpu_auto_renounce",
            "teamName": team_name,
            "playerKey": row.get("playerKey"),
            "playerId": row.get("playerId"),
            "playerName": row.get("playerName"),
            "capHoldCleared": int(num(row.get("capHoldCleared") or row.get("capHoldAmount"), 0)),
            "targetPlayerName": target_name,
            "targetPlayerKey": target_key,
            "targetValueScore": row.get("targetValueScore") or plan.get("targetValueScore"),
            "holdValueScore": row.get("holdValueScore"),
            "holdCategory": row.get("holdCategory") or row.get("holdValue", {}).get("category"),
            "reason": row.get("reason") or "cpu_cleared_cap_hold_for_signing",
        })

    blocked_existing_keys = set()
    for item in state.setdefault("blockedCapHoldRenounceLog", []):
        blocked_existing_keys.add((
            int(num(item.get("day"), 0)),
            item.get("teamName"),
            item.get("playerKey"),
            item.get("targetPlayerKey"),
            item.get("blockedReason"),
        ))

    for row in plan.get("blockedRows", []) or []:
        key = (day, team_name, row.get("playerKey"), target_key, row.get("blockedReason"))
        if key in blocked_existing_keys:
            continue
        blocked_existing_keys.add(key)
        state.setdefault("blockedCapHoldRenounceLog", []).append({
            "day": day,
            "type": "cpu_auto_renounce_blocked",
            "teamName": team_name,
            "playerKey": row.get("playerKey"),
            "playerId": row.get("playerId"),
            "playerName": row.get("playerName"),
            "capHoldAmount": int(num(row.get("capHoldAmount"), 0)),
            "targetPlayerName": target_name,
            "targetPlayerKey": target_key,
            "targetValueScore": row.get("targetValueScore") or plan.get("targetValueScore"),
            "holdValueScore": row.get("holdValueScore"),
            "blockedReason": row.get("blockedReason"),
        })

def auto_renounce_cpu_cap_holds_for_room(
    league_data: Dict[str, Any],
    team_name: str,
    clearance_needed: int,
    protected_player_key: Optional[str] = None,
    target_player: Optional[Dict[str, Any]] = None,
    current_day: Optional[int] = None,
) -> Dict[str, Any]:
    # CPU-only helper. Keep the good pacing engine intact, but make the final
    # cap-hold clearance smarter: clear low-priority holds for real upgrades,
    # and refuse to sacrifice protected young/core players or better holds.
    needed = int(num(clearance_needed, 0))
    if needed <= 0:
        return {
            "ok": True,
            "renounced": [],
            "blockedRenounces": [],
            "capHoldCleared": 0,
            "clearanceNeeded": 0,
        }

    plan = get_cpu_cap_hold_clearance_plan(
        league_data = league_data,
        team_name = team_name,
        clearance_needed = needed,
        protected_player_key = protected_player_key,
        target_player = target_player,
    )

    if not plan.get("ok"):
        record_cpu_cap_hold_renounce_audit(
            league_data = league_data,
            team_name = team_name,
            current_day = current_day,
            target_player = target_player,
            plan = plan,
            renounced = [],
        )
        return {
            "ok": False,
            "renounced": [],
            "blockedRenounces": plan.get("blockedRows", []),
            "capHoldCleared": int(num(plan.get("capHoldCleared"), 0)),
            "clearanceNeeded": needed,
            "targetPlayerName": plan.get("targetPlayerName"),
            "targetValueScore": plan.get("targetValueScore"),
            "reason": "CPU could not clear cap holds without sacrificing protected or higher-value rights.",
        }

    cleared = 0
    renounced = []

    for row in plan.get("renounceRows", []):
        if cleared >= needed:
            break

        player_idx = find_free_agent_index(
            league_data.get("freeAgents", []),
            row.get("playerId"),
            row.get("playerName"),
        )
        if player_idx == -1:
            continue

        player = league_data["freeAgents"][player_idx]
        rights = get_player_rights(player)
        if rights.get("heldByTeam") != team_name:
            continue

        hold_amount = get_player_cap_hold_amount(
            league_data = league_data,
            player = player,
            team_name = team_name,
        )
        if hold_amount <= 0:
            continue

        set_player_rights(
            player = player,
            held_by_team = None,
            seasons_toward_bird = 0,
            rookie_scale = rights.get("rookieScale", False),
            restricted_free_agent = False,
        )
        player["rightsRenounced"] = True
        player.pop("qualifyingOffer", None)
        player.pop("qualifyingOfferEligible", None)

        cleared += int(hold_amount)
        renounced.append({
            "playerKey": get_cap_hold_player_key(player),
            "playerId": player.get("id"),
            "playerName": player.get("name"),
            "teamName": team_name,
            "capHoldCleared": int(hold_amount),
            "holdValueScore": row.get("holdValueScore"),
            "targetValueScore": row.get("targetValueScore"),
            "targetPlayerName": row.get("targetPlayerName"),
            "holdCategory": row.get("holdValue", {}).get("category") if isinstance(row.get("holdValue"), dict) else None,
            "reason": "cpu_cleared_cap_hold_for_signing",
        })

    result_plan = copy.deepcopy(plan)
    result_plan["renounceRows"] = renounced
    record_cpu_cap_hold_renounce_audit(
        league_data = league_data,
        team_name = team_name,
        current_day = current_day,
        target_player = target_player,
        plan = result_plan,
        renounced = renounced,
    )

    return {
        "ok": cleared >= needed,
        "renounced": renounced,
        "blockedRenounces": plan.get("blockedRows", []),
        "capHoldCleared": cleared,
        "clearanceNeeded": needed,
        "targetPlayerName": plan.get("targetPlayerName"),
        "targetPlayerKey": plan.get("targetPlayerKey"),
        "targetValueScore": plan.get("targetValueScore"),
    }



def _optional_int(value: Any) -> Optional[int]:
    try:
        if value in [None, "", False]:
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def is_team_hard_capped(league_data: Dict[str, Any], team_name: str) -> bool:
    _, _, team = find_team_entry(league_data, team_name)
    team = team or {}

    if bool(team.get("isHardCapped")):
        return True
    if bool(team.get("hardCapped")):
        return True
    if bool(team.get("hardCapTriggered")):
        return True
    if bool(team.get("triggeredHardCap")):
        return True

    for key in ["hardCappedByTeam", "hardCapTriggeredByTeam"]:
        raw = league_data.get(key)
        if isinstance(raw, dict) and bool(raw.get(team_name)):
            return True

    raw_list = league_data.get("hardCappedTeams")
    if isinstance(raw_list, list) and team_name in raw_list:
        return True

    return False


def get_team_hard_cap(league_data: Dict[str, Any], team_name: str) -> Optional[int]:
    _, _, team = find_team_entry(league_data, team_name)
    team = team or {}

    team_keys = [
        "hardCap",
        "hardCapValue",
        "hardCapAmount",
        "hardCapLine",
        "hardCapLimit",
        "secondApron",
        "secondApronValue",
        "secondApronAmount",
        "secondApronLine",
        "apron2",
    ]

    for key in team_keys:
        value = _optional_int(team.get(key))
        if value is not None and value > 0:
            return value

    for map_key in [
        "hardCapByTeam",
        "teamHardCaps",
        "hardCapMap",
        "secondApronByTeam",
        "teamSecondAprons",
    ]:
        raw = league_data.get(map_key)
        if isinstance(raw, dict):
            value = _optional_int(raw.get(team_name))
            if value is not None and value > 0:
                return value

    league_keys = [
        "hardCap",
        "hardCapValue",
        "hardCapAmount",
        "hardCapLine",
        "hardCapLimit",
        "secondApron",
        "secondApronValue",
        "secondApronAmount",
        "secondApronLine",
        "apron2",
    ]

    for key in league_keys:
        value = _optional_int(league_data.get(key))
        if value is not None and value > 0:
            return value

    return None

def get_team_cap_snapshot(
    league_data: Dict[str, Any],
    team_name: str,
    exclude_cap_hold_player_key: Optional[str] = None,
) -> Dict[str, Any]:
    season_year = get_operating_season_year(league_data)
    state = league_data.get("freeAgencyState", {})
    if not (isinstance(state, dict) and state.get("isActive")):
        has_offseason_free_agents = any(
            isinstance(player.get("freeAgencyMeta"), dict)
            for player in league_data.get("freeAgents", [])
        )
        if has_offseason_free_agents:
            season_year = get_current_season_year(league_data) + 1

    salary_cap = get_salary_cap(league_data)
    roster_limit = get_roster_limit(league_data)

    _, _, team = find_team_entry(league_data, team_name)
    if not team:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    player_payroll = get_team_player_payroll(team, season_year)
    dead_cap = get_team_dead_cap_for_year(league_data, team_name, season_year)

    cap_hold_rows = get_team_cap_hold_rows(
        league_data = league_data,
        team_name = team_name,
    )

    if exclude_cap_hold_player_key:
        cap_hold_rows = [
            row for row in cap_hold_rows
            if row.get("playerKey") != exclude_cap_hold_player_key
        ]

    cap_hold_total = int(sum(int(num(row.get("capHoldAmount"), 0)) for row in cap_hold_rows))

    raw_payroll_without_holds = player_payroll + dead_cap
    practical_payroll = raw_payroll_without_holds + cap_hold_total

    roster_count = len(get_team_players(team))

    hard_cap = get_team_hard_cap(league_data, team_name)
    hard_cap_room = None
    if hard_cap is not None:
        hard_cap_room = int(hard_cap) - int(practical_payroll)

    return {
        "ok": True,
        "teamName": team_name,
        "seasonYear": season_year,
        "salaryCap": salary_cap,
        "luxuryTaxLine": get_luxury_tax_line(league_data),
        "firstApron": get_first_apron(league_data),
        "secondApron": get_second_apron(league_data),

        "playerPayroll": player_payroll,
        "deadCap": dead_cap,

        "rawPayrollWithoutHolds": raw_payroll_without_holds,
        "rawCapRoomWithoutHolds": salary_cap - raw_payroll_without_holds,

        "capHolds": cap_hold_total,
        "capHoldTotal": cap_hold_total,
        "capHoldRows": cap_hold_rows,

        "payroll": practical_payroll,
        "capRoom": salary_cap - practical_payroll,
        "practicalPayroll": practical_payroll,
        "practicalCapRoom": salary_cap - practical_payroll,

        "rosterCount": roster_count,
        "rosterLimit": roster_limit,
        "hardCap": hard_cap,
        "hardCapRoom": hard_cap_room,
        "isHardCapped": is_team_hard_capped(league_data, team_name),
    }

def estimate_market_value(player: Dict[str, Any]) -> Dict[str, Any]:
    overall = num(player.get("overall"), 75)
    age = int(num(player.get("age"), 27))
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)

    off_rating = num(player.get("offRating"), overall)
    def_rating = num(player.get("defRating"), overall)
    scoring_rating = num(player.get("scoringRating"), 50)

    # True fringe/minimum players should still be cheap, but real rotation
    # players in the 77-83 range need a real NBA-style market.
    minimum_bucket = (
        overall <= 72
        or (overall <= 73 and age >= 27 and upside <= 1)
        or (overall <= 74 and age >= 30 and upside <= 1)
    )

    if minimum_bucket:
        years = get_realistic_expected_contract_years(player)
        base_salary = MIN_DEAL

        if overall >= 73 and age <= 26:
            base_salary = 1_900_000
        elif overall >= 73:
            base_salary = 1_500_000

        salary_by_year = build_salary_by_year(
            int(round_to_nearest(base_salary, base = 1_000)),
            years,
        )
        return {
            "expectedYears": years,
            "salaryByYear": salary_by_year,
            "expectedYear1Salary": salary_by_year[0],
            "expectedAAV": int(sum(salary_by_year) / len(salary_by_year)),
            "minAcceptableAAV": MIN_DEAL,
        }

    # Salary curve tuned for a $150M cap.
    # Surgical market-value tuning:
    # - Keep true fringe/minimum players cheap.
    # - Raise 75-83 OVR players modestly, especially real 77-83 rotation/starter talent.
    # - Smooth the 84-88 jump so high-end starters do not cliff into star pricing too abruptly.
    if overall <= 75:
        base_salary = 3_100_000 + max(0.0, overall - 74.0) * 1_250_000
    elif overall <= 78:
        base_salary = 4_800_000 + (overall - 76.0) * 2_050_000
    elif overall <= 81:
        base_salary = 10_800_000 + (overall - 79.0) * 3_000_000
    elif overall <= 84:
        base_salary = 19_000_000 + (overall - 82.0) * 3_500_000
    elif overall <= 88:
        base_salary = 26_000_000 + (overall - 84.0) * 2_850_000
    else:
        base_salary = 37_400_000 + (overall - 88.0) * 3_200_000

    # Upside/age modifiers. Young RFAs and young rotation players cost more,
    # while older role players are still discounted realistically.
    if age <= 22:
        base_salary *= 1.08 + min(0.18, upside * 0.025)
    elif age <= 25:
        base_salary *= 1.05 + min(0.14, upside * 0.018)
    elif age <= 27:
        base_salary *= 1.02 + min(0.08, upside * 0.010)
    elif age <= 30:
        base_salary *= 1.00
    elif age <= 33:
        base_salary *= max(0.85, 1.0 - ((age - 30) * 0.043))
    else:
        # Surgical old-player tuning:
        # Elite older stars should still be paid like elite current-value players.
        # 84+ OVR players use a softer age curve that improves as the player remains
        # more elite, while sub-84 older players keep the normal stronger age discount.
        if overall >= 84:
            star_score = clamp((overall - 84.0) / 8.0, 0.0, 1.0)

            starting_mult = 0.88 + (star_score * 0.10)
            yearly_drop = 0.040 - (star_score * 0.018)
            floor_mult = 0.68 + (star_score * 0.14)

            base_salary *= max(
                floor_mult,
                starting_mult - ((age - 34) * yearly_drop),
            )
        else:
            base_salary *= max(0.62, 0.84 - ((age - 33) * 0.062))

    if age >= 31 and overall <= 80:
        base_salary *= 0.94 if overall >= 77 else 0.92
    if age >= 34 and overall <= 79:
        base_salary *= 0.91 if overall >= 77 else 0.88
    if age >= 36 and overall <= 82:
        base_salary *= 0.93 if overall >= 80 else 0.90

    # Skill boosts for players who are clearly valuable despite only moderate OVR.
    if off_rating >= 88:
        base_salary *= 1.04
    if def_rating >= 88:
        base_salary *= 1.04
    if scoring_rating >= 84:
        base_salary *= 1.03
    if overall <= 83 and max(off_rating, def_rating) >= overall + 7:
        base_salary *= 1.05
    if age >= 34 and 77 <= overall <= 82 and (
        max(off_rating, def_rating) >= 86 or scoring_rating >= 82
    ):
        base_salary *= 1.025

    year1_salary = int(
        round_to_nearest(
            clamp(base_salary, MIN_DEAL, MAX_SALARY),
            base = 1_000,
        )
    )

    years = get_realistic_expected_contract_years(player)
    salary_by_year = build_salary_by_year(year1_salary, years)

    if overall <= 76:
        min_accept_mult = 0.86
    elif overall <= 78:
        min_accept_mult = 0.90
    elif overall <= 81:
        min_accept_mult = 0.93
    elif overall <= 84:
        min_accept_mult = 0.95
    elif overall <= 87:
        min_accept_mult = 0.97
    else:
        min_accept_mult = 0.985

    if age <= 25 and upside >= 3 and overall >= 77:
        min_accept_mult += 0.04
    if age >= 31 and overall <= 80:
        min_accept_mult -= 0.015 if overall >= 77 else 0.03
    if age >= 34 and overall <= 79:
        min_accept_mult -= 0.025 if overall >= 77 else 0.04

    min_accept_mult = clamp(min_accept_mult, 0.78, 0.995)

    min_acceptable_aav = int(
        round_to_nearest(
            max(MIN_DEAL, year1_salary * min_accept_mult),
            base = 1_000,
        )
    )

    return {
        "expectedYears": years,
        "salaryByYear": salary_by_year,
        "expectedYear1Salary": salary_by_year[0],
        "expectedAAV": int(sum(salary_by_year) / len(salary_by_year)),
        "minAcceptableAAV": min_acceptable_aav,
    }

def add_market_values_to_free_agents(league_data: Dict[str, Any]) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    free_agents = updated.get("freeAgents", [])

    for player in free_agents:
        player["marketValue"] = estimate_market_value(player)

    return {
        "ok": True,
        "leagueData": updated,
        "freeAgentCount": len(free_agents),
    }
def refresh_free_agent_market_values(league_data: Dict[str, Any]) -> None:
    for player in league_data.get("freeAgents", []):
        player["marketValue"] = estimate_market_value(player)


def build_contract_from_offer(league_data: Dict[str, Any], offer: Dict[str, Any]) -> Dict[str, Any]:
    season_year = get_operating_season_year(league_data)
    salary_by_year = offer.get("salaryByYear", [])

    if not isinstance(salary_by_year, list) or not salary_by_year:
        raise ValueError("Offer must include salaryByYear as a non-empty list.")

    safe_salary_by_year = [int(round(num(x, 0))) for x in salary_by_year]
    state = ensure_free_agency_state(league_data)

    start_year = season_year
    if not state.get("isActive"):
        start_year = int(offer.get("startYear", season_year))

    raw_option = offer.get("option")
    normalized_option = None
    if isinstance(raw_option, dict):
        option_type = raw_option.get("type")
        if option_type in ["team", "player"] and len(safe_salary_by_year) >= 2:
            # User-created FA contracts only allow the option on the final year.
            # This keeps the UI simple and avoids unrealistic option-year gaming.
            normalized_option = {
                "type": option_type,
                "yearIndices": [len(safe_salary_by_year) - 1],
                "picked": None,
            }

    return normalize_contract({
        "startYear": start_year,
        "salaryByYear": safe_salary_by_year,
        "option": normalized_option,
    })
def apply_free_agency_start_year(
    league_data: Dict[str, Any],
    contract: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    normalized = normalize_contract(contract)
    if not normalized:
        return normalized

    state = ensure_free_agency_state(league_data)
    if state.get("isActive"):
        normalized["startYear"] = get_current_season_year(league_data) + 1

    return normalized

def is_minimum_contract_for_current_year(
    league_data: Dict[str, Any],
    contract: Dict[str, Any]
) -> bool:
    season_year = get_operating_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)
    return int(offered_current_salary) <= int(get_minimum_exception_amount(league_data))

def is_emergency_fill_candidate(player: Dict[str, Any]) -> bool:
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))

    return (
        overall <= 74
        or (overall <= 75 and (age >= 23 or potential <= overall + 1))
        or (overall <= 76 and (age >= 25 or potential <= overall + 2))
        or (overall <= 77 and (age >= 27 or potential <= overall + 2))
        or (overall <= 78 and age >= 30 and potential <= overall + 2)
    )
def finalize_cpu_min_roster_cleanup(
    league_data: Dict[str, Any],
    current_day: int,
    user_team_name: Optional[str] = None,
    min_roster_target_override: Optional[int] = None,
) -> List[Dict[str, Any]]:
    cleanup_signings = []
    min_roster_target = (
        int(min_roster_target_override)
        if min_roster_target_override is not None
        else get_min_roster_target(league_data)
    )
    season_year = get_operating_season_year(league_data)
    state = ensure_free_agency_state(league_data)

    def _record_cleanup_signing(
        signed_player: Dict[str, Any],
        team_name: str,
        source: str,
    ) -> Dict[str, Any]:
        player_key = get_player_key_from_player(signed_player)
        if player_key in state.get("offersByPlayer", {}):
            del state["offersByPlayer"][player_key]

        story_context = build_free_agency_story_context(
            league_data = league_data,
            player = signed_player,
            team_name = team_name,
            contract = signed_player.get("contract"),
            row = {"spendingType": "minimum", "source": source},
            event_type = "cleanup_signing",
            current_day = current_day,
        )

        state["signedPlayersLog"].append({
            "day": current_day,
            "playerId": signed_player.get("id"),
            "playerName": signed_player.get("name"),
            "teamName": team_name,
            "contract": signed_player.get("contract"),
            "allOffers": [],
            "source": source,
            "spendingType": "minimum",
            "storyContext": story_context,
        })

        signing_row = {
            "playerId": signed_player.get("id"),
            "playerName": signed_player.get("name"),
            "signedWith": team_name,
            "day": current_day,
            "contract": signed_player.get("contract"),
            "totalValue": int(sum(signed_player["contract"]["salaryByYear"])),
            "aav": int(sum(signed_player["contract"]["salaryByYear"]) / len(signed_player["contract"]["salaryByYear"])),
            "cleanupSigning": True,
            "emergencySigning": True,
            "spendingType": "minimum",
            "storyContext": story_context,
        }
        cleanup_signings.append(signing_row)
        return signing_row

    while True:
        made_move = False
        teams_below_min = []

        for _, _, team in iter_teams(league_data):
            team_name = team.get("name")
            if not team_name:
                continue
            if user_team_name and team_name == user_team_name:
                continue

            deficit = max(0, min_roster_target - len(get_team_players(team)))
            if deficit > 0:
                teams_below_min.append((deficit, team_name))

        if not teams_below_min:
            break

        teams_below_min.sort(key = lambda x: (-x[0], x[1]))

        for _, team_name in teams_below_min:
            while True:
                _, _, live_team = find_team_entry(league_data, team_name)
                if live_team is None:
                    break
                if len(get_team_players(live_team)) >= min_roster_target:
                    break
                if len(get_team_players(live_team)) >= get_roster_limit(league_data):
                    break

                snapshot = get_team_cap_snapshot(league_data, team_name)
                if not snapshot.get("ok"):
                    break

                hard_cap = snapshot.get("hardCap")
                is_hard_capped = bool(snapshot.get("isHardCapped"))
                projected_payroll = int(num(snapshot.get("payroll"), 0)) + MIN_DEAL
                if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
                    break

                emergency_rows = []
                for fa in league_data.get("freeAgents", []):
                    if not is_emergency_fill_candidate(fa):
                        continue

                    emergency_rows.append((
                        -int(round(num(fa.get("overall"), 0))),
                        int(num(fa.get("age"), 27)),
                        str(fa.get("name", "")),
                        fa,
                    ))

                if not emergency_rows:
                    break

                emergency_rows.sort(key = lambda x: (x[0], x[1], x[2]))

                signed_this_round = None

                for _, _, _, fa in emergency_rows:
                    player_idx = find_free_agent_index(
                        league_data.get("freeAgents", []),
                        fa.get("id"),
                        fa.get("name"),
                    )
                    if player_idx == -1:
                        continue

                    signed_player = copy.deepcopy(league_data["freeAgents"][player_idx])
                    signed_player["contract"] = normalize_contract({
                        "startYear": season_year,
                        "salaryByYear": [MIN_DEAL],
                        "option": None,
                    })
                    signed_player["marketValue"] = estimate_market_value(signed_player)

                    update_player_rights_after_signing(
                        player = signed_player,
                        team_name = team_name,
                        signing_source = "minimum_cleanup",
                        matched_rfa = False,
                    )

                    league_data["freeAgents"].pop(player_idx)
                    live_team.setdefault("players", []).append(signed_player)

                    signed_this_round = _record_cleanup_signing(
                        signed_player = signed_player,
                        team_name = team_name,
                        source = "cpu_emergency_min_roster_cleanup",
                    )
                    made_move = True
                    break

                if not signed_this_round:
                    break

        if not made_move:
            break

    return cleanup_signings

# ------------------------------------------------------------
# TEAM DIRECTION / CPU BEHAVIOR HELPERS
# ------------------------------------------------------------
def get_player_position_bucket(player: Dict[str, Any]) -> str:
    raw = str(player.get("pos") or player.get("position") or "").upper().replace("-", "/")
    if "PG" in raw:
        return "PG"
    if "SG" in raw:
        return "SG"
    if "SF" in raw:
        return "SF"
    if "PF" in raw:
        return "PF"
    if "C" in raw:
        return "C"
    return "UTIL"


def get_team_name_from_team(team: Dict[str, Any]) -> str:
    return str(team.get("name") or team.get("teamName") or "")


def get_team_history_rows(
    league_data: Optional[Dict[str, Any]],
    team_name: str,
    max_seasons: int = 3,
) -> List[Dict[str, Any]]:
    if not league_data or not team_name:
        return []

    history = league_data.get("seasonHistory", [])
    if not isinstance(history, list):
        return []

    rows = []

    for season in history:
        if not isinstance(season, dict):
            continue

        season_year = int(num(season.get("seasonYear"), 0))
        teams = season.get("teams", [])
        if not isinstance(teams, list):
            continue

        for row in teams:
            if not isinstance(row, dict):
                continue
            if row.get("teamName") != team_name and row.get("name") != team_name:
                continue

            item = copy.deepcopy(row)
            item["seasonYear"] = season_year
            item["championTeam"] = season.get("champion")
            rows.append(item)
            break

    rows.sort(key = lambda row: int(num(row.get("seasonYear"), 0)), reverse = True)
    return rows[:max(1, max_seasons)]


def get_playoff_result_score(row: Dict[str, Any]) -> float:
    label = str(row.get("playoffResult") or "").strip().lower()
    round_reached = int(num(row.get("playoffRoundReached"), 0))

    if bool(row.get("champion")) or label == "champion":
        return 1.00
    if bool(row.get("finals")) or label == "finals" or round_reached >= 4:
        return 0.92
    if bool(row.get("conferenceFinals")) or label == "conference_finals" or round_reached >= 3:
        return 0.82
    if label == "second_round" or round_reached >= 2:
        return 0.68
    if bool(row.get("madePlayoffs")) or label == "first_round" or round_reached >= 1:
        return 0.54
    if bool(row.get("madePlayIn")) or label == "play_in":
        return 0.38
    return 0.18


def build_recent_team_results_profile(
    league_data: Optional[Dict[str, Any]],
    team_name: str,
) -> Dict[str, Any]:
    history_rows = get_team_history_rows(league_data, team_name, max_seasons = 3)
    weights = [1.00, 0.60, 0.35]

    if not history_rows:
        return {
            "historyAvailable": False,
            "recentStandingsScore": 0.50,
            "recentPlayoffScore": 0.35,
            "recentWinPct": None,
            "lastSeasonWins": None,
            "lastSeasonLosses": None,
            "lastSeasonSeed": None,
            "lastSeasonPlayoffResult": None,
            "lastSeasonRoundReached": 0,
            "weightedWins": None,
            "weightedWinPct": None,
            "reasons": [],
            "historyRows": [],
        }

    weighted_standings_total = 0.0
    weighted_playoff_total = 0.0
    weighted_win_pct_total = 0.0
    weighted_wins_total = 0.0
    weight_total = 0.0
    reasons = []

    for idx, row in enumerate(history_rows):
        weight = weights[idx] if idx < len(weights) else 0.20
        wins = int(num(row.get("wins"), 0))
        losses = int(num(row.get("losses"), 0))
        games = wins + losses
        win_pct = num(row.get("winPct"), 0.0)
        if win_pct <= 0 and games > 0:
            win_pct = wins / games

        seed = row.get("conferenceSeed")
        seed_num = int(num(seed, 0)) if seed not in [None, ""] else None

        win_score = clamp((win_pct - 0.25) / 0.45, 0.0, 1.0)

        if seed_num is not None and seed_num > 0:
            if seed_num <= 6:
                seed_score = clamp(0.82 - ((seed_num - 1) * 0.055), 0.52, 0.90)
            elif seed_num <= 10:
                seed_score = clamp(0.46 - ((seed_num - 7) * 0.035), 0.32, 0.46)
            else:
                seed_score = 0.22
        else:
            league_rank = int(num(row.get("leagueRank"), 0))
            if league_rank > 0:
                seed_score = clamp(1.0 - ((league_rank - 1) / 29.0), 0.10, 0.90)
            else:
                seed_score = 0.30

        standings_score = clamp((win_score * 0.78) + (seed_score * 0.22), 0.0, 1.0)
        playoff_score = get_playoff_result_score(row)

        weighted_standings_total += standings_score * weight
        weighted_playoff_total += playoff_score * weight
        weighted_win_pct_total += win_pct * weight
        weighted_wins_total += wins * weight
        weight_total += weight

        if idx == 0:
            playoff_label = str(row.get("playoffResult") or "missed_playoffs").replace("_", " ")
            reasons.append(f"Last season: {wins}-{losses} ({round(win_pct * 100, 1)}% win rate)")
            if seed_num:
                reasons.append(f"Last season conference seed: {seed_num}")
            reasons.append(f"Last season playoff result: {playoff_label}")

    weight_total = max(0.001, weight_total)
    last = history_rows[0]

    return {
        "historyAvailable": True,
        "recentStandingsScore": round(weighted_standings_total / weight_total, 3),
        "recentPlayoffScore": round(weighted_playoff_total / weight_total, 3),
        "recentWinPct": round(weighted_win_pct_total / weight_total, 3),
        "weightedWins": round(weighted_wins_total / weight_total, 1),
        "weightedWinPct": round(weighted_win_pct_total / weight_total, 3),
        "lastSeasonWins": int(num(last.get("wins"), 0)),
        "lastSeasonLosses": int(num(last.get("losses"), 0)),
        "lastSeasonSeed": int(num(last.get("conferenceSeed"), 0)) if last.get("conferenceSeed") not in [None, ""] else None,
        "lastSeasonPlayoffResult": last.get("playoffResult") or "missed_playoffs",
        "lastSeasonRoundReached": int(num(last.get("playoffRoundReached"), 0)),
        "lastSeasonChampion": bool(last.get("champion")),
        "lastSeasonFinals": bool(last.get("finals")),
        "lastSeasonConferenceFinals": bool(last.get("conferenceFinals")),
        "reasons": reasons,
        "historyRows": copy.deepcopy(history_rows),
    }


def classify_direction_from_scores(
    roster_strength_score: float,
    age_upside_score: float,
    history_profile: Dict[str, Any],
    fallback_direction: str,
) -> Tuple[str, float, Dict[str, float], List[str]]:
    if not history_profile.get("historyAvailable"):
        return fallback_direction, 0.58, {
            "rosterStrengthScore": round(roster_strength_score, 3),
            "ageUpsideScore": round(age_upside_score, 3),
            "recentStandingsScore": None,
            "recentPlayoffScore": None,
            "winNowScore": None,
            "rebuildScore": None,
        }, ["No season history found, using roster-only direction."]

    standings_score = float(history_profile.get("recentStandingsScore", 0.50))
    playoff_score = float(history_profile.get("recentPlayoffScore", 0.35))
    recent_win_pct = history_profile.get("recentWinPct")
    last_wins = history_profile.get("lastSeasonWins")
    last_round = int(num(history_profile.get("lastSeasonRoundReached"), 0))

    prime_roster_score = clamp(1.0 - abs(age_upside_score - 0.50), 0.0, 1.0)
    win_now_score = clamp(
        (standings_score * 0.45)
        + (playoff_score * 0.30)
        + (roster_strength_score * 0.20)
        + (prime_roster_score * 0.05),
        0.0,
        1.0,
    )

    bad_results_score = clamp(1.0 - standings_score, 0.0, 1.0)
    rebuild_score = clamp(
        (bad_results_score * 0.45)
        + (age_upside_score * 0.35)
        + ((1.0 - roster_strength_score) * 0.20),
        0.0,
        1.0,
    )

    reasons = list(history_profile.get("reasons", []))
    reasons.append(f"Win-now score: {round(win_now_score, 3)}")
    reasons.append(f"Rebuild score: {round(rebuild_score, 3)}")
    reasons.append(f"Roster strength score: {round(roster_strength_score, 3)}")

    champion_or_finals = bool(history_profile.get("lastSeasonChampion") or history_profile.get("lastSeasonFinals"))
    conference_finals = bool(history_profile.get("lastSeasonConferenceFinals"))

    if champion_or_finals:
        direction = "contending"
        confidence = 0.95
    elif conference_finals and roster_strength_score >= 0.50:
        direction = "contending"
        confidence = 0.88
    elif last_wins is not None and last_wins >= 54 and roster_strength_score >= 0.48:
        direction = "contending"
        confidence = 0.86
    elif last_wins is not None and last_wins >= 48 and last_round >= 2 and roster_strength_score >= 0.48:
        direction = "contending"
        confidence = 0.82
    elif win_now_score >= 0.76:
        direction = "contending"
        confidence = 0.78
    elif win_now_score >= 0.61:
        direction = "win now"
        confidence = 0.74
    elif rebuild_score >= 0.72 and roster_strength_score <= 0.42:
        direction = "rebuilding"
        confidence = 0.78
    elif rebuild_score >= 0.58:
        direction = "rebuilding"
        confidence = 0.72
    elif win_now_score >= 0.46:
        direction = "retooling"
        confidence = 0.65
    else:
        direction = "balanced"
        confidence = 0.58

    if recent_win_pct is not None and recent_win_pct < 0.36 and direction in ["win now", "contending"]:
        direction = "retooling" if roster_strength_score >= 0.48 else "rebuilding"
        confidence = max(confidence, 0.70)
        reasons.append("Recent win percentage is too low for true win-now behavior.")

    if recent_win_pct is not None and recent_win_pct < 0.30 and roster_strength_score < 0.38:
        direction = "rebuilding"
        confidence = max(confidence, 0.78)
        reasons.append("Bottom-tier recent record with weak roster strength.")

    return direction, round(confidence, 3), {
        "rosterStrengthScore": round(roster_strength_score, 3),
        "ageUpsideScore": round(age_upside_score, 3),
        "recentStandingsScore": round(standings_score, 3),
        "recentPlayoffScore": round(playoff_score, 3),
        "winNowScore": round(win_now_score, 3),
        "rebuildScore": round(rebuild_score, 3),
    }, reasons


def build_team_roster_profile(
    team: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    players = list(team.get("players", []))
    team_name = get_team_name_from_team(team)
    ranked = sorted(
        players,
        key = lambda p: num(p.get("overall"), 0),
        reverse = True,
    )

    if not ranked:
        history_profile = build_recent_team_results_profile(league_data, team_name)
        direction, confidence, scores, reasons = classify_direction_from_scores(
            roster_strength_score = 0.0,
            age_upside_score = 0.0,
            history_profile = history_profile,
            fallback_direction = "rebuilding",
        )
        return {
            "direction": direction,
            "directionConfidence": confidence,
            "directionScores": scores,
            "directionReasons": reasons,
            "resultsProfile": history_profile,
            "coreOverall": 0.0,
            "coreAge": 0.0,
            "corePotentialGap": 0.0,
            "starCount": 0,
            "starterQualityCount": 0,
            "rotationQualityCount": 0,
            "youngCoreCount": 0,
            "oldCoreCount": 0,
            "top3Overall": 0.0,
            "top8Overall": 0.0,
            "positionCounts": {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0},
            "qualityCounts": {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0},
            "needs": {"PG": 1.0, "SG": 1.0, "SF": 1.0, "PF": 1.0, "C": 1.0, "UTIL": 0.5},
            "weakestPositions": ["PG", "SG", "SF"],
        }

    core = ranked[:8] if len(ranked) >= 8 else ranked
    top3 = ranked[:3] if len(ranked) >= 3 else ranked
    top8 = ranked[:8] if len(ranked) >= 8 else ranked

    core_overall = sum(num(p.get("overall"), 0) for p in core) / max(1, len(core))
    core_age = sum(num(p.get("age"), 0) for p in core) / max(1, len(core))
    core_potential_gap = (
        sum(num(p.get("potential"), num(p.get("overall"), 0)) - num(p.get("overall"), 0) for p in core)
        / max(1, len(core))
    )
    top3_overall = sum(num(p.get("overall"), 0) for p in top3) / max(1, len(top3))
    top8_overall = sum(num(p.get("overall"), 0) for p in top8) / max(1, len(top8))

    star_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 85)
    starter_quality_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 80)
    rotation_quality_count = sum(1 for p in ranked if num(p.get("overall"), 0) >= 76)
    young_core_count = sum(
        1 for p in ranked
        if num(p.get("overall"), 0) >= 77 and int(num(p.get("age"), 27)) <= 26
    )
    old_core_count = sum(
        1 for p in ranked
        if num(p.get("overall"), 0) >= 78 and int(num(p.get("age"), 27)) >= 31
    )

    position_counts = {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0}
    quality_counts = {"PG": 0, "SG": 0, "SF": 0, "PF": 0, "C": 0, "UTIL": 0}

    for player in ranked:
        bucket = get_player_position_bucket(player)
        position_counts[bucket] = position_counts.get(bucket, 0) + 1
        if num(player.get("overall"), 0) >= 76:
            quality_counts[bucket] = quality_counts.get(bucket, 0) + 1

    if top3_overall >= 83.0 and top8_overall >= 78.5 and core_age >= 26:
        fallback_direction = "contending"
    elif young_core_count >= 4 and core_potential_gap >= 2.5 and core_age <= 26.5:
        fallback_direction = "rebuilding"
    elif core_potential_gap >= 2.0 and core_age <= 28.5:
        fallback_direction = "retooling"
    else:
        fallback_direction = "balanced"

    star_component = clamp((top3_overall - 75.0) / 15.0, 0.0, 1.0)
    depth_component = clamp((top8_overall - 72.0) / 12.0, 0.0, 1.0)
    star_bonus = min(0.12, star_count * 0.055)
    roster_strength_score = clamp((star_component * 0.55) + (depth_component * 0.45) + star_bonus, 0.0, 1.0)

    young_component = clamp((27.5 - core_age) / 6.5, 0.0, 1.0)
    upside_component = clamp(core_potential_gap / 5.0, 0.0, 1.0)
    young_core_component = clamp(young_core_count / 5.0, 0.0, 1.0)
    age_upside_score = clamp(
        (young_component * 0.35)
        + (upside_component * 0.35)
        + (young_core_component * 0.30),
        0.0,
        1.0,
    )

    history_profile = build_recent_team_results_profile(league_data, team_name)
    direction, confidence, scores, reasons = classify_direction_from_scores(
        roster_strength_score = roster_strength_score,
        age_upside_score = age_upside_score,
        history_profile = history_profile,
        fallback_direction = fallback_direction,
    )

    target_counts = {"PG": 2, "SG": 2, "SF": 2, "PF": 2, "C": 2}
    needs = {}

    for bucket, target_count in target_counts.items():
        total_gap = max(0, target_count - position_counts.get(bucket, 0))
        quality_gap = max(0, target_count - quality_counts.get(bucket, 0))
        need_score = 0.18 + (total_gap * 0.24) + (quality_gap * 0.18)

        if bucket == "C" and quality_counts.get("C", 0) == 0:
            need_score += 0.18
        if bucket in ["SF", "PF"] and quality_counts.get(bucket, 0) == 0:
            need_score += 0.12

        needs[bucket] = round(clamp(need_score, 0.0, 1.0), 3)

    needs["UTIL"] = round(
        clamp(0.12 + max(0, 8 - rotation_quality_count) * 0.06, 0.0, 1.0),
        3,
    )

    weakest_positions = sorted(
        ["PG", "SG", "SF", "PF", "C"],
        key = lambda bucket: (-needs[bucket], quality_counts.get(bucket, 0), position_counts.get(bucket, 0), bucket),
    )

    return {
        "direction": direction,
        "directionConfidence": confidence,
        "directionScores": scores,
        "directionReasons": reasons,
        "resultsProfile": history_profile,
        "fallbackRosterDirection": fallback_direction,
        "coreOverall": round(core_overall, 1),
        "coreAge": round(core_age, 1),
        "corePotentialGap": round(core_potential_gap, 1),
        "starCount": star_count,
        "starterQualityCount": starter_quality_count,
        "rotationQualityCount": rotation_quality_count,
        "youngCoreCount": young_core_count,
        "oldCoreCount": old_core_count,
        "top3Overall": round(top3_overall, 1),
        "top8Overall": round(top8_overall, 1),
        "positionCounts": position_counts,
        "qualityCounts": quality_counts,
        "needs": needs,
        "weakestPositions": weakest_positions,
    }

def get_player_role_rank_on_team(team: Dict[str, Any], player: Dict[str, Any]) -> int:
    players = list(team.get("players", []))
    ranked = sorted(
        players,
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num(p.get("potential"), num(p.get("overall"), 0)),
            int(num(p.get("age"), 27)),
        ),
    )

    player_id = player.get("id")
    player_name = player.get("name")

    for idx, roster_player in enumerate(ranked, start = 1):
        if player_id not in [None, ""] and roster_player.get("id") == player_id:
            return idx
        if player_name not in [None, ""] and roster_player.get("name") == player_name:
            return idx

    return len(ranked) + 1


def get_player_need_score_from_profile(
    profile: Dict[str, Any],
    player: Dict[str, Any],
) -> float:
    bucket = get_player_position_bucket(player)
    needs = profile.get("needs", {}) if isinstance(profile, dict) else {}
    return float(needs.get(bucket, needs.get("UTIL", 0.15)))


def get_player_need_score_for_team(
    team: Dict[str, Any],
    player: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
) -> float:
    profile = build_team_roster_profile(team, league_data = league_data)
    return get_player_need_score_from_profile(profile, player)


def get_team_exception_room(
    league_data: Dict[str, Any],
    team_name: str,
    player: Optional[Dict[str, Any]] = None,
    snapshot: Optional[Dict[str, Any]] = None,
) -> int:
    snapshot = snapshot or get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return 0

    cap_room = max(0, int(num(snapshot.get("capRoom"), 0)))
    payroll = int(num(snapshot.get("payroll"), 0))
    remaining = get_team_remaining_exceptions(league_data, team_name)

    if player is not None and is_rights_team(player, team_name):
        usable_room = get_bird_rights_salary_ceiling(
            league_data = league_data,
            player = player,
            team_name = team_name,
        )
    elif cap_room > 0:
        usable_room = cap_room
        if cap_room <= remaining["roomException"]:
            usable_room = max(usable_room, remaining["roomException"])
    else:
        zone = get_payroll_zone_for_amount(league_data, payroll)

        if zone == "second_apron":
            usable_room = MIN_DEAL
        elif zone in ["first_apron", "tax"]:
            usable_room = remaining["taxpayerMLE"]
        else:
            usable_room = remaining["nonTaxpayerMLE"]

    hard_cap_room = snapshot.get("hardCapRoom")
    if bool(snapshot.get("isHardCapped")) and hard_cap_room is not None:
        usable_room = min(usable_room, max(0, int(num(hard_cap_room, 0))))

    return max(0, int(usable_room))

def validate_offer_spending_rules(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    contract: Dict[str, Any],
    outstanding_current_salary: int = 0,
    snapshot: Optional[Dict[str, Any]] = None,
    allow_pending_cap_hold_clearance: bool = True,
    allow_rfa_match_rights: bool = False,
) -> Dict[str, Any]:
    snapshot = snapshot or get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    contract = normalize_contract(contract)
    if not contract:
        return {
            "ok": False,
            "reason": "Invalid contract.",
            "teamSnapshot": snapshot,
        }

    season_year = get_operating_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)
    outstanding_current_salary = int(num(outstanding_current_salary, 0))

    if offered_current_salary > MAX_SALARY:
        over_by = offered_current_salary - MAX_SALARY
        return {
            "ok": False,
            "reason": f"Offer exceeds the maximum first-year salary by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": MAX_SALARY,
            "spendingType": "max_salary_blocked",
        }

    replaced_cap_hold = 0
    if is_rights_team(player, team_name):
        replaced_cap_hold = get_player_cap_hold_amount(
            league_data = league_data,
            player = player,
            team_name = team_name,
        )

    projected_payroll = (
        int(num(snapshot.get("payroll"), 0))
        - int(replaced_cap_hold)
        + int(outstanding_current_salary)
        + int(offered_current_salary)
    )

    hard_cap = snapshot.get("hardCap")
    is_hard_capped = bool(snapshot.get("isHardCapped"))
    if is_hard_capped and hard_cap is not None and projected_payroll > int(num(hard_cap, 0)):
        over_by = projected_payroll - int(num(hard_cap, 0))
        return {
            "ok": False,
            "reason": f"{team_name} would exceed its hard cap by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": get_team_exception_room(league_data, team_name, player),
            "spendingType": "hard_cap_blocked",
        }

    allow_minimum_exception = is_minimum_contract_for_current_year(
        league_data = league_data,
        contract = contract,
    )

    rights = get_player_rights(player)
    own_rights = is_rights_team(player, team_name)
    payroll_zone = get_payroll_zone_for_amount(league_data, int(num(snapshot.get("payroll"), 0)))
    cap_room = max(0, int(num(snapshot.get("capRoom"), 0)))
    practical_cap_room = int(num(snapshot.get("capRoom"), 0))
    raw_cap_room_without_holds = int(num(snapshot.get("rawCapRoomWithoutHolds"), 0))
    raw_payroll_without_holds = int(num(snapshot.get("rawPayrollWithoutHolds"), 0))
    cap_hold_total = int(num(snapshot.get("capHoldTotal") or snapshot.get("capHolds"), 0))
    remaining = get_team_remaining_exceptions(league_data, team_name)
    needed_room = outstanding_current_salary + offered_current_salary

    # Surgical RFA match rule:
    # Matching an outside offer sheet is not the same as creating a normal
    # Early Bird / Non-Bird return offer. If the original team still holds RFA
    # rights, the match should not be blocked by the Bird-rights salary ceiling.
    # Hard-cap legality was already checked above through projected_payroll.
    if allow_rfa_match_rights and own_rights and rights.get("restrictedFreeAgent"):
        return {
            "ok": True,
            "reason": "Offer is legal using restricted free agent matching rights.",
            "teamSnapshot": snapshot,
            "exceptionRoom": MAX_SALARY,
            "spendingType": "rfa_match",
            "exceptionType": None,
            "birdRights": rights,
            "payrollZone": payroll_zone,
            "projectedPayroll": projected_payroll,
            "exceptionRemaining": remaining,
            "rfaMatchRights": True,
        }

    # Live free-agency offer rule:
    # If a team has enough raw cap room after clearing cap holds, the offer is
    # legal to submit. The final signing still needs those holds cleared before
    # the player is added to the roster.
    if (
        allow_pending_cap_hold_clearance
        and not own_rights
        and cap_hold_total > 0
        and raw_cap_room_without_holds >= needed_room
        and practical_cap_room < needed_room
    ):
        raw_projected_payroll = raw_payroll_without_holds + needed_room
        if is_hard_capped and hard_cap is not None and raw_projected_payroll > int(num(hard_cap, 0)):
            over_by = raw_projected_payroll - int(num(hard_cap, 0))
            return {
                "ok": False,
                "reason": f"{team_name} would exceed its hard cap by ${int(over_by):,} even after clearing cap holds.",
                "teamSnapshot": snapshot,
                "exceptionRoom": raw_cap_room_without_holds,
                "spendingType": "hard_cap_blocked",
                "exceptionType": None,
                "birdRights": rights,
                "payrollZone": payroll_zone,
                "exceptionRemaining": remaining,
            }

        clearance_needed = max(0, needed_room - practical_cap_room)
        return {
            "ok": True,
            "reason": "Offer can be submitted using raw cap room after clearing cap holds.",
            "teamSnapshot": snapshot,
            "exceptionRoom": raw_cap_room_without_holds,
            "spendingType": "cap_space",
            "exceptionType": None,
            "birdRights": rights,
            "payrollZone": "below_cap",
            "projectedPayroll": raw_projected_payroll,
            "exceptionRemaining": remaining,
            "pendingCapHoldClearance": True,
            "capHoldClearanceNeeded": clearance_needed,
            "rawCapRoomWithoutHolds": raw_cap_room_without_holds,
            "rawPayrollWithoutHolds": raw_payroll_without_holds,
            "capHoldTotal": cap_hold_total,
        }

    if own_rights and rights.get("birdLevel") in ["bird", "early_bird", "non_bird"]:
        bird_ceiling = get_bird_rights_salary_ceiling(
            league_data = league_data,
            player = player,
            team_name = team_name,
        )

        if offered_current_salary > bird_ceiling:
            over_by = offered_current_salary - bird_ceiling
            return {
                "ok": False,
                "reason": f"{team_name} only has {rights.get('birdLevel')} rights for {player.get('name')}. This offer is over the rights limit by ${int(over_by):,}.",
                "teamSnapshot": snapshot,
                "exceptionRoom": bird_ceiling,
                "spendingType": "bird_rights_blocked",
                "birdRights": rights,
                "payrollZone": payroll_zone,
            }

        return {
            "ok": True,
            "reason": "Offer is legal using Bird rights.",
            "teamSnapshot": snapshot,
            "exceptionRoom": bird_ceiling,
            "spendingType": "bird_rights",
            "exceptionType": None,
            "birdRights": rights,
            "payrollZone": payroll_zone,
            "projectedPayroll": projected_payroll,
            "exceptionRemaining": remaining,
        }

    if allow_minimum_exception:
        return {
            "ok": True,
            "reason": "Offer is legal using the minimum exception.",
            "teamSnapshot": snapshot,
            "exceptionRoom": MIN_DEAL,
            "spendingType": "minimum",
            "exceptionType": None,
            "birdRights": rights,
            "payrollZone": payroll_zone,
            "projectedPayroll": projected_payroll,
            "exceptionRemaining": remaining,
        }

    needed_room = outstanding_current_salary + offered_current_salary
    available_room = 0
    spending_type = "cap_or_exception"
    exception_type = None
    legal_reason = "Offer is legal using cap room, exception room, or minimum exception."

    if cap_room > 0 and needed_room <= cap_room + int(replaced_cap_hold):
        available_room = cap_room + int(replaced_cap_hold)
        spending_type = "cap_space"
        exception_type = None
        legal_reason = "Offer is legal using cap room."
    elif cap_room > 0 and needed_room <= remaining["roomException"] + int(replaced_cap_hold):
        available_room = remaining["roomException"] + int(replaced_cap_hold)
        spending_type = "cap_or_exception"
        exception_type = "room_exception"
        legal_reason = "Offer is legal using remaining room exception."
    else:
        if payroll_zone == "second_apron":
            return {
                "ok": False,
                "reason": f"{team_name} is above the second apron and can only sign outside free agents to minimum contracts.",
                "teamSnapshot": snapshot,
                "exceptionRoom": MIN_DEAL,
                "spendingType": "second_apron_blocked",
                "exceptionType": None,
                "birdRights": rights,
                "payrollZone": payroll_zone,
                "exceptionRemaining": remaining,
            }

        if payroll_zone in ["first_apron", "tax"]:
            available_room = remaining["taxpayerMLE"] + int(replaced_cap_hold)
            exception_type = "taxpayer_mle"
            legal_reason = "Offer is legal using remaining taxpayer MLE."
        else:
            available_room = remaining["nonTaxpayerMLE"] + int(replaced_cap_hold)
            exception_type = "non_taxpayer_mle"
            legal_reason = "Offer is legal using remaining non-taxpayer MLE."

    if exception_type == "non_taxpayer_mle" and projected_payroll > get_first_apron(league_data):
        over_by = projected_payroll - get_first_apron(league_data)
        return {
            "ok": False,
            "reason": f"{team_name} cannot use the non-taxpayer MLE because this offer would cross the first apron by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
            "spendingType": "first_apron_blocked",
            "exceptionType": exception_type,
            "birdRights": rights,
            "payrollZone": payroll_zone,
            "exceptionRemaining": remaining,
        }

    if needed_room > available_room:
        over_by = needed_room - available_room
        return {
            "ok": False,
            "reason": f"{team_name} does not have enough remaining room for this offer. Over by ${int(over_by):,}.",
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
            "spendingType": "room_blocked",
            "exceptionType": exception_type,
            "birdRights": rights,
            "payrollZone": payroll_zone,
            "exceptionRemaining": remaining,
        }

    return {
        "ok": True,
        "reason": legal_reason,
        "teamSnapshot": snapshot,
        "exceptionRoom": available_room,
        "spendingType": spending_type,
        "exceptionType": exception_type,
        "birdRights": rights,
        "payrollZone": payroll_zone,
        "projectedPayroll": projected_payroll,
        "exceptionRemaining": remaining,
    }

def classify_team_direction(
    team: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return build_team_roster_profile(team, league_data = league_data)


def estimate_team_re_sign_interest(
    team: Dict[str, Any],
    player: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    profile = build_team_roster_profile(team, league_data = league_data)
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)
    role_rank = get_player_role_rank_on_team(team, player)
    need_score = get_player_need_score_for_team(team, player, league_data = league_data)

    score = 0.42
    score += max(0.0, (overall - 74.0) * 0.018)
    score += max(0.0, upside * 0.028)
    score += need_score * 0.12

    if role_rank <= 3:
        score += 0.24
    elif role_rank <= 5:
        score += 0.14
    elif role_rank <= 8:
        score += 0.06

    if direction in ["contending", "win now"]:
        if overall >= 79:
            score += 0.12
        if role_rank <= 5 and overall >= 77:
            score += 0.10
        if age >= 29 and overall >= 79:
            score += 0.08
        if age <= 25 and overall <= 75:
            score -= 0.05

    elif direction in ["rebuilding"]:
        if age <= 26:
            score += 0.12
        if upside >= 3:
            score += 0.10
        if age >= 31 and overall <= 80 and role_rank > 4:
            score -= 0.18
        if age >= 29 and upside <= 1 and overall <= 78:
            score -= 0.10

    elif direction == "retooling":
        if age <= 28:
            score += 0.08
        if upside >= 2:
            score += 0.07
        if 27 <= age <= 31 and overall >= 79:
            score += 0.05

    else:
        if 24 <= age <= 31:
            score += 0.05
        if overall >= 79:
            score += 0.05

    if age >= 34 and overall <= 80:
        score -= 0.10
    if age >= 36 and overall <= 82:
        score -= 0.12

    score = clamp(score, 0.0, 1.0)

    return {
        "teamDirection": direction,
        "reSignInterestScore": round(score, 3),
        "roleRank": role_rank,
        "needScore": round(need_score, 3),
    }


def estimate_team_free_agent_fit_from_profile(
    team: Dict[str, Any],
    player: Dict[str, Any],
    profile: Dict[str, Any],
) -> Dict[str, Any]:
    # Same scoring formula as estimate_team_free_agent_fit(...), but uses the
    # already-built team profile from the current FA day instead of rebuilding it
    # for every team/player candidate.
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)
    need_score = get_player_need_score_from_profile(profile, player)

    score = 0.22
    score += max(0.0, (overall - 72.0) * 0.020)
    score += max(0.0, (overall - 81.0) * 0.015)
    score += need_score * 0.28
    score += min(0.18, max(0.0, overall - 84.0) * 0.020)

    if direction in ["contending", "win now"]:
        if overall >= 79:
            score += 0.10
        score += max(0.0, min(0.10, (age - 27) * 0.010))
        if age <= 24 and overall < 78:
            score -= 0.05

    elif direction in ["rebuilding"]:
        if age <= 26:
            score += 0.10
        if upside >= 2:
            score += 0.08
        if upside >= 4:
            score += 0.04

        # Older players are discounted, but talent can overpower that discount.
        age_penalty = max(0.0, (age - 29) * 0.020)
        talent_relief = max(0.0, (overall - 80) * 0.017)
        score -= max(0.0, age_penalty - talent_relief)

    elif direction == "retooling":
        if age <= 29:
            score += 0.07
        if upside >= 2:
            score += 0.06
        if overall >= 79:
            score += 0.05
        if 27 <= age <= 31 and overall >= 80:
            score += 0.04

    else:
        if 24 <= age <= 31:
            score += 0.05
        if overall >= 79:
            score += 0.05
        if upside >= 2:
            score += 0.03

    if overall >= 85:
        score += 0.10
    elif overall >= 82:
        score += 0.05

    if age >= 34 and overall <= 79:
        score -= 0.06
    if age >= 36 and overall <= 81:
        score -= 0.08

    bucket = get_player_position_bucket(player)
    if bucket in profile["weakestPositions"][:2]:
        score += 0.08

    score = clamp(score, 0.0, 1.20)

    return {
        "teamDirection": direction,
        "interestScore": round(score, 3),
        "needScore": round(need_score, 3),
        "positionBucket": bucket,
        "weakestPositions": profile["weakestPositions"],
    }


def estimate_team_free_agent_fit(
    team: Dict[str, Any],
    player: Dict[str, Any],
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    profile = build_team_roster_profile(team, league_data = league_data)
    return estimate_team_free_agent_fit_from_profile(
        team = team,
        player = player,
        profile = profile,
    )
# ------------------------------------------------------------
# OFFSEASON CONTRACT DECISIONS
# ------------------------------------------------------------
def decide_player_option(
    player: Dict[str, Any],
    season_year: int,
    team: Optional[Dict[str, Any]] = None,
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    active_option = get_active_option_for_year(contract, season_year)
    market_value = player.get("marketValue") or estimate_market_value(player)

    if not active_option or active_option.get("type") != "player":
        return {
            "hasDecision": False,
            "exerciseOption": False,
            "score": 0.0,
            "reason": "No active player option.",
        }

    option_salary = int(active_option["salary"])
    expected_aav = int(market_value["expectedAAV"])
    expected_years = get_realistic_expected_contract_years(player)

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)

    market_gap = (expected_aav - option_salary) / max(1.0, float(option_salary))

    decline_threshold = 0.16

    if age >= 32:
        decline_threshold += 0.06
    if age >= 35:
        decline_threshold += 0.08
    if upside >= 3:
        decline_threshold -= 0.04
    if age <= 26 and overall >= 78:
        decline_threshold -= 0.04
    if expected_years >= 3:
        decline_threshold -= 0.03

    if team is not None and league_data is not None:
        team_name = get_team_name_from_team(team)
        results_profile = build_recent_team_results_profile(league_data, team_name)

        if results_profile.get("historyAvailable"):
            last_wins = results_profile.get("lastSeasonWins")
            recent_win_pct = results_profile.get("recentWinPct")

            if results_profile.get("lastSeasonChampion") or results_profile.get("lastSeasonFinals"):
                decline_threshold += 0.04
            elif results_profile.get("lastSeasonConferenceFinals"):
                decline_threshold += 0.03
            elif last_wins is not None and last_wins >= 50:
                decline_threshold += 0.025
            elif last_wins is not None and last_wins >= 42:
                decline_threshold += 0.015

            if last_wins is not None and last_wins <= 25:
                decline_threshold -= 0.035
            elif recent_win_pct is not None and recent_win_pct < 0.32:
                decline_threshold -= 0.025

    decline_threshold = clamp(decline_threshold, 0.08, 0.32)
    score = 1.0 + decline_threshold - market_gap
    exercise = market_gap < decline_threshold

    return {
        "hasDecision": True,
        "exerciseOption": exercise,
        "score": round(score, 3),
        "optionSalary": option_salary,
        "expectedAAV": expected_aav,
        "reason": "Player option accepted." if exercise else "Player option declined.",
    }


def decide_cpu_team_option(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    active_option = get_active_option_for_year(contract, season_year)
    market_value = player.get("marketValue") or estimate_market_value(player)

    if not active_option or active_option.get("type") != "team":
        return {
            "hasDecision": False,
            "exerciseOption": False,
            "score": 0.0,
            "reason": "No active team option.",
        }

    option_salary = int(active_option["salary"])
    expected_aav = int(market_value["expectedAAV"])

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    upside = max(0.0, potential - overall)

    direction_info = classify_team_direction(team, league_data = league_data)
    direction = direction_info["direction"]

    value_ratio = expected_aav / max(1.0, float(option_salary))
    salary_cap = get_salary_cap(league_data or {})
    roster_limit = get_roster_limit(league_data or {})
    standard_count = len(get_team_players(team))
    roster_pressure = max(0, standard_count - roster_limit)

    # Surgical team-option tuning:
    # Old logic was too generous to low-OVR young players. Keep real cheap
    # rookie-control assets, but stop picking up weak depth options just because
    # the player is young.
    cheap_young_option_limit = int(round_to_nearest(max(5_500_000, salary_cap * 0.035), base = 1_000))
    small_young_option_limit = int(round_to_nearest(max(9_500_000, salary_cap * 0.060), base = 1_000))
    rookie_asset_option_limit = int(round_to_nearest(max(15_000_000, salary_cap * 0.095), base = 1_000))

    rights = get_player_rights(player)
    rookie_scale_control = bool(rights.get("rookieScale"))

    very_low_young_depth = (
        age <= 25
        and overall <= 66
        and potential <= 73
    )
    low_floor_low_upside = (
        overall <= 69
        and potential <= 74
        and upside <= 2
    )
    roster_crunch_fringe = (
        roster_pressure > 0
        and overall <= 74
        and potential <= 78
        and upside <= 3
    )
    overpaid_depth_option = (
        overall <= 72
        and option_salary > max(expected_aav * 1.18, salary_cap * 0.025)
    )

    cheap_young_control = (
        age <= 24
        and option_salary <= cheap_young_option_limit
        and not very_low_young_depth
        and (overall >= 68 or potential >= 75 or upside >= 4)
    )
    small_young_control = (
        age <= 25
        and option_salary <= small_young_option_limit
        and not low_floor_low_upside
        and (overall >= 72 or potential >= 78 or upside >= 4)
    )
    rookie_asset_control = (
        rookie_scale_control
        and age <= 25
        and option_salary <= rookie_asset_option_limit
        and not very_low_young_depth
        and (overall >= 70 or potential >= 76 or upside >= 4)
    )
    young_asset_control = bool(
        cheap_young_control
        or small_young_control
        or rookie_asset_control
    )

    score = value_ratio
    score += max(0.0, (overall - 74.0) * 0.020)
    score += max(0.0, upside * 0.025)

    if overall >= 82:
        score += 0.18
    elif overall >= 78:
        score += 0.12
    elif overall >= 75:
        score += 0.06

    if age <= 25 and overall >= 72:
        score += 0.10
    elif age <= 25 and overall <= 69:
        score -= 0.10

    if age <= 27 and upside >= 3:
        score += 0.08
    if young_asset_control:
        score += 0.20

    if very_low_young_depth:
        score -= 0.28
    if low_floor_low_upside:
        score -= 0.18
    if roster_crunch_fringe:
        score -= 0.22
    if overpaid_depth_option:
        score -= 0.18

    if direction == "contending":
        if overall >= 76:
            score += 0.10
        if age >= 29 and overall >= 76:
            score += 0.05
        if overall <= 72 and age <= 25:
            score -= 0.05

    elif direction == "rebuilding":
        if age <= 24 and potential >= 78:
            score += 0.08
        if overall <= 69 and potential <= 74:
            score -= 0.10

    if roster_pressure >= 2 and overall <= 75 and not young_asset_control:
        score -= 0.12

    if option_salary <= expected_aav:
        score += 0.08
    elif value_ratio < 0.50:
        score -= 0.20
    elif value_ratio < 0.65:
        score -= 0.10

    exercise = False
    decision_reason = "CPU team declined team option."

    # Hard decline guards for the exact issue your friend found.
    if very_low_young_depth and value_ratio < 1.15:
        exercise = False
        decision_reason = "CPU declined low-OVR young depth option."
    elif low_floor_low_upside and value_ratio < 1.05:
        exercise = False
        decision_reason = "CPU declined low-upside depth option."
    elif roster_crunch_fringe and value_ratio < 1.15:
        exercise = False
        decision_reason = "CPU declined fringe option to create roster space."
    elif overpaid_depth_option:
        exercise = False
        decision_reason = "CPU declined overpaid depth option."
    elif young_asset_control:
        exercise = True
        decision_reason = "CPU exercised young asset team option."
    elif expected_aav >= option_salary and overall >= 70:
        exercise = True
        decision_reason = "CPU exercised value team option."
    elif value_ratio >= 0.88 and overall >= 72:
        exercise = True
        decision_reason = "CPU exercised fair-value team option."
    elif value_ratio >= 0.72 and overall >= 75:
        exercise = True
        decision_reason = "CPU exercised rotation-value team option."
    elif value_ratio >= 0.60 and overall >= 78:
        exercise = True
        decision_reason = "CPU exercised quality-player team option."
    elif value_ratio >= 0.58 and age <= 25 and overall >= 73 and potential >= 78:
        exercise = True
        decision_reason = "CPU exercised young upside team option."
    elif value_ratio >= 0.58 and age <= 27 and upside >= 4 and overall >= 72:
        exercise = True
        decision_reason = "CPU exercised upside team option."
    elif direction == "contending" and value_ratio >= 0.58 and overall >= 76:
        exercise = True
        decision_reason = "CPU exercised contender depth team option."
    elif value_ratio >= 0.52 and overall >= 83:
        exercise = True
        decision_reason = "CPU exercised high-talent discount team option."
    else:
        exercise = score >= 1.12
        decision_reason = (
            "CPU exercised team option by value score."
            if exercise
            else "CPU declined team option by value score."
        )

    return {
        "hasDecision": True,
        "exerciseOption": exercise,
        "score": round(score, 3),
        "optionSalary": option_salary,
        "expectedAAV": expected_aav,
        "teamDirection": direction,
        "valueRatio": round(value_ratio, 3),
        "standardCount": standard_count,
        "rosterPressure": roster_pressure,
        "youngAssetControl": bool(young_asset_control),
        "reason": decision_reason,
    }

def build_free_agent_record(
    player: Dict[str, Any],
    from_team_name: str,
    season_year: int,
    reason: str
) -> Dict[str, Any]:
    fa_player = copy.deepcopy(player)
    previous_rights = get_player_rights(fa_player)

    fa_player["previousContract"] = normalize_contract(player.get("contract"))
    fa_player["freeAgencyMeta"] = {
        "fromTeam": from_team_name,
        "seasonYear": season_year,
        "reason": reason,
    }

    if reason == "declined_team_option":
        set_player_rights(
            player = fa_player,
            held_by_team = None,
            seasons_toward_bird = 0,
            rookie_scale = previous_rights["rookieScale"],
            restricted_free_agent = False,
        )
    else:
        set_player_rights(
            player = fa_player,
            held_by_team = previous_rights.get("heldByTeam") or from_team_name,
            seasons_toward_bird = max(1, previous_rights["seasonsTowardBird"]),
            rookie_scale = previous_rights["rookieScale"],
            restricted_free_agent = previous_rights["restrictedFreeAgent"],
        )

    fa_player["contract"] = None
    fa_player["marketValue"] = estimate_market_value(fa_player)
    return fa_player

def remove_existing_free_agent_match(
    free_agents: List[Dict[str, Any]],
    player_id: Optional[Any],
    player_name: Optional[str]
) -> None:
    keep = []
    for p in free_agents:
        same_id = player_id not in [None, ""] and p.get("id") == player_id
        same_name = player_name not in [None, ""] and p.get("name") == player_name
        if same_id or same_name:
            continue
        keep.append(p)
    free_agents[:] = keep


def add_player_to_free_agency(
    updated: Dict[str, Any],
    player: Dict[str, Any],
    from_team_name: str,
    season_year: int,
    reason: str
) -> Dict[str, Any]:
    free_agents = updated.setdefault("freeAgents", [])
    remove_existing_free_agent_match(
        free_agents = free_agents,
        player_id = player.get("id"),
        player_name = player.get("name"),
    )

    fa_player = build_free_agent_record(
        player = player,
        from_team_name = from_team_name,
        season_year = season_year,
        reason = reason,
    )
    free_agents.append(fa_player)
    return fa_player


def build_contract_status_row(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    contract = normalize_contract(player.get("contract"))
    market_value = player.get("marketValue") or estimate_market_value(player)
    team_direction = classify_team_direction(team, league_data = league_data)
    re_sign_interest = estimate_team_re_sign_interest(team, player, league_data = league_data)

    upcoming_year = season_year + 1

    salary_this_year = get_contract_salary_for_year(contract, upcoming_year)
    salary_next_year = get_contract_salary_for_year(contract, upcoming_year + 1) if contract else 0
    final_rookie_option_completed = is_completed_final_rookie_scale_team_option(
        player = player,
        current_season_year = season_year,
    )
    active_option = get_active_option_for_player_for_year(
        player = player,
        contract = contract,
        option_season_year = upcoming_year,
        current_season_year = season_year,
    )

    if final_rookie_option_completed:
        salary_this_year = 0
        salary_next_year = 0
        active_option = None

    if active_option and salary_this_year <= 0:
        salary_this_year = int(active_option.get("salary", 0))
    contract_last_year = get_contract_last_year(contract)

    status = "signed"
    if not contract:
        status = "no_contract"
    elif active_option:
        # Source-of-truth parity with apply_offseason_contract_decisions:
        # an active option must always surface as an option decision row,
        # even if the saved salary slot is missing/zero in an older contract shape.
        status = f"{active_option['type']}_option"
    elif salary_this_year <= 0:
        status = "expired"

    row = {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": team.get("name"),
        "age": int(num(player.get("age"), 0)),
        "overall": int(round(num(player.get("overall"), 0))),
        "potential": int(round(num(player.get("potential"), num(player.get("overall"), 0)))),
        "position": player.get("pos"),
        "status": status,
        "seasonYear": season_year,
        "salaryThisYear": int(salary_this_year),
        "salaryNextYear": int(salary_next_year),
        "contractLastYear": contract_last_year,
        "marketValue": market_value,
        "teamDirection": team_direction["direction"],
        "reSignInterestScore": re_sign_interest["reSignInterestScore"],
        "finalRookieOptionCompleted": bool(final_rookie_option_completed),
        "qualifyingOfferCandidate": bool(
            final_rookie_option_completed
            and get_player_rights(player).get("rookieScale")
            and get_player_rights(player).get("heldByTeam")
        ),
    }

    if active_option:
        row["option"] = active_option

        if active_option["type"] == "player":
            row["playerOptionDecision"] = decide_player_option(
                player = player,
                season_year = upcoming_year,
                team = team,
                league_data = league_data,
            )
        elif active_option["type"] == "team":
            row["cpuTeamOptionDecision"] = decide_cpu_team_option(
                team,
                player,
                upcoming_year,
                league_data = league_data,
            )

    return row



# ------------------------------------------------------------
# TWO-WAY / STASH OFFSEASON DECISION HELPERS
# ------------------------------------------------------------
def get_raw_contract_salary_for_year(contract: Optional[Dict[str, Any]], season_year: int) -> int:
    if not isinstance(contract, dict):
        return 0

    start_year = int(num(contract.get("startYear"), DEFAULT_SEASON_YEAR))
    salary_by_year = contract.get("salaryByYear")

    if not isinstance(salary_by_year, list) or not salary_by_year:
        return 0

    idx = int(season_year) - start_year
    if idx < 0 or idx >= len(salary_by_year):
        return 0

    return int(num(salary_by_year[idx], 0))


def get_player_meta(player: Dict[str, Any]) -> Dict[str, Any]:
    meta = player.get("meta")
    return meta if isinstance(meta, dict) else {}


def get_player_draft_round(player: Dict[str, Any]) -> int:
    meta = get_player_meta(player)
    return int(num(
        meta.get("draftRound")
        or player.get("draftRound")
        or player.get("round")
        or 2,
        2,
    ))


def get_player_draft_pick(player: Dict[str, Any]) -> int:
    meta = get_player_meta(player)
    return int(num(
        meta.get("draftPick")
        or player.get("draftPick")
        or player.get("pick")
        or 60,
        60,
    ))


def get_player_rookie_reference_year(player: Dict[str, Any]) -> Optional[int]:
    meta = get_player_meta(player)
    candidates = [
        meta.get("nbaRookieSeasonYear"),
        player.get("nbaRookieSeasonYear"),
        meta.get("rookieYear"),
        player.get("rookieYear"),
        meta.get("rookieSeasonYear"),
        player.get("rookieSeasonYear"),
        meta.get("draftYear"),
        player.get("draftYear"),
        player.get("draftClassYear"),
    ]

    for value in candidates:
        year = int(num(value, 0))
        if 2020 <= year <= 2100:
            return year

    return None


def build_rookie_salary_for_pick(round_num: int, pick_num: int) -> int:
    round_num = int(num(round_num, 2))
    pick_num = int(num(pick_num, 60))

    if round_num == 1:
        return max(2_400_000, int(11_800_000 - (pick_num - 1) * 315_000))

    pick_in_round = max(1, pick_num - 30)
    return max(1_250_000, int(2_250_000 - (pick_in_round - 1) * 28_000))


def build_two_way_contract_for_season(start_year: int, source: str) -> Dict[str, Any]:
    return {
        "type": "two_way",
        "startYear": int(start_year),
        "salaryByYear": [TWO_WAY_SALARY],
        "option": None,
        "source": source,
        "countsAgainstStandardRoster": False,
        "countsAgainstSalaryCap": False,
    }


def build_standard_conversion_contract(
    player: Dict[str, Any],
    season_year: int,
    source: str,
) -> Dict[str, Any]:
    round_num = get_player_draft_round(player)
    pick_num = get_player_draft_pick(player)
    year_one_salary = build_rookie_salary_for_pick(round_num, pick_num)

    return {
        "type": "standard",
        "startYear": int(season_year) + 1,
        "salaryByYear": [int(year_one_salary)],
        "option": {
            "type": "team",
            "yearIndices": [0],
            "picked": {"0": True},
        },
        "source": source,
        "countsAgainstStandardRoster": True,
        "countsAgainstSalaryCap": True,
    }


def get_two_way_meta(player: Dict[str, Any]) -> Dict[str, Any]:
    meta = player.get("twoWayMeta")
    return meta if isinstance(meta, dict) else {}


def get_two_way_years_used(player: Dict[str, Any]) -> int:
    tw_meta = get_two_way_meta(player)
    value = (
        tw_meta.get("twoWayYearsUsed")
        or player.get("twoWayYearsUsed")
        or 1
    )
    return max(1, int(num(value, 1)))


def get_two_way_current_season_year(player: Dict[str, Any]) -> int:
    tw_meta = get_two_way_meta(player)
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}

    for value in [
        tw_meta.get("currentTwoWaySeasonYear"),
        tw_meta.get("assignedSeasonYear"),
        player.get("currentTwoWaySeasonYear"),
        contract.get("startYear"),
    ]:
        year = int(num(value, 0))
        if 2020 <= year <= 2100:
            return year

    return DEFAULT_SEASON_YEAR


def is_two_way_contract_decision_due(player: Dict[str, Any], season_year: int) -> bool:
    contract = player.get("contract") if isinstance(player.get("contract"), dict) else None
    current_two_way_year = get_two_way_current_season_year(player)

    # Same-offseason rookie signings should not immediately reappear on the
    # Options page. The decision is due only after that two-way season has been
    # completed, or when an old save has an expired/missing two-way contract.
    if int(season_year) < int(current_two_way_year):
        return False

    upcoming_year = int(season_year) + 1
    return contract is None or get_raw_contract_salary_for_year(contract, upcoming_year) <= 0


def can_extend_two_way_for_next_season(player: Dict[str, Any], season_year: int) -> bool:
    if get_two_way_years_used(player) >= 2:
        return False

    target_year = int(season_year) + 1
    rookie_year = get_player_rookie_reference_year(player)

    if rookie_year is not None and target_year - rookie_year >= 3:
        return False

    pro_seasons = get_player_pro_seasons(player)
    if pro_seasons >= 3:
        return False

    return True


def build_two_way_decision_row(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    market_value = player.get("marketValue") or estimate_market_value(player)
    can_extend = can_extend_two_way_for_next_season(player, season_year)
    available = ["convert", "release"]
    if can_extend:
        available = ["extend", "convert", "release"]

    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))

    two_way_count = len(team.get("twoWayPlayers", []) or [])
    upside = max(0, potential - overall)

    # Development-contract path:
    # If the player is clearly playable, convert him. Otherwise, use the
    # second two-way year whenever he is still eligible, especially if the
    # team is using fewer than two two-way slots. Only weak low-upside players
    # should be released while an extension is still available.
    if overall >= 74:
        recommended = "convert"
    elif can_extend:
        if overall <= 68 and potential < 72 and upside <= 2:
            recommended = "release"
        elif overall <= 70 and potential < 74 and two_way_count >= 2:
            recommended = "release"
        else:
            recommended = "extend"
    else:
        if overall >= 71 or potential >= 76 or upside >= 4:
            recommended = "convert"
        else:
            recommended = "release"

    if recommended not in available:
        recommended = available[0] if available else "release"

    player_key = get_player_key(player.get("id"), player.get("name"))

    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "playerKey": player_key,
        "teamName": team.get("name"),
        "age": int(num(player.get("age"), 0)),
        "overall": overall,
        "potential": potential,
        "position": player.get("pos"),
        "status": "two_way_decision",
        "decisionType": "two_way",
        "seasonYear": season_year,
        "salaryThisYear": 0,
        "salaryNextYear": 0,
        "marketValue": market_value,
        "teamDirection": classify_team_direction(team, league_data = league_data)["direction"],
        "twoWayYearsUsed": get_two_way_years_used(player),
        "maxTwoWayYears": 2,
        "canExtendTwoWay": can_extend,
        "availableDecisions": available,
        "recommendedDecision": recommended,
    }


def get_stash_meta(player: Dict[str, Any]) -> Dict[str, Any]:
    meta = player.get("stashMeta")
    return meta if isinstance(meta, dict) else {}


def get_stash_return_eligible_season_year(player: Dict[str, Any]) -> int:
    stash_meta = get_stash_meta(player)
    meta = get_player_meta(player)

    for value in [
        stash_meta.get("returnEligibleSeasonYear"),
        stash_meta.get("decisionSeasonYear"),
        meta.get("stashDecisionSeasonYear"),
        meta.get("stashSeasonYear"),
        player.get("returnEligibleSeasonYear"),
    ]:
        year = int(num(value, 0))
        if 2020 <= year <= 2100:
            return year

    contract = player.get("contract") if isinstance(player.get("contract"), dict) else {}
    year = int(num(contract.get("startYear"), 0))
    if 2020 <= year <= 2100:
        return year

    return DEFAULT_SEASON_YEAR


def is_stash_decision_due(player: Dict[str, Any], season_year: int) -> bool:
    # A one-year stash should not appear in the same offseason it was assigned.
    # It becomes actionable only after the stashed season has completed.
    return int(season_year) >= int(get_stash_return_eligible_season_year(player))


def can_assign_stash_player_to_two_way(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
) -> bool:
    two_way_count = len(team.get("twoWayPlayers", []) or [])
    if two_way_count >= TWO_WAY_MAX:
        return False

    target_year = int(season_year) + 1
    rookie_year = get_player_rookie_reference_year(player)

    if rookie_year is not None and target_year - rookie_year >= 3:
        return False

    if get_player_pro_seasons(player) >= 3:
        return False

    return True


def build_stash_decision_row(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
    league_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    market_value = player.get("marketValue") or estimate_market_value(player)
    can_two_way = can_assign_stash_player_to_two_way(team, player, season_year)
    available = ["standard", "release"]
    if can_two_way:
        available = ["two_way", "standard", "release"]

    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))

    two_way_count = len(team.get("twoWayPlayers", []) or [])
    upside = max(0, potential - overall)

    # Stash return path should usually be stash -> two-way -> standard later.
    # Only genuinely playable returnees jump straight to a standard deal.
    if overall >= 74:
        recommended = "standard"
    elif can_two_way:
        if overall <= 68 and potential < 71 and upside <= 2 and two_way_count >= 2:
            recommended = "release"
        else:
            recommended = "two_way"
    elif overall >= 71 or potential >= 76 or upside >= 4:
        recommended = "standard"
    else:
        recommended = "release"

    if recommended not in available:
        recommended = available[0] if available else "release"

    player_key = get_player_key(player.get("id"), player.get("name"))

    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "playerKey": player_key,
        "teamName": team.get("name"),
        "age": int(num(player.get("age"), 0)),
        "overall": overall,
        "potential": potential,
        "position": player.get("pos"),
        "status": "stash_decision",
        "decisionType": "stash",
        "seasonYear": season_year,
        "salaryThisYear": 0,
        "salaryNextYear": 0,
        "marketValue": market_value,
        "teamDirection": classify_team_direction(team, league_data = league_data)["direction"],
        "returnEligibleSeasonYear": get_stash_return_eligible_season_year(player),
        "availableDecisions": available,
        "recommendedDecision": recommended,
    }


def get_development_decision_choice(
    decisions: Dict[str, Any],
    player: Dict[str, Any],
    fallback: Optional[str] = None,
) -> Optional[str]:
    if not isinstance(decisions, dict):
        return fallback

    keys = []
    if player.get("id") not in [None, ""]:
        keys.append(str(player.get("id")))
        keys.append(get_player_key(player.get("id"), player.get("name")))
    if player.get("name") not in [None, ""]:
        keys.append(str(player.get("name")))
        keys.append(get_player_key(None, player.get("name")))

    for key in keys:
        if key in decisions and decisions.get(key) not in [None, ""]:
            return str(decisions.get(key))

    return fallback


def append_unique_contract_player(players: List[Dict[str, Any]], player: Dict[str, Any]) -> None:
    key = get_player_key(player.get("id"), player.get("name"))
    for idx, existing in enumerate(players):
        existing_key = get_player_key(existing.get("id"), existing.get("name"))
        if existing_key == key:
            players[idx] = player
            return
    players.append(player)


def clear_player_team_control_for_ufa(player: Dict[str, Any]) -> None:
    set_player_rights(
        player = player,
        held_by_team = None,
        seasons_toward_bird = 0,
        rookie_scale = False,
        restricted_free_agent = False,
    )
    player.pop("qualifyingOffer", None)
    player.pop("qualifyingOfferEligible", None)


def mark_player_as_standard_conversion(
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    source: str,
) -> Dict[str, Any]:
    converted = copy.deepcopy(player)
    converted["contract"] = build_standard_conversion_contract(converted, season_year, source)
    converted["contractType"] = "standard"
    converted["rosterStatus"] = "standard"
    converted["assignmentStatus"] = "nba"
    converted["team"] = team_name
    converted.pop("isTwoWay", None)
    converted.pop("twoWayMeta", None)
    converted.pop("stashMeta", None)

    meta = converted.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["nbaRookieSeasonYear"] = meta.get("nbaRookieSeasonYear") or season_year + 1
        meta["rookieSigningDecision"] = source
        meta["yearsWithCurrentTeam"] = max(1, int(num(meta.get("yearsWithCurrentTeam"), 0)))

    set_player_rights(
        player = converted,
        held_by_team = team_name,
        seasons_toward_bird = 1,
        rookie_scale = True,
        restricted_free_agent = False,
    )

    return converted


def mark_player_as_two_way_extension(
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
    source: str = "two_way_extended",
) -> Dict[str, Any]:
    extended = copy.deepcopy(player)
    previous_years_used = get_two_way_years_used(extended)
    old_tw_meta = extended.get("twoWayMeta") if isinstance(extended.get("twoWayMeta"), dict) else {}

    extended["contract"] = build_two_way_contract_for_season(
        start_year = season_year + 1,
        source = source,
    )
    extended["contractType"] = "two_way"
    extended["rosterStatus"] = "two_way"
    extended["assignmentStatus"] = "g_league"
    extended["team"] = team_name
    extended["isTwoWay"] = True

    meta = extended.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["nbaRookieSeasonYear"] = meta.get("nbaRookieSeasonYear") or season_year + 1
        meta["rookieSigningDecision"] = source

    extended["twoWayMeta"] = {
        **old_tw_meta,
        "assignedByTeam": team_name,
        "assignedSeasonYear": old_tw_meta.get("assignedSeasonYear", season_year + 1),
        "currentTwoWaySeasonYear": season_year + 1,
        "twoWayYearsUsed": min(2, previous_years_used + 1),
        "maxTwoWayYears": 2,
        "source": source,
    }

    set_player_rights(
        player = extended,
        held_by_team = team_name,
        seasons_toward_bird = 0,
        rookie_scale = False,
        restricted_free_agent = False,
    )

    return extended


def mark_stash_player_as_first_two_way(
    player: Dict[str, Any],
    team_name: str,
    season_year: int,
) -> Dict[str, Any]:
    two_way_player = copy.deepcopy(player)
    two_way_player["contract"] = build_two_way_contract_for_season(
        start_year = season_year + 1,
        source = "stash_return_two_way",
    )
    two_way_player["contractType"] = "two_way"
    two_way_player["rosterStatus"] = "two_way"
    two_way_player["assignmentStatus"] = "g_league"
    two_way_player["team"] = team_name
    two_way_player["isTwoWay"] = True
    two_way_player.pop("stashMeta", None)

    meta = two_way_player.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["nbaRookieSeasonYear"] = season_year + 1
        meta["rookieSigningDecision"] = "stash_return_two_way"

    two_way_player["twoWayMeta"] = {
        "assignedByTeam": team_name,
        "assignedSeasonYear": season_year + 1,
        "currentTwoWaySeasonYear": season_year + 1,
        "twoWayYearsUsed": 1,
        "maxTwoWayYears": 2,
        "source": "stash_return_two_way",
    }

    set_player_rights(
        player = two_way_player,
        held_by_team = team_name,
        seasons_toward_bird = 0,
        rookie_scale = False,
        restricted_free_agent = False,
    )

    return two_way_player


def preview_offseason_contracts(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> Dict[str, Any]:
    # Player/team options are a pre-free-agency step. Keep preview aligned
    # with apply_offseason_contract_decisions by resolving the current
    # offseason year, even if a stale freeAgencyState is still marked active.
    season_year = get_current_season_year(league_data)

    expired_contracts = []
    player_options = []
    team_options = []
    signed_players = []
    two_way_decisions = []
    stash_decisions = []

    for _, _, team in iter_teams(league_data):
        for player in team.get("players", []):
            row = build_contract_status_row(
                team,
                player,
                season_year,
                league_data = league_data,
            )

            if row["status"] in ["expired", "no_contract"]:
                expired_contracts.append(row)
            elif row["status"] == "player_option":
                player_options.append(row)
            elif row["status"] == "team_option":
                team_options.append(row)
            else:
                signed_players.append(row)

        for player in team.get("twoWayPlayers", []):
            if is_two_way_contract_decision_due(player, season_year):
                two_way_decisions.append(
                    build_two_way_decision_row(
                        team = team,
                        player = player,
                        season_year = season_year,
                        league_data = league_data,
                    )
                )
                continue

            row = build_contract_status_row(
                team,
                player,
                season_year,
                league_data = league_data,
            )
            row["twoWayContract"] = True
            signed_players.append(row)

        for player in team.get("stashPlayers", []):
            if is_stash_decision_due(player, season_year):
                stash_decisions.append(
                    build_stash_decision_row(
                        team = team,
                        player = player,
                        season_year = season_year,
                        league_data = league_data,
                    )
                )

    def sort_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(
            rows,
            key = lambda r: (
                str(r.get("teamName", "")),
                -num(r.get("overall"), 0),
                str(r.get("playerName", "")),
            )
        )

    expired_contracts = sort_rows(expired_contracts)
    player_options = sort_rows(player_options)
    team_options = sort_rows(team_options)
    two_way_decisions = sort_rows(two_way_decisions)
    stash_decisions = sort_rows(stash_decisions)

    pending_user_team_options = []
    pending_user_two_way_decisions = []
    pending_user_stash_decisions = []

    if user_team_name:
        pending_user_team_options = [
            row for row in team_options
            if row.get("teamName") == user_team_name
        ]
        pending_user_two_way_decisions = [
            row for row in two_way_decisions
            if row.get("teamName") == user_team_name
        ]
        pending_user_stash_decisions = [
            row for row in stash_decisions
            if row.get("teamName") == user_team_name
        ]

    projected_new_free_agents = len(expired_contracts)

    for row in player_options:
        decision = row.get("playerOptionDecision", {})
        if decision.get("hasDecision") and not decision.get("exerciseOption"):
            projected_new_free_agents += 1

    for row in team_options:
        if row.get("teamName") == user_team_name:
            projected_new_free_agents += 1
        else:
            cpu_decision = row.get("cpuTeamOptionDecision", {})
            if cpu_decision.get("hasDecision") and not cpu_decision.get("exerciseOption"):
                projected_new_free_agents += 1

    for row in two_way_decisions:
        if row.get("teamName") == user_team_name:
            continue
        if row.get("recommendedDecision") == "release":
            projected_new_free_agents += 1

    for row in stash_decisions:
        if row.get("teamName") == user_team_name:
            continue
        if row.get("recommendedDecision") == "release":
            projected_new_free_agents += 1

    return {
        "ok": True,
        "seasonYear": season_year,
        "userTeamName": user_team_name,
        "summary": {
            "expiredContractCount": len(expired_contracts),
            "playerOptionCount": len(player_options),
            "teamOptionCount": len(team_options),
            "twoWayDecisionCount": len(two_way_decisions),
            "stashDecisionCount": len(stash_decisions),
            "pendingUserTeamOptionCount": len(pending_user_team_options),
            "pendingUserTwoWayDecisionCount": len(pending_user_two_way_decisions),
            "pendingUserStashDecisionCount": len(pending_user_stash_decisions),
            "projectedNewFreeAgents": projected_new_free_agents,
            "currentFreeAgentCount": len(league_data.get("freeAgents", [])),
        },
        "expiredContracts": expired_contracts,
        "playerOptions": player_options,
        "teamOptions": team_options,
        "twoWayDecisions": two_way_decisions,
        "stashDecisions": stash_decisions,
        "pendingUserTeamOptions": pending_user_team_options,
        "pendingUserTwoWayDecisions": pending_user_two_way_decisions,
        "pendingUserStashDecisions": pending_user_stash_decisions,
    }

def get_user_team_option_choice(
    decisions: Dict[str, Any],
    player: Dict[str, Any]
) -> Optional[bool]:
    player_id = player.get("id")
    player_name = player.get("name")

    if player_id not in [None, ""] and str(player_id) in decisions:
        return bool(decisions[str(player_id)])

    if player_name not in [None, ""] and str(player_name) in decisions:
        return bool(decisions[str(player_name)])

    return None



def apply_offseason_contract_decisions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    team_option_decisions: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    season_year = get_current_season_year(league_data)
    preview = preview_offseason_contracts(
        league_data = league_data,
        user_team_name = user_team_name,
    )

    team_option_decisions = team_option_decisions or {}
    two_way_decisions = {}
    stash_decisions = {}

    if isinstance(team_option_decisions, dict):
        two_way_decisions = team_option_decisions.get("__twoWayDecisions") or {}
        stash_decisions = team_option_decisions.get("__stashDecisions") or {}

    if user_team_name:
        missing = []
        for row in preview["pendingUserTeamOptions"]:
            player_id = row.get("playerId")
            player_name = row.get("playerName")

            has_id_choice = player_id not in [None, ""] and str(player_id) in team_option_decisions
            has_name_choice = player_name not in [None, ""] and str(player_name) in team_option_decisions

            if not has_id_choice and not has_name_choice:
                missing.append({
                    "playerId": player_id,
                    "playerName": player_name,
                    "teamName": row.get("teamName"),
                    "salaryThisYear": row.get("salaryThisYear"),
                    "option": row.get("option"),
                })

        missing_two_way = []
        for row in preview.get("pendingUserTwoWayDecisions", []):
            choice = get_development_decision_choice(
                decisions = two_way_decisions,
                player = {
                    "id": row.get("playerId"),
                    "name": row.get("playerName"),
                },
                fallback = None,
            )
            available = row.get("availableDecisions") if isinstance(row.get("availableDecisions"), list) else ["convert", "release"]
            if choice not in available:
                missing_two_way.append(row)

        missing_stash = []
        for row in preview.get("pendingUserStashDecisions", []):
            choice = get_development_decision_choice(
                decisions = stash_decisions,
                player = {
                    "id": row.get("playerId"),
                    "name": row.get("playerName"),
                },
                fallback = None,
            )
            available = row.get("availableDecisions") if isinstance(row.get("availableDecisions"), list) else ["standard", "release"]
            if choice not in available:
                missing_stash.append(row)

        if missing or missing_two_way or missing_stash:
            return {
                "ok": False,
                "reason": "Pending user option, two-way, or stash decisions are required before finalizing pre-free-agency.",
                "seasonYear": season_year,
                "pendingTeamOptions": missing,
                "pendingTwoWayDecisions": missing_two_way,
                "pendingStashDecisions": missing_stash,
                "preview": preview,
            }

    updated = copy.deepcopy(league_data)
    decision_log = []
    teams_affected = set()

    for _, _, team in iter_teams(updated):
        team_name = team.get("name", "Unknown Team")
        original_players = list(team.get("players", []))
        kept_players = []

        for player in original_players:
            contract = normalize_contract(player.get("contract"))
            upcoming_year = season_year + 1
            salary_this_year = get_contract_salary_for_year(contract, upcoming_year)
            active_option = get_active_option_for_player_for_year(
                player = player,
                contract = contract,
                option_season_year = upcoming_year,
                current_season_year = season_year,
            )

            if active_option and salary_this_year <= 0:
                salary_this_year = int(active_option.get("salary", 0))

            final_rookie_option_completed = is_completed_final_rookie_scale_team_option(
                player = player,
                current_season_year = season_year,
            )

            if final_rookie_option_completed:
                fa_player = add_player_to_free_agency(
                    updated = updated,
                    player = player,
                    from_team_name = team_name,
                    season_year = season_year,
                    reason = "expired_rookie_scale_contract",
                )
                process_qualifying_offer_after_entry(
                    league_data = updated,
                    team = team,
                    player = fa_player,
                    team_name = team_name,
                    season_year = season_year,
                    reason = "expired_rookie_scale_contract",
                    user_team_name = user_team_name,
                )
                decision_log.append({
                    "type": "rookie_scale_qo",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "entered_free_agency_qo_eligible",
                })
                teams_affected.add(team_name)
                continue

            if contract is None or (salary_this_year <= 0 and not active_option):
                fa_player = add_player_to_free_agency(
                    updated = updated,
                    player = player,
                    from_team_name = team_name,
                    season_year = season_year,
                    reason = "expired_contract" if contract else "no_contract",
                )
                process_qualifying_offer_after_entry(
                    league_data = updated,
                    team = team,
                    player = fa_player,
                    team_name = team_name,
                    season_year = season_year,
                    reason = "expired_contract" if contract else "no_contract",
                    user_team_name = user_team_name,
                )
                decision_log.append({
                    "type": "expired_contract",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "entered_free_agency",
                })
                teams_affected.add(team_name)
                continue

            if active_option and active_option.get("type") == "player":
                decision = decide_player_option(
                    player = player,
                    season_year = upcoming_year,
                    team = team,
                    league_data = updated,
                )
                if decision["exerciseOption"]:
                    kept_player = copy.deepcopy(player)
                    kept_player["contract"] = apply_option_exercise_to_contract(
                        contract = kept_player.get("contract"),
                        active_option = active_option,
                    )
                    kept_players.append(kept_player)
                    decision_log.append({
                        "type": "player_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "accepted_option",
                        "score": decision["score"],
                    })
                else:
                    fa_player = add_player_to_free_agency(
                        updated = updated,
                        player = player,
                        from_team_name = team_name,
                        season_year = season_year,
                        reason = "declined_player_option",
                    )
                    process_qualifying_offer_after_entry(
                        league_data = updated,
                        team = team,
                        player = fa_player,
                        team_name = team_name,
                        season_year = season_year,
                        reason = "declined_player_option",
                        user_team_name = user_team_name,
                    )
                    decision_log.append({
                        "type": "player_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "declined_option_entered_free_agency",
                        "score": decision["score"],
                    })
                    teams_affected.add(team_name)
                continue

            if active_option and active_option.get("type") == "team":
                if user_team_name and team_name == user_team_name:
                    exercise = get_user_team_option_choice(team_option_decisions, player)
                    if exercise is None:
                        return {
                            "ok": False,
                            "reason": f"Missing team option decision for {player.get('name')}.",
                            "preview": preview,
                        }
                    decision = {
                        "exerciseOption": exercise,
                        "score": None,
                    }
                else:
                    decision = decide_cpu_team_option(
                        team,
                        player,
                        upcoming_year,
                        league_data = updated,
                    )
                    exercise = decision["exerciseOption"]

                if exercise:
                    kept_player = copy.deepcopy(player)
                    kept_player["contract"] = apply_option_exercise_to_contract(
                        contract = kept_player.get("contract"),
                        active_option = active_option,
                    )
                    kept_players.append(kept_player)
                    decision_log.append({
                        "type": "team_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "option_exercised",
                        "score": decision.get("score"),
                        "userControlled": bool(user_team_name and team_name == user_team_name),
                    })
                else:
                    fa_player = add_player_to_free_agency(
                        updated = updated,
                        player = player,
                        from_team_name = team_name,
                        season_year = season_year,
                        reason = "declined_team_option",
                    )
                    process_qualifying_offer_after_entry(
                        league_data = updated,
                        team = team,
                        player = fa_player,
                        team_name = team_name,
                        season_year = season_year,
                        reason = "declined_team_option",
                        user_team_name = user_team_name,
                    )
                    decision_log.append({
                        "type": "team_option",
                        "playerName": player.get("name"),
                        "teamName": team_name,
                        "result": "option_declined_entered_free_agency",
                        "score": decision.get("score"),
                        "userControlled": bool(user_team_name and team_name == user_team_name),
                    })
                    teams_affected.add(team_name)
                continue

            kept_players.append(player)

        team["players"] = kept_players

        original_two_way_players = list(team.get("twoWayPlayers", [])) if isinstance(team.get("twoWayPlayers"), list) else []
        kept_two_way_players = []

        for player in original_two_way_players:
            if not is_two_way_contract_decision_due(player, season_year):
                kept_two_way_players.append(player)
                continue

            row = build_two_way_decision_row(
                team = team,
                player = player,
                season_year = season_year,
                league_data = updated,
            )
            available = row.get("availableDecisions") if isinstance(row.get("availableDecisions"), list) else ["convert", "release"]

            if user_team_name and team_name == user_team_name:
                choice = get_development_decision_choice(two_way_decisions, player, None)
                if choice not in available:
                    return {
                        "ok": False,
                        "reason": f"Missing or invalid two-way decision for {player.get('name')}.",
                        "preview": preview,
                    }
            else:
                choice = row.get("recommendedDecision", "release")

            if choice not in available:
                choice = row.get("recommendedDecision") if row.get("recommendedDecision") in available else "release"

            if choice == "extend" and can_extend_two_way_for_next_season(player, season_year):
                kept_player = mark_player_as_two_way_extension(
                    player = player,
                    team_name = team_name,
                    season_year = season_year,
                    source = "two_way_extended_second_year",
                )
                kept_two_way_players.append(kept_player)
                decision_log.append({
                    "type": "two_way_decision",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "extended_two_way",
                    "userControlled": bool(user_team_name and team_name == user_team_name),
                })
                continue

            if choice == "convert":
                converted = mark_player_as_standard_conversion(
                    player = player,
                    team_name = team_name,
                    season_year = season_year,
                    source = "two_way_convert_to_standard",
                )
                append_unique_contract_player(team["players"], converted)
                decision_log.append({
                    "type": "two_way_decision",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "converted_to_standard",
                    "userControlled": bool(user_team_name and team_name == user_team_name),
                })
                teams_affected.add(team_name)
                continue

            fa_player = add_player_to_free_agency(
                updated = updated,
                player = player,
                from_team_name = team_name,
                season_year = season_year,
                reason = "released_from_two_way",
            )
            clear_player_team_control_for_ufa(fa_player)
            decision_log.append({
                "type": "two_way_decision",
                "playerName": player.get("name"),
                "teamName": team_name,
                "result": "released_to_unrestricted_free_agency",
                "userControlled": bool(user_team_name and team_name == user_team_name),
            })
            teams_affected.add(team_name)

        if original_two_way_players or isinstance(team.get("twoWayPlayers"), list):
            team["twoWayPlayers"] = kept_two_way_players

        original_stash_players = list(team.get("stashPlayers", [])) if isinstance(team.get("stashPlayers"), list) else []
        kept_stash_players = []

        for player in original_stash_players:
            if not is_stash_decision_due(player, season_year):
                kept_stash_players.append(player)
                continue

            row = build_stash_decision_row(
                team = team,
                player = player,
                season_year = season_year,
                league_data = updated,
            )
            available = row.get("availableDecisions") if isinstance(row.get("availableDecisions"), list) else ["standard", "release"]

            if user_team_name and team_name == user_team_name:
                choice = get_development_decision_choice(stash_decisions, player, None)
                if choice not in available:
                    return {
                        "ok": False,
                        "reason": f"Missing or invalid stash decision for {player.get('name')}.",
                        "preview": preview,
                    }
            else:
                choice = row.get("recommendedDecision", "release")

            if choice not in available:
                choice = row.get("recommendedDecision") if row.get("recommendedDecision") in available else "release"

            if choice == "two_way" and can_assign_stash_player_to_two_way(team, player, season_year):
                two_way_player = mark_stash_player_as_first_two_way(
                    player = player,
                    team_name = team_name,
                    season_year = season_year,
                )
                append_unique_contract_player(team["twoWayPlayers"], two_way_player)
                decision_log.append({
                    "type": "stash_decision",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "signed_first_two_way",
                    "userControlled": bool(user_team_name and team_name == user_team_name),
                })
                teams_affected.add(team_name)
                continue

            if choice == "standard":
                converted = mark_player_as_standard_conversion(
                    player = player,
                    team_name = team_name,
                    season_year = season_year,
                    source = "stash_return_standard",
                )
                append_unique_contract_player(team["players"], converted)
                decision_log.append({
                    "type": "stash_decision",
                    "playerName": player.get("name"),
                    "teamName": team_name,
                    "result": "converted_to_standard",
                    "userControlled": bool(user_team_name and team_name == user_team_name),
                })
                teams_affected.add(team_name)
                continue

            fa_player = add_player_to_free_agency(
                updated = updated,
                player = player,
                from_team_name = team_name,
                season_year = season_year,
                reason = "released_from_stash",
            )
            clear_player_team_control_for_ufa(fa_player)
            decision_log.append({
                "type": "stash_decision",
                "playerName": player.get("name"),
                "teamName": team_name,
                "result": "released_to_unrestricted_free_agency",
                "userControlled": bool(user_team_name and team_name == user_team_name),
            })
            teams_affected.add(team_name)

        if original_stash_players or isinstance(team.get("stashPlayers"), list):
            team["stashPlayers"] = kept_stash_players

    normalize_all_player_rights(updated)

    for player in updated.setdefault("freeAgents", []):
        player["marketValue"] = estimate_market_value(player)

    summary = {
        "seasonYear": season_year,
        "enteredFreeAgencyCount": len([
            x for x in decision_log
            if "entered_free_agency" in str(x.get("result", "")) or "free_agency" in str(x.get("result", ""))
        ]),
        "playerOptionAcceptedCount": len([
            x for x in decision_log
            if x.get("type") == "player_option" and x.get("result") == "accepted_option"
        ]),
        "teamOptionExercisedCount": len([
            x for x in decision_log
            if x.get("type") == "team_option" and x.get("result") == "option_exercised"
        ]),
        "teamOptionDeclinedCount": len([
            x for x in decision_log
            if x.get("type") == "team_option" and x.get("result") == "option_declined_entered_free_agency"
        ]),
        "twoWayExtendedCount": len([
            x for x in decision_log
            if x.get("type") == "two_way_decision" and x.get("result") == "extended_two_way"
        ]),
        "twoWayConvertedCount": len([
            x for x in decision_log
            if x.get("type") == "two_way_decision" and x.get("result") == "converted_to_standard"
        ]),
        "stashTwoWayCount": len([
            x for x in decision_log
            if x.get("type") == "stash_decision" and x.get("result") == "signed_first_two_way"
        ]),
        "stashConvertedCount": len([
            x for x in decision_log
            if x.get("type") == "stash_decision" and x.get("result") == "converted_to_standard"
        ]),
        "teamsAffected": sorted(teams_affected),
        "freeAgentCount": len(updated.get("freeAgents", [])),
    }

    return {
        "ok": True,
        "leagueData": updated,
        "summary": summary,
        "decisionLog": decision_log,
        "previewAfter": preview_offseason_contracts(
            league_data = updated,
            user_team_name = user_team_name,
        ),
    }

def get_player_key(player_id: Optional[Any], player_name: Optional[str]) -> str:
    if player_id not in [None, ""]:
        return f"id:{player_id}"
    return f"name:{player_name or ''}"


def get_player_key_from_player(player: Dict[str, Any]) -> str:
    return get_player_key(player.get("id"), player.get("name"))


def ensure_free_agency_state(league_data: Dict[str, Any]) -> Dict[str, Any]:
    state = league_data.setdefault("freeAgencyState", {})
    if not isinstance(state, dict):
        league_data["freeAgencyState"] = {}
        state = league_data["freeAgencyState"]

    state.setdefault("isActive", False)
    state.setdefault("currentDay", 0)
    state.setdefault("maxDays", DEFAULT_FREE_AGENCY_DAYS)
    state.setdefault("offersByPlayer", {})
    state.setdefault("dailyLog", [])
    state.setdefault("signedPlayersLog", [])
    state.setdefault("offerHistory", [])
    state.setdefault("userOfferOutcomeLog", [])
    state.setdefault("pendingUserDecisions", [])
    state.setdefault("pendingRfaMatchDecisions", [])
    state.setdefault("pendingUserTeamName", None)
    state.setdefault("pendingUserTeamSnapshot", None)
    state.setdefault("forceViewingOffersReturn", False)
    state.setdefault("forceViewingOffersReturnReason", None)
    state.setdefault("resumeAdvanceAfterImmediateRfaMatch", False)
    state.setdefault("resumeAdvanceAfterImmediateRfaMatchDay", None)
    state.setdefault("exceptionUsageByTeam", {})
    state.setdefault("teamNeedProfiles", {})
    state.setdefault("rightsRenounceLog", [])
    state.setdefault("blockedCapHoldRenounceLog", [])
    state.setdefault("fullActionLog", [])
    state.setdefault("rfaDebugLog", [])
    state.setdefault("cpuOfferDebugLog", [])
    state.setdefault("rfaMatchDebugLog", [])
    state.setdefault("finalizeDebugLog", [])
    state.setdefault("freeAgencyDebugErrors", [])
    return state



# ------------------------------------------------------------
# DEBUG-ONLY RFA / CPU OFFER AUDIT HELPERS - LITE
# ------------------------------------------------------------
# Debug-only. No gameplay behavior changes.
# This version is intentionally tiny because leagueData is already close to
# localStorage quota during free agency. It records only flat, searchable facts.
RFA_DEBUG_PLAYER_NAMES = {
    "Stephon Castle",
    "Alex Sarr",
    "Matas Buzelis",
    "Kel'el Ware",
    "Jalen Duren",
    "Cason Wallace",
    "Tari Eason",
}

# Keep this low. Four/five buckets at 180 rows each is enough to trace the bug
# without rebuilding the old 1MB+ debug payload problem.
RFA_DEBUG_LOG_LIMIT = 180


def _debug_str(value: Any) -> str:
    return str(value or "")


def is_rfa_debug_target(player: Optional[Dict[str, Any]], team_name: Optional[str] = None) -> bool:
    if not isinstance(player, dict):
        return False

    name = player.get("name")
    rights = get_player_rights(player)
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 99))
    potential = int(round(num(player.get("potential"), overall)))

    if name in RFA_DEBUG_PLAYER_NAMES:
        return True

    # Keep generic logging narrow. We mainly care about young good RFAs.
    if rights.get("restrictedFreeAgent") and age <= 27 and (overall >= 78 or potential >= 82):
        return True

    if team_name and is_rights_team(player, team_name) and age <= 28 and (overall >= 78 or potential >= 82):
        return True

    return False


def compact_debug_rights(player: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(player, dict):
        return {}

    rights = get_player_rights(player)
    qualifying_offer = player.get("qualifyingOffer") if isinstance(player.get("qualifyingOffer"), dict) else None
    qualifying_offer_eligible = player.get("qualifyingOfferEligible") if isinstance(player.get("qualifyingOfferEligible"), dict) else None
    free_agency_meta = player.get("freeAgencyMeta") if isinstance(player.get("freeAgencyMeta"), dict) else None

    return {
        "heldByTeam": rights.get("heldByTeam"),
        "birdLevel": rights.get("birdLevel"),
        "seasonsTowardBird": rights.get("seasonsTowardBird"),
        "rookieScale": bool(rights.get("rookieScale")),
        "restrictedFreeAgent": bool(rights.get("restrictedFreeAgent")),
        "rightsRenounced": bool(player.get("rightsRenounced")),
        "qoAmount": int(num(qualifying_offer.get("amount"), 0)) if qualifying_offer else 0,
        "qoStatus": qualifying_offer.get("status") if qualifying_offer else None,
        "qoEligibleAmount": int(num(qualifying_offer_eligible.get("amount"), 0)) if qualifying_offer_eligible else 0,
        "qoEligibleStatus": qualifying_offer_eligible.get("status") if qualifying_offer_eligible else None,
        "fromTeam": free_agency_meta.get("fromTeam") if free_agency_meta else None,
        "faReason": free_agency_meta.get("reason") if free_agency_meta else None,
    }


def compact_debug_player(player: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(player, dict):
        return {}

    rights = get_player_rights(player)

    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "playerKey": get_player_key_from_player(player),
        "age": int(num(player.get("age"), 0)),
        "overall": int(round(num(player.get("overall"), 0))),
        "potential": int(round(num(player.get("potential"), num(player.get("overall"), 0)))),
        "pos": player.get("pos") or player.get("position"),
        "rightsTeam": rights.get("heldByTeam"),
        "isRfa": bool(rights.get("restrictedFreeAgent")),
        "birdLevel": rights.get("birdLevel"),
        "rookieScale": bool(rights.get("rookieScale")),
        "rightsRenounced": bool(player.get("rightsRenounced")),
    }


def compact_debug_contract(contract: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    if not normalized:
        return {}

    salary_by_year = [int(num(x, 0)) for x in normalized.get("salaryByYear", [])]
    years = len(salary_by_year)
    total = int(sum(salary_by_year))
    option = normalized.get("option") if isinstance(normalized.get("option"), dict) else None

    return {
        "startYear": normalized.get("startYear"),
        "years": years,
        "year1": salary_by_year[0] if salary_by_year else 0,
        "totalValue": total,
        "aav": int(total / max(1, years)) if years else 0,
        "optionType": option.get("type") if option else None,
    }


def compact_debug_offer(offer: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(offer, dict):
        return {}

    contract = compact_debug_contract(offer.get("contract"))
    return {
        "offerId": offer.get("offerId"),
        "teamName": offer.get("teamName"),
        "source": offer.get("source"),
        "status": offer.get("status", "active"),
        "playerName": offer.get("playerName"),
        "playerKey": offer.get("playerKey"),
        "day": offer.get("submittedDay") or offer.get("day"),
        "years": contract.get("years") or int(num(offer.get("years"), 0)),
        "year1": contract.get("year1") or int(num(offer.get("currentYearSalary"), 0)),
        "totalValue": int(num(offer.get("totalValue"), contract.get("totalValue", 0))),
        "aav": int(num(offer.get("aav"), contract.get("aav", 0))),
        "spendingType": offer.get("spendingType"),
        "exceptionType": offer.get("exceptionType"),
        "payrollZone": offer.get("payrollZone"),
        "targetTier": offer.get("targetTier"),
        "playerViewScore": offer.get("playerViewScore"),
        "teamBoardScore": offer.get("teamBoardScore"),
        "rfaOfferSheet": bool(offer.get("rfaOfferSheet")),
        "rightsTeamName": offer.get("rightsTeamName"),
        "ownRightsOffer": bool(offer.get("ownRightsOffer")),
        "incumbentPriority": bool(offer.get("incumbentPriority")),
        "forceRfaMatch": bool(offer.get("forceRfaMatch")),
        "skipRfaAutoMatch": bool(offer.get("skipRfaAutoMatch")),
        "rfaMatchDeclined": bool(offer.get("rfaMatchDeclined")),
    }


def compact_debug_snapshot(snapshot: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}

    return {
        "ok": bool(snapshot.get("ok")),
        "reason": snapshot.get("reason"),
        "seasonYear": snapshot.get("seasonYear"),
        "payroll": int(num(snapshot.get("payroll"), 0)),
        "capRoom": int(num(snapshot.get("capRoom"), 0)),
        "rawCapRoomWithoutHolds": int(num(snapshot.get("rawCapRoomWithoutHolds"), 0)),
        "capHoldTotal": int(num(snapshot.get("capHoldTotal") or snapshot.get("capHolds"), 0)),
        "rosterCount": snapshot.get("rosterCount"),
        "rosterLimit": snapshot.get("rosterLimit"),
        "hardCapRoom": snapshot.get("hardCapRoom"),
        "isHardCapped": bool(snapshot.get("isHardCapped")),
    }


def compact_debug_spending(spending_res: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(spending_res, dict):
        return {}

    return {
        "ok": bool(spending_res.get("ok")),
        "reason": spending_res.get("reason"),
        "spendingType": spending_res.get("spendingType"),
        "exceptionType": spending_res.get("exceptionType"),
        "exceptionRoom": int(num(spending_res.get("exceptionRoom"), 0)),
        "payrollZone": spending_res.get("payrollZone"),
        "projectedPayroll": int(num(spending_res.get("projectedPayroll"), 0)),
        "pendingCapHoldClearance": bool(spending_res.get("pendingCapHoldClearance")),
        "capHoldClearanceNeeded": int(num(spending_res.get("capHoldClearanceNeeded"), 0)),
        "autoRenouncedCapHoldAmount": int(num(spending_res.get("autoRenouncedCapHoldAmount"), 0)),
    }


def _debug_is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _debug_compact_dict(value: Dict[str, Any], max_items: int = 18) -> Dict[str, Any]:
    out = {}

    for key, item in value.items():
        if len(out) >= max_items:
            out["_trimmed"] = True
            break

        if _debug_is_scalar(item):
            out[key] = item
        elif isinstance(item, list):
            out[f"{key}Count"] = len(item)
            names = []
            for row in item[:4]:
                if isinstance(row, dict):
                    name = row.get("playerName") or row.get("name") or row.get("teamName")
                    if name:
                        names.append(name)
            if names:
                out[f"{key}Names"] = names
        elif isinstance(item, dict):
            scalar_child = {}
            for child_key, child_value in item.items():
                if len(scalar_child) >= 8:
                    scalar_child["_trimmed"] = True
                    break
                if _debug_is_scalar(child_value):
                    scalar_child[child_key] = child_value
            out[key] = scalar_child if scalar_child else {"_dictKeys": list(item.keys())[:8]}
        else:
            out[key] = str(type(item).__name__)

    return out


def compact_debug_payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    out = {}

    for key, value in payload.items():
        if key == "snapshot":
            out["snapshot"] = compact_debug_snapshot(value)
        elif key == "spending":
            out["spending"] = compact_debug_spending(value)
        elif key == "contract":
            out["contract"] = compact_debug_contract(value)
        elif key == "rights":
            out["rights"] = _debug_compact_dict(value, max_items = 14) if isinstance(value, dict) else value
        elif key == "autoRes":
            if isinstance(value, dict):
                out["autoRes"] = {
                    "ok": bool(value.get("ok")),
                    "reason": value.get("reason"),
                    "capHoldCleared": int(num(value.get("capHoldCleared"), 0)),
                    "clearanceNeeded": int(num(value.get("clearanceNeeded"), 0)),
                    "targetPlayerName": value.get("targetPlayerName"),
                    "renouncedCount": len(value.get("renounced", [])) if isinstance(value.get("renounced"), list) else 0,
                    "blockedCount": len(value.get("blockedRenounces", [])) if isinstance(value.get("blockedRenounces"), list) else 0,
                }
        elif _debug_is_scalar(value):
            out[key] = value
        elif isinstance(value, dict):
            out[key] = _debug_compact_dict(value)
        elif isinstance(value, list):
            out[f"{key}Count"] = len(value)
        else:
            out[key] = str(type(value).__name__)

    return out


def record_fa_debug(
    league_data: Dict[str, Any],
    bucket: str,
    event: str,
    payload: Optional[Dict[str, Any]] = None,
    player: Optional[Dict[str, Any]] = None,
    team_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        # Hard filter: do not log every player. That caused the quota problem.
        if player is not None and not is_rfa_debug_target(player, team_name):
            return

        state = ensure_free_agency_state(league_data)
        key = str(bucket or "freeAgencyDebugLog")
        rows = state.setdefault(key, [])
        if not isinstance(rows, list):
            state[key] = []
            rows = state[key]

        row = {
            "day": int(num(state.get("currentDay"), 0)),
            "event": str(event),
            "teamName": team_name,
        }

        if player is not None:
            row.update(compact_debug_player(player))

        if offer is not None:
            offer_row = compact_debug_offer(offer)
            for offer_key, offer_value in offer_row.items():
                row[f"offer_{offer_key}"] = offer_value

        payload_row = compact_debug_payload(payload)
        if payload_row:
            row["payload"] = payload_row

        # Final size guard so one accidental nested payload cannot bloat the save.
        try:
            if len(json.dumps(row, default = str)) > 2200:
                row["payload"] = {"trimmedForSize": True}
        except Exception:
            row["payload"] = {"trimmedForSize": True}

        rows.append(row)
        if len(rows) > RFA_DEBUG_LOG_LIMIT:
            del rows[:-RFA_DEBUG_LOG_LIMIT]

    except Exception as exc:
        # Debug logging must never change gameplay behavior.
        try:
            state = ensure_free_agency_state(league_data)
            errors = state.setdefault("freeAgencyDebugErrors", [])
            errors.append({
                "day": int(num(state.get("currentDay"), 0)),
                "event": str(event),
                "error": str(exc)[:240],
            })
            if len(errors) > 25:
                del errors[:-25]
        except Exception:
            pass


def record_rfa_debug(
    league_data: Dict[str, Any],
    event: str,
    player: Optional[Dict[str, Any]] = None,
    team_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    if player is None or is_rfa_debug_target(player, team_name):
        record_fa_debug(
            league_data = league_data,
            bucket = "rfaDebugLog",
            event = event,
            payload = payload,
            player = player,
            team_name = team_name,
            offer = offer,
        )


def compact_contract_for_free_agency_action_log(contract: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(contract, dict):
        return None

    salary_by_year = contract.get("salaryByYear") if isinstance(contract.get("salaryByYear"), list) else []
    option = contract.get("option") if isinstance(contract.get("option"), dict) else None

    return {
        "startYear": contract.get("startYear"),
        "salaryByYear": [int(num(value, 0)) for value in salary_by_year],
        "option": copy.deepcopy(option) if option else None,
    }


def compact_offer_for_free_agency_action_log(offer: Dict[str, Any]) -> Dict[str, Any]:
    contract = compact_contract_for_free_agency_action_log(offer.get("contract"))
    salary_by_year = contract.get("salaryByYear", []) if contract else []
    years = len(salary_by_year) or int(num(offer.get("years"), 0))
    total_value = int(num(offer.get("totalValue"), sum(salary_by_year)))

    return {
        "offerId": offer.get("offerId"),
        "day": offer.get("submittedDay") or offer.get("day"),
        "submittedDay": offer.get("submittedDay") or offer.get("day"),
        "playerId": offer.get("playerId"),
        "playerName": offer.get("playerName"),
        "playerKey": offer.get("playerKey"),
        "teamName": offer.get("teamName"),
        "source": offer.get("source", "cpu"),
        "status": offer.get("status", "active"),
        "contract": contract,
        "totalValue": total_value,
        "years": years,
        "aav": int(num(offer.get("aav"), total_value / max(1, years))) if years else int(num(offer.get("aav"), 0)),
        "currentYearSalary": int(num(offer.get("currentYearSalary"), salary_by_year[0] if salary_by_year else 0)),
        "spendingType": offer.get("spendingType"),
        "exceptionType": offer.get("exceptionType"),
        "payrollZone": offer.get("payrollZone"),
        "teamDirection": offer.get("teamDirection"),
        "targetTier": offer.get("targetTier"),
        "playerViewScore": offer.get("playerViewScore"),
        "teamBoardScore": offer.get("teamBoardScore"),
        "rfaOfferSheet": bool(offer.get("rfaOfferSheet")),
        "rightsTeamName": offer.get("rightsTeamName"),
        "rosterNeed": copy.deepcopy(offer.get("rosterNeed")) if isinstance(offer.get("rosterNeed"), dict) else None,
    }


def compact_signing_for_free_agency_action_log(signing: Dict[str, Any]) -> Dict[str, Any]:
    contract = compact_contract_for_free_agency_action_log(signing.get("contract") or signing.get("signedContract"))
    salary_by_year = contract.get("salaryByYear", []) if contract else []
    years = len(salary_by_year) or int(num(signing.get("years") or signing.get("signedYears"), 0))
    total_value = int(num(signing.get("totalValue") or signing.get("signedTotalValue"), sum(salary_by_year)))

    return {
        "day": signing.get("day"),
        "playerId": signing.get("playerId"),
        "playerName": signing.get("playerName"),
        "playerKey": signing.get("playerKey"),
        "teamName": signing.get("teamName") or signing.get("signedWith"),
        "signedWith": signing.get("signedWith") or signing.get("teamName"),
        "contract": contract,
        "totalValue": total_value,
        "years": years,
        "aav": int(num(signing.get("aav"), total_value / max(1, years))) if years else int(num(signing.get("aav"), 0)),
        "spendingType": signing.get("spendingType"),
        "exceptionType": signing.get("exceptionType"),
        "payrollZone": signing.get("payrollZone"),
        "rfaMatched": bool(signing.get("rfaMatched")),
        "originalOfferTeamName": signing.get("originalOfferTeamName"),
        "matchedOriginalTeamName": signing.get("matchedOriginalTeamName"),
        "declinedRightsTeamName": signing.get("declinedRightsTeamName"),
    }


def append_free_agency_full_action_log(
    league_data: Dict[str, Any],
    day_resolved: Optional[int] = None,
    offer_day: Optional[int] = None,
    signings: Optional[List[Dict[str, Any]]] = None,
    generated_offers: Optional[List[Dict[str, Any]]] = None,
    event_type: str = "market_update",
) -> None:
    state = ensure_free_agency_state(league_data)
    rows = state.setdefault("fullActionLog", [])
    signings = signings or []
    generated_offers = generated_offers or []

    if not signings and not generated_offers:
        return

    resolved_day = int(num(day_resolved, 0)) if day_resolved not in [None, ""] else None
    generated_offer_day = int(num(offer_day, 0)) if offer_day not in [None, ""] else None
    entry_id = f"{event_type}|{resolved_day if resolved_day is not None else ''}|{generated_offer_day if generated_offer_day is not None else ''}"

    entry = {
        "id": entry_id,
        "eventType": event_type,
        "dayResolved": resolved_day,
        "offerDay": generated_offer_day,
        "signings": [compact_signing_for_free_agency_action_log(row) for row in signings],
        "generatedOffers": [compact_offer_for_free_agency_action_log(row) for row in generated_offers],
        "signingCount": len(signings),
        "generatedOfferCount": len(generated_offers),
    }

    kept = [row for row in rows if row.get("id") != entry_id]
    kept.append(entry)
    kept.sort(key = lambda row: (
        int(num(row.get("dayResolved"), row.get("offerDay") or 0)),
        int(num(row.get("offerDay"), 0)),
        str(row.get("eventType", "")),
    ))
    state["fullActionLog"] = kept[-60:]


def should_enforce_post_market_cleanup_rules(
    league_data: Dict[str, Any],
    state: Dict[str, Any],
) -> bool:
    """Return True only for the narrow late-offseason roster-fill window.

    A completed free-agency state can remain on leagueData after the new season
    starts. Regular-season direct FA signings should not inherit the offseason
    emergency-cleanup restriction.
    """
    if not bool(state.get("maxDays")):
        return False

    if bool(state.get("isActive")):
        return False

    if bool(state.get("regularSeasonSigningMode")):
        return False

    if bool(state.get("skipPostMarketCleanupRules")):
        return False

    if state.get("postMarketCleanupOpen") is False:
        return False

    current_season = get_current_season_year(league_data)
    state_season = int(num(state.get("seasonYear"), current_season))
    if state_season < current_season:
        return False

    phase_text = " ".join([
        str(league_data.get("seasonPhase") or ""),
        str(league_data.get("phase") or ""),
        str(league_data.get("currentPhase") or ""),
        str(league_data.get("stage") or ""),
        str(league_data.get("mode") or ""),
    ]).lower()

    if "offseason" not in phase_text and any(
        token in phase_text
        for token in ["regular", "in-season", "inseason", "playoff", "postseason", "preseason"]
    ):
        return False

    return True


# ------------------------------------------------------------
# FREE AGENCY STORY CONTEXT HELPERS
# ------------------------------------------------------------
def _story_format_dollars(amount: Any) -> str:
    amount = int(num(amount, 0))
    if amount >= 1_000_000:
        text = f"${amount / 1_000_000:.1f}M"
        return text.replace(".0M", "M")
    if amount > 0:
        return f"${amount:,}"
    return "$0"


def _story_contract_summary(contract: Optional[Dict[str, Any]], fallback_total: int = 0, fallback_years: int = 0) -> Dict[str, Any]:
    normalized = normalize_contract(contract)
    salary_by_year = list(normalized.get("salaryByYear", [])) if normalized else []
    years = len(salary_by_year) or int(num(fallback_years, 0))
    total_value = int(sum(int(num(x, 0)) for x in salary_by_year)) if salary_by_year else int(num(fallback_total, 0))
    current_year_salary = int(salary_by_year[0]) if salary_by_year else 0
    aav = int(total_value / max(1, years)) if years else 0

    return {
        "years": years,
        "totalValue": total_value,
        "currentYearSalary": current_year_salary,
        "aav": aav,
        "line": f"{_story_format_dollars(total_value)} - {years} years" if years and total_value else "contract details unavailable",
    }


def _story_pick(seed_text: str, options: List[str]) -> str:
    if not options:
        return ""
    idx = stable_text_seed(seed_text) % len(options)
    return options[idx]


def _story_tool_label(value: Any) -> str:
    text = str(value or "").replace("_", " ").replace("-", " ").strip()
    return " ".join(part.capitalize() for part in text.split()) if text else ""


def _story_player_profile_line(player: Dict[str, Any]) -> str:
    name = player.get("name") or "This player"
    pos = player.get("pos") or player.get("position") or "player"
    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))
    age = int(num(player.get("age"), 27))
    upside = potential - overall

    if overall >= 88:
        return f"{name} profiles as a true star-level {pos}, so the signing changes the top of the rotation immediately."
    if overall >= 83 and age <= 26:
        return f"{name} gives the team a young high-end {pos} with enough runway to keep improving."
    if overall >= 80:
        return f"{name} looks like a strong starter or high-minute rotation {pos}, which makes the contract more than a depth move."
    if age <= 24 and upside >= 3:
        return f"{name} is an upside swing: the team is betting on development as much as current production."
    if age >= 33 and overall >= 76:
        return f"{name} is a veteran stability move, likely valued for immediate minutes more than long-term growth."
    if overall <= 74:
        return f"{name} is mainly a depth and roster-balance piece at this stage of the market."
    return f"{name} gives the team another playable {pos} option without forcing a major roster reset."


def _story_recent_team_context(league_data: Dict[str, Any], team_name: str) -> Dict[str, Any]:
    profile = build_recent_team_results_profile(league_data, team_name)
    if not profile.get("historyAvailable"):
        return {
            "label": "no recent standings context found",
            "short": "a roster-context move",
            "mood": "Without recent standings data, player mood should lean more on role, contract size, and roster fit.",
            "profile": profile,
        }

    wins = profile.get("lastSeasonWins")
    losses = profile.get("lastSeasonLosses")
    seed = profile.get("lastSeasonSeed")
    result = str(profile.get("lastSeasonPlayoffResult") or "missed_playoffs").replace("_", " ")
    record = f"{wins}-{losses}" if wins is not None and losses is not None else "record unavailable"
    label_parts = [record]
    if seed:
        label_parts.append(f"{seed} seed")
    if result and result != "missed playoffs":
        label_parts.append(result)
    label = ", ".join(label_parts)

    if profile.get("lastSeasonChampion"):
        short = "a defending champion trying to protect its title window"
        mood = "This should be one of the strongest mood environments because the player is joining a fresh champion."
    elif profile.get("lastSeasonFinals"):
        short = "a Finals-level team adding another piece"
        mood = "This should help the player's mood because the team already looks like a title threat."
    elif profile.get("lastSeasonConferenceFinals"):
        short = "a deep playoff team looking for one more edge"
        mood = "This should usually create a positive mood read because the player joins a serious playoff group."
    elif wins is not None and wins >= 50:
        short = "a 50-win team strengthening its rotation"
        mood = "This is a strong mood landing spot because winning is already built into the situation."
    elif wins is not None and wins >= 42:
        short = "a playoff-caliber team trying to stabilize its rotation"
        mood = "This should be a stable mood landing spot because the team is competitive."
    elif wins is not None and wins <= 25:
        short = "a rebuilding team offering opportunity and flexibility"
        mood = "The standings may hurt short-term mood, but a bigger role or stronger contract can balance that out."
    else:
        short = "a team still defining its next step"
        mood = "Mood should depend heavily on whether the player gets the role and minutes expected from this signing."

    return {
        "label": label,
        "short": short,
        "mood": mood,
        "profile": profile,
    }


def _story_team_building_context(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    roster_need: Optional[Dict[str, Any]] = None,
    team_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    _, _, team = find_team_entry(league_data, team_name)

    if team_profile is None and team is not None:
        team_profile = build_team_roster_profile(team, league_data = league_data)

    if team_profile is None:
        team_profile = {}

    bucket = None
    need_score = None

    if isinstance(roster_need, dict):
        bucket = roster_need.get("position") or roster_need.get("positionBucket")
        need_score = roster_need.get("needScore")

    if not bucket:
        bucket = get_player_position_bucket(player)

    if need_score is None and team is not None:
        need_score = get_player_need_score_for_team(team, player, league_data = league_data)

    need_score = float(num(need_score, 0.0))
    direction = team_profile.get("direction") or "balanced"

    if need_score >= 0.70:
        need_line = f"The need grade is strong at {_story_position_phrase(bucket, str(bucket) + '|building')}, so this looks like a targeted positional fix."
    elif need_score >= 0.45:
        need_line = f"The team had a real {_story_position_phrase(bucket, str(bucket) + '|building-mid')} need, even if it was not an emergency hole."
    elif need_score > 0:
        need_line = f"The {_story_position_phrase(bucket, str(bucket) + '|building-light')} need was lighter, so the move is more about value, role, or market timing."
    else:
        need_line = "No strong positional-need signal was attached to this move."

    direction_line = {
        "contending": "The direction profile is contending, so the front office is prioritizing immediate rotation value.",
        "win now": "The direction profile is win-now, which explains paying for present-day reliability.",
        "retooling": "The direction profile is retooling, so this move balances current usefulness with some flexibility.",
        "rebuilding": "The direction profile is rebuilding, so age, upside, and role opportunity matter more than one-year impact.",
        "balanced": "The direction profile is balanced, so this reads like a practical roster fit instead of an all-in swing.",
    }.get(direction, f"The team direction is {direction}, which shapes how aggressive this offer looks.")

    return {
        "direction": direction,
        "directionConfidence": team_profile.get("directionConfidence"),
        "positionBucket": bucket,
        "needScore": round(need_score, 3),
        "needLine": need_line,
        "directionLine": direction_line,
        "profile": team_profile,
    }


def _story_team_display(team_name: Any, capital: bool = False) -> str:
    name = str(team_name or "Unknown Team").strip()
    if not name:
        name = "Unknown Team"
    lowered = name.lower()
    if lowered.startswith("the "):
        return name[0].upper() + name[1:] if capital else name
    prefix = "The" if capital else "the"
    return f"{prefix} {name}"


def _story_team_possessive(team_name: Any) -> str:
    display = _story_team_display(team_name, capital = True)
    return f"{display}'" if display.endswith("s") else f"{display}'s"



def _story_position_phrase(bucket: Any, seed: str = "", style: str = "default") -> str:
    raw = str(bucket or "UTIL").upper().strip()
    options = {
        "PG": ["point guard", "lead-guard spot", "at the 1", "primary guard spot"],
        "SG": ["shooting guard", "off-guard spot", "at the 2", "secondary guard spot"],
        "SF": ["small forward", "wing spot", "at the 3", "perimeter-forward spot"],
        "PF": ["power forward", "frontcourt spot", "at the 4", "forward spot"],
        "C": ["center", "middle", "at the 5", "big-man spot"],
        "UTIL": ["rotation", "utility", "depth", "multi-position"],
    }

    picked = _story_pick(f"{seed}|position|{raw}|{style}", options.get(raw, options["UTIL"]))
    if style == "room":
        if picked.startswith("at the "):
            return f"{picked} spot"
        return f"{picked} room"
    return picked


def _story_rows_count(rows: Any) -> int:
    return len(rows) if isinstance(rows, list) else 0


def _story_is_plural_count(count: int) -> bool:
    return int(count or 0) != 1


def _story_be_verb(count: int) -> str:
    return "are" if _story_is_plural_count(count) else "is"


def _story_have_verb(count: int) -> str:
    return "have" if _story_is_plural_count(count) else "has"


def _story_group_label(names: str, count: int, fallback: str = "that group") -> str:
    if names:
        return names
    return fallback


def _story_player_first_name(player: Dict[str, Any]) -> str:
    name = str(player.get("name") or "I").strip()
    return name.split(" ")[0] if name else "I"


def _story_rating_lookup(player: Dict[str, Any], keys: List[str]) -> Optional[float]:
    for key in keys:
        value = player.get(key)
        if value not in [None, ""]:
            return num(value, 0)
    return None


def _story_player_strength_phrase(player: Dict[str, Any], seed: str = "", pronoun: str = "his") -> str:
    # This stays user-facing and basketball-real: no OVR/POT numbers in dialogue.
    # It only names skills if those attribute fields exist in the player row.
    skill_fields = [
        ("shooting", ["3PT", "3pt", "three", "threePt", "threePoint", "threePointRating", "three_point", "rating3pt"]),
        ("mid-range scoring", ["MID", "mid", "midRange", "midRating", "midRangeRating"]),
        ("finishing", ["CLOSE", "close", "closeRating", "inside", "insideScoring", "finishing"]),
        ("free-throw touch", ["FT", "ft", "freeThrow", "freeThrowRating"]),
        ("passing", ["PASS", "pass", "passing", "passRating", "passingRating"]),
        ("ball handling", ["BALL", "ball", "ballHandle", "ballHandling", "handle", "dribble"]),
        ("defense", ["DEF", "def", "defense", "defRating", "defensiveRating"]),
        ("offense", ["OFF", "off", "offense", "offRating", "offensiveRating"]),
        ("scoring", ["scoring", "scoringRating"]),
        ("rebounding", ["REB", "reb", "rebound", "rebounding", "rebRating"]),
    ]

    found = []
    for label, keys in skill_fields:
        rating = _story_rating_lookup(player, keys)
        if rating is None:
            continue
        if rating >= 86:
            found.append((rating, label))
        elif rating >= 82 and label in ["shooting", "defense", "passing", "ball handling", "finishing", "scoring"]:
            found.append((rating, label))

    found.sort(key = lambda item: (-item[0], item[1]))
    labels = []
    for _, label in found:
        if label not in labels:
            labels.append(label)
        if len(labels) >= 3:
            break

    if labels:
        if len(labels) == 1:
            skill_text = f"{labels[0]} profile"
        elif len(labels) == 2:
            skill_text = f"{labels[0]} and {labels[1]} profile"
        else:
            skill_text = f"{labels[0]}, {labels[1]}, and {labels[2]} profile"
        return f"{pronoun} {skill_text}"

    off_rating = _story_rating_lookup(player, ["OFF", "off", "offense", "offRating", "offensiveRating"])
    def_rating = _story_rating_lookup(player, ["DEF", "def", "defense", "defRating", "defensiveRating"])

    if off_rating is not None and def_rating is not None:
        if off_rating >= def_rating + 5:
            return f"{pronoun} offensive skill set"
        if def_rating >= off_rating + 5:
            return f"{pronoun} defensive skill set"
        return f"{pronoun} two-way skill set"

    return _story_pick(seed + "|generic-skill-phrase", [
        f"{pronoun} basketball profile",
        f"{pronoun} skill set",
        f"{pronoun} game",
        f"the way {pronoun} game fits the roster",
    ])


def _story_is_minimum_deal(contract_info: Dict[str, Any], spending_type: Any, exception_type: Any) -> bool:
    raw = f"{spending_type or ''} {exception_type or ''}".lower()
    first_year = int(num(contract_info.get("currentYearSalary"), 0))
    aav = int(num(contract_info.get("aav"), 0))
    return "minimum" in raw or (first_year > 0 and first_year <= int(MIN_DEAL * 1.15)) or (aav > 0 and aav <= int(MIN_DEAL * 1.25))


def _story_spending_line(spending_type: Any, exception_type: Any, payroll_zone: Any, exception_usage: Optional[Dict[str, Any]]) -> str:
    raw = f"{spending_type or ''} {exception_type or ''} {payroll_zone or ''}".lower()

    if "rfa_match" in raw:
        return "We used restricted-free-agent matching rights here, so this was about keeping control of our own player instead of treating it like a normal open-market win."
    if "bird" in raw:
        return "We used Bird-rights flexibility, which is exactly the tool built for keeping a player we already know without needing normal cap room."
    if "taxpayer" in raw:
        return "We were working with taxpayer mid-level type spending, so this was a limited but meaningful way to add someone we actually believe can help."
    if "non_taxpayer" in raw or "mid_level" in raw or "mle" in raw:
        return "We used mid-level exception type spending, which means we valued him well above minimum depth but were still operating inside a controlled CBA path."
    if "room" in raw or "cap_space" in raw or "below_cap" in raw:
        return "We had cap-space or room-exception flexibility, so this was a real target rather than a leftover minimum swing."
    if "minimum" in raw:
        return "We kept the contract in minimum territory, so this is about roster access, cheap depth, and giving the player a chance to stick."

    if exception_usage and int(num(exception_usage.get("amountUsed"), 0)) > 0:
        return f"We used {_story_format_dollars(exception_usage.get('amountUsed'))} of an exception to complete this signing."

    return "The free-agency engine treated this as legal based on our cap room, rights, exceptions, and roster-limit situation."


def _story_name_list(players: List[Dict[str, Any]], limit: int = 3) -> str:
    names = []
    for player in players[:max(0, limit)]:
        name = player.get("name")
        if name:
            names.append(str(name))

    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])}, and {names[-1]}"


def _story_same_player(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if not a or not b:
        return False
    a_id = a.get("id")
    b_id = b.get("id")
    if a_id not in [None, ""] and b_id not in [None, ""] and a_id == b_id:
        return True
    a_name = a.get("name")
    b_name = b.get("name")
    return bool(a_name and b_name and a_name == b_name)


def _story_team_roster_context(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
) -> Dict[str, Any]:
    _, _, team = find_team_entry(league_data, team_name)
    players = list(team.get("players", [])) if team else []

    existing_players = [p for p in players if not _story_same_player(p, player)]
    ranked = sorted(
        existing_players,
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num(p.get("potential"), num(p.get("overall"), 0)),
            int(num(p.get("age"), 27)),
            str(p.get("name", "")),
        ),
    )

    bucket = get_player_position_bucket(player)
    player_overall = int(round(num(player.get("overall"), 0)))
    player_age = int(num(player.get("age"), 0))
    player_potential = int(round(num(player.get("potential"), player_overall)))

    same_position = [p for p in ranked if get_player_position_bucket(p) == bucket]
    rotation_same_position = [p for p in same_position if num(p.get("overall"), 0) >= 74]
    better_same_position = [p for p in same_position if num(p.get("overall"), 0) >= player_overall + 2]
    comparable_same_position = [p for p in same_position if abs(num(p.get("overall"), 0) - player_overall) <= 1]
    clearly_below_same_position = [p for p in same_position if num(p.get("overall"), 0) <= player_overall - 3]

    top_players = ranked[:3]
    star_players = [p for p in ranked if num(p.get("overall"), 0) >= 85]
    young_core = [
        p for p in ranked
        if int(num(p.get("age"), 27)) <= 26 and num(p.get("overall"), 0) >= 76
    ][:3]

    average_age = None
    if ranked:
        average_age = round(sum(num(p.get("age"), 0) for p in ranked[:8]) / max(1, len(ranked[:8])), 1)

    if not same_position:
        role_read = "clean_path"
    elif player_overall >= 84:
        role_read = "high_end_piece"
    elif better_same_position and player_overall < 80:
        role_read = "depth_competition"
    elif player_overall >= 80 and len(clearly_below_same_position) >= 1:
        role_read = "position_upgrade"
    elif comparable_same_position:
        role_read = "rotation_overlap"
    elif len(rotation_same_position) >= 2 and player_overall < 78:
        role_read = "crowded_depth"
    else:
        role_read = "rotation_fit"

    return {
        "teamFound": bool(team),
        "positionBucket": bucket,
        "playerOverall": player_overall,
        "playerAge": player_age,
        "playerPotential": player_potential,
        "topPlayers": [
            {
                "name": p.get("name"),
                "overall": int(round(num(p.get("overall"), 0))),
                "age": int(num(p.get("age"), 0)),
                "position": p.get("pos") or p.get("position"),
            }
            for p in top_players
        ],
        "starPlayers": [
            {
                "name": p.get("name"),
                "overall": int(round(num(p.get("overall"), 0))),
                "age": int(num(p.get("age"), 0)),
                "position": p.get("pos") or p.get("position"),
            }
            for p in star_players[:3]
        ],
        "samePositionPlayers": [
            {
                "name": p.get("name"),
                "overall": int(round(num(p.get("overall"), 0))),
                "age": int(num(p.get("age"), 0)),
                "position": p.get("pos") or p.get("position"),
            }
            for p in same_position[:5]
        ],
        "betterSamePositionPlayers": [
            {"name": p.get("name"), "overall": int(round(num(p.get("overall"), 0)))}
            for p in better_same_position[:3]
        ],
        "clearlyBelowSamePositionPlayers": [
            {"name": p.get("name"), "overall": int(round(num(p.get("overall"), 0)))}
            for p in clearly_below_same_position[:4]
        ],
        "rotationSamePositionCount": len(rotation_same_position),
        "samePositionCount": len(same_position),
        "topPlayerNames": _story_name_list(top_players, 3),
        "starNames": _story_name_list(star_players, 2),
        "samePositionNames": _story_name_list(same_position, 3),
        "betterSamePositionNames": _story_name_list(better_same_position, 3),
        "clearlyBelowSamePositionNames": _story_name_list(clearly_below_same_position, 3),
        "youngCoreNames": _story_name_list(young_core, 3),
        "averageCoreAge": average_age,
        "roleRead": role_read,
    }


def _story_offer_team_name(offer: Dict[str, Any]) -> str:
    return str(offer.get("teamName") or offer.get("signedWith") or offer.get("originalOfferTeamName") or "")


def _story_offer_total(offer: Dict[str, Any]) -> int:
    contract = normalize_contract(offer.get("contract"))
    if contract:
        return int(sum(int(num(x, 0)) for x in contract.get("salaryByYear", [])))
    return int(num(offer.get("totalValue") or offer.get("signedTotalValue") or offer.get("userOfferTotalValue"), 0))


def _story_offer_years(offer: Dict[str, Any]) -> int:
    contract = normalize_contract(offer.get("contract"))
    if contract:
        return len(contract.get("salaryByYear", []))
    return int(num(offer.get("years") or offer.get("signedYears") or offer.get("userOfferYears"), 0))


def _story_offer_line(offer: Dict[str, Any]) -> str:
    years = _story_offer_years(offer)
    total = _story_offer_total(offer)
    if years and total:
        return f"{_story_format_dollars(total)} over {years} year{'s' if years != 1 else ''}"
    if total:
        return _story_format_dollars(total)
    return "terms not fully listed"


def _story_offer_score(offer: Dict[str, Any]) -> float:
    return float(num(offer.get("playerViewScore") or offer.get("acceptanceScore") or offer.get("score"), 0))


def _story_offer_compact_row(offer: Dict[str, Any]) -> Dict[str, Any]:
    raw_team = _story_offer_team_name(offer)
    return {
        "teamName": raw_team,
        "displayTeamName": _story_team_display(raw_team),
        "line": _story_offer_line(offer),
        "totalValue": _story_offer_total(offer),
        "years": _story_offer_years(offer),
        "playerViewScore": round(_story_offer_score(offer), 3),
    }


def _story_market_offer_context(
    all_offers: List[Dict[str, Any]],
    accepted_team_name: str,
    accepted_total_value: int,
    seed_text: str = "",
) -> Dict[str, Any]:
    accepted_display = _story_team_display(accepted_team_name)

    if not all_offers:
        return {
            "offerCount": 0,
            "acceptedOffer": None,
            "otherOffers": [],
            "marketLine": _story_pick(seed_text + "|no-offers", [
                "I did not have a full list of competing offers attached here, so I am reading this as the clearest available path from the data we have.",
                "There was not a tracked second offer in this row, so the decision comes down to the role, money, and fit this team put in front of me.",
                "The market data did not show another finalist offer, which makes this feel like the offer that actually gave me a real decision to make.",
            ]),
            "teamMarketLine": _story_pick(seed_text + "|no-team-offers", [
                "We did not have a full competing-offer list attached to this row, so we evaluated the move from our own offer, roster fit, and CBA path.",
                "There was not a deep finalist list in the data, so our job was to make the role and contract clear enough to close the deal.",
                "The attached market data was thin, so we treated this as a direct fit-and-price decision rather than a bidding war.",
            ]),
        }

    try:
        sorted_offers = sort_offers_for_display(copy.deepcopy(all_offers))
    except Exception:
        sorted_offers = sorted(
            copy.deepcopy(all_offers),
            key = lambda offer: (_story_offer_score(offer), _story_offer_total(offer)),
            reverse = True,
        )

    accepted_offer = None
    for offer in sorted_offers:
        if _story_offer_team_name(offer) == accepted_team_name:
            accepted_offer = offer
            break

    if accepted_offer is None and sorted_offers:
        accepted_offer = sorted_offers[0]

    other_offers = [
        offer for offer in sorted_offers
        if _story_offer_team_name(offer)
        and _story_offer_team_name(offer) != accepted_team_name
    ]

    other_rows = [_story_offer_compact_row(offer) for offer in other_offers[:3]]

    if not other_rows:
        market_line = _story_pick(seed_text + "|single-market", [
            "I did not have another tracked finalist offer once this decision was made, so this was about accepting the cleanest available path.",
            "I did not see another real finalist in the attached market data, so the offer in front of me mattered more than waiting for something vague.",
            "There was not a listed second choice here, which made the decision feel pretty direct once the role and contract lined up.",
        ])
        team_market_line = _story_pick(seed_text + "|single-team-market", [
            "We were not beating a deep list of tracked finalist offers here; our main job was giving him a clean reason to say yes.",
            "There was not a listed second bidder pushing us, so this was more about fit and commitment than winning an auction.",
            "The market did not show a real finalist pileup, so we focused on giving him a contract and role that made sense now.",
        ])
    else:
        second = other_rows[0]
        third = other_rows[1] if len(other_rows) > 1 else None
        accepted_total = int(num(accepted_total_value, 0))
        second_total = int(num(second.get("totalValue"), 0))
        second_display = second.get("displayTeamName") or _story_team_display(second.get("teamName"))

        if accepted_total > 0 and second_total > 0 and accepted_total >= second_total * 1.45:
            money_read = _story_pick(seed_text + "|accepted-way-more", [
                f"That second offer was not close financially, so it was hard to treat it like the same level of commitment.",
                f"The gap was big enough that I could not pretend the money and security were equal.",
                f"That next offer gave me interest, but not the same financial respect or security.",
            ])
        elif second_total > accepted_total and accepted_total > 0:
            money_read = _story_pick(seed_text + "|accepted-less", [
                "That offer had more total money, so my choice was not only about the biggest number.",
                "I left some money on the table, which means fit, role, comfort, or team situation had to matter.",
                "The bigger number was there, but the accepted offer made more sense as a full basketball situation.",
            ])
        elif second_total == accepted_total and second_total > 0:
            money_read = _story_pick(seed_text + "|even-money", [
                "The money was basically even, so role, fit, and comfort mattered more.",
                "With the dollars that close, the team context and path to minutes became the separator.",
                "The contracts were close enough that I had to decide where the basketball fit made more sense.",
            ])
        else:
            money_read = _story_pick(seed_text + "|accepted-more", [
                "The accepted deal gave me the stronger money or security compared with that next option.",
                "The offer I took was the stronger commitment once I compared the actual terms.",
                "The other interest was real, but the accepted deal gave me the cleaner financial path.",
            ])

        if third:
            third_display = third.get("displayTeamName") or _story_team_display(third.get("teamName"))
            third_text = _story_pick(seed_text + "|third-offer", [
                f" I also had {third_display} at {third['line']}, so there were multiple real paths on the table.",
                f" {third_display} had another offer at {third['line']}, but it did not beat the full situation I chose.",
                f" The third tracked option was {third_display} at {third['line']}, which made this a real market read rather than a single-phone-call decision.",
                f" {third_display} stayed in the mix at {third['line']}, but the final choice still came down to the best blend of role, money, and fit.",
                f" I had {third_display} on the board too at {third['line']}, which gave me leverage but not a better final landing spot.",
                f" {third_display} made the board more interesting at {third['line']}, but that offer did not change where I felt the best overall fit was.",
                f" There was also {third_display} at {third['line']}, so the choice was not made in a quiet market.",
                f" {third_display} gave me a third option at {third['line']}, but once I weighed the details, it was not the one I wanted most.",
            ])
        else:
            third_text = ""

        market_line = _story_pick(seed_text + "|market-line", [
            f"I also had {second_display} at {second['line']}. {money_read}{third_text}",
            f"My next real option came from {second_display} at {second['line']}. {money_read}{third_text}",
            f"When I compared the board, {second_display} gave me the main alternative at {second['line']}. {money_read}{third_text}",
            f"The second choice in the data came from {second_display} at {second['line']}. {money_read}{third_text}",
            f"There was real interest beyond the team I picked: {second_display} had {second['line']} waiting. {money_read}{third_text}",
            f"I had to weigh this against {second_display}'s {second['line']} offer. {money_read}{third_text}",
            f"The cleanest comparison was {second_display} at {second['line']}. {money_read}{third_text}",
            f"This was not just about saying yes to the first call; {second_display} had a real offer at {second['line']}. {money_read}{third_text}",
            f"The market gave me a real fallback through {second_display} at {second['line']}. {money_read}{third_text}",
            f"I had to compare the accepted deal against {second_display}'s {second['line']} number. {money_read}{third_text}",
            f"There was another route available with {second_display} at {second['line']}. {money_read}{third_text}",
            f"I was not choosing in a vacuum; {second_display} had a serious alternative at {second['line']}. {money_read}{third_text}",
            f"The other finalist that mattered most was {second_display} at {second['line']}. {money_read}{third_text}",
            f"I had options, and the first one I had to measure against was {second_display}'s {second['line']} offer. {money_read}{third_text}",
            f"The board gave me at least one clear alternative: {second_display} at {second['line']}. {money_read}{third_text}",
        ])
        team_market_line = _story_pick(seed_text + "|team-market-line", [
            f"We knew {second_display} had a real alternative at {second['line']}, so our offer needed to win on the full mix of money, role, roster fit, and timing.",
            f"We were not bidding in a vacuum - {second_display} had {second['line']} on the board, so we had to make the full situation make sense.",
            f"The market gave him another route through {second_display} at {second['line']}, which meant our pitch could not just be empty minutes talk.",
            f"With {second_display} on the board at {second['line']}, we had to decide how much we valued the player and what role we were ready to offer.",
            f"There was another team in the conversation, and {second_display}'s {second['line']} offer forced us to be clear about why our situation was better.",
            f"{second_display.capitalize()} made this competitive at {second['line']}, so we could not rely on vague interest or a weak role pitch.",
            f"Once {second_display} put {second['line']} into the decision, we had to win more than the salary column.",
            f"We saw {second_display}'s {second['line']} offer and knew the final pitch had to connect money, role, and roster logic.",
            f"The alternative from {second_display} was real at {second['line']}, so this became a full-context recruiting job.",
            f"We had to beat the idea of {second_display}, not just the dollars. Their {second['line']} offer made the comparison real.",
            f"That {second_display} offer at {second['line']} gave him leverage, so we needed our roster fit to matter.",
            f"The board was not empty. {second_display} had {second['line']} available, and our deal had to feel like the better basketball answer.",
            f"We knew he could point to {second_display}'s {second['line']} offer, so our side had to make sense beyond the headline number.",
            f"The market had another door open through {second_display} at {second['line']}, which made our role clarity and team context important.",
            f"We were competing with a real option from {second_display} at {second['line']}, not just a rumor.",
        ])

    return {
        "offerCount": len(sorted_offers),
        "acceptedOffer": accepted_offer,
        "otherOffers": other_rows,
        "marketLine": market_line,
        "teamMarketLine": team_market_line,
    }


def _story_success_memory(recent_context: Dict[str, Any]) -> str:
    profile = recent_context.get("profile") or {}
    if profile.get("lastSeasonChampion"):
        return "we just proved this group can win the whole thing"
    if profile.get("lastSeasonFinals"):
        return "we already reached the Finals with this group"
    if profile.get("lastSeasonConferenceFinals"):
        return "we already made a deep playoff run with this group"
    wins = profile.get("lastSeasonWins")
    if wins is not None and wins >= 50:
        return "we were already a 50-win team"
    if wins is not None and wins >= 42:
        return "we were already in the playoff mix"
    return "we know the current team context clearly"


def _story_tenure_read(player: Dict[str, Any], team_name: str) -> Dict[str, Any]:
    meta = player.get("meta") if isinstance(player.get("meta"), dict) else {}
    fa_meta = player.get("freeAgencyMeta") if isinstance(player.get("freeAgencyMeta"), dict) else {}
    rights = get_player_rights(player)

    years = int(num(
        meta.get("yearsWithCurrentTeam")
        or meta.get("yearsWithTeam")
        or meta.get("seasonsWithTeam"),
        0,
    ))
    from_team = fa_meta.get("fromTeam")
    rights_team = rights.get("heldByTeam")
    acquired_via = str(meta.get("acquiredVia") or "").strip().lower()

    # Important: after a player signs, update_player_rights_after_signing sets
    # rights.heldByTeam to the new club. That does NOT mean the new club had
    # formal pre-signing rights. Only treat it as continuity/rights if the
    # player came from that team or the signing was explicitly recorded as a
    # re-sign / RFA match.
    same_team_from_entry = bool(from_team and team_name and from_team == team_name)
    same_team_from_acquired_via = bool(
        team_name
        and rights_team == team_name
        and acquired_via in ["re_signed", "rfa_matched"]
    )
    same_team = bool(same_team_from_entry or same_team_from_acquired_via)

    if same_team and years <= 0:
        years = max(1, int(num(rights.get("seasonsTowardBird"), 0)))

    if not same_team:
        years = 0

    return {
        "sameTeam": same_team,
        "years": years,
        "fromTeam": from_team,
        "rightsTeam": rights_team,
        "birdLevel": rights.get("birdLevel"),
        "rfa": bool((same_team and rights.get("restrictedFreeAgent")) or player.get("qualifyingOffer") or acquired_via == "rfa_matched"),
        "acquiredVia": acquired_via,
    }

def _story_role_line_for_team(player: Dict[str, Any], roster_context: Dict[str, Any], seed: str) -> str:
    player_name = player.get("name") or "him"
    bucket = roster_context.get("positionBucket") or get_player_position_bucket(player)
    pos = _story_position_phrase(bucket, seed + "|team-role-pos")
    pos_room = _story_position_phrase(bucket, seed + "|team-role-room", style = "room")
    overall = int(num(roster_context.get("playerOverall"), num(player.get("overall"), 0)))
    skill_phrase = _story_player_strength_phrase(player, seed + "|team-skill", pronoun = "his")
    same_names = roster_context.get("samePositionNames")
    below_names = roster_context.get("clearlyBelowSamePositionNames")
    better_names = roster_context.get("betterSamePositionNames")
    role_read = roster_context.get("roleRead")

    same_count = _story_rows_count(roster_context.get("samePositionPlayers"))
    below_count = _story_rows_count(roster_context.get("clearlyBelowSamePositionPlayers"))
    better_count = _story_rows_count(roster_context.get("betterSamePositionPlayers"))
    below_be = _story_be_verb(below_count)
    better_be = _story_be_verb(better_count)

    if role_read in ["high_end_piece", "position_upgrade"] or overall >= 82:
        if below_names:
            return _story_pick(seed + "|team-role-upgrade", [
                f"At {pos}, we see {player_name} as more than depth - {skill_phrase} gives us a stronger option than the current same-position group that includes {below_names}.",
                f"This is not about asking {player_name} to fight for scraps; compared with {below_names}, he gives us a higher-level option in the {pos_room}.",
                f"The {pos_room} needed quality, and {player_name}'s game gives us a stronger answer than the depth names we already had there, including {below_names}.",
                f"We are not bringing him in behind weaker depth. {below_names} {below_be} already in that room, but {player_name} changes the top of that position group.",
                f"This is a real upgrade play. The roster had bodies in the {pos_room}, but {player_name} rates above the names already sitting there, including {below_names}.",
            ])
        return _story_pick(seed + "|team-role-high", [
            f"We view {player_name} as a real rotation piece right away, not a fringe player hoping the depth chart breaks perfectly.",
            f"His level is high enough that the role conversation starts with how we use him, not whether he belongs in the rotation.",
            f"We are treating him like a real piece of the {pos_room} because his skill set can help immediately.",
            f"This is not a camp-body read. We expect his game to factor into the real rotation.",
        ])

    if better_names:
        return _story_pick(seed + "|team-role-behind", [
            f"At {pos}, {better_names} {better_be} still above him in the current roster data, so we see this as depth and competition rather than a guaranteed top role.",
            f"We like the depth he gives us, but with {better_names} already here, the role has to be earned realistically.",
            f"The {pos_room} is not empty because of {better_names}, so this is more about strengthening the bench than promising a major role.",
            f"We are being honest about the depth chart: {better_names} {better_be} ahead today, but this signing gives us another playable option.",
        ])

    if same_names:
        return _story_pick(seed + "|team-role-overlap", [
            f"At {pos}, we already had {same_names}, so this move gives us real competition and lineup flexibility.",
            f"The fit is about giving ourselves another option around {same_names}, not pretending the depth chart was empty.",
            f"With {same_names} already in the room, we wanted one more playable body who could push the rotation instead of just filling space.",
            f"The {pos_room} already had names in it, but adding {player_name} gives us a cleaner mix of depth, insurance, and matchup options.",
        ])

    return _story_pick(seed + "|team-role-clean", [
        f"At {pos}, the current roster data did not show many established names ahead of him, so the path to minutes is cleaner.",
        f"The depth chart in the {pos_room} gave us room to add someone who could matter right away.",
        f"We saw a cleaner opening in the {pos_room}, which made the basketball fit easier to justify.",
        f"There was enough open space in the {pos_room} for this signing to make practical sense instead of feeling crowded from day one.",
    ])

def _story_role_line_for_player(player: Dict[str, Any], roster_context: Dict[str, Any], seed: str) -> str:
    bucket = roster_context.get("positionBucket") or get_player_position_bucket(player)
    pos = _story_position_phrase(bucket, seed + "|player-role-pos")
    pos_room = _story_position_phrase(bucket, seed + "|player-role-room", style = "room")
    overall = int(num(roster_context.get("playerOverall"), num(player.get("overall"), 0)))
    skill_phrase = _story_player_strength_phrase(player, seed + "|player-skill", pronoun = "my")
    same_names = roster_context.get("samePositionNames")
    below_names = roster_context.get("clearlyBelowSamePositionNames")
    better_names = roster_context.get("betterSamePositionNames")
    role_read = roster_context.get("roleRead")

    below_count = _story_rows_count(roster_context.get("clearlyBelowSamePositionPlayers"))
    better_count = _story_rows_count(roster_context.get("betterSamePositionPlayers"))
    below_be = _story_be_verb(below_count)
    better_be = _story_be_verb(better_count)

    if role_read in ["high_end_piece", "position_upgrade"] or overall >= 82:
        if below_names:
            return _story_pick(seed + "|player-role-upgrade", [
                f"I do not look at this like I am begging for minutes; compared with {below_names}, I know I raise the level of the {pos_room}.",
                f"I respect the guys already there, but my level says I should help right away, especially in a {pos_room} that included {below_names}.",
                f"This role makes sense because I am not coming in as the last man - I can be one of the better {pos} options on the roster.",
                f"I can read the depth chart too. {below_names} {below_be} there, but {skill_phrase} says I should be competing for real minutes, not just surviving the roster cut.",
            ])
        return _story_pick(seed + "|player-role-high", [
            f"I see myself as a real rotation player, so I needed a team that was ready to use me at that level.",
            f"My priority was finding a role that matched my level, not just finding any roster spot.",
            f"I wanted a place where the team saw me as part of the rotation right away.",
            f"At my level, the question is not whether I belong. It is whether the role and team situation make sense.",
        ])

    if better_names:
        return _story_pick(seed + "|player-role-behind", [
            f"I know {better_names} {better_be} already ahead in the {pos_room}, so I have to earn minutes and make the most of the role I get.",
            f"The depth chart is not wide open with {better_names} there, but I can still see a path if I play well.",
            f"This is not a guaranteed role because {better_names} {better_be} already in the room, so I have to prove I belong.",
            f"I am not pretending the {pos_room} is empty. {better_names} {better_be} there, so my job is to turn the opportunity into trust.",
        ])

    if same_names:
        return _story_pick(seed + "|player-role-overlap", [
            f"I know there are other {pos} options like {same_names}, but the role is realistic enough for me to see how I fit.",
            f"There is competition with {same_names}, but not so much that I cannot picture a real role.",
            f"The {pos_room} has bodies, including {same_names}, but I still see a chance to carve out minutes.",
            f"I am walking into competition, not a promise. With {same_names} there, I have to make the fit obvious.",
        ])

    return _story_pick(seed + "|player-role-clean", [
        f"The {pos_room} gives me a cleaner lane to earn minutes.",
        f"I can see the opening at {pos}, and that matters when I am picking a team.",
        f"There is enough room in the {pos_room} for me to believe the opportunity is real.",
        f"The role feels believable because there is not a long list of established names blocking the path at {pos}.",
    ])

def _story_team_side_voice(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    contract_info: Dict[str, Any],
    team_context: Dict[str, Any],
    recent_context: Dict[str, Any],
    roster_context: Dict[str, Any],
    market_context: Dict[str, Any],
    money_line: str,
    event_type: str,
    matched_rfa: bool,
    original_offer_team_name: Optional[str],
    spending_type: Any = None,
    exception_type: Any = None,
    seed: str = "",
) -> Dict[str, Any]:
    player_name = player.get("name") or "this player"
    bucket = roster_context.get("positionBucket") or get_player_position_bucket(player)
    direction = team_context.get("direction") or "balanced"
    need_score = float(num(team_context.get("needScore"), 0))
    star_names = roster_context.get("starNames")
    top_names = roster_context.get("topPlayerNames")
    tenure = _story_tenure_read(player, team_name)
    team_display = _story_team_display(team_name)
    outside_display = _story_team_display(original_offer_team_name) if original_offer_team_name else "the outside team"
    is_minimum = _story_is_minimum_deal(contract_info, spending_type, exception_type)
    bird_level = str(tenure.get("birdLevel") or "none")
    rights_raw = f"{spending_type or ''} {exception_type or ''} {event_type or ''}".lower()
    bird_spending = "bird" in rights_raw
    rfa_spending = bool(matched_rfa or "rfa" in rights_raw)
    own_rights = bool(tenure.get("sameTeam") and bird_level != "none" and (bird_spending or rfa_spending))
    continuity_only = bool(tenure.get("sameTeam") and tenure.get("years", 0) >= 3 and not own_rights)

    if matched_rfa:
        opener = _story_pick(seed + "|team-opener-rfa", [
            f"We were not letting {player_name} walk after {outside_display} put the offer sheet on the table.",
            f"Once {outside_display} tested our resolve, we had to decide if {player_name} was still worth protecting. We decided he was.",
            f"The offer sheet forced the question, and our answer was simple: we still valued {player_name} enough to match.",
        ])
    elif own_rights and tenure.get("years", 0) >= 3:
        success = _story_success_memory(recent_context)
        opener = _story_pick(seed + "|team-opener-longtime", [
            f"We know {player_name} already. He has been with us for {tenure.get('years')} years, {success}, and Bird rights gave us the cleanest path to keep that continuity.",
            f"This was about trust as much as talent. {player_name} has been in our system for {tenure.get('years')} years, and we were comfortable using our Bird rights to keep him.",
            f"We did not want to create a hole with a player who already fits here. After {tenure.get('years')} years together, keeping {player_name} made more sense than replacing him blindly.",
        ])
    elif own_rights:
        opener = _story_pick(seed + "|team-opener-bird", [
            f"We were happy to use our Bird-rights path because {player_name} already made sense in our building.",
            f"Bird-rights flexibility matters exactly in this kind of spot: we could keep a player we knew without needing to clear normal cap room.",
            f"We saw value in continuity, and our rights gave us a way to keep {player_name} without reshaping the entire cap sheet first.",
            f"This is why rights matter. We already had the relationship with {player_name}, and the CBA gave us a clean way to keep it going.",
        ])
    elif continuity_only:
        opener = _story_pick(seed + "|team-opener-continuity-no-rights", [
            f"We already knew {player_name}'s fit here, so the move was about continuity and trust, not pretending we had some special rights advantage.",
            f"This was a familiarity play. {player_name} had already spent time with us, and keeping that role stable made basketball sense.",
            f"We were not starting from zero with {player_name}. The relationship and role were already there, so the contract just had to make sense.",
        ])
    elif is_minimum:
        opener = _story_pick(seed + "|team-opener-min", [
            f"We needed a roster spot filled the right way, and {player_name} was available on a simple minimum path.",
            f"This was not a headline chase. We needed cheap playable depth, and {player_name} gave us a reasonable way to finish the roster.",
            f"At this point in the market, we were looking for someone willing to come in, compete, and give us depth without stressing the cap sheet.",
        ])
    elif star_names:
        opener = _story_pick(seed + "|team-opener-stars", [
            f"We already have {star_names} setting the top of our roster, so we wanted {player_name} to make that group easier to support.",
            f"With {star_names} already carrying a lot of the identity, this move was about adding the right complementary piece.",
            f"Our top-end talent is already there with {star_names}. The question was how to make the rotation around them stronger, and {player_name} fit that answer.",
        ])
    elif top_names:
        opener = _story_pick(seed + "|team-opener-top", [
            f"With {top_names} already shaping our rotation, we saw {player_name} as a way to make the roster more complete.",
            f"We looked at the group around {top_names} and felt {player_name} filled a real basketball need.",
            f"The core of the roster already had {top_names}; adding {player_name} was about improving the next layer.",
        ])
    else:
        opener = _story_pick(seed + "|team-opener-basic", [
            f"We looked at our roster and saw {player_name} as a practical way to add another playable {_story_position_phrase(bucket, seed + '|basic-pos')}.",
            f"The roster needed another credible option, and {player_name} was the cleanest fit at this point in the market.",
            f"This was a fit-and-price decision: we saw a role, we saw the contract path, and we moved.",
        ])

    role_line = _story_role_line_for_team(player, roster_context, seed)

    if need_score >= 0.70:
        need_line = _story_pick(seed + "|team-need-strong", [
            f"The need grade was strong at {_story_position_phrase(bucket, seed + '|need-strong-a')}, so we treated this as a targeted positional fix instead of a random market swing.",
            f"The {_story_position_phrase(bucket, seed + '|need-strong-b')} need was loud enough that we wanted a real answer, not just another body.",
            f"Our board said {_story_position_phrase(bucket, seed + '|need-strong-c')} was one of the spots to address, and this signing directly speaks to that.",
        ])
    elif need_score >= 0.45:
        need_line = _story_pick(seed + "|team-need-medium", [
            f"The {_story_position_phrase(bucket, seed + '|need-medium-a')} need was real enough that we wanted another option, even if it was not the only hole on the roster.",
            f"This was not an emergency, but the {_story_position_phrase(bucket, seed + '|need-medium-b', style = 'room')} still needed another playable piece.",
            f"We did not need to panic at {_story_position_phrase(bucket, seed + '|need-medium-c')}, but we did need more stability there.",
        ])
    else:
        need_line = _story_pick(seed + "|team-need-light", [
            f"The {_story_position_phrase(bucket, seed + '|need-light-a')} need was not screaming emergency, but we still liked the value and fit at this price.",
            f"This was less about plugging the biggest hole and more about adding value where the market made sense.",
            f"Even if {_story_position_phrase(bucket, seed + '|need-light-c')} was not our loudest need, the player and contract still made the roster cleaner.",
        ])

    direction_line = {
        "contending": _story_pick(seed + "|team-dir-contending", [
            "We are trying to win now, so the priority was someone who can survive in meaningful rotation minutes.",
            "Our timeline is not theoretical - we need players who can help in real games right away.",
            "For us, the bar is playoff usefulness, not just regular-season depth.",
        ]),
        "win now": _story_pick(seed + "|team-dir-win", [
            "We are leaning win-now, so present-day reliability mattered more than a long development curve.",
            "The direction of the team pushed us toward someone we trust to help sooner rather than later.",
            "We valued immediate usefulness here because the roster is trying to win now.",
        ]),
        "retooling": _story_pick(seed + "|team-dir-retool", [
            "We are retooling, so we wanted a move that helps now without locking us into a bad long-term shape.",
            "We are not trying to freeze the roster, but we still need useful players while we reshape it.",
            "This fits a retool: useful now, not reckless later.",
        ]),
        "rebuilding": _story_pick(seed + "|team-dir-rebuild", [
            "We are still building, so age, runway, and role flexibility mattered as much as immediate wins.",
            "In our situation, opportunity and development have to be part of the pitch.",
            "We are not selling a finished product, so the move has to make sense through role and growth.",
        ]),
        "balanced": _story_pick(seed + "|team-dir-balanced", [
            "We are in a balanced spot, so this was about value, roster balance, and keeping options open.",
            "This was a practical move: not reckless, not passive, just a cleaner roster fit.",
            "We weighed the move as both a basketball fit and a flexibility decision.",
        ]),
    }.get(direction, f"Our direction reads as {direction}, so we weighed this move against that timeline.")

    summary_parts = [opener, role_line, need_line, direction_line]
    if market_context.get("teamMarketLine"):
        summary_parts.append(market_context.get("teamMarketLine"))
    summary = " ".join(part for part in summary_parts if part).strip()

    return {
        "title": f"{_story_team_possessive(team_name)} side",
        "voice": "team",
        "summary": summary,
        "bullets": [
            f"Recent team context: {recent_context.get('label') or 'not available'}.",
            f"Roster names used: {top_names or 'no top-player names available in this team row'}.",
            f"Depth chart read: {roster_context.get('samePositionNames') or ('limited established ' + _story_position_phrase(bucket, seed + '|bullet-pos') + ' depth found')}.",
            f"Contract path: {money_line}",
        ],
    }


def _story_player_side_voice(
    player: Dict[str, Any],
    team_name: str,
    contract_info: Dict[str, Any],
    roster_context: Dict[str, Any],
    market_context: Dict[str, Any],
    recent_context: Dict[str, Any],
    event_type: str,
    matched_rfa: bool,
    spending_type: Any = None,
    exception_type: Any = None,
    seed: str = "",
) -> Dict[str, Any]:
    player_name = player.get("name") or "I"
    first_name = _story_player_first_name(player)
    age = int(num(player.get("age"), 27))
    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))
    upside = potential - overall
    contract_line = contract_info.get("line") or "the contract"
    team_display = _story_team_display(team_name)
    tenure = _story_tenure_read(player, team_name)
    is_minimum = _story_is_minimum_deal(contract_info, spending_type, exception_type)

    if matched_rfa:
        opener = _story_pick(seed + "|player-opener-rfa", [
            f"From my side, the outside offer finally set the market, and once {team_display} matched it, the decision was made.",
            f"I got to test the market, but restricted free agency means the team with my rights still had the final say once they matched.",
            f"The offer sheet showed my value, and {team_display} decided they still wanted me at that number.",
        ])
    elif tenure.get("sameTeam") and tenure.get("years", 0) >= 3:
        success = _story_success_memory(recent_context)
        opener = _story_pick(seed + "|player-opener-longtime", [
            f"I already know this place. I have been with {team_display} for {tenure.get('years')} years, {success}, and staying made sense once the contract showed they still valued me.",
            f"Continuity mattered here. I know the role, I know the locker room, and after {tenure.get('years')} years with {team_display}, this did not feel like starting over.",
            f"I was comfortable here. {team_display} knew my game, I knew what they expected from me, and the deal was strong enough to keep that going.",
        ])
    elif is_minimum:
        opener = _story_pick(seed + "|player-opener-min", [
            f"From my side, I wanted a real roster spot. A minimum deal is not about ego; it is about getting in the building and earning trust.",
            f"I know this is a minimum, but it keeps me in the league and gives me a chance to prove I can help.",
            f"At this point, I am thankful to have a team willing to give me a roster spot and a chance to compete.",
            f"The money is not the headline here. I needed an opportunity, and {team_display} gave me one.",
        ])
    elif overall >= 85:
        opener = _story_pick(seed + "|player-opener-star", [
            f"From my side, I needed a team that treated me like a major piece, and {team_display} put real value behind that with {contract_line}.",
            f"I was not looking for just any offer. I needed the money, role, and roster direction to line up, and {team_display} made that case.",
            f"At my level, the decision has to be about respect, winning direction, and role. {team_display} checked enough of those boxes.",
        ])
    elif age <= 25 and upside >= 3:
        opener = _story_pick(seed + "|player-opener-young", [
            f"From my side, I wanted a place where I could keep growing instead of getting buried, and this deal gives me a real runway.",
            f"I am still building my value, so I needed opportunity, patience, and a role that gives me room to improve.",
            f"The money matters, but at my age the role matters too. I wanted a team that could actually let me grow.",
        ])
    elif age >= 32:
        opener = _story_pick(seed + "|player-opener-vet", [
            f"From my side, I wanted stability, a defined role, and a team that still had a reason to use me right away.",
            f"At this stage, I am not chasing empty promises. I needed a team that knew how I could help.",
            f"I wanted a situation that made sense now, not just a vague chance to hang around.",
        ])
    else:
        opener = _story_pick(seed + "|player-opener-prime", [
            f"From my side, I was looking for the cleanest mix of role, money, and fit, and {team_display} gave me that path.",
            f"I had to weigh the full picture: the contract, the rotation, and whether the team actually had a plan for me.",
            f"This was not just about signing somewhere. I wanted the team that made the role and money make sense together.",
        ])

    role_line = _story_role_line_for_player(player, roster_context, seed)

    if is_minimum:
        money_line = _story_pick(seed + "|player-money-min", [
            f"The {contract_line} structure means I have to earn everything from here.",
            f"On a minimum, the job is simple: get on the roster, compete, and make it hard for them to cut my minutes.",
            f"This is not long-term security, so the opportunity matters more than pretending the contract is huge.",
        ])
    elif contract_info.get("years", 0) >= 3:
        money_line = _story_pick(seed + "|player-money-long", [
            f"The {contract_line} structure gives me security, which matters because I do not have to treat this like a one-year survival deal.",
            f"The years mattered. I can settle into the role instead of feeling like everything resets immediately.",
            f"The contract gave me enough stability to focus on basketball instead of chasing the next market right away.",
        ])
    elif contract_info.get("years", 0) == 2:
        money_line = _story_pick(seed + "|player-money-two", [
            f"The {contract_line} structure gives me some security while still leaving room to prove my value again.",
            f"Two years gives me a little stability without completely locking me into one path.",
            f"The deal is not forever, but it is enough commitment for me to take the situation seriously.",
        ])
    else:
        money_line = _story_pick(seed + "|player-money-one", [
            f"The {contract_line} structure feels more like a prove-it deal, so the opportunity and minutes have to matter.",
            f"On a one-year structure, I need the role to help me build the next contract.",
            f"This is a short runway, so I have to make the fit work fast.",
        ])

    if is_minimum:
        growth_line = _story_pick(seed + "|player-growth-min", [
            "I am coming in thankful, but not satisfied - I still have to earn a real place in the rotation.",
            "For me, this is about staying ready and turning a small contract into a bigger opportunity.",
            "The first goal is simple: stick on the roster, then force the coaches to trust me.",
        ])
    elif age <= 25 and upside >= 2:
        growth_line = _story_pick(seed + "|player-growth-young", [
            "I still have development value, so I care about touches, mistakes, and whether the team will actually let me grow.",
            "I am not a finished product, so the team context matters as much as the number on the contract.",
            "I need minutes that help me become more than what I am right now.",
        ])
    elif overall >= 80:
        growth_line = _story_pick(seed + "|player-growth-good", [
            "I already see myself as a real rotation piece, so I wanted a place where the role matches my level.",
            "I am past the point of just hoping to belong; I wanted a team that sees me as useful right away.",
            "The role had to respect the player I already am, not treat me like a fringe gamble.",
        ])
    elif age >= 32:
        growth_line = _story_pick(seed + "|player-growth-vet", [
            "At this stage, I am not only chasing upside; I need a situation that gives me a real job.",
            "I know what I am in the league, so fit and clarity matter more than vague upside talk.",
            "The goal is to help now and keep showing I can still belong.",
        ])
    else:
        growth_line = _story_pick(seed + "|player-growth-default", [
            "I am trying to turn this contract into a stable role and a stronger market next time.",
            "This gives me a chance to build trust and make the next decision easier.",
            "The opportunity is real enough that I can see how this helps my career.",
        ])

    summary = " ".join([
        opener,
        market_context.get("marketLine", ""),
        role_line,
        money_line,
        growth_line,
    ]).strip()

    return {
        "title": f"{first_name}'s side",
        "voice": "player",
        "summary": summary,
        "bullets": [
            f"Player profile: age {age}, {_story_position_phrase(player.get('pos') or player.get('position'), seed + '|bullet-profile-pos')}; {_story_player_strength_phrase(player, seed + '|bullet-profile-skill', pronoun = 'his')}.",
            f"Role read: {role_line}",
            f"Market read: {market_context.get('marketLine')}",
            f"Mood read: {recent_context.get('mood')}",
        ],
    }


def build_free_agency_story_context(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    contract: Optional[Dict[str, Any]] = None,
    row: Optional[Dict[str, Any]] = None,
    offer: Optional[Dict[str, Any]] = None,
    all_offers: Optional[List[Dict[str, Any]]] = None,
    spending_res: Optional[Dict[str, Any]] = None,
    event_type: str = "signing",
    current_day: Optional[int] = None,
    matched_rfa: bool = False,
    original_offer_team_name: Optional[str] = None,
    rights_team_name: Optional[str] = None,
    exception_usage: Optional[Dict[str, Any]] = None,
    roster_need: Optional[Dict[str, Any]] = None,
    team_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    row = row or {}
    offer = offer or row or {}
    spending_res = spending_res or {}
    all_offers = all_offers or []

    player_name = player.get("name") or row.get("playerName") or offer.get("playerName") or "Player"
    team_name = team_name or row.get("teamName") or offer.get("teamName") or "Unknown Team"
    team_display = _story_team_display(team_name)
    contract = contract or row.get("contract") or offer.get("contract")
    contract_info = _story_contract_summary(
        contract,
        fallback_total = int(num(row.get("totalValue") or offer.get("totalValue"), 0)),
        fallback_years = int(num(row.get("years") or offer.get("years"), 0)),
    )

    spending_type = spending_res.get("spendingType") or row.get("spendingType") or offer.get("spendingType")
    exception_type = spending_res.get("exceptionType") or row.get("exceptionType") or offer.get("exceptionType")
    payroll_zone = spending_res.get("payrollZone") or row.get("payrollZone") or offer.get("payrollZone")
    original_offer_team_name = original_offer_team_name or row.get("originalOfferTeamName") or offer.get("originalOfferTeamName")
    rights_team_name = rights_team_name or row.get("rightsTeamName") or get_player_rights(player).get("heldByTeam")
    roster_need = roster_need or row.get("rosterNeed") or offer.get("rosterNeed")

    recent_context = _story_recent_team_context(league_data, team_name)
    team_context = _story_team_building_context(
        league_data = league_data,
        team_name = team_name,
        player = player,
        roster_need = roster_need,
        team_profile = team_profile,
    )
    roster_context = _story_team_roster_context(
        league_data = league_data,
        team_name = team_name,
        player = player,
    )

    seed = f"{event_type}|{player_name}|{team_name}|{contract_info['totalValue']}|{current_day}|{spending_type}|{exception_type}|{original_offer_team_name}"
    market_context = _story_market_offer_context(
        all_offers = all_offers,
        accepted_team_name = team_name,
        accepted_total_value = contract_info.get("totalValue", 0),
        seed_text = seed,
    )
    tag = _story_tool_label(exception_type or spending_type or event_type) or "Free Agency"
    outside_display = _story_team_display(original_offer_team_name) if original_offer_team_name else "the outside bidder"

    if matched_rfa or str(event_type).startswith("rfa") or str(spending_type) == "rfa_match":
        headline = f"{player_name} - RFA matched"
        what_happened = _story_pick(seed + "|what-rfa", [
            f"{_story_team_display(team_name, capital = True)} matched the offer sheet after {outside_display} pushed the market to {contract_info['line']}.",
            f"{outside_display.capitalize()} created the pressure, but {team_display} kept control by matching the {contract_info['line']} offer sheet.",
            f"This was not a normal open-market win: {team_display} used its RFA rights to keep {player_name} after the outside offer arrived.",
            f"{_story_team_display(team_name, capital = True)} decided the cost was worth it and prevented {player_name} from leaving on the offer sheet.",
        ])
    elif event_type == "cpu_offer":
        headline = f"{player_name} - {tag} offer"
        what_happened = _story_pick(seed + "|what-offer", [
            f"{_story_team_display(team_name, capital = True)} entered the bidding with a {contract_info['line']} offer because the fit lined up with its roster direction.",
            f"This is a targeted offer from {team_display}, not just random market noise.",
            f"{_story_team_display(team_name, capital = True)} is testing whether {contract_info['line']} is enough to pull {player_name} into its rotation.",
            f"The offer tells you {team_display} sees a specific use for {player_name} at this point in the market.",
        ])
    elif event_type == "pending_user_signing":
        headline = f"{player_name} - ready to sign"
        what_happened = _story_pick(seed + "|what-user", [
            f"Your offer has reached the decision stage, and {player_name} is ready to join if you approve the signing.",
            f"The market has moved far enough that {player_name} is willing to accept your {contract_info['line']} offer.",
            f"This is now your final call: accept the signing or let the player stay on the market.",
        ])
    elif event_type == "cleanup_signing":
        headline = f"{player_name} - roster fill"
        what_happened = _story_pick(seed + "|what-cleanup", [
            f"{_story_team_display(team_name, capital = True)} used the late market to fill out the roster with {player_name}.",
            f"This was a practical roster-compliance move after the main market cooled down.",
            f"{_story_team_display(team_name, capital = True)} needed playable depth, and {player_name} was still available at the right price.",
        ])
    else:
        headline = f"{player_name} - {tag}"
        what_happened = _story_pick(seed + "|what-signing", [
            f"{_story_team_display(team_name, capital = True)} completed the signing at {contract_info['line']} after the market settled around this offer.",
            f"The signing connects contract value, team need, and player fit more than it looks at first glance.",
            f"{_story_team_display(team_name, capital = True)} found a legal spending path and finished the deal before the market moved on.",
            f"This move shows what {team_display} valued most in this free-agency window.",
            f"The deal is less about a generic roster spot and more about how {player_name}'s level, price, and role fit {team_display} specifically.",
        ])

    money_line = _story_spending_line(spending_type, exception_type, payroll_zone, exception_usage)
    team_side = _story_team_side_voice(
        league_data = league_data,
        player = player,
        team_name = team_name,
        contract_info = contract_info,
        team_context = team_context,
        recent_context = recent_context,
        roster_context = roster_context,
        market_context = market_context,
        money_line = money_line,
        event_type = event_type,
        matched_rfa = bool(matched_rfa),
        original_offer_team_name = original_offer_team_name,
        spending_type = spending_type,
        exception_type = exception_type,
        seed = seed,
    )
    player_side = _story_player_side_voice(
        player = player,
        team_name = team_name,
        contract_info = contract_info,
        roster_context = roster_context,
        market_context = market_context,
        recent_context = recent_context,
        event_type = event_type,
        matched_rfa = bool(matched_rfa),
        spending_type = spending_type,
        exception_type = exception_type,
        seed = seed,
    )

    team_need = f"{team_context['needLine']} {team_context['directionLine']}"
    recent_line = f"{_story_team_display(team_name, capital = True)} is coming off {recent_context['label']}. This reads like {recent_context['short']}."
    mood_angle = recent_context["mood"]

    return {
        "version": 3,
        "eventType": event_type,
        "headline": headline,
        "subtitle": contract_info["line"],
        "playerName": player_name,
        "teamName": team_name,
        "teamDisplayName": team_display,
        "day": current_day,
        "contractLine": contract_info["line"],
        "totalValue": contract_info["totalValue"],
        "years": contract_info["years"],
        "aav": contract_info["aav"],
        "spendingType": spending_type,
        "exceptionType": exception_type,
        "payrollZone": payroll_zone,
        "teamDirection": team_context.get("direction"),
        "needScore": team_context.get("needScore"),
        "positionBucket": team_context.get("positionBucket"),
        "recentRecord": recent_context.get("label"),
        "recentTeamShort": recent_context.get("short"),
        "moodAngle": mood_angle,
        "rfaMatched": bool(matched_rfa),
        "originalOfferTeamName": original_offer_team_name,
        "rightsTeamName": rights_team_name,
        "uniquenessSeed": seed,
        "teamSide": team_side,
        "playerSide": player_side,
        "otherOffers": market_context.get("otherOffers", []),
        "rosterContext": roster_context,
        "sections": [
            {"label": "What happened", "value": what_happened},
            {"label": "Contract / CBA path", "value": money_line},
            {"label": "Team need / direction", "value": team_need},
            {"label": "Recent team context", "value": recent_line},
            {"label": "Other offers", "value": market_context.get("marketLine")},
            {"label": "Mood angle", "value": mood_angle},
        ],
    }

def normalize_exception_type(raw_value: Any) -> Optional[str]:
    raw = str(raw_value or "").strip().lower().replace("-", "_").replace(" ", "_")

    if raw in ["", "none", "null", "cap_space", "minimum", "bird_rights", "rfa_match"]:
        return None

    if "room" in raw:
        return "room_exception"
    if "non_taxpayer" in raw or "non_tax" in raw or "nonpayer" in raw:
        return "non_taxpayer_mle"
    if "taxpayer" in raw:
        return "taxpayer_mle"
    if "mid_level" in raw or raw == "mle":
        return "non_taxpayer_mle"

    return None


def get_exception_usage_ledger(league_data: Dict[str, Any]) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    usage = state.setdefault("exceptionUsageByTeam", {})
    if not isinstance(usage, dict):
        state["exceptionUsageByTeam"] = {}
        usage = state["exceptionUsageByTeam"]
    return usage


def get_team_exception_usage(league_data: Dict[str, Any], team_name: str) -> Dict[str, int]:
    usage = get_exception_usage_ledger(league_data)
    row = usage.setdefault(team_name, {})
    if not isinstance(row, dict):
        usage[team_name] = {}
        row = usage[team_name]

    normalized = {
        "nonTaxpayerMLE": int(num(row.get("nonTaxpayerMLE") or row.get("non_taxpayer_mle"), 0)),
        "taxpayerMLE": int(num(row.get("taxpayerMLE") or row.get("taxpayer_mle"), 0)),
        "roomException": int(num(row.get("roomException") or row.get("room_exception"), 0)),
    }

    row["nonTaxpayerMLE"] = normalized["nonTaxpayerMLE"]
    row["taxpayerMLE"] = normalized["taxpayerMLE"]
    row["roomException"] = normalized["roomException"]
    row["totalUsed"] = (
        normalized["nonTaxpayerMLE"]
        + normalized["taxpayerMLE"]
        + normalized["roomException"]
    )
    return normalized


def get_team_remaining_exceptions(league_data: Dict[str, Any], team_name: str) -> Dict[str, int]:
    used = get_team_exception_usage(league_data, team_name)
    return {
        "nonTaxpayerMLE": max(0, get_non_taxpayer_mle_amount(league_data) - used["nonTaxpayerMLE"]),
        "taxpayerMLE": max(0, get_taxpayer_mle_amount(league_data) - used["taxpayerMLE"]),
        "roomException": max(0, get_room_exception_amount(league_data) - used["roomException"]),
    }


def record_exception_usage_for_signing(
    league_data: Dict[str, Any],
    team_name: str,
    spending_res: Dict[str, Any],
    current_year_salary: int,
) -> Optional[Dict[str, Any]]:
    exception_type = normalize_exception_type(spending_res.get("exceptionType"))
    amount = int(num(current_year_salary, 0))

    if not exception_type or amount <= MIN_DEAL:
        return None

    usage = get_exception_usage_ledger(league_data)
    row = usage.setdefault(team_name, {})
    if not isinstance(row, dict):
        usage[team_name] = {}
        row = usage[team_name]

    key_map = {
        "non_taxpayer_mle": "nonTaxpayerMLE",
        "taxpayer_mle": "taxpayerMLE",
        "room_exception": "roomException",
    }
    key = key_map.get(exception_type)
    if not key:
        return None

    before = int(num(row.get(key), 0))
    row[key] = before + amount
    row["totalUsed"] = (
        int(num(row.get("nonTaxpayerMLE"), 0))
        + int(num(row.get("taxpayerMLE"), 0))
        + int(num(row.get("roomException"), 0))
    )

    return {
        "teamName": team_name,
        "exceptionType": exception_type,
        "amountUsed": amount,
        "usedBefore": before,
        "usedAfter": row[key],
        "remainingAfter": get_team_remaining_exceptions(league_data, team_name),
    }


def get_active_offers_for_player(state: Dict[str, Any], player_key: str) -> List[Dict[str, Any]]:
    offers = state.setdefault("offersByPlayer", {}).setdefault(player_key, [])
    return [o for o in offers if o.get("status", "active") == "active"]


def get_active_offer_count_for_team(state: Dict[str, Any], team_name: str) -> int:
    count = 0
    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") == "active" and offer.get("teamName") == team_name:
                count += 1
    return count


def get_projected_team_roster_count(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return 0

    # Live free-agency offers are not actual roster spots. A team can have
    # several offers out, then the final signing screen enforces the 15-man limit.
    return len(get_team_players(team))

def get_team_roster_deficit(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None,
    target_override: Optional[int] = None
) -> int:
    min_roster_target = (
        int(target_override)
        if target_override is not None
        else get_min_roster_target(league_data)
    )

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return 0

    actual_count = len(get_team_players(team))
    return max(0, min_roster_target - actual_count)
def get_team_remaining_roster_slots(
    league_data: Dict[str, Any],
    team_name: str,
    state: Optional[Dict[str, Any]] = None
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return 0

    fa_state = state if isinstance(state, dict) else ensure_free_agency_state(league_data)
    live_market_mode = bool(isinstance(fa_state, dict) and fa_state.get("isActive"))

    projected_count = get_projected_team_roster_count(
        league_data = league_data,
        team_name = team_name,
        state = state,
    )

    if live_market_mode:
        return max(0, OFFSEASON_CONTROLLED_MAX - get_team_controlled_player_count(team))

    max_roster_limit = get_roster_limit(league_data)
    return max(0, max_roster_limit - projected_count)


def get_active_offer_limit_for_team(
    league_data: Dict[str, Any],
    team_name: str,
    state: Dict[str, Any],
    target_override: Optional[int] = None,
    snapshot: Optional[Dict[str, Any]] = None
) -> int:
    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return MAX_ACTIVE_OFFERS_PER_TEAM

    roster_target = (
        int(target_override)
        if target_override is not None
        else get_min_roster_target(league_data)
    )

    current_roster_count = len(get_team_players(team))
    roster_deficit = max(0, roster_target - current_roster_count)
    snapshot = snapshot or get_team_cap_snapshot(league_data, team_name)
    cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0
    raw_room = int(snapshot.get("rawCapRoomWithoutHolds", cap_room)) if snapshot.get("ok") else cap_room
    planning_room = max(cap_room, raw_room)
    current_day = int(num(state.get("currentDay"), 1)) if isinstance(state, dict) else 1

    # Live offers are conditional paths, not completed signings. Teams with real
    # raw cap room should be willing to keep multiple star/starter offers alive,
    # then decide which holds to renounce only after players accept.
    if current_day <= 1:
        desired_limit = 4
        if planning_room >= 55_000_000:
            desired_limit = 9
        elif planning_room >= 40_000_000:
            desired_limit = 8
        elif planning_room >= 28_000_000:
            desired_limit = 7
        elif planning_room >= 18_000_000 or roster_deficit >= 3:
            desired_limit = 5
    elif current_day <= 2:
        desired_limit = 5
        if planning_room >= 55_000_000:
            desired_limit = 10
        elif planning_room >= 40_000_000:
            desired_limit = 9
        elif planning_room >= 28_000_000:
            desired_limit = 8
        elif planning_room >= 18_000_000 or roster_deficit >= 3:
            desired_limit = 6
    elif current_day <= 4:
        desired_limit = 6
        if planning_room >= 55_000_000:
            desired_limit = 10
        elif planning_room >= 40_000_000:
            desired_limit = 9
        elif planning_room >= 28_000_000 or roster_deficit >= 3:
            desired_limit = 8
    else:
        desired_limit = 7
        if planning_room >= 40_000_000 or roster_deficit >= 3:
            desired_limit = 9

    if current_roster_count >= get_roster_limit(league_data):
        # Live FA offers are soft paths, not completed signings. Do not hard-block
        # a full roster from making a small number of offers; final signing still
        # enforces roster legality before any player is added.
        desired_limit = min(desired_limit, 2)

    return int(clamp(desired_limit, 0, 10))

def get_outstanding_offer_year1_total(
    state: Dict[str, Any],
    team_name: str,
    exclude_offer_id: Optional[str] = None
) -> int:
    total = 0
    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") != "active":
                continue
            if offer.get("teamName") != team_name:
                continue
            if exclude_offer_id and offer.get("offerId") == exclude_offer_id:
                continue
            total += int(num(offer.get("currentYearSalary"), 0))
    return total


def find_existing_offer_for_team_player(
    state: Dict[str, Any],
    player_key: str,
    team_name: str
) -> Optional[Dict[str, Any]]:
    offers = state.setdefault("offersByPlayer", {}).setdefault(player_key, [])
    for offer in offers:
        if offer.get("status", "active") == "active" and offer.get("teamName") == team_name:
            return offer
    return None


def upsert_offer_record(
    league_data: Dict[str, Any],
    player_key: str,
    offer_record: Dict[str, Any]
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    offers_by_player = state.setdefault("offersByPlayer", {})
    offers = offers_by_player.setdefault(player_key, [])
    team_name = offer_record.get("teamName")

    kept_offers = []
    replaced_any = False

    for existing in offers:
        same_team = bool(team_name) and existing.get("teamName") == team_name
        if same_team:
            old = copy.deepcopy(existing)
            old["status"] = "replaced"
            old["replacedByOfferId"] = offer_record.get("offerId")
            old["replacedOnDay"] = offer_record.get("submittedDay") or offer_record.get("day")
            state.setdefault("offerHistory", []).append(old)
            replaced_any = True
            continue

        kept_offers.append(existing)

    kept_offers.append(offer_record)
    offers_by_player[player_key] = kept_offers

    if replaced_any:
        state.setdefault("dailyLog", []).append({
            "day": offer_record.get("submittedDay") or offer_record.get("day"),
            "type": "offer_replaced",
            "playerKey": player_key,
            "playerName": offer_record.get("playerName"),
            "teamName": team_name,
            "newOfferId": offer_record.get("offerId"),
        })

    return offer_record

def sort_offers_for_display(offers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        offers,
        key = lambda o: (
            -num(o.get("playerViewScore"), 0),
            -num(o.get("totalValue"), 0),
            -num(o.get("aav"), 0),
            str(o.get("teamName", "")),
        )
    )

def build_pending_user_decision_entry(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    player_key = get_player_key_from_player(player)

    chosen_offer_copy = copy.deepcopy(chosen_offer)
    chosen_offer_copy["contract"] = normalize_contract(chosen_offer_copy.get("contract"))

    contract = normalize_contract(chosen_offer_copy.get("contract"))
    salary_by_year = list(contract.get("salaryByYear", [])) if contract else []
    total_value = int(sum(salary_by_year))
    years = len(salary_by_year)
    current_year_salary = int(salary_by_year[0]) if salary_by_year else 0

    return {
        "playerKey": player_key,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "player": {
            "id": player.get("id"),
            "name": player.get("name"),
            "overall": player.get("overall"),
            "age": player.get("age"),
            "position": player.get("pos"),
            "headshot": player.get("headshot"),
        },
        "teamName": team_name,
        "day": current_day,
        "chosenOffer": chosen_offer_copy,
        "contract": contract,
        "salaryByYear": salary_by_year,
        "currentYearSalary": current_year_salary,
        "years": years,
        "totalValue": total_value,
        "allOffers": sort_offers_for_display(copy.deepcopy(all_offers)),
        "storyContext": build_free_agency_story_context(
            league_data = league_data,
            player = player,
            team_name = team_name,
            contract = contract,
            row = chosen_offer_copy,
            all_offers = all_offers,
            spending_res = chosen_offer_copy,
            event_type = "pending_user_signing",
            current_day = current_day,
            roster_need = chosen_offer_copy.get("rosterNeed"),
        ),
    }


def upsert_pending_user_decision(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    entry = build_pending_user_decision_entry(
        league_data = league_data,
        team_name = team_name,
        player = player,
        chosen_offer = chosen_offer,
        all_offers = all_offers,
        current_day = current_day,
    )

    pending_rows = [
        row for row in state.get("pendingUserDecisions", [])
        if row.get("playerKey") != entry.get("playerKey")
    ]
    pending_rows.append(entry)
    pending_rows.sort(
        key = lambda row: (
            -num(row.get("totalValue"), 0),
            str(row.get("playerName", "")),
        )
    )

    state["pendingUserDecisions"] = pending_rows
    state["pendingUserTeamName"] = team_name

    snapshot = get_team_cap_snapshot(league_data, team_name)
    state["pendingUserTeamSnapshot"] = snapshot if snapshot.get("ok") else None

    return entry


def clear_pending_user_decisions(state: Dict[str, Any]) -> None:
    state["pendingUserDecisions"] = []
    state["pendingUserTeamSnapshot"] = None


def build_pending_rfa_match_decision_entry(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    player_key = get_player_key_from_player(player)
    rights = get_player_rights(player)
    rights_team_name = rights.get("heldByTeam")

    offer_sheet = copy.deepcopy(chosen_offer)
    offer_sheet["contract"] = normalize_contract(offer_sheet.get("contract"))

    contract = normalize_contract(offer_sheet.get("contract"))
    salary_by_year = list(contract.get("salaryByYear", [])) if contract else []
    total_value = int(sum(salary_by_year))
    years = len(salary_by_year)
    current_year_salary = int(salary_by_year[0]) if salary_by_year else 0
    offering_team_name = offer_sheet.get("teamName")

    return {
        "id": f"rfa:{player_key}:{current_day}:{offering_team_name}",
        "type": "rfa_match_decision",
        "status": "pending",
        "playerKey": player_key,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "player": {
            "id": player.get("id"),
            "name": player.get("name"),
            "overall": player.get("overall"),
            "age": player.get("age"),
            "position": player.get("pos"),
            "headshot": player.get("headshot"),
        },
        "rightsTeamName": rights_team_name,
        "teamName": rights_team_name,
        "offeringTeamName": offering_team_name,
        "offerSheet": offer_sheet,
        "chosenOffer": offer_sheet,
        "contract": contract,
        "salaryByYear": salary_by_year,
        "currentYearSalary": current_year_salary,
        "years": years,
        "totalValue": total_value,
        "aav": int(total_value / max(1, years)),
        "day": current_day,
        "deadlineDay": current_day + 1,
        "allOffers": sort_offers_for_display(copy.deepcopy(all_offers)),
        "storyContext": build_free_agency_story_context(
            league_data = league_data,
            player = player,
            team_name = rights_team_name,
            contract = contract,
            row = offer_sheet,
            all_offers = all_offers,
            spending_res = {"spendingType": "rfa_match"},
            event_type = "rfa_pending",
            current_day = current_day,
            matched_rfa = True,
            original_offer_team_name = offering_team_name,
            rights_team_name = rights_team_name,
        ),
    }


def upsert_pending_rfa_match_decision(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    all_offers: List[Dict[str, Any]],
    current_day: int,
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    entry = build_pending_rfa_match_decision_entry(
        league_data = league_data,
        player = player,
        chosen_offer = chosen_offer,
        all_offers = all_offers,
        current_day = current_day,
    )

    pending_rows = [
        row for row in state.get("pendingRfaMatchDecisions", [])
        if row.get("playerKey") != entry.get("playerKey")
    ]
    pending_rows.append(entry)
    pending_rows.sort(
        key = lambda row: (
            -num(row.get("totalValue"), 0),
            str(row.get("playerName", "")),
        )
    )

    state["pendingRfaMatchDecisions"] = pending_rows
    state["pendingUserTeamName"] = entry.get("rightsTeamName")

    rights_team_name = entry.get("rightsTeamName")
    snapshot = get_team_cap_snapshot(league_data, rights_team_name) if rights_team_name else None
    state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

    return entry


def should_create_user_rfa_match_decision(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    user_team_name: Optional[str] = None,
) -> bool:
    if not user_team_name:
        return False

    rights = get_player_rights(player)
    rights_team_name = rights.get("heldByTeam")

    if not rights.get("restrictedFreeAgent"):
        return False

    if not rights_team_name or rights_team_name != user_team_name:
        return False

    if chosen_offer.get("teamName") == rights_team_name:
        return False

    if chosen_offer.get("status", "active") != "active":
        return False

    return True


def clear_pending_rfa_match_decision_for_player(state: Dict[str, Any], player_key: str) -> None:
    state["pendingRfaMatchDecisions"] = [
        row for row in state.get("pendingRfaMatchDecisions", [])
        if row.get("playerKey") != player_key
    ]


def process_pending_rfa_match_decision(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    player_key: Optional[str] = None,
    decision: str = "decline",
    rights_decisions: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    state = ensure_free_agency_state(updated)

    pending_rows = list(state.get("pendingRfaMatchDecisions", []))
    if not pending_rows:
        return {
            "ok": True,
            "leagueData": updated,
            "processedDecision": None,
            "processedSigning": None,
            "pendingRfaMatchDecisions": [],
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    if not user_team_name:
        user_team_name = state.get("pendingUserTeamName")

    target_row = None
    if player_key:
        for row in pending_rows:
            if str(row.get("playerKey")) == str(player_key):
                target_row = row
                break
    else:
        target_row = pending_rows[0]

    if not target_row:
        return {
            "ok": False,
            "reason": "Pending RFA match decision not found.",
            "leagueData": updated,
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    row_player_key = target_row.get("playerKey") or get_player_key(
        target_row.get("playerId"),
        target_row.get("playerName"),
    )

    rights_team_name = target_row.get("rightsTeamName") or target_row.get("teamName")
    if user_team_name and rights_team_name and user_team_name != rights_team_name:
        return {
            "ok": False,
            "reason": f"This RFA match decision belongs to {rights_team_name}.",
            "leagueData": updated,
            "blockedPlayerKey": row_player_key,
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    free_agents = updated.setdefault("freeAgents", [])
    player_idx = find_free_agent_index(
        free_agents,
        target_row.get("playerId"),
        target_row.get("playerName"),
    )
    if player_idx == -1:
        clear_pending_rfa_match_decision_for_player(state, row_player_key)
        return {
            "ok": False,
            "reason": f"{target_row.get('playerName', 'Player')} is no longer available.",
            "leagueData": updated,
            "blockedPlayerKey": row_player_key,
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    player = free_agents[player_idx]
    current_day = int(num(state.get("currentDay"), target_row.get("day", 1)))
    raw_decision = str(decision or "decline").strip().lower().replace("-", "_").replace(" ", "_")
    match_offer = raw_decision in ["match", "match_offer", "matched", "accept", "accept_match"]

    offer_sheet = copy.deepcopy(
        target_row.get("offerSheet")
        or target_row.get("chosenOffer")
        or {}
    )
    offer_sheet["contract"] = normalize_contract(
        offer_sheet.get("contract") or target_row.get("contract")
    )

    if match_offer:
        chosen_offer = copy.deepcopy(offer_sheet)
        chosen_offer["teamName"] = rights_team_name
        chosen_offer["source"] = "rfa_user_match"
        chosen_offer["matchedOriginalTeamName"] = rights_team_name
        chosen_offer["originalOfferTeamName"] = target_row.get("offeringTeamName") or offer_sheet.get("teamName")
        chosen_offer["forceRfaMatch"] = True
        final_decision = "match"
    else:
        chosen_offer = copy.deepcopy(offer_sheet)
        chosen_offer["source"] = chosen_offer.get("source") or "cpu"
        chosen_offer["declinedRightsTeamName"] = rights_team_name
        chosen_offer["rfaMatchDeclined"] = True
        chosen_offer["skipRfaAutoMatch"] = True
        final_decision = "decline"

    if match_offer:
        prepared = prepare_user_offer_for_conditional_finalization(
            league_data = updated,
            user_team_name = rights_team_name,
            player = player,
            chosen_offer = chosen_offer,
            rights_decisions = rights_decisions,
        )

        if not prepared.get("ok"):
            return {
                "ok": False,
                "reason": prepared.get("reason") or f"Unable to prepare RFA match for {target_row.get('playerName', 'player')}.",
                "leagueData": updated,
                "blockedPlayerKey": row_player_key,
                "pendingRfaMatchDecision": target_row,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
                "spendingCheck": prepared.get("spendingCheck"),
                "finalCheck": prepared.get("finalCheck"),
                "capHoldClearanceNeeded": prepared.get("capHoldClearanceNeeded"),
                "capHoldCleared": prepared.get("capHoldCleared"),
            }

        updated = prepared.get("leagueData", updated)
        state = ensure_free_agency_state(updated)
        player = prepared.get("player", player)
        chosen_offer = prepared.get("chosenOffer", chosen_offer)
        chosen_offer["rfaMatchPreparedWithRightsClearance"] = bool(prepared.get("rightsClearanceApplied"))

    signed = finalize_free_agent_signing_from_offer(
        league_data = updated,
        player = player,
        chosen_offer = chosen_offer,
        current_day = current_day,
    )

    if not signed:
        return {
            "ok": False,
            "reason": f"Unable to process RFA decision for {target_row.get('playerName', 'player')} with the current cap / roster situation.",
            "leagueData": league_data,
            "blockedPlayerKey": row_player_key,
            "pendingRfaMatchDecision": target_row,
            "stateSummary": build_free_agency_state_summary(league_data),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    state = ensure_free_agency_state(updated)
    clear_pending_rfa_match_decision_for_player(state, row_player_key)
    state["pendingUserTeamName"] = rights_team_name
    state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, rights_team_name) if rights_team_name else None
    state.setdefault("dailyLog", []).append({
        "day": current_day,
        "type": "rfa_match_decision",
        "playerName": target_row.get("playerName"),
        "rightsTeamName": rights_team_name,
        "offeringTeamName": target_row.get("offeringTeamName"),
        "decision": final_decision,
        "signedWith": signed.get("signedWith"),
    })

    append_free_agency_full_action_log(
        league_data = updated,
        day_resolved = current_day,
        offer_day = None,
        signings = [signed],
        generated_offers = [],
        event_type = "rfa_match_decision",
    )

    return {
        "ok": True,
        "leagueData": updated,
        "processedDecision": {
            "playerKey": row_player_key,
            "playerId": target_row.get("playerId"),
            "playerName": target_row.get("playerName"),
            "rightsTeamName": rights_team_name,
            "offeringTeamName": target_row.get("offeringTeamName"),
            "decision": final_decision,
        },
        "processedSigning": signed,
        "processedSignings": [signed],
        "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
        "stateSummary": build_free_agency_state_summary(updated),
        "teamSnapshot": state.get("pendingUserTeamSnapshot"),
    }



def get_rights_decision_keys_for_player(player: Dict[str, Any]) -> set:
    keys = {get_cap_hold_player_key(player)}

    player_id = player.get("id")
    player_name = player.get("name")

    if player_id not in [None, ""]:
        keys.add(str(player_id))
    if player_name not in [None, ""]:
        keys.add(str(player_name))

    return {str(key) for key in keys if key not in [None, ""]}


def filter_rights_decisions_excluding_player(
    rights_decisions: Optional[Dict[str, Any]],
    protected_player: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not isinstance(rights_decisions, dict):
        return {}

    protected_keys = get_rights_decision_keys_for_player(protected_player or {}) if protected_player else set()

    out = {}
    for key, value in rights_decisions.items():
        key_text = str(key)
        if key_text in protected_keys:
            continue
        out[key_text] = value

    return out


def apply_user_rights_clearance_plan(
    league_data: Dict[str, Any],
    team_name: Optional[str],
    rights_decisions: Optional[Dict[str, Any]],
    protected_player: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not team_name:
        return {
            "ok": False,
            "reason": "No user team was available for cap-hold clearance.",
            "leagueData": league_data,
            "decisionLog": [],
            "capHoldCleared": 0,
        }

    safe_decisions = filter_rights_decisions_excluding_player(
        rights_decisions = rights_decisions,
        protected_player = protected_player,
    )

    if not safe_decisions:
        return {
            "ok": True,
            "leagueData": league_data,
            "decisionLog": [],
            "capHoldCleared": 0,
            "skipped": True,
        }

    result = apply_rights_management(
        league_data = league_data,
        team_name = team_name,
        rights_decisions = safe_decisions,
    )

    decision_log = result.get("decisionLog", []) if isinstance(result, dict) else []
    cap_hold_cleared = int(sum(
        int(num(row.get("capHoldCleared"), 0))
        for row in decision_log
        if row.get("decision") == "renounce"
    ))

    return {
        "ok": bool(result.get("ok")) if isinstance(result, dict) else False,
        "reason": result.get("reason") if isinstance(result, dict) else "Unable to apply rights clearance.",
        "leagueData": result.get("leagueData", league_data) if isinstance(result, dict) else league_data,
        "decisionLog": decision_log,
        "capHoldCleared": cap_hold_cleared,
        "teamSnapshot": result.get("teamSnapshot") if isinstance(result, dict) else None,
    }


def mark_pending_user_decision_delayed(
    league_data: Dict[str, Any],
    row: Dict[str, Any],
    user_team_name: Optional[str],
    current_day: int,
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    player_key = row.get("playerKey") or get_player_key(
        row.get("playerId"),
        row.get("playerName"),
    )

    touched = []
    for offer in state.get("offersByPlayer", {}).get(player_key, []):
        if user_team_name and offer.get("teamName") != user_team_name:
            continue
        if offer.get("source") != "user":
            continue
        if offer.get("status", "active") != "active":
            continue

        old_count = int(num(offer.get("userDecisionDelayCount"), 0))
        offer["userDecisionDelayCount"] = old_count + 1
        offer["lastUserDecisionDelayDay"] = current_day
        offer["userDelayedDecision"] = True
        offer["playerViewScorePenalty"] = min(0.35, 0.16 * offer["userDecisionDelayCount"])
        touched.append(copy.deepcopy(offer))

    if touched:
        state.setdefault("dailyLog", []).append({
            "day": current_day,
            "type": "user_delayed_pending_signing",
            "playerKey": player_key,
            "playerName": row.get("playerName"),
            "teamName": user_team_name,
            "delayCount": max(int(num(offer.get("userDecisionDelayCount"), 0)) for offer in touched),
        })

    return {
        "playerKey": player_key,
        "playerName": row.get("playerName"),
        "teamName": user_team_name,
        "delayedOffers": touched,
    }


def prepare_user_offer_for_conditional_finalization(
    league_data: Dict[str, Any],
    user_team_name: Optional[str],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    rights_decisions: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not user_team_name:
        return {
            "ok": False,
            "reason": "No user team was available for this pending signing.",
            "leagueData": league_data,
            "chosenOffer": chosen_offer,
            "player": player,
        }

    working = league_data
    player_key = get_player_key_from_player(player)
    normalized_offer = copy.deepcopy(chosen_offer)
    normalized_offer["teamName"] = user_team_name
    normalized_offer["contract"] = normalize_contract(normalized_offer.get("contract"))

    # Important RFA order of operations:
    # First check whether the original team matches the offer sheet. If the
    # original team matches, the user's cap-hold clearance plan must NOT fire,
    # because the user never completes the signing.
    matched_offer, would_be_matched = maybe_apply_rfa_match(
        league_data = working,
        player = player,
        chosen_offer = copy.deepcopy(normalized_offer),
    )

    if would_be_matched and matched_offer.get("teamName") != user_team_name:
        matched_offer["forceRfaMatch"] = True
        matched_offer["source"] = "rfa_match"
        matched_offer["originalOfferTeamName"] = normalized_offer.get("teamName")
        matched_offer["matchedOriginalTeamName"] = matched_offer.get("teamName")
        matched_offer["contract"] = normalize_contract(matched_offer.get("contract"))
        return {
            "ok": True,
            "leagueData": working,
            "chosenOffer": matched_offer,
            "player": player,
            "rfaMatchedBeforeUserClearance": True,
            "rightsClearanceApplied": False,
            "rightsDecisionLog": [],
            "capHoldCleared": 0,
        }

    snapshot = get_team_cap_snapshot(working, user_team_name)
    if not snapshot.get("ok"):
        return {
            "ok": False,
            "reason": snapshot.get("reason", "Unable to read user team cap snapshot."),
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": player,
        }

    spending_check = validate_offer_spending_rules(
        league_data = working,
        team_name = user_team_name,
        player = player,
        contract = normalized_offer.get("contract"),
        outstanding_current_salary = 0,
        snapshot = snapshot,
        allow_pending_cap_hold_clearance = True,
    )

    if not spending_check.get("ok"):
        return {
            "ok": False,
            "reason": spending_check.get("reason", "This offer is no longer legal."),
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": player,
            "spendingCheck": spending_check,
        }

    if not spending_check.get("pendingCapHoldClearance"):
        return {
            "ok": True,
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": player,
            "rightsClearanceApplied": False,
            "rightsDecisionLog": [],
            "capHoldCleared": 0,
            "spendingCheck": spending_check,
        }

    clearance_needed = int(num(spending_check.get("capHoldClearanceNeeded"), 0))
    clearance_result = apply_user_rights_clearance_plan(
        league_data = working,
        team_name = user_team_name,
        rights_decisions = rights_decisions,
        protected_player = player,
    )

    if not clearance_result.get("ok"):
        return {
            "ok": False,
            "reason": clearance_result.get("reason", "Unable to apply selected cap-hold clearance."),
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": player,
            "spendingCheck": spending_check,
        }

    working = clearance_result.get("leagueData", working)
    refreshed_free_agents = working.setdefault("freeAgents", [])
    refreshed_player_idx = find_free_agent_index(
        refreshed_free_agents,
        player.get("id"),
        player.get("name"),
    )

    if refreshed_player_idx == -1:
        return {
            "ok": False,
            "reason": f"{player.get('name', 'Player')} is no longer available after cap-hold clearance.",
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": player,
            "spendingCheck": spending_check,
        }

    refreshed_player = refreshed_free_agents[refreshed_player_idx]
    snapshot_after = get_team_cap_snapshot(working, user_team_name)
    final_check = validate_offer_spending_rules(
        league_data = working,
        team_name = user_team_name,
        player = refreshed_player,
        contract = normalized_offer.get("contract"),
        outstanding_current_salary = 0,
        snapshot = snapshot_after if snapshot_after.get("ok") else None,
        allow_pending_cap_hold_clearance = False,
    )

    if not final_check.get("ok"):
        cleared = int(num(clearance_result.get("capHoldCleared"), 0))
        return {
            "ok": False,
            "reason": (
                f"Selected cap-hold clearance was not enough for {player.get('name', 'this signing')}. "
                f"Needed about ${clearance_needed:,}; selected clearance removed ${cleared:,}. "
                f"{final_check.get('reason', '')}".strip()
            ),
            "leagueData": working,
            "chosenOffer": normalized_offer,
            "player": refreshed_player,
            "spendingCheck": spending_check,
            "finalCheck": final_check,
            "capHoldClearanceNeeded": clearance_needed,
            "capHoldCleared": cleared,
        }

    normalized_offer["manualRenouncedCapHolds"] = [
        row for row in clearance_result.get("decisionLog", [])
        if row.get("decision") == "renounce"
    ]
    normalized_offer["manualRenouncedCapHoldAmount"] = int(num(clearance_result.get("capHoldCleared"), 0))
    normalized_offer["capHoldClearanceNeeded"] = clearance_needed

    return {
        "ok": True,
        "leagueData": working,
        "chosenOffer": normalized_offer,
        "player": refreshed_player,
        "rightsClearanceApplied": True,
        "rightsDecisionLog": clearance_result.get("decisionLog", []),
        "capHoldCleared": int(num(clearance_result.get("capHoldCleared"), 0)),
        "spendingCheck": final_check,
    }


def process_pending_user_decisions(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    selected_player_keys: Optional[List[str]] = None,
    rights_decisions: Optional[Dict[str, Any]] = None,
    declined_player_keys: Optional[List[str]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    state = ensure_free_agency_state(updated)

    pending_rows = list(state.get("pendingUserDecisions", []))
    if not pending_rows:
        resume_after_immediate_rfa_match = bool(
            state.get("resumeAdvanceAfterImmediateRfaMatch")
            or state.get("forceViewingOffersReturnReason") == "immediate_rfa_match"
        )

        if resume_after_immediate_rfa_match and state.get("isActive"):
            if not user_team_name:
                user_team_name = state.get("pendingUserTeamName")

            current_day = int(num(
                state.get("resumeAdvanceAfterImmediateRfaMatchDay")
                or state.get("currentDay"),
                1,
            ))
            max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

            state["forceViewingOffersReturn"] = False
            state["forceViewingOffersReturnReason"] = None
            state["resumeAdvanceAfterImmediateRfaMatch"] = False
            state["resumeAdvanceAfterImmediateRfaMatchDay"] = None

            generated_offers = []
            processed_signings = []

            if current_day >= max_days or len(updated.get("freeAgents", [])) == 0:
                final_cleanup_target = get_min_roster_target(updated)

                final_cleanup_signings = finalize_cpu_min_roster_cleanup(
                    league_data = updated,
                    current_day = current_day,
                    user_team_name = user_team_name,
                    min_roster_target_override = final_cleanup_target,
                )

                if final_cleanup_signings:
                    processed_signings.extend(final_cleanup_signings)
                    state["dailyLog"].append({
                        "day": current_day,
                        "type": "cpu_final_min_roster_cleanup",
                        "signings": len(final_cleanup_signings),
                        "targetRosterSize": final_cleanup_target,
                    })

                state["isActive"] = False
                state["pendingUserTeamSnapshot"] = None

                append_free_agency_full_action_log(
                    league_data = updated,
                    day_resolved = current_day,
                    offer_day = None,
                    signings = processed_signings,
                    generated_offers = generated_offers,
                    event_type = "user_rfa_match_resume_close",
                )
            else:
                state["currentDay"] = current_day + 1

                generated_offers = generate_cpu_offers_for_day(
                    league_data = updated,
                    user_team_name = user_team_name,
                )

                state["dailyLog"].append({
                    "day": state["currentDay"],
                    "type": "offer_generation",
                    "offersGenerated": len(generated_offers),
                })

                state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, user_team_name) if user_team_name else None

                append_free_agency_full_action_log(
                    league_data = updated,
                    day_resolved = current_day,
                    offer_day = state.get("currentDay"),
                    signings = processed_signings,
                    generated_offers = generated_offers,
                    event_type = "user_rfa_match_resume_advance",
                )

            return {
                "ok": True,
                "leagueData": updated,
                "processedSignings": processed_signings,
                "generatedOffers": generated_offers,
                "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
                "resumedAfterImmediateRfaMatch": True,
            }

        state["forceViewingOffersReturn"] = False
        state["forceViewingOffersReturnReason"] = None
        state["resumeAdvanceAfterImmediateRfaMatch"] = False
        state["resumeAdvanceAfterImmediateRfaMatchDay"] = None

        return {
            "ok": True,
            "leagueData": updated,
            "processedSignings": [],
            "generatedOffers": [],
            "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(updated),
            "teamSnapshot": state.get("pendingUserTeamSnapshot"),
        }

    if not user_team_name:
        user_team_name = state.get("pendingUserTeamName")

    # Refresh the pending dashboard snapshot from the current leagueData. This
    # keeps the confirmation screen/backend aligned after the user leaves to
    # release players or otherwise edit the roster before finalizing signings.
    if user_team_name:
        refreshed_snapshot = get_team_cap_snapshot(updated, user_team_name)
        state["pendingUserTeamSnapshot"] = refreshed_snapshot if refreshed_snapshot.get("ok") else None

    selected_set = {str(x) for x in (selected_player_keys or [])}
    declined_set = {str(x) for x in (declined_player_keys or [])}
    rights_decisions = rights_decisions or {}

    preview = copy.deepcopy(updated)
    preview_state = ensure_free_agency_state(preview)
    current_day = int(num(preview_state.get("currentDay"), 1))
    max_days = int(num(preview_state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

    processed_signings = []
    delayed_decisions = []
    declined_decisions = []
    remaining_pending_rows = []
    non_selected_pending_rows = []
    rights_clearance_logs = []

    def build_user_chosen_offer_from_pending_row(row: Dict[str, Any], player_key: str) -> Dict[str, Any]:
        chosen_offer = copy.deepcopy(row.get("chosenOffer") or {})

        if not chosen_offer:
            contract = normalize_contract(row.get("contract"))
            total_value = int(num(row.get("totalValue"), 0))
            years = int(num(row.get("years"), 1))
            chosen_offer = {
                "offerId": f"{player_key}|{user_team_name}",
                "playerId": row.get("playerId"),
                "playerName": row.get("playerName"),
                "playerKey": player_key,
                "teamName": user_team_name,
                "source": "user",
                "submittedDay": current_day,
                "status": "active",
                "contract": contract,
                "salaryByYear": list(contract.get("salaryByYear", [])) if contract else [],
                "currentYearSalary": int((contract.get("salaryByYear") or [0])[0]) if contract else 0,
                "years": years,
                "totalValue": total_value,
                "aav": int(total_value / max(1, years)),
            }

        chosen_offer["teamName"] = user_team_name
        chosen_offer["contract"] = normalize_contract(
            chosen_offer.get("contract") or row.get("contract")
        )
        return chosen_offer

    def mark_user_offer_declined(row: Dict[str, Any], player_key: str) -> Dict[str, Any]:
        touched = []
        for offer in preview_state.get("offersByPlayer", {}).get(player_key, []):
            if user_team_name and offer.get("teamName") != user_team_name:
                continue
            if offer.get("source") != "user":
                continue
            if offer.get("status", "active") != "active":
                continue
            offer["status"] = "declined_by_user"
            offer["userDeclinedDecisionDay"] = current_day
            touched.append(copy.deepcopy(offer))

        preview_state.setdefault("dailyLog", []).append({
            "day": current_day,
            "type": "user_declined_pending_signing",
            "playerKey": player_key,
            "playerName": row.get("playerName"),
            "teamName": user_team_name,
        })

        return {
            "playerKey": player_key,
            "playerName": row.get("playerName"),
            "teamName": user_team_name,
            "declinedOffers": touched,
        }

    # If any selected outside RFA offer sheet is matched, treat that match as
    # an interruption before committing the rest of the user's selected batch.
    # Only the matched RFA is removed. Every other pending signing and cap-hold
    # choice stays available so the user can rethink the screen.
    for row in pending_rows:
        player_key = row.get("playerKey") or get_player_key(
            row.get("playerId"),
            row.get("playerName"),
        )

        if player_key not in selected_set or player_key in declined_set:
            continue

        free_agents = preview.setdefault("freeAgents", [])
        player_idx = find_free_agent_index(
            free_agents,
            row.get("playerId"),
            row.get("playerName"),
        )
        if player_idx == -1:
            continue

        player = free_agents[player_idx]
        rights = get_player_rights(player)
        rights_team_name = rights.get("heldByTeam")
        if not rights.get("restrictedFreeAgent") or not rights_team_name or rights_team_name == user_team_name:
            continue

        chosen_offer = build_user_chosen_offer_from_pending_row(row, player_key)
        matched_offer, would_be_matched = maybe_apply_rfa_match(
            league_data = preview,
            player = player,
            chosen_offer = copy.deepcopy(chosen_offer),
        )

        if not would_be_matched or matched_offer.get("teamName") == user_team_name:
            continue

        matched_offer["forceRfaMatch"] = True
        matched_offer["source"] = "rfa_match"
        matched_offer["originalOfferTeamName"] = chosen_offer.get("teamName")
        matched_offer["matchedOriginalTeamName"] = matched_offer.get("teamName")
        matched_offer["contract"] = normalize_contract(matched_offer.get("contract"))

        signed = finalize_free_agent_signing_from_offer(
            league_data = preview,
            player = player,
            chosen_offer = matched_offer,
            current_day = current_day,
        )
        if not signed:
            return {
                "ok": False,
                "reason": f"Unable to process the matched RFA offer for {row.get('playerName', 'player')}.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
            }

        signed_with = signed.get("signedWith") or signed.get("teamName")
        if not (
            signed.get("rfaMatched")
            and signed.get("originalOfferTeamName") == user_team_name
            and signed_with != user_team_name
        ):
            continue

        processed_signings.append(signed)
        preview_state = ensure_free_agency_state(preview)
        remaining_after_match = [
            copy.deepcopy(pending_row)
            for pending_row in pending_rows
            if (
                pending_row.get("playerKey")
                or get_player_key(pending_row.get("playerId"), pending_row.get("playerName"))
            ) != player_key
        ]
        preview_state["pendingUserDecisions"] = remaining_after_match
        preview_state["pendingUserTeamName"] = user_team_name

        snapshot = get_team_cap_snapshot(preview, user_team_name) if user_team_name else None
        preview_state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

        preview_state["forceViewingOffersReturn"] = True
        preview_state["forceViewingOffersReturnReason"] = "immediate_rfa_match"
        preview_state["resumeAdvanceAfterImmediateRfaMatch"] = True
        preview_state["resumeAdvanceAfterImmediateRfaMatchDay"] = current_day

        preview_state.setdefault("dailyLog", []).append({
            "day": current_day,
            "type": "user_rfa_match_batch_interrupted",
            "playerName": signed.get("playerName"),
            "matchedByTeamName": signed_with,
            "originalOfferTeamName": signed.get("originalOfferTeamName"),
            "remainingPendingUserDecisions": len(remaining_after_match),
        })

        append_free_agency_full_action_log(
            league_data = preview,
            day_resolved = current_day,
            offer_day = None,
            signings = processed_signings,
            generated_offers = [],
            event_type = "user_rfa_match_batch_interrupted",
        )

        return {
            "ok": True,
            "leagueData": preview,
            "processedSignings": processed_signings,
            "generatedOffers": [],
            "delayedUserDecisions": [],
            "declinedUserDecisions": [],
            "manualRightsClearanceLog": [],
            "pendingRfaMatchDecisions": preview_state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(preview),
            "teamSnapshot": preview_state.get("pendingUserTeamSnapshot"),
            "immediateRfaMatch": True,
            "batchInterruptedByImmediateRfaMatch": True,
        }

    for row_index, row in enumerate(pending_rows):
        player_key = row.get("playerKey") or get_player_key(
            row.get("playerId"),
            row.get("playerName"),
        )

        if player_key in declined_set:
            declined_decisions.append(mark_user_offer_declined(row, player_key))
            continue

        if player_key not in selected_set:
            # Non-selected rows are not silent declines. Defer the delay/hold
            # handling until selected rows are resolved, so an immediate RFA
            # match can leave the user on the same decision screen cleanly.
            non_selected_pending_rows.append(copy.deepcopy(row))
            continue

        free_agents = preview.setdefault("freeAgents", [])
        player_idx = find_free_agent_index(
            free_agents,
            row.get("playerId"),
            row.get("playerName"),
        )
        if player_idx == -1:
            return {
                "ok": False,
                "reason": f"{row.get('playerName', 'Player')} is no longer available.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
            }

        player = free_agents[player_idx]
        chosen_offer = build_user_chosen_offer_from_pending_row(row, player_key)

        prepared = prepare_user_offer_for_conditional_finalization(
            league_data = preview,
            user_team_name = user_team_name,
            player = player,
            chosen_offer = chosen_offer,
            rights_decisions = rights_decisions,
        )

        if not prepared.get("ok"):
            return {
                "ok": False,
                "reason": prepared.get("reason") or f"Unable to prepare {row.get('playerName', 'player')} for signing.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
                "spendingCheck": prepared.get("spendingCheck"),
                "finalCheck": prepared.get("finalCheck"),
                "capHoldClearanceNeeded": prepared.get("capHoldClearanceNeeded"),
                "capHoldCleared": prepared.get("capHoldCleared"),
            }

        preview = prepared.get("leagueData", preview)
        preview_state = ensure_free_agency_state(preview)
        player = prepared.get("player", player)
        chosen_offer = prepared.get("chosenOffer", chosen_offer)

        if prepared.get("rightsClearanceApplied"):
            rights_clearance_logs.append({
                "playerKey": player_key,
                "playerName": row.get("playerName"),
                "capHoldCleared": prepared.get("capHoldCleared", 0),
                "decisionLog": prepared.get("rightsDecisionLog", []),
            })

        signed = finalize_free_agent_signing_from_offer(
            league_data = preview,
            player = player,
            chosen_offer = chosen_offer,
            current_day = current_day,
        )
        if not signed:
            return {
                "ok": False,
                "reason": f"Unable to sign {row.get('playerName', 'player')} with the current cap / roster situation.",
                "leagueData": updated,
                "blockedPlayerKey": player_key,
                "stateSummary": build_free_agency_state_summary(updated),
                "teamSnapshot": state.get("pendingUserTeamSnapshot"),
            }

        processed_signings.append(signed)

        signed_with = signed.get("signedWith") or signed.get("teamName")
        if (
            signed.get("rfaMatched")
            and user_team_name
            and signed.get("originalOfferTeamName") == user_team_name
            and signed_with != user_team_name
        ):
            preview_state = ensure_free_agency_state(preview)
            remaining_after_match = non_selected_pending_rows + [
                copy.deepcopy(future_row)
                for future_row in pending_rows[row_index + 1:]
            ]
            preview_state["pendingUserDecisions"] = remaining_after_match
            preview_state["pendingUserTeamName"] = user_team_name

            snapshot = get_team_cap_snapshot(preview, user_team_name) if user_team_name else None
            preview_state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

            if declined_decisions:
                preview_state.setdefault("declinedUserDecisionLog", []).extend(copy.deepcopy(declined_decisions))
            if rights_clearance_logs:
                preview_state.setdefault("manualRightsClearanceLog", []).extend(copy.deepcopy(rights_clearance_logs))

            preview_state["forceViewingOffersReturn"] = True
            preview_state["forceViewingOffersReturnReason"] = "immediate_rfa_match"
            preview_state["resumeAdvanceAfterImmediateRfaMatch"] = True
            preview_state["resumeAdvanceAfterImmediateRfaMatchDay"] = current_day

            preview_state.setdefault("dailyLog", []).append({
                "day": current_day,
                "type": "user_rfa_match_immediate_return",
                "playerName": signed.get("playerName"),
                "matchedByTeamName": signed_with,
                "originalOfferTeamName": signed.get("originalOfferTeamName"),
                "remainingPendingUserDecisions": len(remaining_after_match),
            })

            append_free_agency_full_action_log(
                league_data = preview,
                day_resolved = current_day,
                offer_day = None,
                signings = processed_signings,
                generated_offers = [],
                event_type = "user_rfa_match_immediate_return",
            )

            return {
                "ok": True,
                "leagueData": preview,
                "processedSignings": processed_signings,
                "generatedOffers": [],
                "delayedUserDecisions": [],
                "declinedUserDecisions": declined_decisions,
                "manualRightsClearanceLog": rights_clearance_logs,
                "pendingRfaMatchDecisions": preview_state.get("pendingRfaMatchDecisions", []),
                "stateSummary": build_free_agency_state_summary(preview),
                "teamSnapshot": preview_state.get("pendingUserTeamSnapshot"),
                "immediateRfaMatch": True,
            }

    if non_selected_pending_rows:
        for pending_row in non_selected_pending_rows:
            # Non-selected rows are not silent declines. Before the final market
            # close, keep the offer live with a delay penalty. On the final day,
            # keep the decision pending and block the close so a ready-to-sign
            # player cannot disappear into free agency by accident.
            if current_day >= max_days:
                remaining_pending_rows.append(copy.deepcopy(pending_row))
                continue

            delayed_decisions.append(
                mark_pending_user_decision_delayed(
                    league_data = preview,
                    row = pending_row,
                    user_team_name = user_team_name,
                    current_day = current_day,
                )
            )

    preview_state = ensure_free_agency_state(preview)
    preview_state["pendingUserTeamName"] = user_team_name

    if remaining_pending_rows:
        preview_state["pendingUserDecisions"] = remaining_pending_rows
        snapshot = get_team_cap_snapshot(preview, user_team_name) if user_team_name else None
        preview_state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

        if delayed_decisions:
            preview_state.setdefault("delayedUserDecisionLog", []).extend(copy.deepcopy(delayed_decisions))
        if declined_decisions:
            preview_state.setdefault("declinedUserDecisionLog", []).extend(copy.deepcopy(declined_decisions))
        if rights_clearance_logs:
            preview_state.setdefault("manualRightsClearanceLog", []).extend(copy.deepcopy(rights_clearance_logs))

        names = ", ".join(str(row.get("playerName") or "player") for row in remaining_pending_rows[:3])
        more = len(remaining_pending_rows) - 3
        if more > 0:
            names += f" and {more} more"

        return {
            "ok": False,
            "reason": f"Final free agency day: resolve pending signing decisions before closing the market ({names}). Select the player to sign him, or use an explicit decline path if you add one later.",
            "leagueData": preview,
            "processedSignings": processed_signings,
            "generatedOffers": [],
            "delayedUserDecisions": delayed_decisions,
            "declinedUserDecisions": declined_decisions,
            "manualRightsClearanceLog": rights_clearance_logs,
            "pendingRfaMatchDecisions": preview_state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(preview),
            "teamSnapshot": preview_state.get("pendingUserTeamSnapshot"),
        }

    clear_pending_user_decisions(preview_state)
    preview_state["pendingUserTeamName"] = user_team_name
    preview_state["forceViewingOffersReturn"] = False
    preview_state["forceViewingOffersReturnReason"] = None
    preview_state["resumeAdvanceAfterImmediateRfaMatch"] = False
    preview_state["resumeAdvanceAfterImmediateRfaMatchDay"] = None

    if delayed_decisions:
        preview_state.setdefault("delayedUserDecisionLog", []).extend(copy.deepcopy(delayed_decisions))

    if declined_decisions:
        preview_state.setdefault("declinedUserDecisionLog", []).extend(copy.deepcopy(declined_decisions))

    if rights_clearance_logs:
        preview_state.setdefault("manualRightsClearanceLog", []).extend(copy.deepcopy(rights_clearance_logs))

    generated_offers = []

    if current_day >= max_days or len(preview.get("freeAgents", [])) == 0:
        final_cleanup_target = get_min_roster_target(preview)

        final_cleanup_signings = finalize_cpu_min_roster_cleanup(
            league_data = preview,
            current_day = current_day,
            user_team_name = user_team_name,
            min_roster_target_override = final_cleanup_target,
        )

        if final_cleanup_signings:
            processed_signings.extend(final_cleanup_signings)
            preview_state["dailyLog"].append({
                "day": current_day,
                "type": "cpu_final_min_roster_cleanup",
                "signings": len(final_cleanup_signings),
                "targetRosterSize": final_cleanup_target,
            })

        preview_state["isActive"] = False
        preview_state["pendingUserTeamSnapshot"] = None
    else:
        preview_state["currentDay"] = current_day + 1

        generated_offers = generate_cpu_offers_for_day(
            league_data = preview,
            user_team_name = user_team_name,
        )

        preview_state["dailyLog"].append({
            "day": preview_state["currentDay"],
            "type": "offer_generation",
            "offersGenerated": len(generated_offers),
        })

        snapshot = get_team_cap_snapshot(preview, user_team_name) if user_team_name else None
        preview_state["pendingUserTeamSnapshot"] = snapshot if snapshot and snapshot.get("ok") else None

    append_free_agency_full_action_log(
        league_data = preview,
        day_resolved = current_day,
        offer_day = preview_state.get("currentDay") if generated_offers else None,
        signings = processed_signings,
        generated_offers = generated_offers,
        event_type = "user_decision_update",
    )

    return {
        "ok": True,
        "leagueData": preview,
        "processedSignings": processed_signings,
        "generatedOffers": generated_offers,
        "delayedUserDecisions": delayed_decisions,
        "declinedUserDecisions": declined_decisions,
        "manualRightsClearanceLog": rights_clearance_logs,
        "pendingRfaMatchDecisions": preview_state.get("pendingRfaMatchDecisions", []),
        "stateSummary": build_free_agency_state_summary(preview),
        "teamSnapshot": preview_state.get("pendingUserTeamSnapshot"),
    }

def get_contract_option_player_score_adjustment(contract: Optional[Dict[str, Any]]) -> float:
    contract = normalize_contract(contract)
    if not contract or not contract.get("option"):
        return 0.0

    option = contract.get("option") or {}
    option_type = option.get("type")
    years = len(contract.get("salaryByYear", []))

    # Options should be a small preference nudge, not a major driver.
    # Money and years should decide most of the player's interest.
    if years <= 1:
        return 0.0
    if option_type == "player":
        return 0.040
    if option_type == "team":
        return -0.050
    return 0.0


def get_option_required_aav_multiplier(contract: Optional[Dict[str, Any]]) -> float:
    contract = normalize_contract(contract)
    if not contract or not contract.get("option"):
        return 1.0

    option = contract.get("option") or {}
    option_type = option.get("type")
    years = len(contract.get("salaryByYear", []))

    # Keep option impact light. A player option helps, a team option hurts,
    # but neither should turn a fair-market offer into an automatic yes/no.
    if years <= 1:
        return 1.0
    if option_type == "player":
        return 0.985
    if option_type == "team":
        return 1.020
    return 1.0


def build_offer_record(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    contract: Dict[str, Any],
    source: str,
    current_day: int
) -> Dict[str, Any]:
    salary_by_year = list(contract.get("salaryByYear", []))
    total_value = int(sum(salary_by_year))
    years = len(salary_by_year)
    aav = int(total_value / max(1, years))

    player_key = get_player_key_from_player(player)

    return {
        "offerId": f"{player_key}|{team_name}",
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "playerKey": player_key,
        "teamName": team_name,
        "source": source,
        "submittedDay": current_day,
        "status": "active",
        "contract": normalize_contract(contract),
        "salaryByYear": salary_by_year,
        "currentYearSalary": int(salary_by_year[0]) if salary_by_year else 0,
        "years": years,
        "totalValue": total_value,
        "aav": aav,
    }


def evaluate_market_offer_submission(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    contract: Dict[str, Any],
    exclude_offer_id: Optional[str] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    state: Optional[Dict[str, Any]] = None,
    active_offer_count: Optional[int] = None,
    active_offer_limit: Optional[int] = None
) -> Dict[str, Any]:
    normalize_player_rights_for_location(player, None)

    snapshot = snapshot or get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    state = state or ensure_free_agency_state(league_data)

    # Live offers should not reserve roster slots or cap dollars like completed
    # signings. The actual cap and roster legality is enforced when the user
    # accepts pending signings on ViewingOffers.
    outstanding_current_salary = 0

    if active_offer_count is None:
        active_offer_count = get_active_offer_count_for_team(state, team_name)
    else:
        active_offer_count = int(num(active_offer_count, 0))

    existing_offer = exclude_offer_id is not None
    effective_offer_count = active_offer_count if existing_offer else active_offer_count + 1

    if active_offer_limit is None:
        active_offer_limit = get_active_offer_limit_for_team(
            league_data = league_data,
            team_name = team_name,
            state = state,
            snapshot = snapshot,
        )
    else:
        active_offer_limit = int(num(active_offer_limit, MAX_ACTIVE_OFFERS_PER_TEAM))

    if effective_offer_count > active_offer_limit:
        return {
            "ok": False,
            "reason": f"{team_name} already has {active_offer_count} live offers. Resolve or replace one before adding more.",
            "teamSnapshot": snapshot,
        }

    spending_res = validate_offer_spending_rules(
        league_data = league_data,
        team_name = team_name,
        player = player,
        contract = contract,
        outstanding_current_salary = outstanding_current_salary,
        snapshot = snapshot,
    )
    if not spending_res.get("ok"):
        return spending_res

    market_value = player.get("marketValue") or estimate_market_value(player)
    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))
    expected_years = get_realistic_expected_contract_years(player)
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    salary_ratio = offered_aav / max(1, expected_aav)
    year_penalty = abs(offered_years - expected_years) * 0.06
    option_adjustment = get_contract_option_player_score_adjustment(contract)
    acceptance_score = salary_ratio - year_penalty + option_adjustment

    if is_rights_team(player, team_name):
        acceptance_score += 0.04

    return {
        "ok": True,
        "reason": spending_res.get("reason", "Offer can be submitted to the live market."),
        "teamSnapshot": snapshot,
        "contract": contract,
        "marketValue": market_value,
        "exceptionRoom": spending_res.get("exceptionRoom"),
        "spendingType": spending_res.get("spendingType"),
        "exceptionType": spending_res.get("exceptionType"),
        "exceptionRemaining": spending_res.get("exceptionRemaining"),
        "birdRights": spending_res.get("birdRights"),
        "payrollZone": spending_res.get("payrollZone"),
        "pendingCapHoldClearance": spending_res.get("pendingCapHoldClearance", False),
        "capHoldClearanceNeeded": spending_res.get("capHoldClearanceNeeded", 0),
        "rawCapRoomWithoutHolds": spending_res.get("rawCapRoomWithoutHolds"),
        "rawPayrollWithoutHolds": spending_res.get("rawPayrollWithoutHolds"),
        "capHoldTotal": spending_res.get("capHoldTotal"),
        "details": {
            "offeredYears": offered_years,
            "offeredAAV": offered_aav,
            "expectedYears": expected_years,
            "expectedAAV": expected_aav,
            "minAcceptableAAV": min_acceptable_aav,
            "optionAdjustment": round(option_adjustment, 3),
            "acceptanceScore": round(acceptance_score, 3),
        },
    }


def score_offer_for_player_with_fit(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    offer: Dict[str, Any],
    team_profile: Optional[Dict[str, Any]] = None,
    fit: Optional[Dict[str, Any]] = None,
) -> float:
    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(max(MIN_DEAL, num(market_value.get("expectedAAV"), MIN_DEAL)))
    expected_years = get_realistic_expected_contract_years(player)

    offered_aav = int(num(offer.get("aav"), 0))
    offered_years = int(num(offer.get("years"), 1))
    team_name = offer.get("teamName")

    contract = normalize_contract(offer.get("contract"))
    if not contract:
        contract = normalize_contract({
            "startYear": get_operating_season_year(league_data),
            "salaryByYear": list(offer.get("salaryByYear", [])) or [offered_aav],
            "option": None,
        })

    salary_ratio = offered_aav / max(1.0, float(expected_aav))
    score = get_offer_money_interest_score(salary_ratio)

    _, _, team = find_team_entry(league_data, team_name)
    if team_profile is not None:
        direction = team_profile.get("direction", "balanced")
    else:
        direction = classify_team_direction(team, league_data = league_data)["direction"] if team else "balanced"

    age = int(num(player.get("age"), 27))
    overall = num(player.get("overall"), 75)
    potential = num(player.get("potential"), overall)
    previous_team = (
        player.get("freeAgencyMeta", {}).get("fromTeam")
        if isinstance(player.get("freeAgencyMeta"), dict)
        else None
    )

    # Years/security matter, but less than money.
    if offered_years == expected_years:
        score += 0.015
    else:
        score -= min(0.080, abs(offered_years - expected_years) * 0.025)
        if age >= 33 and offered_years > expected_years:
            score -= 0.020
        if age <= 26 and offered_years >= expected_years:
            score += 0.015

    score += get_contract_option_player_score_adjustment(contract)

    # No default old-team / Bird-rights player-interest bonus.
    # Returning to the old team only helps if that team was a strong situation.
    if team_name and (
        (previous_team and previous_team == team_name)
        or is_rights_team(player, team_name)
    ):
        score += get_return_team_interest_bonus(
            league_data = league_data,
            team_name = team_name,
            player = player,
            rights_bonus = bool(get_player_rights(player).get("restrictedFreeAgent") and is_rights_team(player, team_name)),
        )

    # Team quality/direction is the second major factor after contract quality.
    score += get_team_quality_player_interest_adjustment(
        league_data = league_data,
        team_name = team_name,
        player = player,
        direction = direction,
    )

    if age >= 30 and direction in ["contending", "win now"]:
        score += 0.018
    if age <= 25 and direction in ["rebuilding", "retooling"]:
        score += 0.018
    if potential - overall >= 2 and direction in ["rebuilding", "retooling"]:
        score += 0.012

    if team:
        if fit is None:
            if team_profile is not None:
                fit = estimate_team_free_agent_fit_from_profile(
                    team = team,
                    player = player,
                    profile = team_profile,
                )
            else:
                fit = estimate_team_free_agent_fit(team, player, league_data = league_data)
        need_score = float(num(fit.get("needScore"), 0.0))
        score += need_score * 0.038
        if fit.get("positionBucket") in (fit.get("weakestPositions", []) or [])[:1]:
            score += 0.016
        elif fit.get("positionBucket") in (fit.get("weakestPositions", []) or [])[:2]:
            score += 0.009

    if age >= 35 and offered_years >= 3:
        score -= 0.050
    elif age >= 33 and offered_years >= 3 and overall < 84:
        score -= 0.035

    delay_count = int(num(offer.get("userDecisionDelayCount"), 0))
    if delay_count > 0:
        score -= min(0.35, 0.16 * delay_count)

    explicit_penalty = num(offer.get("playerViewScorePenalty"), 0)
    if explicit_penalty > 0:
        score -= min(0.35, explicit_penalty)

    return round(clamp(score, 0.02, 1.05), 3)


def score_offer_for_player(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    offer: Dict[str, Any]
) -> float:
    return score_offer_for_player_with_fit(
        league_data = league_data,
        player = player,
        offer = offer,
        team_profile = None,
        fit = None,
    )


def build_free_agency_state_summary(league_data: Dict[str, Any]) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    active_offer_count = 0
    active_offer_salary_by_team = {}

    for offers in state.get("offersByPlayer", {}).values():
        for offer in offers:
            if offer.get("status", "active") == "active":
                active_offer_count += 1
                team_name = offer.get("teamName")
                if team_name:
                    active_offer_salary_by_team[team_name] = active_offer_salary_by_team.get(team_name, 0) + int(num(offer.get("currentYearSalary"), 0))

    return {
        "isActive": bool(state.get("isActive")),
        "currentDay": int(num(state.get("currentDay"), 0)),
        "maxDays": int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS)),
        "freeAgentCount": len(league_data.get("freeAgents", [])),
        "activeOfferCount": active_offer_count,
        "activeOfferSalaryByTeam": active_offer_salary_by_team,
        "signedCount": len(state.get("signedPlayersLog", [])),
        "pendingUserDecisionCount": len(state.get("pendingUserDecisions", [])),
        "pendingRfaMatchDecisionCount": len(state.get("pendingRfaMatchDecisions", [])),
        "exceptionUsageByTeam": copy.deepcopy(state.get("exceptionUsageByTeam", {})),
        "rightsRenounceLog": copy.deepcopy(state.get("rightsRenounceLog", [])),
        "blockedCapHoldRenounceLog": copy.deepcopy(state.get("blockedCapHoldRenounceLog", [])),
        "rightsRenouncedCount": len(state.get("rightsRenounceLog", [])),
        "blockedCapHoldRenounceCount": len(state.get("blockedCapHoldRenounceLog", [])),
    }


def get_cpu_serious_offer_floor_ratio(
    player: Dict[str, Any],
    current_day: int,
    max_days: int,
    incumbent_priority: bool = False,
) -> float:
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)
    max_days = max(1, int(num(max_days, DEFAULT_FREE_AGENCY_DAYS)))
    day_progress = clamp((current_day - 1) / max(1.0, float(max_days - 1)), 0.0, 1.0)

    if overall >= 90:
        floor = 0.93 - (0.08 * day_progress)
    elif overall >= 87:
        floor = 0.89 - (0.08 * day_progress)
    elif overall >= 84:
        floor = 0.84 - (0.07 * day_progress)
    elif overall >= 81:
        floor = 0.80 - (0.07 * day_progress)
    elif overall >= 78:
        floor = 0.68 - (0.08 * day_progress)
    elif overall >= 75:
        floor = 0.54 - (0.10 * day_progress)
    else:
        floor = 0.40 - (0.06 * day_progress)

    if age <= 25 and upside >= 3 and overall >= 77:
        floor += 0.025
    if age >= 32 and overall <= 80:
        floor -= 0.040
    if incumbent_priority:
        floor -= 0.020

    # Surgical floor: if a team wants to bid on a real starter/star, the offer
    # should be a reasonable market offer, not a fake lowball.
    if overall >= 87:
        floor = max(0.85, floor)
    elif overall >= 84:
        floor = max(0.84, floor)
    elif overall >= 80:
        floor = max(0.80, floor)
    elif overall >= 78:
        floor = max(0.66, floor)
    else:
        floor = max(0.34, floor)

    return round(clamp(floor, 0.34, 0.96), 3)


def is_cpu_serious_offer_for_player(
    player: Dict[str, Any],
    contract: Dict[str, Any],
    current_day: int,
    max_days: int,
    incumbent_priority: bool = False,
    target_tier: str = "value",
) -> bool:
    contract = normalize_contract(contract)
    if not contract:
        return False

    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))
    min_acceptable_aav = int(num(market_value.get("minAcceptableAAV"), MIN_DEAL))
    salary_by_year = contract.get("salaryByYear", [])
    offered_years = len(salary_by_year)
    offered_aav = int(sum(salary_by_year) / max(1, offered_years))
    overall = int(round(num(player.get("overall"), 0)))

    # Minimum offers are serious only for true depth/fringe players. This blocks
    # apron teams from fake-bidding on star or starter-level free agents.
    if offered_aav <= int(MIN_DEAL * 1.25):
        if expected_aav > int(MIN_DEAL * 1.55) and overall >= 75:
            return False
        if current_day <= 2 and target_tier != "depth" and not incumbent_priority:
            return False
        return True

    floor_ratio = get_cpu_serious_offer_floor_ratio(
        player = player,
        current_day = current_day,
        max_days = max_days,
        incumbent_priority = incumbent_priority,
    )
    serious_floor = max(MIN_DEAL, int(expected_aav * floor_ratio))

    if overall >= 84:
        serious_floor = max(serious_floor, int(min_acceptable_aav * 0.90))
    elif overall >= 78:
        serious_floor = max(serious_floor, int(min_acceptable_aav * 0.82))

    return offered_aav >= serious_floor


def get_cpu_rights_hold_value_score(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
) -> Dict[str, Any]:
    rights = get_player_rights(player)
    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))
    cap_hold = int(get_player_cap_hold_amount(
        league_data = league_data,
        player = player,
        team_name = team_name,
    ))

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)

    fit = estimate_team_free_agent_fit(team, player, league_data = league_data)
    direction = fit.get("teamDirection") or classify_team_direction(team, league_data = league_data).get("direction", "balanced")
    need_score = float(num(fit.get("needScore"), 0.0))

    hold_to_market = cap_hold / max(1.0, float(expected_aav))
    score = 0.28
    score += max(0.0, (overall - 74.0) * 0.045)
    score += max(0.0, upside * 0.045)
    score += need_score * 0.18

    if rights.get("restrictedFreeAgent"):
        score += 0.32
    if rights.get("rookieScale"):
        score += 0.18
    if rights.get("birdLevel") == "bird":
        score += 0.12
    elif rights.get("birdLevel") == "early_bird":
        score += 0.08
    elif rights.get("birdLevel") == "non_bird":
        score += 0.03

    if direction in ["contending", "win now"]:
        if overall >= 79:
            score += 0.12
        if age >= 29 and overall >= 77:
            score += 0.06
        if age <= 24 and overall <= 74:
            score -= 0.04
    elif direction == "rebuilding":
        if age <= 26:
            score += 0.12
        if upside >= 3:
            score += 0.10
        if age >= 30 and overall <= 79:
            score -= 0.18
    elif direction == "retooling":
        if age <= 28:
            score += 0.08
        if upside >= 2:
            score += 0.07

    if expected_aav >= cap_hold:
        score += 0.18
    elif hold_to_market >= 3.00:
        score -= 0.78
    elif hold_to_market >= 2.25:
        score -= 0.56
    elif hold_to_market >= 1.70:
        score -= 0.36
    elif hold_to_market >= 1.35:
        score -= 0.18

    high_hold_role_player = bool(
        cap_hold >= 12_000_000
        and expected_aav <= cap_hold * 0.70
        and overall <= 79
        and not rights.get("restrictedFreeAgent")
    )
    if high_hold_role_player:
        score -= 0.35
    if cap_hold >= 20_000_000 and expected_aav <= 12_000_000 and overall <= 80:
        score -= 0.28
    if overall <= 74 and age >= 28 and cap_hold >= 5_000_000:
        score -= 0.18

    if rights.get("restrictedFreeAgent") and age <= 26 and (overall >= 76 or potential >= 79):
        category = "must_keep"
        score = max(score, 1.05)
    elif overall >= 83 and age <= 31:
        category = "must_keep"
        score = max(score, 0.96)
    elif score >= 0.82:
        category = "want_back"
    elif score >= 0.48:
        category = "keep_if_cheap"
    elif high_hold_role_player or hold_to_market >= 1.70:
        category = "easy_renounce"
    else:
        category = "renounce_candidate"

    return {
        "score": round(score, 3),
        "category": category,
        "capHold": cap_hold,
        "expectedAAV": expected_aav,
        "holdToMarket": round(hold_to_market, 3),
        "needScore": round(need_score, 3),
        "teamDirection": direction,
        "highHoldRolePlayer": high_hold_role_player,
    }


def get_cpu_cap_hold_clearance_plan(
    league_data: Dict[str, Any],
    team_name: str,
    clearance_needed: int,
    protected_player_key: Optional[str] = None,
    target_player: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    needed = int(num(clearance_needed, 0))
    if needed <= 0:
        return {
            "ok": True,
            "renounceRows": [],
            "blockedRows": [],
            "candidateRows": [],
            "capHoldCleared": 0,
            "clearanceNeeded": needed,
        }

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return {
            "ok": False,
            "renounceRows": [],
            "blockedRows": [],
            "candidateRows": [],
            "capHoldCleared": 0,
            "clearanceNeeded": needed,
        }

    target_name = target_player.get("name") if target_player is not None else None
    target_key = get_player_key(target_player.get("id"), target_player.get("name")) if target_player is not None else None
    target_value = get_player_asset_value_score(target_player) if target_player is not None else None

    rows = [
        row for row in get_team_cap_hold_rows(league_data, team_name)
        if not protected_player_key or row.get("playerKey") != protected_player_key
    ]

    scored_rows = []
    blocked_rows = []
    candidate_rows = []

    for row in rows:
        player_idx = find_free_agent_index(
            league_data.get("freeAgents", []),
            row.get("playerId"),
            row.get("playerName"),
        )
        if player_idx == -1:
            continue

        player = league_data["freeAgents"][player_idx]
        rights = get_player_rights(player)
        if rights.get("heldByTeam") != team_name:
            continue

        value = get_cpu_rights_hold_value_score(
            league_data = league_data,
            team = team,
            player = player,
            team_name = team_name,
        )
        category = value.get("category")
        cap_hold = int(num(value.get("capHold"), row.get("capHoldAmount")))
        hold_to_market = float(num(value.get("holdToMarket"), 1.0))
        score = float(num(value.get("score"), 0.0))

        enriched_row = copy.deepcopy(row)
        enriched_row["holdValue"] = value
        enriched_row["holdValueScore"] = get_cap_hold_row_asset_value_score(row)
        enriched_row["targetPlayerName"] = target_name
        enriched_row["targetPlayerKey"] = target_key
        enriched_row["targetValueScore"] = target_value

        renounce_check = should_allow_cpu_cap_hold_renounce_for_target(
            league_data = league_data,
            team_name = team_name,
            row = row,
            target_player = target_player,
        )
        enriched_row["holdValueScore"] = renounce_check.get("holdValueScore", enriched_row.get("holdValueScore"))
        enriched_row["targetValueScore"] = renounce_check.get("targetValueScore", target_value)

        if category == "must_keep":
            enriched_row["blockedReason"] = "must_keep_hold"
            blocked_rows.append(enriched_row)
            continue

        if not renounce_check.get("allow"):
            enriched_row["blockedReason"] = renounce_check.get("blockedReason")
            blocked_rows.append(enriched_row)
            continue

        sacrifice_score = score
        sacrifice_score -= min(0.40, cap_hold / 60_000_000)
        if value.get("highHoldRolePlayer"):
            sacrifice_score -= 0.45
        if hold_to_market >= 2.25:
            sacrifice_score -= 0.30
        elif hold_to_market >= 1.70:
            sacrifice_score -= 0.18
        if category == "easy_renounce":
            sacrifice_score -= 0.30
        elif category == "renounce_candidate":
            sacrifice_score -= 0.12

        candidate_rows.append(enriched_row)
        scored_rows.append((
            sacrifice_score,
            -cap_hold,
            str(row.get("playerName", "")),
            enriched_row,
            player,
            value,
        ))

    scored_rows.sort(key = lambda item: (item[0], item[1], item[2]))

    cleared = 0
    chosen = []
    for _, _, _, row, player, value in scored_rows:
        if cleared >= needed:
            break
        cap_hold = int(num(value.get("capHold"), row.get("capHoldAmount")))
        if cap_hold <= 0:
            continue
        cleared += cap_hold
        chosen.append({
            "playerKey": get_cap_hold_player_key(player),
            "playerId": player.get("id"),
            "playerName": player.get("name"),
            "teamName": team_name,
            "capHoldCleared": cap_hold,
            "holdValue": value,
            "holdValueScore": row.get("holdValueScore"),
            "targetPlayerName": target_name,
            "targetPlayerKey": target_key,
            "targetValueScore": row.get("targetValueScore"),
            "reason": "cpu_cleared_cap_hold_for_signing",
        })

    return {
        "ok": cleared >= needed,
        "renounceRows": chosen,
        "blockedRows": blocked_rows,
        "candidateRows": candidate_rows,
        "capHoldCleared": cleared,
        "clearanceNeeded": needed,
        "targetPlayerName": target_name,
        "targetPlayerKey": target_key,
        "targetValueScore": target_value,
    }



def get_player_required_interest_for_day(
    player: Dict[str, Any],
    current_day: int,
    max_days: int,
) -> float:
    max_days = max(1, int(num(max_days, DEFAULT_FREE_AGENCY_DAYS)))
    current_day = int(clamp(current_day, 1, max_days))

    # Surgical pacing patch v2:
    # Keep free agency patient, but avoid empty early days. Days 1-2 are just a
    # touch easier to clear, while Days 5-6 are slightly firmer so the whole
    # market does not collapse into the middle of the period.
    if max_days == 1:
        base = 0.50
    else:
        scaled_day = 1.0 + ((current_day - 1) * 9.0 / max(1.0, float(max_days - 1)))
        curve = [
            (1.0, 0.948),
            (2.0, 0.920),
            (3.0, 0.900),
            (4.0, 0.875),
            (5.0, 0.858),
            (6.0, 0.812),
            (7.0, 0.700),
            (8.0, 0.625),
            (9.0, 0.560),
            (10.0, 0.500),
        ]
        base = curve[-1][1]
        for idx in range(1, len(curve)):
            x0, y0 = curve[idx - 1]
            x1, y1 = curve[idx]
            if scaled_day <= x1:
                t = (scaled_day - x0) / max(0.0001, x1 - x0)
                base = y0 + ((y1 - y0) * t)
                break

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))

    patience = 1.0 - ((current_day - 1) / max(1.0, float(max_days)))
    if overall >= 88:
        base += 0.025 * patience
    elif overall >= 83:
        base += 0.014 * patience
    elif overall <= 74 and (age >= 27 or potential <= overall + 1):
        base -= 0.025
    elif overall <= 77:
        base -= 0.012

    if current_day >= max_days:
        base = min(base, 0.51)

    return round(clamp(base, 0.50, 1.05), 3)


def withdraw_stale_cpu_offers_for_day(
    league_data: Dict[str, Any],
    refreshed_offer_ids: set,
    current_day: int,
    user_team_name: Optional[str] = None,
) -> int:
    state = ensure_free_agency_state(league_data)
    withdrawn = 0

    for player_key, offers in list(state.get("offersByPlayer", {}).items()):
        for offer in offers:
            if offer.get("status", "active") != "active":
                continue
            if offer.get("source") != "cpu":
                continue
            if user_team_name and offer.get("teamName") == user_team_name:
                continue
            if offer.get("offerId") in refreshed_offer_ids:
                continue

            old = copy.deepcopy(offer)
            old["status"] = "withdrawn"
            old["withdrawnOnDay"] = current_day
            old["withdrawReason"] = "cpu_daily_board_refresh"
            state.setdefault("offerHistory", []).append(old)

            offer["status"] = "withdrawn"
            offer["withdrawnOnDay"] = current_day
            offer["withdrawReason"] = "cpu_daily_board_refresh"
            withdrawn += 1

    if withdrawn > 0:
        state.setdefault("dailyLog", []).append({
            "day": current_day,
            "type": "cpu_daily_offer_withdrawals",
            "withdrawnOffers": withdrawn,
        })

    return withdrawn


def classify_cpu_target_tier(
    player: Dict[str, Any],
    team: Dict[str, Any],
    league_data: Dict[str, Any],
    fit: Dict[str, Any],
    target_score: float,
    incumbent_priority: bool,
    own_rights: bool,
    previous_team_player: bool,
) -> str:
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)
    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))
    need_score = float(num(fit.get("needScore"), 0.0))
    rights = get_player_rights(player)

    if incumbent_priority or (own_rights and rights.get("restrictedFreeAgent") and overall >= 75):
        return "incumbent"

    if overall >= 86:
        return "primary"
    if overall >= 82 and (need_score >= 0.36 or age <= 27 or upside >= 2):
        return "primary"
    if target_score >= 0.88 and overall >= 80:
        return "primary"

    if overall >= 78:
        return "backup"
    if overall >= 75 and (need_score >= 0.45 or age <= 25 or upside >= 2):
        return "backup"

    if expected_aav <= int(MIN_DEAL * 1.55) or overall <= 74:
        return "depth"

    return "value"


def get_cpu_daily_offer_caps(
    current_day: int,
    max_days: int,
    roster_deficit: int,
    active_offer_limit: int,
    planning_room: int = 0,
) -> Dict[str, int]:
    current_day = int(num(current_day, 1))
    max_days = max(1, int(num(max_days, DEFAULT_FREE_AGENCY_DAYS)))

    planning_room = int(num(planning_room, 0))

    if current_day <= 1:
        total = 4
        depth = 0
        value = 0
        if planning_room >= 55_000_000:
            total = 9
        elif planning_room >= 40_000_000:
            total = 8
        elif planning_room >= 28_000_000:
            total = 7
        elif planning_room >= 18_000_000:
            total = 5
    elif current_day <= 2:
        total = 5
        depth = 0 if roster_deficit < 2 else 1
        value = 1
        if planning_room >= 55_000_000:
            total = 10
        elif planning_room >= 40_000_000:
            total = 9
        elif planning_room >= 28_000_000:
            total = 8
        elif planning_room >= 18_000_000:
            total = 6
    elif current_day <= max(3, int(max_days * 0.55)):
        total = 6
        depth = 1 if current_day <= 3 else 2
        value = 2
        if planning_room >= 55_000_000:
            total = 10
        elif planning_room >= 40_000_000:
            total = 9
        elif planning_room >= 28_000_000:
            total = 8
    else:
        total = 7
        depth = 3
        value = 3
        if planning_room >= 40_000_000:
            total = 9

    if roster_deficit >= 3:
        total += 1
        if current_day >= 3:
            depth += 1
    elif roster_deficit <= 0 and current_day <= 2 and planning_room < 28_000_000:
        total = max(3, total - 1)

    return {
        "total": int(clamp(total, 0, active_offer_limit)),
        "depth": int(clamp(depth, 0, active_offer_limit)),
        "value": int(clamp(value, 0, active_offer_limit)),
    }


def get_offer_money_interest_score(ratio: float) -> float:
    ratio = float(num(ratio, 0.0))

    points = [
        (0.00, 0.05),
        (0.50, 0.25),
        (0.70, 0.46),
        (0.80, 0.58),
        (0.90, 0.68),
        (1.00, 0.78),
        (1.10, 0.87),
        (1.20, 0.94),
        (1.30, 0.99),
        (1.50, 1.03),
    ]

    for idx in range(1, len(points)):
        x0, y0 = points[idx - 1]
        x1, y1 = points[idx]
        if ratio <= x1:
            t = (ratio - x0) / max(0.0001, x1 - x0)
            return y0 + ((y1 - y0) * t)

    return 1.04



def build_cpu_offer_contract(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    current_day: int,
    max_days: int,
    rng: random.Random,
    target_score: float = 0.0,
    incumbent_priority: bool = False,
    target_tier: str = "value",
    profile: Optional[Dict[str, Any]] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    need_score: Optional[float] = None,
    exception_room: Optional[int] = None,
) -> Dict[str, Any]:
    market_value = player.get("marketValue") or estimate_market_value(player)
    if profile is None:
        profile = build_team_roster_profile(team, league_data = league_data)
    direction = profile["direction"]

    age = int(num(player.get("age"), 27))
    overall = int(round(num(player.get("overall"), 75)))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)

    off_rating = int(round(num(player.get("offRating"), overall)))
    def_rating = int(round(num(player.get("defRating"), overall)))
    scoring_rating = int(round(num(player.get("scoringRating"), overall)))

    expected_year1 = int(market_value["expectedYear1Salary"])
    expected_years = get_realistic_expected_contract_years(player)

    team_name = team.get("name")
    if snapshot is None:
        snapshot = get_team_cap_snapshot(league_data, team_name) if team_name else {"ok": False, "capRoom": 0, "rosterCount": 0}
    cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0
    raw_cap_room_without_holds = int(snapshot.get("rawCapRoomWithoutHolds", cap_room)) if snapshot.get("ok") else cap_room
    if exception_room is None:
        exception_room = get_team_exception_room(
            league_data = league_data,
            team_name = team_name,
            player = player,
            snapshot = snapshot,
        ) if team_name else cap_room
    else:
        exception_room = int(num(exception_room, 0))

    own_rights = bool(team_name and is_rights_team(player, team_name))
    planning_room = max(cap_room, raw_cap_room_without_holds)
    if own_rights:
        available_room = exception_room
    elif planning_room > 0:
        available_room = max(exception_room, planning_room)
    else:
        available_room = exception_room

    actual_roster_count = len(get_team_players(team))
    offseason_min_target = get_free_agency_min_roster_target(league_data)
    roster_deficit = max(0, offseason_min_target - actual_roster_count)
    max_days = max(1, int(num(max_days, DEFAULT_FREE_AGENCY_DAYS)))
    day_progress = clamp((current_day - 1) / max(1.0, float(max_days - 1)), 0.0, 1.0)

    if need_score is None:
        need_score = get_player_need_score_for_team(team, player, league_data = league_data)
    else:
        need_score = float(num(need_score, 0.0))
    previous_team = None
    if isinstance(player.get("freeAgencyMeta"), dict):
        previous_team = player["freeAgencyMeta"].get("fromTeam")
    is_returning_team_target = bool(
        team_name
        and (
            previous_team == team_name
            or own_rights
        )
    )

    fringe_player = (
        overall <= 74
        or (overall <= 75 and (age >= 23 or potential <= overall + 1))
        or (overall <= 76 and (age >= 26 or potential <= overall + 2))
        or (overall <= 77 and age >= 30 and potential <= overall + 2)
    )

    if fringe_player and target_tier == "depth":
        years = get_realistic_expected_contract_years(player)
        if age >= 29 and overall <= 76:
            years = 1
        years = int(clamp(years, 1, 2))
        option = build_cpu_offer_option(
            player = player,
            years = years,
            target_tier = target_tier,
            salary_ratio = 1.0,
            rng = rng,
        )
        return normalize_contract({
            "startYear": get_operating_season_year(league_data),
            "salaryByYear": build_salary_by_year(MIN_DEAL, years),
            "option": option,
        })

    # Build realistic offers around market value. The goal is not to force
    # 100% interest on Day 1; players can wait while thresholds fall later.
    if target_tier in ["incumbent", "primary"]:
        multiplier = 0.96 + (0.035 * rng.random())
    elif target_tier == "backup":
        multiplier = 0.88 + (0.035 * rng.random())
    elif target_tier == "value":
        multiplier = 0.80 + (0.040 * rng.random())
    else:
        multiplier = 0.72 + (0.035 * rng.random())

    # Teams that miss their first path can become a bit more aggressive as the
    # board thins, but not wildly above market.
    if current_day >= 2 and target_tier in ["primary", "backup"]:
        multiplier += min(0.065, 0.020 + (0.045 * day_progress))
    elif current_day >= 4 and target_tier == "value":
        multiplier += 0.035

    if target_tier == "primary" and planning_room >= int(expected_year1 * 0.90):
        multiplier += 0.025
    if target_tier == "incumbent" and incumbent_priority:
        multiplier += 0.025

    if direction in ["contending", "win now"]:
        if overall >= 80 and age >= 27:
            multiplier += 0.025
        if def_rating >= 84 and overall >= 78:
            multiplier += 0.012
        if age <= 24 and overall < 78:
            multiplier -= 0.020
    elif direction == "rebuilding":
        if age <= 26:
            multiplier += 0.025
        if upside >= 3:
            multiplier += 0.025
        if age >= 30 and overall <= 80:
            multiplier -= 0.055
    elif direction == "retooling":
        if age <= 29:
            multiplier += 0.018
        if upside >= 2:
            multiplier += 0.020
    else:
        if 24 <= age <= 31 and overall >= 78:
            multiplier += 0.012

    if need_score >= 0.70:
        multiplier += 0.025
    elif need_score >= 0.45:
        multiplier += 0.012
    elif need_score <= 0.20 and target_tier not in ["primary", "incumbent"]:
        multiplier -= 0.025

    if roster_deficit >= 4 and target_tier in ["backup", "value", "depth"]:
        multiplier += 0.035
    elif roster_deficit >= 2 and target_tier in ["backup", "value"]:
        multiplier += 0.020

    if is_returning_team_target:
        # No default old-team overbid. Continuity only nudges the offer if the
        # prior team was actually a strong basketball situation.
        return_context_bonus = get_return_team_interest_bonus(
            league_data = league_data,
            team_name = team_name,
            player = player,
            rights_bonus = bool(own_rights and get_player_rights(player).get("restrictedFreeAgent")),
        )
        if return_context_bonus > 0:
            multiplier += min(0.018, return_context_bonus * 0.35)

        # If outside teams are trying to pull away a real starter/star, the original
        # team can nudge its offer a little only when the player is core-level or
        # the team context supports keeping him.
        state = ensure_free_agency_state(league_data)
        player_key = get_player_key_from_player(player)
        outside_pressure = False
        for live_offer in state.get("offersByPlayer", {}).get(player_key, []):
            if live_offer.get("status", "active") != "active":
                continue
            if live_offer.get("teamName") == team_name:
                continue
            if int(num(live_offer.get("aav"), 0)) >= int(expected_year1 * 0.82):
                outside_pressure = True
                break
        if outside_pressure and overall >= 80 and (overall >= 86 or age <= 25 or return_context_bonus >= 0.018):
            multiplier += 0.010 if overall < 86 else 0.014
    else:
        perfect_outside_fit = bool(
            target_tier == "primary"
            and overall >= 80
            and planning_room >= int(expected_year1 * 0.88)
            and need_score >= 0.70
            and age <= 31
        )
        if perfect_outside_fit:
            multiplier += 0.018

    if off_rating >= 87 and scoring_rating >= 86 and age <= 30 and overall >= 80:
        multiplier += 0.015

    # Market discipline caps. Only true stars should get major over-market bids.
    if overall >= 90:
        max_multiplier = 1.16
        min_primary_multiplier = 0.98
    elif overall >= 87:
        max_multiplier = 1.12
        min_primary_multiplier = 0.95
    elif overall >= 84:
        max_multiplier = 1.08
        min_primary_multiplier = 0.92
    elif overall >= 81:
        max_multiplier = 1.05
        min_primary_multiplier = 0.88
    elif overall >= 78:
        max_multiplier = 1.02
        min_primary_multiplier = 0.82
    else:
        max_multiplier = 0.98
        min_primary_multiplier = 0.72

    if age >= 35 and overall < 86:
        max_multiplier = min(max_multiplier, 0.92)
    elif age >= 33 and overall < 84:
        max_multiplier = min(max_multiplier, 0.96)
    elif age >= 31 and overall < 82:
        max_multiplier = min(max_multiplier, 0.98)

    if target_tier in ["incumbent", "primary"]:
        multiplier = max(multiplier, min_primary_multiplier)
    elif target_tier == "backup":
        multiplier = min(multiplier, max_multiplier - 0.025)
    elif target_tier == "value":
        multiplier = min(multiplier, max_multiplier - 0.070)

    # If a team can afford to make a real offer to a starter/star, do not let
    # that offer land as a fake lowball. If it cannot afford the floor, the
    # serious-offer filter later will simply skip the bid.
    if available_room >= int(expected_year1 * 0.85) and overall >= 84:
        multiplier = max(multiplier, 0.85)
    elif available_room >= int(expected_year1 * 0.80) and overall >= 80:
        multiplier = max(multiplier, 0.80)

    multiplier = clamp(multiplier, 0.55, max_multiplier)

    year1_salary = int(
        round_to_nearest(
            clamp(expected_year1 * multiplier, MIN_DEAL, MAX_SALARY),
            base = 1_000,
        )
    )

    # Contract length discipline. Use the same expected-length model that
    # powers market value so players do not punish realistic CPU offer length.
    years = get_realistic_expected_contract_years(player)

    if target_tier == "depth":
        if overall <= 72:
            years = 1 if age >= 26 else min(2, years)
        elif overall <= 76:
            years = min(years, 2 if age <= 28 or upside >= 2 else 1)
    elif target_tier == "value" and overall <= 76:
        years = min(years, 2 if age <= 32 or upside >= 2 else 1)

    if target_tier == "primary" and overall >= 82 and age <= 30:
        years = max(years, min(4, expected_years))
    if target_tier == "incumbent" and overall >= 80 and age <= 30:
        years = max(years, min(4, expected_years))

    years = int(clamp(years, 1, 4))

    # Cap offer at actual possible spending. If that makes it unserious, the
    # serious-bidder filter will drop the offer instead of creating fake bids.
    if available_room <= MIN_DEAL:
        year1_salary = MIN_DEAL
        years = 1 if age >= 29 else min(2, years)
    else:
        affordable_year1 = int(
            round_to_nearest(
                clamp(available_room, MIN_DEAL, MAX_SALARY),
                base = 1_000,
            )
        )
        year1_salary = min(year1_salary, affordable_year1)

    salary_ratio = year1_salary / max(1.0, float(expected_year1))
    option = build_cpu_offer_option(
        player = player,
        years = years,
        target_tier = target_tier,
        salary_ratio = salary_ratio,
        rng = rng,
    )

    return normalize_contract({
        "startYear": get_operating_season_year(league_data),
        "salaryByYear": build_salary_by_year(year1_salary, years),
        "option": option,
    })


def is_incumbent_retention_priority(player: Dict[str, Any], team_name: Optional[str]) -> bool:
    if not team_name:
        return False

    rights = get_player_rights(player)
    previous_team = None
    if isinstance(player.get("freeAgencyMeta"), dict):
        previous_team = player["freeAgencyMeta"].get("fromTeam")

    is_own_rights_player = bool(
        rights.get("heldByTeam") == team_name
        and (
            rights.get("birdLevel") in ["bird", "early_bird", "non_bird"]
            or rights.get("restrictedFreeAgent")
        )
    )
    is_previous_team_player = bool(previous_team and previous_team == team_name)

    if not is_own_rights_player and not is_previous_team_player:
        return False

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)

    if rights.get("restrictedFreeAgent") and overall >= 76:
        return True
    if overall >= 82:
        return True
    if overall >= 79 and age <= 33:
        return True
    if overall >= 77 and age <= 27 and upside >= 2:
        return True

    return False


def get_team_controlled_player_count(team: Dict[str, Any]) -> int:
    """Standard + two-way + pending rookies for display/CPU planning.

    Stashes are unlimited draft-rights style holds and do not consume the old
    offseason controlled count. User signings are also allowed to exceed this
    planning count until Calendar simulation starts.
    """
    if not isinstance(team, dict):
        return 0

    return (
        len(team.get("players") or [])
        + len(team.get("twoWayPlayers") or [])
        + len(team.get("pendingRookieSignings") or [])
    )


def is_priority_offseason_overfill_candidate(
    player: Dict[str, Any],
    team_name: Optional[str],
    league_data: Dict[str, Any],
    matched_rfa: bool = False,
) -> bool:
    """Allow CPU over-15 offseason additions only for meaningful roster assets.

    This keeps normal filler/depth signings capped at 15 while still letting a
    team temporarily overfill for RFAs, Bird-rights retention, strong targets,
    or good young assets. Final season simulation still requires 14-15 standard
    players.
    """
    if not player or not team_name:
        return False

    rights = get_player_rights(player)
    previous_team = None
    if isinstance(player.get("freeAgencyMeta"), dict):
        previous_team = player["freeAgencyMeta"].get("fromTeam")

    own_rights = is_rights_team(player, team_name)
    previous_team_player = bool(previous_team and previous_team == team_name)
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)
    market_value = player.get("marketValue") or estimate_market_value(player)
    expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))

    if matched_rfa:
        return overall >= 74 or potential >= 78 or age <= 25

    if rights.get("restrictedFreeAgent") and (own_rights or previous_team_player):
        return overall >= 74 or potential >= 78 or upside >= 3

    if is_incumbent_retention_priority(player, team_name):
        return True

    if own_rights or previous_team_player:
        return overall >= 77 or potential >= 81 or (age <= 25 and upside >= 4)

    if overall >= 82:
        return True

    if overall >= 79 and age <= 31 and expected_aav >= 6_000_000:
        return True

    if age <= 24 and overall >= 76 and potential >= 82:
        return True

    return False


def can_add_standard_player_during_free_agency(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    player: Dict[str, Any],
    team_name: str,
    source: str = "cpu",
    matched_rfa: bool = False,
) -> Tuple[bool, str]:
    """Roster-add guard for live/offseason free agency.

    User signings have no offseason roster-count blocker anymore. CPU teams keep
    the conservative 20-player planning guard unless the target is a priority
    asset. Game simulation remains the hard enforcement point.
    """
    standard_count = len(get_team_players(team))
    controlled_count = get_team_controlled_player_count(team)

    if str(source or "").lower() == "user":
        return True, "User offseason overfill allowed until Calendar simulation."

    if controlled_count >= OFFSEASON_CONTROLLED_MAX:
        return False, f"{team_name} is at the offseason controlled-player planning limit ({OFFSEASON_CONTROLLED_MAX})."

    if standard_count < get_roster_limit(league_data):
        return True, "Roster spot available."

    if is_priority_offseason_overfill_candidate(
        player = player,
        team_name = team_name,
        league_data = league_data,
        matched_rfa = matched_rfa,
    ):
        return True, "Priority offseason overfill allowed."

    return False, f"{team_name} already has {standard_count} standard players and this is not a priority overfill signing."

def generate_cpu_offers_for_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    state = ensure_free_agency_state(league_data)
    refresh_free_agent_market_values(league_data)
    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    season_year = get_current_season_year(league_data)
    offseason_min_target = get_free_agency_min_roster_target(league_data)

    generated = []
    refreshed_offer_ids = set()

    # Each day is a fresh front-office board. CPU offers are conditional paths,
    # so old CPU offers are replaced instead of stacking forever.
    withdraw_stale_cpu_offers_for_day(
        league_data = league_data,
        refreshed_offer_ids = refreshed_offer_ids,
        current_day = current_day,
        user_team_name = user_team_name,
    )

    state["teamNeedProfiles"] = {
        team.get("name"): build_team_roster_profile(team, league_data = league_data)
        for _, _, team in iter_teams(league_data)
        if team.get("name")
    }

    free_agents = list(league_data.get("freeAgents", []))
    pending_user_player_keys = {
        row.get("playerKey") or get_player_key(row.get("playerId"), row.get("playerName"))
        for row in state.get("pendingUserDecisions", [])
        if isinstance(row, dict)
    }

    for _, _, team in iter_teams(league_data):
        team_name = team.get("name")
        if not team_name:
            continue
        if user_team_name and team_name == user_team_name:
            continue

        actual_roster_count = len(get_team_players(team))
        remaining_roster_slots = get_team_remaining_roster_slots(
            league_data = league_data,
            team_name = team_name,
            state = None,
        )
        if remaining_roster_slots <= 0:
            for debug_player in free_agents:
                if is_rfa_debug_target(debug_player, team_name):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "team_skipped_no_remaining_roster_slots_before_candidate_scan",
                        player = debug_player,
                        team_name = team_name,
                        payload = {
                            "actualRosterCount": actual_roster_count,
                            "remainingRosterSlots": remaining_roster_slots,
                            "rosterLimit": get_roster_limit(league_data),
                            "rightsTeam": get_player_rights(debug_player).get("heldByTeam"),
                            "ownRights": is_rights_team(debug_player, team_name),
                        },
                    )
            continue

        actual_roster_deficit = max(0, offseason_min_target - actual_roster_count)
        snapshot = get_team_cap_snapshot(league_data, team_name)
        active_offer_limit = get_active_offer_limit_for_team(
            league_data = league_data,
            team_name = team_name,
            state = state,
            target_override = offseason_min_target,
            snapshot = snapshot,
        )
        if active_offer_limit <= 0:
            for debug_player in free_agents:
                if is_rfa_debug_target(debug_player, team_name):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "team_skipped_active_offer_limit_zero",
                        player = debug_player,
                        team_name = team_name,
                        payload = {
                            "activeOfferLimit": active_offer_limit,
                            "snapshot": compact_debug_snapshot(snapshot),
                            "actualRosterCount": actual_roster_count,
                            "remainingRosterSlots": remaining_roster_slots,
                            "rightsTeam": get_player_rights(debug_player).get("heldByTeam"),
                            "ownRights": is_rights_team(debug_player, team_name),
                        },
                    )
            continue

        profile = state.get("teamNeedProfiles", {}).get(team_name) or build_team_roster_profile(team, league_data = league_data)
        direction = profile.get("direction", "balanced")
        cap_room = int(snapshot.get("capRoom", 0)) if snapshot.get("ok") else 0
        raw_cap_room_without_holds = int(snapshot.get("rawCapRoomWithoutHolds", cap_room)) if snapshot.get("ok") else cap_room
        planning_room = max(cap_room, raw_cap_room_without_holds)

        caps = get_cpu_daily_offer_caps(
            current_day = current_day,
            max_days = max_days,
            roster_deficit = actual_roster_deficit,
            active_offer_limit = active_offer_limit,
            planning_room = planning_room,
        )
        # Offers are conditional, so teams with real cap room can carry extra
        # top-target offers beyond exact open roster slots. Final signings still
        # enforce roster/cap rules after players accept.
        soft_offer_slots = remaining_roster_slots
        if planning_room >= 50_000_000:
            soft_offer_slots += 5
        elif planning_room >= 35_000_000:
            soft_offer_slots += 4
        elif planning_room >= 20_000_000:
            soft_offer_slots += 3
        elif actual_roster_deficit >= 2:
            soft_offer_slots += 2
        max_offers_today = min(caps["total"], max(1, soft_offer_slots))
        if max_offers_today <= 0:
            for debug_player in free_agents:
                if is_rfa_debug_target(debug_player, team_name):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "team_skipped_max_offers_today_zero",
                        player = debug_player,
                        team_name = team_name,
                        payload = {
                            "caps": copy.deepcopy(caps),
                            "softOfferSlots": soft_offer_slots,
                            "maxOffersToday": max_offers_today,
                            "planningRoom": planning_room,
                            "actualRosterDeficit": actual_roster_deficit,
                            "remainingRosterSlots": remaining_roster_slots,
                        },
                    )
            continue

        active_offer_count = get_active_offer_count_for_team(state, team_name)
        candidates = []

        for player in free_agents:
            player_key = get_player_key_from_player(player)
            if player_key in pending_user_player_keys:
                continue

            overall = int(round(num(player.get("overall"), 0)))
            age = int(num(player.get("age"), 27))
            potential = int(round(num(player.get("potential"), overall)))
            upside = max(0, potential - overall)
            market_value = player.get("marketValue") or estimate_market_value(player)
            expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))

            rights = get_player_rights(player)
            previous_team = None
            if isinstance(player.get("freeAgencyMeta"), dict):
                previous_team = player["freeAgencyMeta"].get("fromTeam")
            own_rights = is_rights_team(player, team_name)
            previous_team_player = bool(previous_team and previous_team == team_name)
            incumbent_priority = is_incumbent_retention_priority(player, team_name)
            debug_this_candidate = is_rfa_debug_target(player, team_name)
            over_standard_limit = actual_roster_count >= get_roster_limit(league_data)

            if over_standard_limit and not is_priority_offseason_overfill_candidate(
                player = player,
                team_name = team_name,
                league_data = league_data,
                matched_rfa = False,
            ):
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_non_priority_overfill",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "actualRosterCount": actual_roster_count,
                            "rosterLimit": get_roster_limit(league_data),
                            "rightsTeam": get_player_rights(player).get("heldByTeam"),
                            "ownRights": own_rights,
                            "previousTeamPlayer": previous_team_player,
                            "incumbentPriority": incumbent_priority,
                        },
                    )
                continue

            fit = estimate_team_free_agent_fit_from_profile(
                team = team,
                player = player,
                profile = profile,
            )
            fit_score = float(num(fit.get("interestScore"), 0.0))
            need_score = float(num(fit.get("needScore"), 0.0))
            position_bucket = fit.get("positionBucket")
            weakest_positions = fit.get("weakestPositions", []) or []

            min_fit_threshold = 0.46
            if own_rights or previous_team_player:
                min_fit_threshold = 0.24
            elif actual_roster_deficit >= 3:
                min_fit_threshold = 0.22
            elif actual_roster_deficit >= 1:
                min_fit_threshold = 0.28
            elif planning_room >= 22_000_000:
                min_fit_threshold = 0.34
            elif planning_room >= 10_000_000:
                min_fit_threshold = 0.39

            min_fit_threshold -= max(0.0, (overall - 80.0) * 0.010)
            if need_score >= 0.70:
                min_fit_threshold -= 0.060
            elif need_score >= 0.50:
                min_fit_threshold -= 0.030
            elif need_score <= 0.20 and actual_roster_deficit <= 0 and not incumbent_priority and overall < 82:
                min_fit_threshold += 0.070

            if incumbent_priority:
                min_fit_threshold -= 0.120
            if rights.get("restrictedFreeAgent") and own_rights:
                min_fit_threshold -= 0.050
            raw_cap_star_path = bool(
                not own_rights
                and overall >= 80
                and expected_aav >= 8_000_000
                and raw_cap_room_without_holds >= int(expected_aav * (0.72 if overall >= 85 else 0.66))
            )
            if raw_cap_star_path:
                # For real 80+ talent, raw-cap teams should at least put a
                # reasonable offer on the board, even if player interest is only
                # around the 50%-60% range. Need still matters, but it should not
                # completely hide stars from teams with room.
                if overall >= 88:
                    min_fit_threshold -= 0.180
                elif overall >= 85:
                    min_fit_threshold -= 0.135
                else:
                    min_fit_threshold -= 0.090
            if current_day >= max_days - 1:
                min_fit_threshold -= 0.060
            elif current_day >= max_days - 2:
                min_fit_threshold -= 0.030

            min_fit_threshold = max(0.05, min_fit_threshold)
            if fit_score < min_fit_threshold:
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_fit_threshold",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "fitScore": round(fit_score, 3),
                            "minFitThreshold": round(min_fit_threshold, 3),
                            "needScore": round(need_score, 3),
                            "positionBucket": position_bucket,
                            "weakestPositions": copy.deepcopy(weakest_positions),
                            "ownRights": own_rights,
                            "previousTeamPlayer": previous_team_player,
                            "incumbentPriority": incumbent_priority,
                            "rawCapStarPath": raw_cap_star_path,
                            "planningRoom": planning_room,
                            "snapshot": compact_debug_snapshot(snapshot),
                        },
                    )
                continue

            target_score = fit_score
            target_score += max(0.0, (overall - 75.0) * 0.012)
            target_score += max(0.0, (overall - 82.0) * 0.018)
            target_score += need_score * 0.28
            target_score += min(0.26, actual_roster_deficit * 0.080)

            if position_bucket in weakest_positions[:1]:
                target_score += 0.110
            elif position_bucket in weakest_positions[:2]:
                target_score += 0.060

            if planning_room >= 25_000_000:
                target_score += max(0.0, (overall - 78.0) * 0.017)
            elif planning_room >= 15_000_000:
                target_score += max(0.0, (overall - 79.0) * 0.012)
            elif planning_room >= 8_000_000:
                target_score += max(0.0, (overall - 80.0) * 0.008)

            # Raw-cap star path: cap-space teams may keep several serious offers
            # alive for high-rated players even when practical cap is reduced by
            # holds. The actual hold-renounce decision is made only if a player
            # accepts later.
            if raw_cap_star_path:
                if overall >= 88:
                    target_score += 0.260
                elif overall >= 85:
                    target_score += 0.190
                else:
                    target_score += 0.120
                if planning_room >= 50_000_000:
                    target_score += 0.045
                elif planning_room >= 35_000_000:
                    target_score += 0.025

            if direction in ["contending", "win now"] and overall >= 79 and age >= 27:
                target_score += 0.070
            if direction == "rebuilding" and age <= 27 and upside >= 2:
                target_score += 0.085
            if direction == "retooling" and age <= 29 and overall >= 78:
                target_score += 0.055

            if previous_team_player:
                target_score += 0.160
            if own_rights:
                target_score += 0.180
            if incumbent_priority:
                target_score += 0.120
            if incumbent_priority and rights.get("restrictedFreeAgent"):
                target_score += 0.060

            # As days pass, teams that missed Plan A become more open to the
            # best remaining Plan B players.
            if current_day >= 2 and planning_room >= 12_000_000 and overall >= 78:
                target_score += min(0.080, 0.025 * (current_day - 1))
            if current_day >= max_days - 1:
                target_score += 0.050
            elif current_day >= max_days - 2:
                target_score += 0.025

            target_tier = classify_cpu_target_tier(
                player = player,
                team = team,
                league_data = league_data,
                fit = fit,
                target_score = target_score,
                incumbent_priority = incumbent_priority,
                own_rights = own_rights,
                previous_team_player = previous_team_player,
            )

            # Opening day should be best-case chasing, not backup/depth dumping.
            if current_day <= 1 and target_tier in ["value", "depth"]:
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_opening_day_value_depth_tier",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "targetTier": target_tier,
                            "targetScore": round(target_score, 3),
                            "currentDay": current_day,
                            "incumbentPriority": incumbent_priority,
                            "ownRights": own_rights,
                        },
                    )
                continue
            if current_day <= 1 and target_tier == "backup" and not incumbent_priority and target_score < 0.82:
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_opening_day_backup_score",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "targetTier": target_tier,
                            "targetScore": round(target_score, 3),
                            "requiredScore": 0.82,
                            "currentDay": current_day,
                            "incumbentPriority": incumbent_priority,
                            "ownRights": own_rights,
                        },
                    )
                continue
            if current_day <= 2 and target_tier == "depth" and actual_roster_deficit < 2:
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_early_depth_no_roster_deficit",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "targetTier": target_tier,
                            "targetScore": round(target_score, 3),
                            "actualRosterDeficit": actual_roster_deficit,
                            "currentDay": current_day,
                            "incumbentPriority": incumbent_priority,
                            "ownRights": own_rights,
                        },
                    )
                continue

            seed = stable_text_seed(f"{season_year}|{current_day}|{team_name}|{player_key}|team_board")
            rng = random.Random(seed)
            target_score += rng.random() * 0.025

            contract = build_cpu_offer_contract(
                league_data = league_data,
                team = team,
                player = player,
                current_day = current_day,
                max_days = max_days,
                rng = rng,
                target_score = target_score,
                incumbent_priority = incumbent_priority,
                target_tier = target_tier,
                profile = profile,
                snapshot = snapshot,
                need_score = need_score,
            )

            if not is_cpu_serious_offer_for_player(
                player = player,
                contract = contract,
                current_day = current_day,
                max_days = max_days,
                incumbent_priority = incumbent_priority,
                target_tier = target_tier,
            ):
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_not_serious_offer",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "targetTier": target_tier,
                            "targetScore": round(target_score, 3),
                            "contract": compact_debug_contract(contract),
                            "marketValue": compact_debug_player(player).get("marketValue"),
                            "incumbentPriority": incumbent_priority,
                            "ownRights": own_rights,
                        },
                    )
                continue

            eval_res = evaluate_market_offer_submission(
                league_data = league_data,
                team_name = team_name,
                player = player,
                contract = contract,
                exclude_offer_id = None,
                snapshot = snapshot,
                state = state,
                active_offer_count = active_offer_count,
                active_offer_limit = active_offer_limit,
            )
            if not eval_res.get("ok"):
                if debug_this_candidate:
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_rejected_spending_eval",
                        player = player,
                        team_name = team_name,
                        payload = {
                            "targetTier": target_tier,
                            "targetScore": round(target_score, 3),
                            "contract": compact_debug_contract(contract),
                            "spending": compact_debug_spending(eval_res),
                            "activeOfferCount": active_offer_count,
                            "activeOfferLimit": active_offer_limit,
                            "snapshot": compact_debug_snapshot(snapshot),
                            "incumbentPriority": incumbent_priority,
                            "ownRights": own_rights,
                        },
                    )
                continue

            if debug_this_candidate:
                record_fa_debug(
                    league_data = league_data,
                    bucket = "cpuOfferDebugLog",
                    event = "candidate_added_to_cpu_board",
                    player = player,
                    team_name = team_name,
                    payload = {
                        "targetTier": target_tier,
                        "targetScore": round(target_score, 3),
                        "fitScore": round(fit_score, 3),
                        "needScore": round(need_score, 3),
                        "contract": compact_debug_contract(contract),
                        "spending": compact_debug_spending(eval_res),
                        "activeOfferCount": active_offer_count,
                        "activeOfferLimit": active_offer_limit,
                        "maxOffersToday": max_offers_today,
                        "incumbentPriority": incumbent_priority,
                        "ownRights": own_rights,
                    },
                )

            if eval_res.get("pendingCapHoldClearance"):
                # Soft-offer rule: do not block the offer board here. A team can
                # make multiple conditional offers using raw cap room. Only when
                # an offer is actually selected for the board do we attach the
                # display/audit clearance plan. Final signing still re-checks this.
                eval_res["plannedCapHoldRenounces"] = []
                eval_res["plannedCapHoldClearanceAmount"] = 0
                eval_res["blockedCapHoldRenounces"] = []
                eval_res["capHoldClearanceDeferredUntilAcceptance"] = True

            candidates.append({
                "score": target_score,
                "targetTier": target_tier,
                "teamName": team_name,
                "player": player,
                "playerKey": player_key,
                "contract": contract,
                "evalRes": eval_res,
                "fit": fit,
                "profile": profile,
                "incumbentPriority": incumbent_priority,
                "ownRights": own_rights,
                "previousTeamPlayer": previous_team_player,
                "rawCapStarPath": raw_cap_star_path,
            })

        tier_order = {
            "incumbent": 0,
            "primary": 1,
            "backup": 2,
            "value": 3,
            "depth": 4,
        }

        candidates.sort(
            key = lambda item: (
                tier_order.get(str(item.get("targetTier")), 9),
                0 if item.get("rawCapStarPath") else 1,
                -float(num(item.get("score"), 0.0)),
                -int(num((item.get("player", {}).get("marketValue") or {}).get("expectedAAV"), 0)),
                str(item.get("player", {}).get("name", "")),
            )
        )

        offers_used = 0
        depth_used = 0
        value_used = 0

        for item in candidates:
            if active_offer_count >= active_offer_limit:
                if is_rfa_debug_target(item.get("player"), team_name):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_not_selected_active_offer_limit_reached",
                        player = item.get("player"),
                        team_name = team_name,
                        payload = {
                            "activeOfferCount": active_offer_count,
                            "activeOfferLimit": active_offer_limit,
                            "offersUsed": offers_used,
                            "maxOffersToday": max_offers_today,
                            "targetTier": item.get("targetTier"),
                            "targetScore": round(float(num(item.get("score"), 0.0)), 3),
                        },
                    )
                break
            if offers_used >= max_offers_today:
                if is_rfa_debug_target(item.get("player"), team_name):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "cpuOfferDebugLog",
                        event = "candidate_not_selected_max_offers_today_reached",
                        player = item.get("player"),
                        team_name = team_name,
                        payload = {
                            "activeOfferCount": active_offer_count,
                            "activeOfferLimit": active_offer_limit,
                            "offersUsed": offers_used,
                            "maxOffersToday": max_offers_today,
                            "targetTier": item.get("targetTier"),
                            "targetScore": round(float(num(item.get("score"), 0.0)), 3),
                        },
                    )
                break

            target_tier = str(item.get("targetTier") or "value")
            if target_tier == "depth":
                if depth_used >= caps["depth"]:
                    if is_rfa_debug_target(item.get("player"), team_name):
                        record_fa_debug(
                            league_data = league_data,
                            bucket = "cpuOfferDebugLog",
                            event = "candidate_not_selected_depth_cap_used",
                            player = item.get("player"),
                            team_name = team_name,
                            payload = {"caps": copy.deepcopy(caps), "depthUsed": depth_used, "targetScore": round(float(num(item.get("score"), 0.0)), 3)},
                        )
                    continue
                depth_used += 1
            if target_tier == "value":
                if value_used >= caps["value"]:
                    if is_rfa_debug_target(item.get("player"), team_name):
                        record_fa_debug(
                            league_data = league_data,
                            bucket = "cpuOfferDebugLog",
                            event = "candidate_not_selected_value_cap_used",
                            player = item.get("player"),
                            team_name = team_name,
                            payload = {"caps": copy.deepcopy(caps), "valueUsed": value_used, "targetScore": round(float(num(item.get("score"), 0.0)), 3)},
                        )
                    continue
                value_used += 1

            player = item["player"]
            player_key = item["playerKey"]
            contract = item["contract"]
            eval_res = item["evalRes"]
            fit = item["fit"]
            profile = item["profile"]
            team_name = item["teamName"]

            if eval_res.get("pendingCapHoldClearance"):
                clearance_plan = get_cpu_cap_hold_clearance_plan(
                    league_data = league_data,
                    team_name = team_name,
                    clearance_needed = int(num(eval_res.get("capHoldClearanceNeeded"), 0)),
                    protected_player_key = player_key,
                    target_player = player,
                )
                if clearance_plan.get("ok"):
                    eval_res["plannedCapHoldRenounces"] = clearance_plan.get("renounceRows", [])
                    eval_res["plannedCapHoldClearanceAmount"] = clearance_plan.get("capHoldCleared", 0)
                else:
                    eval_res["plannedCapHoldRenounces"] = []
                    eval_res["plannedCapHoldClearanceAmount"] = 0
                eval_res["blockedCapHoldRenounces"] = clearance_plan.get("blockedRows", [])
                eval_res["capHoldClearanceDeferredUntilAcceptance"] = True

            offer_record = build_offer_record(
                league_data = league_data,
                team_name = team_name,
                player = player,
                contract = contract,
                source = "cpu",
                current_day = current_day,
            )
            offer_record["spendingType"] = eval_res.get("spendingType")
            offer_record["exceptionType"] = eval_res.get("exceptionType")
            offer_record["payrollZone"] = eval_res.get("payrollZone")
            offer_record["exceptionRoom"] = eval_res.get("exceptionRoom")
            offer_record["exceptionRemaining"] = eval_res.get("exceptionRemaining")
            offer_record["birdRights"] = eval_res.get("birdRights")
            offer_record["pendingCapHoldClearance"] = eval_res.get("pendingCapHoldClearance", False)
            offer_record["capHoldClearanceNeeded"] = eval_res.get("capHoldClearanceNeeded", 0)
            offer_record["plannedCapHoldRenounces"] = eval_res.get("plannedCapHoldRenounces", [])
            offer_record["plannedCapHoldClearanceAmount"] = eval_res.get("plannedCapHoldClearanceAmount", 0)
            offer_record["teamDirection"] = profile.get("direction")
            offer_record["teamBoardScore"] = round(float(num(item.get("score"), 0.0)), 3)
            offer_record["targetTier"] = target_tier
            offer_record["incumbentPriority"] = bool(item.get("incumbentPriority"))
            offer_record["ownRightsOffer"] = bool(item.get("ownRights"))
            offer_record["previousTeamOffer"] = bool(item.get("previousTeamPlayer"))
            offer_record["needScore"] = fit.get("needScore")
            offer_record["positionBucket"] = fit.get("positionBucket")
            offer_record["weakestPositions"] = fit.get("weakestPositions")
            offer_record["rosterNeed"] = {
                "position": fit.get("positionBucket"),
                "needScore": fit.get("needScore"),
                "weakestPositions": fit.get("weakestPositions"),
                "teamDirection": profile.get("direction"),
            }
            offer_record["playerViewScore"] = score_offer_for_player_with_fit(
                league_data = league_data,
                player = player,
                offer = offer_record,
                team_profile = profile,
                fit = fit,
            )
            offer_record["storyContext"] = build_free_agency_story_context(
                league_data = league_data,
                player = player,
                team_name = team_name,
                contract = offer_record.get("contract"),
                row = offer_record,
                offer = offer_record,
                spending_res = eval_res,
                event_type = "cpu_offer",
                current_day = current_day,
                roster_need = offer_record.get("rosterNeed"),
                team_profile = profile,
            )
            upsert_offer_record(
                league_data = league_data,
                player_key = player_key,
                offer_record = offer_record,
            )
            refreshed_offer_ids.add(offer_record.get("offerId"))
            if is_rfa_debug_target(player, team_name):
                record_fa_debug(
                    league_data = league_data,
                    bucket = "cpuOfferDebugLog",
                    event = "cpu_offer_created",
                    player = player,
                    team_name = team_name,
                    offer = offer_record,
                    payload = {
                        "targetTier": target_tier,
                        "teamBoardScore": offer_record.get("teamBoardScore"),
                        "playerViewScore": offer_record.get("playerViewScore"),
                        "spending": compact_debug_spending(eval_res),
                        "ownRights": bool(item.get("ownRights")),
                        "previousTeamPlayer": bool(item.get("previousTeamPlayer")),
                        "incumbentPriority": bool(item.get("incumbentPriority")),
                    },
                )
            active_offer_count += 1
            offers_used += 1

            generated.append({
                "playerName": player.get("name"),
                "playerId": player.get("id"),
                "teamName": team_name,
                "contract": offer_record["contract"],
                "totalValue": offer_record["totalValue"],
                "aav": offer_record["aav"],
                "spendingType": offer_record.get("spendingType"),
                "exceptionType": offer_record.get("exceptionType"),
                "payrollZone": offer_record.get("payrollZone"),
                "exceptionRoom": offer_record.get("exceptionRoom"),
                "exceptionRemaining": offer_record.get("exceptionRemaining"),
                "pendingCapHoldClearance": offer_record.get("pendingCapHoldClearance"),
                "capHoldClearanceNeeded": offer_record.get("capHoldClearanceNeeded"),
                "plannedCapHoldRenounces": offer_record.get("plannedCapHoldRenounces", []),
                "teamDirection": offer_record.get("teamDirection"),
                "teamBoardScore": offer_record.get("teamBoardScore"),
                "targetTier": offer_record.get("targetTier"),
                "playerViewScore": offer_record.get("playerViewScore"),
                "incumbentPriority": offer_record.get("incumbentPriority"),
                "ownRightsOffer": offer_record.get("ownRightsOffer"),
                "needScore": offer_record.get("needScore"),
                "positionBucket": offer_record.get("positionBucket"),
                "weakestPositions": offer_record.get("weakestPositions"),
                "rosterNeed": offer_record.get("rosterNeed"),
                "storyContext": offer_record.get("storyContext"),
                "rfaOfferSheet": bool(get_player_rights(player).get("restrictedFreeAgent") and not is_rights_team(player, team_name)),
                "rightsTeamName": get_player_rights(player).get("heldByTeam"),
            })

    return generated


def get_free_agent_offers(
    league_data: Dict[str, Any],
    player_id: Optional[str] = None,
    player_name: Optional[str] = None
) -> Dict[str, Any]:
    state = ensure_free_agency_state(league_data)
    free_agents = league_data.get("freeAgents", [])

    idx = -1
    for i, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            idx = i
            break
        if player_name and player.get("name") == player_name:
            idx = i
            break

    if idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    player = free_agents[idx]
    player_key = get_player_key_from_player(player)

    offers = []
    for offer in state.get("offersByPlayer", {}).get(player_key, []):
        if offer.get("status", "active") != "active":
            continue
        enriched = copy.deepcopy(offer)
        enriched["playerViewScore"] = score_offer_for_player(league_data, player, offer)
        offers.append(enriched)

    offers = sort_offers_for_display(offers)

    best_offer_id = offers[0]["offerId"] if offers else None
    for offer in offers:
        offer["isBestOffer"] = offer.get("offerId") == best_offer_id

    return {
        "ok": True,
        "player": {
            "id": player.get("id"),
            "name": player.get("name"),
            "overall": player.get("overall"),
            "age": player.get("age"),
            "position": player.get("pos"),
            "marketValue": player.get("marketValue") or estimate_market_value(player),
            "rights": get_player_rights(player),
            "qualifyingOffer": copy.deepcopy(player.get("qualifyingOffer")) if isinstance(player.get("qualifyingOffer"), dict) else None,
            "qualifyingOfferEligible": copy.deepcopy(player.get("qualifyingOfferEligible")) if isinstance(player.get("qualifyingOfferEligible"), dict) else None,
            "freeAgencyMeta": copy.deepcopy(player.get("freeAgencyMeta")) if isinstance(player.get("freeAgencyMeta"), dict) else None,
        },
        "offers": offers,
        "stateSummary": build_free_agency_state_summary(league_data),
    }


def submit_user_free_agent_offer(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    state = ensure_free_agency_state(updated)

    if not state.get("isActive"):
        return {
            "ok": False,
            "reason": "Free agency period is not active.",
        }

    free_agents = updated.setdefault("freeAgents", [])
    player_idx = -1
    for idx, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            player_idx = idx
            break
        if player_name and player.get("name") == player_name:
            player_idx = idx
            break

    if player_idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    player = free_agents[player_idx]
    contract = build_contract_from_offer(updated, offer or {})
    player_key = get_player_key_from_player(player)

    existing_offer = find_existing_offer_for_team_player(state, player_key, team_name)
    exclude_offer_id = existing_offer.get("offerId") if existing_offer else None

    eval_res = evaluate_market_offer_submission(
        league_data = updated,
        team_name = team_name,
        player = player,
        contract = contract,
        exclude_offer_id = exclude_offer_id,
    )
    if not eval_res.get("ok"):
        return eval_res

    current_day = int(num(state.get("currentDay"), 1))
    offer_record = build_offer_record(
        league_data = updated,
        team_name = team_name,
        player = player,
        contract = contract,
        source = "user",
        current_day = current_day,
    )
    offer_record["spendingType"] = eval_res.get("spendingType")
    offer_record["exceptionType"] = eval_res.get("exceptionType")
    offer_record["payrollZone"] = eval_res.get("payrollZone")
    offer_record["exceptionRoom"] = eval_res.get("exceptionRoom")
    offer_record["birdRights"] = eval_res.get("birdRights")
    offer_record["pendingCapHoldClearance"] = bool(eval_res.get("pendingCapHoldClearance", False))
    offer_record["capHoldClearanceNeeded"] = int(num(eval_res.get("capHoldClearanceNeeded"), 0))
    offer_record["rawCapRoomWithoutHolds"] = eval_res.get("rawCapRoomWithoutHolds")
    offer_record["rawPayrollWithoutHolds"] = eval_res.get("rawPayrollWithoutHolds")
    offer_record["capHoldTotal"] = eval_res.get("capHoldTotal")
    _, _, offer_team = find_team_entry(updated, team_name)
    offer_profile = build_team_roster_profile(offer_team, league_data = updated) if offer_team else None
    offer_record["storyContext"] = build_free_agency_story_context(
        league_data = updated,
        player = player,
        team_name = team_name,
        contract = offer_record.get("contract"),
        row = offer_record,
        offer = offer_record,
        spending_res = eval_res,
        event_type = "user_offer",
        current_day = current_day,
        team_profile = offer_profile,
    )
    upsert_offer_record(
        league_data = updated,
        player_key = player_key,
        offer_record = offer_record,
    )

    offers_res = get_free_agent_offers(
        league_data = updated,
        player_id = player.get("id"),
        player_name = player.get("name"),
    )

    return {
        "ok": True,
        "reason": "Offer submitted to free agency market.",
        "leagueData": updated,
        "submittedOffer": offer_record,
        "offersView": offers_res,
        "stateSummary": build_free_agency_state_summary(updated),
    }


def should_match_restricted_free_agent_offer(
    league_data: Dict[str, Any],
    rights_team_name: str,
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
) -> bool:
    if not rights_team_name:
        record_fa_debug(
            league_data = league_data,
            bucket = "rfaMatchDebugLog",
            event = "match_rejected_no_rights_team_name",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
        )
        return False

    if chosen_offer.get("teamName") == rights_team_name:
        record_rfa_debug(
            league_data = league_data,
            event = "match_not_needed_offer_from_rights_team",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
        )
        return False

    rights = get_player_rights(player)
    if not rights.get("restrictedFreeAgent"):
        record_fa_debug(
            league_data = league_data,
            bucket = "rfaMatchDebugLog",
            event = "match_rejected_player_not_restricted_at_should_match",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
            payload = {"rights": compact_debug_rights(player)},
        )
        return False

    _, _, rights_team = find_team_entry(league_data, rights_team_name)
    if rights_team is None:
        record_rfa_debug(
            league_data = league_data,
            event = "match_rejected_rights_team_not_found",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
        )
        return False

    contract = normalize_contract(chosen_offer.get("contract"))
    if not contract:
        record_rfa_debug(
            league_data = league_data,
            event = "match_rejected_invalid_contract",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
        )
        return False

    # RFA matching is an actual signing by the rights team. Respect cap/hard-cap
    # legality, but be much more aggressive about keeping young rotation players.
    snapshot = get_team_cap_snapshot(league_data, rights_team_name)
    spending_res = validate_offer_spending_rules(
        league_data = league_data,
        team_name = rights_team_name,
        player = player,
        contract = contract,
        outstanding_current_salary = 0,
        snapshot = snapshot if snapshot.get("ok") else None,
        allow_rfa_match_rights = True,
    )
    if not spending_res.get("ok"):
        record_rfa_debug(
            league_data = league_data,
            event = "match_rejected_spending_rules",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
            payload = {
                "contract": compact_debug_contract(contract),
                "snapshot": compact_debug_snapshot(snapshot),
                "spending": compact_debug_spending(spending_res),
            },
        )
        return False

    market_value = player.get("marketValue") or estimate_market_value(player)

    offered_years = len(contract.get("salaryByYear", []))
    offered_aav = int(sum(contract.get("salaryByYear", [])) / max(1, offered_years))

    expected_aav = int(num(market_value.get("expectedAAV"), MIN_DEAL))
    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 24))
    potential = int(round(num(player.get("potential"), overall)))
    upside = max(0, potential - overall)

    profile = build_team_roster_profile(rights_team, league_data = league_data)
    direction = profile.get("direction", "balanced")
    need_score = get_player_need_score_for_team(rights_team, player, league_data = league_data)

    overpay_ratio = offered_aav / max(1, expected_aav)

    base_payload = {
        "contract": compact_debug_contract(contract),
        "expectedAAV": expected_aav,
        "offeredAAV": offered_aav,
        "offeredYears": offered_years,
        "overpayRatio": round(overpay_ratio, 3),
        "overall": overall,
        "age": age,
        "potential": potential,
        "upside": upside,
        "teamDirection": direction,
        "needScore": round(float(num(need_score, 0.0)), 3),
        "spending": compact_debug_spending(spending_res),
    }

    # Clear keeper tiers. This fixes cases like Tari Eason walking for a normal
    # role-player contract just because the old expected salary was too low.
    if overall >= 84:
        decision = overpay_ratio <= 1.85
        record_rfa_debug(league_data, "match_decision_keeper_overall_84_plus", player, rights_team_name, chosen_offer, {**base_payload, "decision": decision, "keeperThreshold": 1.85})
        return decision
    if overall >= 82:
        decision = overpay_ratio <= 1.70
        record_rfa_debug(league_data, "match_decision_keeper_overall_82_plus", player, rights_team_name, chosen_offer, {**base_payload, "decision": decision, "keeperThreshold": 1.70})
        return decision
    if overall >= 80 and age <= 27:
        decision = overpay_ratio <= 1.62
        record_rfa_debug(league_data, "match_decision_keeper_young_80_plus", player, rights_team_name, chosen_offer, {**base_payload, "decision": decision, "keeperThreshold": 1.62})
        return decision
    if overall >= 78 and age <= 26:
        decision = overpay_ratio <= 1.55
        record_rfa_debug(league_data, "match_decision_keeper_young_78_plus", player, rights_team_name, chosen_offer, {**base_payload, "decision": decision, "keeperThreshold": 1.55})
        return decision
    if age <= 24 and upside >= 4 and overall >= 74:
        decision = overpay_ratio <= 1.52
        record_rfa_debug(league_data, "match_decision_keeper_upside_young", player, rights_team_name, chosen_offer, {**base_payload, "decision": decision, "keeperThreshold": 1.52})
        return decision

    keep_score = 0.36
    keep_score += max(0.0, (overall - 73.0) * 0.045)
    keep_score += min(0.18, upside * 0.035)
    keep_score += float(need_score) * 0.16

    if age <= 24:
        keep_score += 0.14
    elif age <= 27:
        keep_score += 0.08

    if direction in ["rebuilding", "retooling"] and age <= 26:
        keep_score += 0.10
    if direction in ["contending", "win now"] and overall >= 78:
        keep_score += 0.08

    if overpay_ratio <= 1.08 and overall >= 74:
        record_rfa_debug(league_data, "match_decision_keeper_low_overpay", player, rights_team_name, chosen_offer, {**base_payload, "decision": True, "keepScore": round(keep_score, 3), "reason": "overpay_ratio_low"})
        return True

    threshold = 0.64
    if overpay_ratio > 1.15:
        threshold += (overpay_ratio - 1.15) * 0.40
    if overpay_ratio > 1.45:
        threshold += (overpay_ratio - 1.45) * 0.70

    decision = keep_score >= threshold
    record_rfa_debug(
        league_data,
        "match_decision_score_threshold",
        player,
        rights_team_name,
        chosen_offer,
        {**base_payload, "decision": decision, "keepScore": round(keep_score, 3), "threshold": round(threshold, 3)},
    )
    return decision

def maybe_apply_rfa_match(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
) -> Tuple[Dict[str, Any], bool]:
    rights = get_player_rights(player)
    rights_team_name = rights.get("heldByTeam")

    if is_rfa_debug_target(player, rights_team_name):
        record_fa_debug(
            league_data = league_data,
            bucket = "rfaMatchDebugLog",
            event = "maybe_match_entry",
            player = player,
            team_name = rights_team_name,
            offer = chosen_offer,
            payload = {"rights": compact_debug_rights(player)},
        )

    if chosen_offer.get("skipRfaAutoMatch") or chosen_offer.get("rfaMatchDeclined"):
        if is_rfa_debug_target(player, rights_team_name):
            record_fa_debug(
                league_data = league_data,
                bucket = "rfaMatchDebugLog",
                event = "maybe_match_skipped_by_offer_flags",
                player = player,
                team_name = rights_team_name,
                offer = chosen_offer,
                payload = {"skipRfaAutoMatch": bool(chosen_offer.get("skipRfaAutoMatch")), "rfaMatchDeclined": bool(chosen_offer.get("rfaMatchDeclined"))},
            )
        return chosen_offer, False

    if chosen_offer.get("forceRfaMatch"):
        if not rights_team_name or not rights.get("restrictedFreeAgent"):
            # Stale pending RFA rows can survive after rights are renounced.
            # A renounced RFA is now a UFA, so there is no match right to force.
            return chosen_offer, False

        matched_offer = copy.deepcopy(chosen_offer)
        matched_offer["matchedOriginalTeamName"] = rights_team_name or chosen_offer.get("teamName")
        matched_offer["originalOfferTeamName"] = chosen_offer.get("originalOfferTeamName")
        matched_offer["teamName"] = rights_team_name or chosen_offer.get("teamName")
        return matched_offer, True

    if not rights.get("restrictedFreeAgent"):
        if is_rfa_debug_target(player, rights_team_name):
            record_fa_debug(
                league_data = league_data,
                bucket = "rfaMatchDebugLog",
                event = "maybe_match_rejected_not_restricted_free_agent",
                player = player,
                team_name = rights_team_name,
                offer = chosen_offer,
                payload = {"rights": compact_debug_rights(player)},
            )
        return chosen_offer, False

    if not rights_team_name or rights_team_name == chosen_offer.get("teamName"):
        if is_rfa_debug_target(player, rights_team_name):
            record_fa_debug(
                league_data = league_data,
                bucket = "rfaMatchDebugLog",
                event = "maybe_match_not_applicable_no_rights_or_offer_from_rights_team",
                player = player,
                team_name = rights_team_name,
                offer = chosen_offer,
                payload = {"rightsTeamName": rights_team_name, "offerTeamName": chosen_offer.get("teamName")},
            )
        return chosen_offer, False

    if not should_match_restricted_free_agent_offer(
        league_data = league_data,
        rights_team_name = rights_team_name,
        player = player,
        chosen_offer = chosen_offer,
    ):
        if is_rfa_debug_target(player, rights_team_name):
            record_fa_debug(
                league_data = league_data,
                bucket = "rfaMatchDebugLog",
                event = "maybe_match_decision_false",
                player = player,
                team_name = rights_team_name,
                offer = chosen_offer,
            )
        return chosen_offer, False

    matched_offer = copy.deepcopy(chosen_offer)
    matched_offer["matchedOriginalTeamName"] = rights_team_name
    matched_offer["originalOfferTeamName"] = chosen_offer.get("teamName")
    matched_offer["teamName"] = rights_team_name
    matched_offer["source"] = "rfa_match"
    matched_offer["forceRfaMatch"] = True
    if is_rfa_debug_target(player, rights_team_name):
        record_fa_debug(
            league_data = league_data,
            bucket = "rfaMatchDebugLog",
            event = "maybe_match_applied",
            player = player,
            team_name = rights_team_name,
            offer = matched_offer,
            payload = {"originalOfferTeamName": chosen_offer.get("teamName")},
        )
    return matched_offer, True


def finalize_free_agent_signing_from_offer(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    chosen_offer: Dict[str, Any],
    current_day: int
) -> Optional[Dict[str, Any]]:
    player_key = get_player_key_from_player(player)
    state = ensure_free_agency_state(league_data)
    if is_rfa_debug_target(player, chosen_offer.get("teamName")):
        record_fa_debug(
            league_data = league_data,
            bucket = "finalizeDebugLog",
            event = "finalize_entry_before_match_check",
            player = player,
            team_name = chosen_offer.get("teamName"),
            offer = chosen_offer,
            payload = {"rights": compact_debug_rights(player)},
        )

    chosen_offer, matched_rfa = maybe_apply_rfa_match(
        league_data = league_data,
        player = player,
        chosen_offer = chosen_offer,
    )

    signing_team_name = chosen_offer.get("teamName")
    if is_rfa_debug_target(player, signing_team_name):
        record_fa_debug(
            league_data = league_data,
            bucket = "finalizeDebugLog",
            event = "finalize_after_match_check",
            player = player,
            team_name = signing_team_name,
            offer = chosen_offer,
            payload = {"matchedRfa": matched_rfa, "rights": compact_debug_rights(player)},
        )

    _, _, team = find_team_entry(league_data, signing_team_name)
    if team is None:
        record_rfa_debug(league_data, "finalize_failed_team_not_found", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa})
        return None

    snapshot = get_team_cap_snapshot(league_data, signing_team_name)
    if not snapshot.get("ok"):
        record_rfa_debug(league_data, "finalize_failed_team_snapshot", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "snapshot": compact_debug_snapshot(snapshot)})
        return None

    contract = apply_free_agency_start_year(league_data, chosen_offer.get("contract"))

    if chosen_offer.get("forceRfaMatch") or matched_rfa:
        spending_res = validate_offer_spending_rules(
            league_data = league_data,
            team_name = signing_team_name,
            player = player,
            contract = contract,
            outstanding_current_salary = 0,
            snapshot = snapshot,
            allow_pending_cap_hold_clearance = False,
            allow_rfa_match_rights = True,
        )
        if spending_res.get("ok"):
            spending_res["reason"] = "Offer matched using restricted free agent matching rights."
            spending_res["spendingType"] = "rfa_match"
            spending_res["exceptionType"] = None
            spending_res["birdRights"] = get_player_rights(player)
            spending_res["payrollZone"] = get_payroll_zone_for_amount(
                league_data,
                int(num(snapshot.get("payroll"), 0)),
            )
    else:
        spending_res = validate_offer_spending_rules(
            league_data = league_data,
            team_name = signing_team_name,
            player = player,
            contract = contract,
            outstanding_current_salary = 0,
            snapshot = snapshot,
        )

    if not spending_res.get("ok"):
        record_rfa_debug(league_data, "finalize_failed_spending_rules", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "contract": compact_debug_contract(contract), "snapshot": compact_debug_snapshot(snapshot), "spending": compact_debug_spending(spending_res)})
        return None

    if spending_res.get("pendingCapHoldClearance"):
        user_team_name = state.get("pendingUserTeamName")

        if user_team_name and signing_team_name == user_team_name:
            record_rfa_debug(league_data, "finalize_failed_user_team_pending_cap_hold_clearance", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "spending": compact_debug_spending(spending_res)})
            return None

        auto_res = auto_renounce_cpu_cap_holds_for_room(
            league_data = league_data,
            team_name = signing_team_name,
            clearance_needed = int(num(spending_res.get("capHoldClearanceNeeded"), 0)),
            protected_player_key = player_key,
            target_player = player,
            current_day = current_day,
        )

        if not auto_res.get("ok"):
            record_rfa_debug(league_data, "finalize_failed_auto_cap_hold_clearance", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "autoRes": copy.deepcopy(auto_res), "spending": compact_debug_spending(spending_res)})
            return None

        snapshot = get_team_cap_snapshot(league_data, signing_team_name)
        if not snapshot.get("ok"):
            record_rfa_debug(league_data, "finalize_failed_snapshot_after_cap_hold_clearance", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "snapshot": compact_debug_snapshot(snapshot)})
            return None

        spending_res = validate_offer_spending_rules(
            league_data = league_data,
            team_name = signing_team_name,
            player = player,
            contract = contract,
            outstanding_current_salary = 0,
            snapshot = snapshot,
            allow_pending_cap_hold_clearance = False,
            allow_rfa_match_rights = bool(chosen_offer.get("forceRfaMatch") or matched_rfa),
        )

        if not spending_res.get("ok"):
            record_rfa_debug(league_data, "finalize_failed_spending_after_cap_hold_clearance", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "contract": compact_debug_contract(contract), "snapshot": compact_debug_snapshot(snapshot), "spending": compact_debug_spending(spending_res)})
            return None

        spending_res["autoRenouncedCapHolds"] = auto_res.get("renounced", [])
        spending_res["autoRenouncedCapHoldAmount"] = auto_res.get("capHoldCleared", 0)
        spending_res["blockedCapHoldRenounces"] = auto_res.get("blockedRenounces", [])
        spending_res["capHoldRenounceTargetPlayerName"] = auto_res.get("targetPlayerName")
        spending_res["capHoldRenounceTargetValueScore"] = auto_res.get("targetValueScore")

    roster_add_ok, roster_add_reason = can_add_standard_player_during_free_agency(
        league_data = league_data,
        team = team,
        player = player,
        team_name = signing_team_name,
        source = chosen_offer.get("source") or "cpu",
        matched_rfa = bool(chosen_offer.get("forceRfaMatch") or matched_rfa),
    )
    if not roster_add_ok:
        record_rfa_debug(
            league_data,
            "finalize_failed_roster_full",
            player,
            signing_team_name,
            chosen_offer,
            {
                "matchedRfa": matched_rfa,
                "rosterCount": len(get_team_players(team)),
                "rosterLimit": get_roster_limit(league_data),
                "controlledCount": get_team_controlled_player_count(team),
                "reason": roster_add_reason,
            },
        )
        return None

    free_agents = league_data.setdefault("freeAgents", [])
    player_idx = -1
    for idx, p in enumerate(free_agents):
        if player.get("id") not in [None, ""] and p.get("id") == player.get("id"):
            player_idx = idx
            break
        if p.get("name") == player.get("name"):
            player_idx = idx
            break

    if player_idx == -1:
        record_rfa_debug(league_data, "finalize_failed_player_not_in_free_agents", player, signing_team_name, chosen_offer, {"matchedRfa": matched_rfa, "playerKey": player_key})
        return None

    signed_player = copy.deepcopy(player)
    signed_player["contract"] = contract
    signed_player["marketValue"] = estimate_market_value(signed_player)

    update_player_rights_after_signing(
        player = signed_player,
        team_name = signing_team_name,
        signing_source = "free_agency",
        matched_rfa = matched_rfa,
    )

    setoff_rows = apply_dead_cap_setoff_for_signed_player(
        league_data = league_data,
        player = player,
        signing_team_name = signing_team_name,
        contract = contract,
    )

    free_agents.pop(player_idx)
    team.setdefault("players", []).append(signed_player)
    record_rfa_debug(
        league_data,
        "finalize_success_signed_player",
        player,
        signing_team_name,
        chosen_offer,
        {
            "matchedRfa": matched_rfa,
            "originalRights": compact_debug_rights(player),
            "signedPlayerRightsAfterSigning": compact_debug_rights(signed_player),
            "contract": compact_debug_contract(contract),
        },
    )

    current_year_salary = get_contract_salary_for_year(contract, get_operating_season_year(league_data))
    exception_usage = record_exception_usage_for_signing(
        league_data = league_data,
        team_name = signing_team_name,
        spending_res = spending_res,
        current_year_salary = current_year_salary,
    )

    all_offers = []
    for offer in state.get("offersByPlayer", {}).get(player_key, []):
        logged = copy.deepcopy(offer)
        if logged.get("offerId") == chosen_offer.get("offerId"):
            logged["status"] = "accepted"
        else:
            logged["status"] = "lost"

        if matched_rfa and logged.get("offerId") == chosen_offer.get("offerId"):
            logged["status"] = "matched_by_original_team"

        logged["playerViewScore"] = score_offer_for_player(league_data, player, offer)
        all_offers.append(logged)

    sorted_all_offers = sort_offers_for_display(all_offers)

    user_offer_outcomes = []
    for logged in sorted_all_offers:
        if logged.get("source") != "user":
            continue

        user_team_name = logged.get("teamName")
        user_status = logged.get("status")
        if user_status == "accepted" and user_team_name == signing_team_name:
            outcome_status = "won"
        elif user_status == "matched_by_original_team":
            outcome_status = "matched_by_original_team"
        else:
            outcome_status = "lost"

        user_contract = normalize_contract(logged.get("contract"))
        user_salary_by_year = list(user_contract.get("salaryByYear", [])) if user_contract else []
        user_total_value = int(sum(user_salary_by_year)) if user_salary_by_year else int(num(logged.get("totalValue"), 0))
        user_years = len(user_salary_by_year) if user_salary_by_year else int(num(logged.get("years"), 0))

        user_offer_outcomes.append({
            "id": f"{player_key}|{user_team_name}|{current_day}|{outcome_status}",
            "day": current_day,
            "playerId": player.get("id"),
            "playerName": player.get("name"),
            "playerKey": player_key,
            "userTeamName": user_team_name,
            "status": outcome_status,
            "offerStatus": user_status,
            "signedWith": signing_team_name,
            "signedContract": contract,
            "signedTotalValue": int(sum(contract.get("salaryByYear", []))),
            "signedYears": len(contract.get("salaryByYear", [])),
            "userOfferContract": user_contract,
            "userOfferTotalValue": user_total_value,
            "userOfferYears": user_years,
            "rfaMatched": matched_rfa,
            "originalOfferTeamName": chosen_offer.get("originalOfferTeamName"),
            "storyContext": build_free_agency_story_context(
                league_data = league_data,
                player = signed_player,
                team_name = signing_team_name,
                contract = contract,
                row = logged,
                offer = logged,
                all_offers = sorted_all_offers,
                spending_res = spending_res,
                event_type = "rfa_matched" if matched_rfa else "user_offer_outcome",
                current_day = current_day,
                matched_rfa = matched_rfa,
                original_offer_team_name = chosen_offer.get("originalOfferTeamName"),
                rights_team_name = chosen_offer.get("matchedOriginalTeamName") or get_player_rights(player).get("heldByTeam"),
            ),
        })

    if user_offer_outcomes:
        state.setdefault("userOfferOutcomeLog", []).extend(copy.deepcopy(user_offer_outcomes))

    story_context = build_free_agency_story_context(
        league_data = league_data,
        player = signed_player,
        team_name = signing_team_name,
        contract = contract,
        row = chosen_offer,
        offer = chosen_offer,
        all_offers = sorted_all_offers,
        spending_res = spending_res,
        event_type = "rfa_matched" if matched_rfa else "signing",
        current_day = current_day,
        matched_rfa = matched_rfa,
        original_offer_team_name = chosen_offer.get("originalOfferTeamName"),
        rights_team_name = chosen_offer.get("matchedOriginalTeamName") or get_player_rights(player).get("heldByTeam"),
        exception_usage = exception_usage,
        roster_need = chosen_offer.get("rosterNeed"),
    )

    state["signedPlayersLog"].append({
        "day": current_day,
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "teamName": signing_team_name,
        "signedWith": signing_team_name,
        "contract": contract,
        "totalValue": int(sum(contract.get("salaryByYear", []))),
        "aav": int(sum(contract.get("salaryByYear", [])) / max(1, len(contract.get("salaryByYear", [])))),
        "spendingType": spending_res.get("spendingType"),
        "exceptionType": spending_res.get("exceptionType"),
        "exceptionUsage": exception_usage,
        "exceptionRemaining": get_team_remaining_exceptions(league_data, signing_team_name),
        "payrollZone": spending_res.get("payrollZone"),
        "autoRenouncedCapHolds": spending_res.get("autoRenouncedCapHolds", []),
        "autoRenouncedCapHoldAmount": spending_res.get("autoRenouncedCapHoldAmount", 0),
        "deadCapSetoffRows": setoff_rows,
        "manualRenouncedCapHolds": chosen_offer.get("manualRenouncedCapHolds", []),
        "manualRenouncedCapHoldAmount": chosen_offer.get("manualRenouncedCapHoldAmount", 0),
        "allOffers": sorted_all_offers,
        "userOfferOutcomes": user_offer_outcomes,
        "rfaMatched": matched_rfa,
        "originalOfferTeamName": chosen_offer.get("originalOfferTeamName"),
        "matchedOriginalTeamName": chosen_offer.get("matchedOriginalTeamName"),
        "declinedRightsTeamName": chosen_offer.get("declinedRightsTeamName"),
        "storyContext": story_context,
    })

    if player_key in state.get("offersByPlayer", {}):
        del state["offersByPlayer"][player_key]

    total_value = int(sum(contract.get("salaryByYear", [])))
    years = len(contract.get("salaryByYear", []))
    aav = int(total_value / max(1, years))

    return {
        "playerId": player.get("id"),
        "playerName": player.get("name"),
        "signedWith": signing_team_name,
        "teamName": signing_team_name,
        "day": current_day,
        "contract": contract,
        "totalValue": total_value,
        "aav": aav,
        "spendingType": spending_res.get("spendingType"),
        "exceptionType": spending_res.get("exceptionType"),
        "exceptionUsage": exception_usage,
        "exceptionRemaining": get_team_remaining_exceptions(league_data, signing_team_name),
        "payrollZone": spending_res.get("payrollZone"),
        "autoRenouncedCapHolds": spending_res.get("autoRenouncedCapHolds", []),
        "autoRenouncedCapHoldAmount": spending_res.get("autoRenouncedCapHoldAmount", 0),
        "deadCapSetoffRows": setoff_rows,
        "manualRenouncedCapHolds": chosen_offer.get("manualRenouncedCapHolds", []),
        "manualRenouncedCapHoldAmount": chosen_offer.get("manualRenouncedCapHoldAmount", 0),
        "allOffers": sorted_all_offers,
        "userOfferOutcomes": user_offer_outcomes,
        "rfaMatched": matched_rfa,
        "originalOfferTeamName": chosen_offer.get("originalOfferTeamName"),
        "matchedOriginalTeamName": chosen_offer.get("matchedOriginalTeamName"),
        "declinedRightsTeamName": chosen_offer.get("declinedRightsTeamName"),
        "storyContext": story_context,
    }

def resolve_signings_for_day(
    league_data: Dict[str, Any],
    current_day: int,
    user_team_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    state = ensure_free_agency_state(league_data)
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))

    free_agents = sorted(
        league_data.get("freeAgents", []),
        key = lambda p: (
            -num(p.get("overall"), 0),
            -num((p.get("marketValue") or {}).get("expectedAAV"), 0),
        ),
    )

    signings = []

    for player in free_agents:
        player_key = get_player_key_from_player(player)

        offers = []
        for offer in state.get("offersByPlayer", {}).get(player_key, []):
            if offer.get("status", "active") != "active":
                continue
            enriched = copy.deepcopy(offer)
            enriched["playerViewScore"] = score_offer_for_player(league_data, player, offer)
            offers.append(enriched)

        if not offers:
            if is_rfa_debug_target(player):
                record_fa_debug(
                    league_data = league_data,
                    bucket = "rfaDebugLog",
                    event = "resolve_no_active_offers_for_player",
                    player = player,
                    team_name = get_player_rights(player).get("heldByTeam"),
                    payload = {"currentDay": current_day, "playerKey": player_key},
                )
            continue

        offers = sort_offers_for_display(offers)
        best_offer = offers[0]
        best_score = num(best_offer.get("playerViewScore"), 0)
        required_interest = get_player_required_interest_for_day(
            player = player,
            current_day = current_day,
            max_days = max_days,
        )

        best_market = get_market_acceptance_threshold(
            league_data = league_data,
            player = player,
            contract = normalize_contract(best_offer.get("contract")),
            exclude_offer_id = best_offer.get("offerId"),
        )

        should_sign = False
        if current_day >= max_days:
            should_sign = True
        elif best_market.get("autoAccept"):
            should_sign = True
        elif best_score >= required_interest:
            should_sign = True

        if is_rfa_debug_target(player):
            record_fa_debug(
                league_data = league_data,
                bucket = "rfaDebugLog",
                event = "resolve_interest_decision",
                player = player,
                team_name = get_player_rights(player).get("heldByTeam"),
                offer = best_offer,
                payload = {
                    "shouldSign": should_sign,
                    "bestScore": round(float(num(best_score, 0)), 3),
                    "requiredInterest": round(float(num(required_interest, 0)), 3),
                    "currentDay": current_day,
                    "maxDays": max_days,
                    "bestMarket": copy.deepcopy(best_market),
                    "offerTeams": [o.get("teamName") for o in offers],
                    "offerCount": len(offers),
                },
            )

        if not should_sign:
            continue

        for candidate_offer in offers:
            candidate_score = num(candidate_offer.get("playerViewScore"), 0)
            if current_day < max_days and not best_market.get("autoAccept") and candidate_score + 0.025 < required_interest:
                break

            if should_create_user_rfa_match_decision(
                league_data = league_data,
                player = player,
                chosen_offer = candidate_offer,
                user_team_name = user_team_name,
            ):
                pending_entry = upsert_pending_rfa_match_decision(
                    league_data = league_data,
                    player = player,
                    chosen_offer = candidate_offer,
                    all_offers = offers,
                    current_day = current_day,
                )
                state.setdefault("dailyLog", []).append({
                    "day": current_day,
                    "type": "rfa_offer_sheet_pending",
                    "playerName": player.get("name"),
                    "rightsTeamName": pending_entry.get("rightsTeamName"),
                    "offeringTeamName": pending_entry.get("offeringTeamName"),
                    "totalValue": pending_entry.get("totalValue"),
                    "years": pending_entry.get("years"),
                })
                break

            if (
                user_team_name
                and candidate_offer.get("teamName") == user_team_name
                and candidate_offer.get("source") == "user"
            ):
                upsert_pending_user_decision(
                    league_data = league_data,
                    team_name = user_team_name,
                    player = player,
                    chosen_offer = candidate_offer,
                    all_offers = offers,
                    current_day = current_day,
                )
                break

            signed = finalize_free_agent_signing_from_offer(
                league_data = league_data,
                player = player,
                chosen_offer = candidate_offer,
                current_day = current_day,
            )
            if signed:
                if is_rfa_debug_target(player):
                    record_fa_debug(
                        league_data = league_data,
                        bucket = "rfaDebugLog",
                        event = "resolve_finalized_signing",
                        player = player,
                        team_name = signed.get("teamName") or signed.get("signedWith"),
                        offer = candidate_offer,
                        payload = {
                            "signed": {
                                "teamName": signed.get("teamName") or signed.get("signedWith"),
                                "rfaMatched": signed.get("rfaMatched"),
                                "originalOfferTeamName": signed.get("originalOfferTeamName"),
                                "matchedOriginalTeamName": signed.get("matchedOriginalTeamName"),
                                "declinedRightsTeamName": signed.get("declinedRightsTeamName"),
                                "totalValue": signed.get("totalValue"),
                                "aav": signed.get("aav"),
                            }
                        },
                    )
                signings.append(signed)
                break

            if is_rfa_debug_target(player):
                record_fa_debug(
                    league_data = league_data,
                    bucket = "rfaDebugLog",
                    event = "resolve_candidate_offer_failed_finalize",
                    player = player,
                    team_name = candidate_offer.get("teamName"),
                    offer = candidate_offer,
                    payload = {"currentDay": current_day},
                )

            # Offers are soft commitments. If one CPU signing used the cap room
            # or roster slot first, this offer fails final validation and the
            # player can look at the next offer on his board.
            original_offers = state.get("offersByPlayer", {}).get(player_key, [])
            for original_offer in original_offers:
                if original_offer.get("offerId") != candidate_offer.get("offerId"):
                    continue
                if original_offer.get("source") == "user":
                    continue
                original_offer["status"] = "failed_legal_check"
                original_offer["failedOnDay"] = current_day
                original_offer["failedReason"] = "Offer could not be finalized under current cap/roster rules."
                state.setdefault("offerHistory", []).append(copy.deepcopy(original_offer))
                state.setdefault("dailyLog", []).append({
                    "day": current_day,
                    "type": "cpu_offer_failed_final_validation",
                    "playerName": player.get("name"),
                    "teamName": candidate_offer.get("teamName"),
                    "offerId": candidate_offer.get("offerId"),
                })
                break

    return signings


def initialize_free_agency_period(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    max_days: int = DEFAULT_FREE_AGENCY_DAYS
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)

    updated.setdefault("freeAgents", [])
    normalize_all_player_rights(updated)
    refresh_free_agent_market_values(updated)

    state = ensure_free_agency_state(updated)
    state["seasonYear"] = get_current_season_year(updated)
    state["isActive"] = True
    state["currentDay"] = 1
    state["maxDays"] = int(clamp(max_days, 1, 30))
    state["offersByPlayer"] = {}
    state["dailyLog"] = []
    state["signedPlayersLog"] = []
    state["offerHistory"] = []
    state["userOfferOutcomeLog"] = []
    state["pendingUserDecisions"] = []
    state["pendingRfaMatchDecisions"] = []
    state["exceptionUsageByTeam"] = {}
    state["teamNeedProfiles"] = {}
    state["rightsRenounceLog"] = []
    state["blockedCapHoldRenounceLog"] = []
    state["fullActionLog"] = []
    state["rfaDebugLog"] = []
    state["cpuOfferDebugLog"] = []
    state["rfaMatchDebugLog"] = []
    state["finalizeDebugLog"] = []
    state["freeAgencyDebugErrors"] = []
    state["pendingUserTeamName"] = user_team_name
    state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, user_team_name) if user_team_name else None

    for debug_player in updated.get("freeAgents", []):
        if is_rfa_debug_target(debug_player):
            record_fa_debug(
                league_data = updated,
                bucket = "rfaDebugLog",
                event = "free_agency_period_init_debug_target",
                player = debug_player,
                team_name = get_player_rights(debug_player).get("heldByTeam"),
                payload = {
                    "seasonYear": state.get("seasonYear"),
                    "maxDays": state.get("maxDays"),
                    "rights": compact_debug_rights(debug_player),
                    "marketValue": compact_debug_player(debug_player).get("marketValue"),
                },
            )

    offseason_min_target = get_free_agency_min_roster_target(updated)
    opening_cleanup_target = max(10, offseason_min_target - 4)
    opening_cleanup_signings = []

    opening_offers = generate_cpu_offers_for_day(
        league_data = updated,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": 1,
        "type": "opening_market",
        "offersGenerated": len(opening_offers),
        "openingCleanupSignings": 0,
        "openingCleanupTarget": opening_cleanup_target,
        "fullMinTarget": offseason_min_target,
    })

    append_free_agency_full_action_log(
        league_data = updated,
        day_resolved = 0,
        offer_day = 1,
        signings = opening_cleanup_signings,
        generated_offers = opening_offers,
        event_type = "opening_market",
    )

    return {
        "ok": True,
        "leagueData": updated,
        "openingOffers": opening_offers,
        "cleanupSignings": opening_cleanup_signings,
        "stateSummary": build_free_agency_state_summary(updated),
    }


def advance_free_agency_day(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    state = ensure_free_agency_state(updated)
    refresh_free_agent_market_values(updated)

    if not state.get("isActive"):
        return {
            "ok": False,
            "reason": "Free agency period is not active.",
            "stateSummary": build_free_agency_state_summary(updated),
        }

    if state.get("pendingUserDecisions"):
        return {
            "ok": False,
            "reason": "Process your pending user signings before advancing the day.",
            "leagueData": updated,
            "stateSummary": build_free_agency_state_summary(updated),
        }

    if state.get("pendingRfaMatchDecisions"):
        return {
            "ok": False,
            "reason": "Process your pending restricted free agent match decisions before advancing the day.",
            "leagueData": updated,
            "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(updated),
        }

    state["forceViewingOffersReturn"] = False
    state["forceViewingOffersReturnReason"] = None
    state["resumeAdvanceAfterImmediateRfaMatch"] = False
    state["resumeAdvanceAfterImmediateRfaMatchDay"] = None

    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    offseason_min_target = get_free_agency_min_roster_target(updated)

    signings = resolve_signings_for_day(
        league_data = updated,
        current_day = current_day,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": current_day,
        "type": "resolution",
        "signings": len(signings),
    })

    if state.get("pendingUserDecisions") or state.get("pendingRfaMatchDecisions"):
        generated_offers = []

        # The Day Complete screen should still show the next wave of CPU offers
        # while the user is deciding which accepted offers to finalize. Generate
        # those offers for display/market continuity, but restore currentDay so
        # the pending user decisions are still resolved as this completed day.
        if current_day < max_days and len(updated.get("freeAgents", [])) > 0:
            original_day = state.get("currentDay")
            state["currentDay"] = current_day + 1
            generated_offers = generate_cpu_offers_for_day(
                league_data = updated,
                user_team_name = user_team_name,
            )
            state["dailyLog"].append({
                "day": current_day + 1,
                "type": "offer_generation_preview_pending_user",
                "offersGenerated": len(generated_offers),
            })
            state["currentDay"] = original_day

        append_free_agency_full_action_log(
            league_data = updated,
            day_resolved = current_day,
            offer_day = current_day + 1 if generated_offers else None,
            signings = signings,
            generated_offers = generated_offers,
            event_type = "daily_resolution_pending_user",
        )

        return {
            "ok": True,
            "leagueData": updated,
            "dayResolved": current_day,
            "signings": signings,
            "generatedOffers": generated_offers,
            "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(updated),
        }

    if current_day >= max_days or len(updated.get("freeAgents", [])) == 0:
        final_cleanup_target = get_min_roster_target(updated)

        final_cleanup_signings = finalize_cpu_min_roster_cleanup(
            league_data = updated,
            current_day = current_day,
            user_team_name = user_team_name,
            min_roster_target_override = final_cleanup_target,
        )

        if final_cleanup_signings:
            signings.extend(final_cleanup_signings)
            state["dailyLog"].append({
                "day": current_day,
                "type": "cpu_final_min_roster_cleanup",
                "signings": len(final_cleanup_signings),
                "targetRosterSize": final_cleanup_target,
            })

        state["isActive"] = False
        state["pendingUserTeamSnapshot"] = None

        append_free_agency_full_action_log(
            league_data = updated,
            day_resolved = current_day,
            offer_day = None,
            signings = signings,
            generated_offers = [],
            event_type = "final_market_resolution",
        )

        return {
            "ok": True,
            "leagueData": updated,
            "dayResolved": current_day,
            "signings": signings,
            "generatedOffers": [],
            "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
            "stateSummary": build_free_agency_state_summary(updated),
        }

    state["currentDay"] = current_day + 1

    generated_offers = generate_cpu_offers_for_day(
        league_data = updated,
        user_team_name = user_team_name,
    )

    state["dailyLog"].append({
        "day": state["currentDay"],
        "type": "offer_generation",
        "offersGenerated": len(generated_offers),
    })

    append_free_agency_full_action_log(
        league_data = updated,
        day_resolved = current_day,
        offer_day = state["currentDay"],
        signings = signings,
        generated_offers = generated_offers,
        event_type = "daily_market_update",
    )

    state["pendingUserTeamSnapshot"] = get_team_cap_snapshot(updated, user_team_name) if user_team_name else None

    return {
        "ok": True,
        "leagueData": updated,
        "dayResolved": current_day,
        "signings": signings,
        "generatedOffers": generated_offers,
        "pendingRfaMatchDecisions": state.get("pendingRfaMatchDecisions", []),
        "stateSummary": build_free_agency_state_summary(updated),
    }

# ------------------------------------------------------------
# IMMEDIATE OFFER EVALUATION / SIGN / RELEASE
# ------------------------------------------------------------
def get_market_acceptance_threshold(
    league_data: Dict[str, Any],
    player: Dict[str, Any],
    contract: Dict[str, Any],
    exclude_offer_id: Optional[str] = None
) -> Dict[str, Any]:
    contract = normalize_contract(contract)
    if not contract:
        return {
            "requiredAAV": MAX_SALARY,
            "autoAccept": False,
            "offerCount": 0,
            "bestLiveAAV": 0,
            "fringePlayer": False,
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    min_acceptable_aav = int(market_value["minAcceptableAAV"])
    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))

    overall = int(round(num(player.get("overall"), 0)))
    age = int(num(player.get("age"), 27))
    potential = int(round(num(player.get("potential"), overall)))

    state = ensure_free_agency_state(league_data)
    player_key = get_player_key_from_player(player)
    active_offers = [
        o for o in state.get("offersByPlayer", {}).get(player_key, [])
        if o.get("status", "active") == "active"
        and (exclude_offer_id is None or o.get("offerId") != exclude_offer_id)
    ]

    offer_count = len(active_offers)
    best_live_aav = max([int(num(o.get("aav"), 0)) for o in active_offers], default = 0)

    current_day = int(num(state.get("currentDay"), 1))
    max_days = int(num(state.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS))
    day_progress = current_day / max(1, max_days)

    fringe_player = (
        overall <= 74
        or (overall <= 75 and (age >= 24 or potential <= overall + 1))
        or (overall <= 76 and age >= 27 and potential <= overall + 2)
        or (overall <= 77 and age >= 31 and potential <= overall + 1)
    )

    if (
        fringe_player
        and offer_count == 0
        and offered_years <= 2
        and offered_aav >= MIN_DEAL
        and current_day >= max(5, int(max_days * 0.50))
    ):
        return {
            "requiredAAV": MIN_DEAL,
            "autoAccept": True,
            "offerCount": offer_count,
            "bestLiveAAV": best_live_aav,
            "fringePlayer": True,
        }

    expected_aav = int(market_value["expectedAAV"])
    option_mult = get_option_required_aav_multiplier(contract)

    if offer_count == 0:
        # Expected AAV is now the clean "ready to sign" target shown to the user.
        # Only true fringe/late-market cases can accept meaningfully below expected.
        if fringe_player:
            market_floor_mult = 0.82 - (0.10 * day_progress)
        elif overall <= 78:
            market_floor_mult = 0.94 - (0.04 * day_progress)
        elif overall <= 81:
            market_floor_mult = 0.97 - (0.03 * day_progress)
        else:
            market_floor_mult = 1.00

        if age >= 32 and overall <= 79:
            market_floor_mult -= 0.03

        market_floor_mult = clamp(market_floor_mult, 0.72, 1.02)
        required_aav = max(
            MIN_DEAL,
            int(round(max(min_acceptable_aav, expected_aav * market_floor_mult) * option_mult)),
        )
    else:
        if overall >= 85:
            best_offer_mult = 0.985
            market_floor_mult = 0.98
        elif overall >= 80:
            best_offer_mult = 0.975
            market_floor_mult = 0.96
        else:
            best_offer_mult = 0.955
            market_floor_mult = 0.92

        if age >= 32 and overall <= 79:
            market_floor_mult -= 0.03

        required_aav = max(
            MIN_DEAL,
            int(round(max(
                best_live_aav * best_offer_mult,
                expected_aav * market_floor_mult,
                min_acceptable_aav,
            ) * option_mult)),
        )

    return {
        "requiredAAV": required_aav,
        "autoAccept": False,
        "offerCount": offer_count,
        "bestLiveAAV": best_live_aav,
        "fringePlayer": fringe_player,
    }
def evaluate_offer(
    league_data: Dict[str, Any],
    team_name: str,
    player: Dict[str, Any],
    offer: Dict[str, Any],
) -> Dict[str, Any]:
    snapshot = get_team_cap_snapshot(league_data, team_name)
    if not snapshot.get("ok"):
        return snapshot

    _, _, team = find_team_entry(league_data, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"{team_name} not found.",
        }

    roster_count = len(get_team_players(team))
    roster_limit = get_roster_limit(league_data)
    state = ensure_free_agency_state(league_data)
    live_market_mode = bool(state.get("isActive"))
    if roster_count >= roster_limit and not live_market_mode:
        return {
            "ok": False,
            "reason": f"{team_name} already has {roster_count} players.",
            "teamSnapshot": snapshot,
        }

    contract = build_contract_from_offer(league_data, offer)
    season_year = get_operating_season_year(league_data)
    offered_current_salary = get_contract_salary_for_year(contract, season_year)

    spending_res = validate_offer_spending_rules(
        league_data = league_data,
        team_name = team_name,
        player = player,
        contract = contract,
        outstanding_current_salary = 0,
        snapshot = snapshot,
    )

    available_room = spending_res.get("exceptionRoom", 0)

    if not spending_res.get("ok"):
        return {
            "ok": False,
            "accepted": False,
            "reason": spending_res.get("reason", "Offer is not legal."),
            "teamSnapshot": snapshot,
            "exceptionRoom": available_room,
            "contract": contract,
            "spendingType": spending_res.get("spendingType"),
            "exceptionType": spending_res.get("exceptionType"),
            "exceptionRemaining": spending_res.get("exceptionRemaining"),
            "birdRights": spending_res.get("birdRights"),
            "payrollZone": spending_res.get("payrollZone"),
            "pendingCapHoldClearance": spending_res.get("pendingCapHoldClearance", False),
            "capHoldClearanceNeeded": spending_res.get("capHoldClearanceNeeded", 0),
            "rawCapRoomWithoutHolds": spending_res.get("rawCapRoomWithoutHolds"),
            "rawPayrollWithoutHolds": spending_res.get("rawPayrollWithoutHolds"),
            "capHoldTotal": spending_res.get("capHoldTotal"),
        }

    market_value = player.get("marketValue") or estimate_market_value(player)

    offered_years = len(contract["salaryByYear"])
    offered_aav = int(sum(contract["salaryByYear"]) / max(1, offered_years))
    expected_years = get_realistic_expected_contract_years(player)
    expected_aav = int(market_value["expectedAAV"])
    min_acceptable_aav = int(market_value["minAcceptableAAV"])

    market_threshold = get_market_acceptance_threshold(
        league_data = league_data,
        player = player,
        contract = contract,
    )

    required_aav = int(market_threshold["requiredAAV"])
    year_penalty = abs(offered_years - expected_years) * 0.06
    option_adjustment = get_contract_option_player_score_adjustment(contract)
    acceptance_score = (offered_aav / max(1, required_aav)) - year_penalty + option_adjustment

    accepted = bool(market_threshold["autoAccept"]) or (
        offered_aav >= required_aav and acceptance_score >= 0.90
    )

    return {
        "ok": True,
        "accepted": accepted,
        "reason": "Offer accepted." if accepted else "Offer rejected.",
        "teamSnapshot": snapshot,
        "contract": contract,
        "marketValue": market_value,
        "exceptionRoom": available_room,
        "spendingType": spending_res.get("spendingType"),
        "exceptionType": spending_res.get("exceptionType"),
        "exceptionRemaining": spending_res.get("exceptionRemaining"),
        "birdRights": spending_res.get("birdRights"),
        "payrollZone": spending_res.get("payrollZone"),
        "pendingCapHoldClearance": spending_res.get("pendingCapHoldClearance", False),
        "capHoldClearanceNeeded": spending_res.get("capHoldClearanceNeeded", 0),
        "rawCapRoomWithoutHolds": spending_res.get("rawCapRoomWithoutHolds"),
        "rawPayrollWithoutHolds": spending_res.get("rawPayrollWithoutHolds"),
        "capHoldTotal": spending_res.get("capHoldTotal"),
        "details": {
            "offeredYears": offered_years,
            "offeredAAV": offered_aav,
            "expectedYears": expected_years,
            "expectedAAV": expected_aav,
            "minAcceptableAAV": min_acceptable_aav,
            "requiredAAV": required_aav,
            "optionAdjustment": round(option_adjustment, 3),
            "acceptanceScore": round(acceptance_score, 3),
            "offerCount": market_threshold["offerCount"],
            "bestLiveAAV": market_threshold["bestLiveAAV"],
            "fringePlayer": market_threshold["fringePlayer"],
        },
    }


def find_free_agent_index(
    free_agents: List[Dict[str, Any]],
    player_id: Optional[str],
    player_name: Optional[str]
) -> int:
    for idx, player in enumerate(free_agents):
        if player_id and player.get("id") == player_id:
            return idx
        if player_name and player.get("name") == player_name:
            return idx
    return -1


def sign_free_agent(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
    offer: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    free_agents = updated.setdefault("freeAgents", [])

    player_idx = find_free_agent_index(free_agents, player_id, player_name)
    if player_idx == -1:
        return {
            "ok": False,
            "reason": "Free agent not found.",
        }

    _, _, team = find_team_entry(updated, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    player = free_agents[player_idx]
    state = ensure_free_agency_state(updated)
    offer = offer or {}

    post_market_cleanup_mode = should_enforce_post_market_cleanup_rules(updated, state)
    if post_market_cleanup_mode:
        # Post-market free agency is still offseason team building. The user can
        # keep signing without roster-count blockers; Calendar will require a
        # legal standard/two-way roster before any games are simulated.
        pass

    evaluation = evaluate_offer(updated, team_name, player, offer)
    if not evaluation.get("ok"):
        return evaluation
    if not evaluation.get("accepted"):
        return evaluation

    roster_add_ok, roster_add_reason = can_add_standard_player_during_free_agency(
        league_data = updated,
        team = team,
        player = player,
        team_name = team_name,
        source = "user",
        matched_rfa = False,
    )
    if not roster_add_ok:
        return {
            "ok": False,
            "accepted": False,
            "reason": roster_add_reason,
            "teamSnapshot": snapshot if (snapshot := get_team_cap_snapshot(updated, team_name)) else None,
        }

    signed_player = copy.deepcopy(player)
    signed_player["contract"] = apply_free_agency_start_year(
        updated,
        evaluation["contract"],
    )
    signed_player["marketValue"] = estimate_market_value(signed_player)

    update_player_rights_after_signing(
        player = signed_player,
        team_name = team_name,
        signing_source = "free_agency",
        matched_rfa = False,
    )

    setoff_rows = apply_dead_cap_setoff_for_signed_player(
        league_data = updated,
        player = player,
        signing_team_name = team_name,
        contract = signed_player.get("contract"),
    )

    free_agents.pop(player_idx)
    team.setdefault("players", []).append(signed_player)

    return {
        "ok": True,
        "reason": f"{signed_player.get('name', 'Player')} signed with {team_name}.",
        "leagueData": updated,
        "signedPlayer": signed_player,
        "teamName": team_name,
        "deadCapSetoffRows": setoff_rows,
        "teamSnapshot": get_team_cap_snapshot(updated, team_name),
    }

def release_player(
    league_data: Dict[str, Any],
    team_name: str,
    player_id: Optional[str] = None,
    player_name: Optional[str] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    season_year = get_current_season_year(updated)
    _, _, team = find_team_entry(updated, team_name)

    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    players = team.setdefault("players", [])
    release_idx = -1

    for idx, player in enumerate(players):
        if player_id and player.get("id") == player_id:
            release_idx = idx
            break
        if player_name and player.get("name") == player_name:
            release_idx = idx
            break

    if release_idx == -1:
        return {
            "ok": False,
            "reason": "Player not found on team roster.",
        }

    released_player = copy.deepcopy(players.pop(release_idx))
    dead_cap_rows = add_dead_cap_from_player_contract(
        league_data = updated,
        team_name = team_name,
        player = released_player,
        current_season_year = season_year,
        reason = "release_to_free_agency",
    )

    released_player["previousContract"] = normalize_contract(released_player.get("contract"))
    released_player["contract"] = None
    set_player_rights(
        player = released_player,
        held_by_team = None,
        seasons_toward_bird = 0,
        rookie_scale = get_player_rights(released_player).get("rookieScale", False),
        restricted_free_agent = False,
    )
    released_player["marketValue"] = estimate_market_value(released_player)
    released_player["freeAgencyMeta"] = {
        "fromTeam": team_name,
        "seasonYear": season_year,
        "reason": "released",
    }

    updated.setdefault("freeAgents", []).append(released_player)

    return {
        "ok": True,
        "reason": f"{released_player.get('name', 'Player')} released to free agency.",
        "leagueData": updated,
        "releasedPlayer": released_player,
        "deadCapRows": dead_cap_rows,
        "teamName": team_name,
        "teamSnapshot": get_team_cap_snapshot(updated, team_name),
    }


def preview_rights_management(
    league_data: Dict[str, Any],
    team_name: Optional[str] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    refresh_free_agent_market_values(updated)

    if not team_name:
        return {
            "ok": False,
            "reason": "No team name provided for rights management.",
        }

    _, _, team = find_team_entry(updated, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
        }

    snapshot = get_team_cap_snapshot(updated, team_name)
    rows = snapshot.get("capHoldRows", [])

    return {
        "ok": True,
        "leagueData": updated,
        "teamName": team_name,
        "rightsRows": rows,
        "rows": rows,
        "teamSnapshot": snapshot,
        "summary": {
            "teamName": team_name,
            "seasonYear": snapshot.get("seasonYear"),
            "salaryCap": snapshot.get("salaryCap"),
            "playerPayroll": snapshot.get("playerPayroll", 0),
            "deadCap": snapshot.get("deadCap", 0),
            "payrollBeforeHolds": snapshot.get("rawPayrollWithoutHolds", 0),
            "rawCapRoomWithoutHolds": snapshot.get("rawCapRoomWithoutHolds", 0),
            "capHoldTotal": snapshot.get("capHoldTotal", 0),
            "practicalPayroll": snapshot.get("practicalPayroll", 0),
            "practicalCapRoom": snapshot.get("practicalCapRoom", 0),
            "rightsCount": len(rows),
        },
    }


def _normalize_rights_decision(value: Any) -> str:
    if isinstance(value, bool):
        return "renounce" if value else "keep"

    raw = str(value or "keep").strip().lower().replace("-", "_").replace(" ", "_")

    if raw in ["renounce", "renounced", "release_rights", "drop_rights"]:
        return "renounce"

    if raw in ["extend_qo", "extend_qualifying_offer", "offer_qo", "offer_qualifying_offer"]:
        return "extend_qo"

    if raw in ["decline_qo", "decline_qualifying_offer", "do_not_offer_qo", "no_qo"]:
        return "decline_qo"

    if raw in ["withdraw_qo", "withdraw_qualifying_offer", "remove_qo"]:
        return "withdraw_qo"

    if raw in ["keep_qo", "keep_qualifying_offer"]:
        return "keep_qo"

    if raw in ["keep", "keep_rights", "retain", "retain_rights", ""]:
        return "keep"

    return "keep"


def _get_rights_decision_for_player(
    rights_decisions: Dict[str, Any],
    player: Dict[str, Any],
) -> str:
    player_key = get_cap_hold_player_key(player)
    player_id = player.get("id")
    player_name = player.get("name")

    possible_keys = [
        player_key,
        str(player_id) if player_id not in [None, ""] else None,
        str(player_name) if player_name not in [None, ""] else None,
    ]

    for key in possible_keys:
        if key and key in rights_decisions:
            return _normalize_rights_decision(rights_decisions.get(key))

    return "keep"


def apply_rights_management(
    league_data: Dict[str, Any],
    team_name: Optional[str] = None,
    rights_decisions: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)
    refresh_free_agent_market_values(updated)

    rights_decisions = rights_decisions or {}

    if not team_name:
        return {
            "ok": False,
            "reason": "No team name provided for rights management.",
            "leagueData": updated,
        }

    _, _, team = find_team_entry(updated, team_name)
    if team is None:
        return {
            "ok": False,
            "reason": f"Team '{team_name}' not found.",
            "leagueData": updated,
        }

    decision_log = []

    for player in updated.get("freeAgents", []):
        rights = get_player_rights(player)
        if rights.get("heldByTeam") != team_name:
            continue

        decision = _get_rights_decision_for_player(
            rights_decisions = rights_decisions,
            player = player,
        )

        if decision == "renounce":
            old_cap_hold = get_player_cap_hold_amount(
                league_data = updated,
                player = player,
                team_name = team_name,
            )

            set_player_rights(
                player = player,
                held_by_team = None,
                seasons_toward_bird = 0,
                rookie_scale = rights.get("rookieScale", False),
                restricted_free_agent = False,
            )

            player["rightsRenounced"] = True
            player.pop("qualifyingOffer", None)
            player.pop("qualifyingOfferEligible", None)

            decision_log.append({
                "playerKey": get_cap_hold_player_key(player),
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "teamName": team_name,
                "decision": "renounce",
                "capHoldCleared": old_cap_hold,
            })

        elif decision == "extend_qo":
            eligible = player.get("qualifyingOfferEligible") if isinstance(player.get("qualifyingOfferEligible"), dict) else None
            amount = int(num(eligible.get("amount"), 0)) if eligible else get_qualifying_offer_amount(updated, player)

            set_player_rights(
                player = player,
                held_by_team = team_name,
                seasons_toward_bird = rights.get("seasonsTowardBird", 0),
                rookie_scale = rights.get("rookieScale", False),
                restricted_free_agent = True,
            )

            player["qualifyingOffer"] = {
                "teamName": team_name,
                "amount": int(round_to_nearest(max(MIN_DEAL, amount), base = 1_000)),
                "seasonYear": int(num((eligible or {}).get("seasonYear"), get_current_season_year(updated) + 1)),
                "status": "extended",
            }
            player.pop("qualifyingOfferEligible", None)
            player.pop("rightsRenounced", None)

            decision_log.append({
                "playerKey": get_cap_hold_player_key(player),
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "teamName": team_name,
                "decision": "extend_qo",
                "qualifyingOfferAmount": int(player["qualifyingOffer"]["amount"]),
            })

        elif decision in ["decline_qo", "withdraw_qo"]:
            old_qo = player.get("qualifyingOffer") if isinstance(player.get("qualifyingOffer"), dict) else None
            old_eligible = player.get("qualifyingOfferEligible") if isinstance(player.get("qualifyingOfferEligible"), dict) else None

            set_player_rights(
                player = player,
                held_by_team = team_name,
                seasons_toward_bird = rights.get("seasonsTowardBird", 0),
                rookie_scale = rights.get("rookieScale", False),
                restricted_free_agent = False,
            )

            player.pop("qualifyingOffer", None)
            player.pop("qualifyingOfferEligible", None)
            player.pop("rightsRenounced", None)

            decision_log.append({
                "playerKey": get_cap_hold_player_key(player),
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "teamName": team_name,
                "decision": decision,
                "qualifyingOfferAmount": int(num((old_qo or old_eligible or {}).get("amount"), 0)),
            })

        else:
            if decision == "keep_qo" and isinstance(player.get("qualifyingOffer"), dict):
                set_player_rights(
                    player = player,
                    held_by_team = team_name,
                    seasons_toward_bird = rights.get("seasonsTowardBird", 0),
                    rookie_scale = rights.get("rookieScale", False),
                    restricted_free_agent = True,
                )
                player.pop("rightsRenounced", None)

            decision_log.append({
                "playerKey": get_cap_hold_player_key(player),
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "teamName": team_name,
                "decision": "keep_qo" if decision == "keep_qo" else "keep",
                "capHoldKept": get_player_cap_hold_amount(
                    league_data = updated,
                    player = player,
                    team_name = team_name,
                ),
            })

    preview_after = preview_rights_management(
        league_data = updated,
        team_name = team_name,
    )

    return {
        "ok": True,
        "leagueData": updated,
        "teamName": team_name,
        "decisionLog": decision_log,
        "summary": {
            "keptCount": len([row for row in decision_log if row.get("decision") in ["keep", "keep_qo"]]),
            "renouncedCount": len([row for row in decision_log if row.get("decision") == "renounce"]),
            "extendedQOCount": len([row for row in decision_log if row.get("decision") == "extend_qo"]),
            "declinedQOCount": len([row for row in decision_log if row.get("decision") == "decline_qo"]),
            "withdrawnQOCount": len([row for row in decision_log if row.get("decision") == "withdraw_qo"]),
            "capHoldCleared": int(sum(int(num(row.get("capHoldCleared"), 0)) for row in decision_log)),
        },
        "previewAfter": preview_after,
        "teamSnapshot": preview_after.get("teamSnapshot"),
    }



def get_roster_repair_keep_score(player: Dict[str, Any]) -> float:
    overall = float(num(player.get("overall"), 0))
    potential = float(num(player.get("potential"), overall))
    age = int(num(player.get("age"), 27))
    upside = max(0.0, potential - overall)
    contract = normalize_contract(player.get("contract"))
    salary = 0
    if contract:
        salary_by_year = contract.get("salaryByYear", [])
        salary = int(num(salary_by_year[0], 0)) if salary_by_year else 0

    score = overall + potential * 0.22 + upside * 0.75

    if age <= 23:
        score += 3.5
    elif age <= 26:
        score += 1.5
    elif age >= 34:
        score -= 3.0
    elif age >= 31:
        score -= 1.2

    if overall >= 80:
        score += 8.0
    elif overall >= 76:
        score += 4.0
    elif overall >= 72:
        score += 1.0

    # Cheap young assets are worth holding; older low-end money is more cuttable.
    if age <= 24 and upside >= 4:
        score += 2.0
    if overall < 74 and salary >= 5_000_000:
        score -= min(4.0, salary / 5_000_000)

    return float(score)


def is_repair_two_way_eligible(player: Dict[str, Any], season_year: int) -> bool:
    if not isinstance(player, dict):
        return False

    overall = int(round(num(player.get("overall"), 0)))
    potential = int(round(num(player.get("potential"), overall)))
    age = int(num(player.get("age"), 22))
    upside = max(0, potential - overall)

    if overall >= 76:
        return False
    if overall >= 74 and potential >= 82:
        return False
    if age >= 25 and overall >= 72:
        return False

    rookie_year = get_player_rookie_reference_year(player)
    if rookie_year is not None:
        if int(season_year) - int(rookie_year) >= 3:
            return False
    elif get_player_pro_seasons(player) >= 3:
        return False

    return bool(overall <= 73 or (age <= 23 and overall <= 75 and upside <= 3))


def move_standard_player_to_two_way_for_repair(
    team: Dict[str, Any],
    player: Dict[str, Any],
    season_year: int,
) -> Dict[str, Any]:
    team_name = team.get("name") or team.get("teamName") or "Unknown Team"
    moved = copy.deepcopy(player)
    moved["previousStandardContract"] = copy.deepcopy(player.get("contract")) if isinstance(player.get("contract"), dict) else None
    moved["contract"] = build_two_way_contract_for_season(
        start_year = int(season_year),
        source = "cpu_roster_repair_two_way_conversion",
    )
    moved["contractType"] = "two_way"
    moved["rosterStatus"] = "two_way"
    moved["assignmentStatus"] = "g_league"
    moved["team"] = team_name

    meta = moved.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["cpuRosterRepairTwoWay"] = True
        meta["twoWayAssignedSeasonYear"] = int(season_year)

    tw_meta = moved.get("twoWayMeta") if isinstance(moved.get("twoWayMeta"), dict) else {}
    moved["twoWayMeta"] = {
        **tw_meta,
        "currentTwoWaySeasonYear": int(season_year),
        "assignedSeasonYear": int(season_year),
        "twoWayYearsUsed": max(1, int(num(tw_meta.get("twoWayYearsUsed"), moved.get("twoWayYearsUsed") or 1))),
        "maxTwoWayYears": 2,
        "source": "cpu_roster_repair_two_way_conversion",
    }
    moved["twoWayYearsUsed"] = moved["twoWayMeta"]["twoWayYearsUsed"]
    moved["maxTwoWayYears"] = 2

    player_key = get_player_key(player.get("id"), player.get("name"))
    team["players"] = [
        p for p in (team.get("players") or [])
        if get_player_key(p.get("id"), p.get("name")) != player_key
    ]
    append_unique_contract_player(team.setdefault("twoWayPlayers", []), moved)

    return {
        "playerId": moved.get("id"),
        "playerName": moved.get("name"),
        "teamName": team_name,
        "action": "standard_to_two_way",
        "overall": moved.get("overall"),
        "reason": "cpu_roster_repair_two_way_conversion",
    }


def trim_cpu_team_to_season_roster_limits(
    league_data: Dict[str, Any],
    team: Dict[str, Any],
    season_year: int,
) -> Dict[str, Any]:
    team_name = team.get("name") or team.get("teamName") or "Unknown Team"
    actions = {
        "twoWayAssignments": [],
        "droppedPlayers": [],
        "twoWayDrops": [],
    }

    if not isinstance(team.get("players"), list):
        team["players"] = []
    if not isinstance(team.get("twoWayPlayers"), list):
        team["twoWayPlayers"] = []

    # Two-way overflow: keep the best three and release the rest.
    if len(team.get("twoWayPlayers") or []) > TWO_WAY_MAX:
        sorted_two_way = sorted(
            team.get("twoWayPlayers") or [],
            key = get_roster_repair_keep_score,
            reverse = True,
        )
        keep = sorted_two_way[:TWO_WAY_MAX]
        drop = sorted_two_way[TWO_WAY_MAX:]
        team["twoWayPlayers"] = keep

        for player in drop:
            fa_player = add_player_to_free_agency(
                updated = league_data,
                player = player,
                from_team_name = team_name,
                season_year = season_year,
                reason = "two_way_roster_limit_release",
            )
            clear_player_team_control_for_ufa(fa_player)
            actions["twoWayDrops"].append({
                "playerId": player.get("id"),
                "playerName": player.get("name"),
                "teamName": team_name,
                "action": "released_two_way_over_limit",
                "overall": player.get("overall"),
            })

    # Standard overflow: first move young eligible fringe players to two-way.
    safety = 0
    while (
        len(team.get("players") or []) > REGULAR_SEASON_MAX_ROSTER
        and len(team.get("twoWayPlayers") or []) < TWO_WAY_MAX
        and safety < 12
    ):
        safety += 1
        candidates = [
            p for p in (team.get("players") or [])
            if is_repair_two_way_eligible(p, season_year)
        ]
        if not candidates:
            break

        candidates.sort(
            key = lambda p: (
                get_roster_repair_keep_score(p),
                int(num(p.get("overall"), 0)),
                int(num(p.get("potential"), 0)),
            )
        )
        moved = move_standard_player_to_two_way_for_repair(
            team = team,
            player = candidates[0],
            season_year = season_year,
        )
        actions["twoWayAssignments"].append(moved)

    # If still over 15, release fringe standards. This should be rare after the
    # two-way conversion pass and should target low-end, older, cheap/minimum
    # players before useful young assets.
    while len(team.get("players") or []) > REGULAR_SEASON_MAX_ROSTER:
        players = list(team.get("players") or [])
        if not players:
            break
        players.sort(
            key = lambda p: (
                get_roster_repair_keep_score(p),
                int(num(p.get("overall"), 0)),
                int(num(p.get("potential"), 0)),
            )
        )
        cut = players[0]
        cut_key = get_player_key(cut.get("id"), cut.get("name"))
        team["players"] = [
            p for p in (team.get("players") or [])
            if get_player_key(p.get("id"), p.get("name")) != cut_key
        ]
        fa_player = add_player_to_free_agency(
            updated = league_data,
            player = cut,
            from_team_name = team_name,
            season_year = season_year,
            reason = "standard_roster_limit_release",
        )
        clear_player_team_control_for_ufa(fa_player)
        actions["droppedPlayers"].append({
            "playerId": cut.get("id"),
            "playerName": cut.get("name"),
            "teamName": team_name,
            "action": "released_standard_over_limit",
            "overall": cut.get("overall"),
            "reason": "standard_roster_limit_release",
        })

    return actions


def repair_cpu_teams_to_min_roster(
    league_data: Dict[str, Any],
    user_team_name: Optional[str] = None,
    min_players: Optional[int] = None,
    current_day: int = 0,
) -> Dict[str, Any]:
    updated = copy.deepcopy(league_data)
    normalize_all_player_rights(updated)

    if min_players is not None:
        try:
            updated["minRosterSize"] = int(min_players)
        except (TypeError, ValueError):
            pass

    refresh_free_agent_market_values(updated)

    season_year = get_current_season_year(updated)

    dropped_players: List[Dict[str, Any]] = []
    two_way_assignments: List[Dict[str, Any]] = []
    two_way_drops: List[Dict[str, Any]] = []

    # Before games can sim, CPU teams must be season-legal. This pass allows the
    # offseason to be flexible, then cleans CPU teams by moving eligible young
    # fringe players to two-way first and only cutting if still over 15.
    for _, _, team in iter_teams(updated):
        team_name = team.get("name")
        if not team_name:
            continue
        if user_team_name and team_name == user_team_name:
            continue

        trim_actions = trim_cpu_team_to_season_roster_limits(
            league_data = updated,
            team = team,
            season_year = season_year,
        )
        dropped_players.extend(trim_actions.get("droppedPlayers", []))
        two_way_assignments.extend(trim_actions.get("twoWayAssignments", []))
        two_way_drops.extend(trim_actions.get("twoWayDrops", []))

    cleanup_signings = finalize_cpu_min_roster_cleanup(
        league_data = updated,
        current_day = int(num(current_day, 0)),
        user_team_name = user_team_name,
    )

    # Emergency signings may make the roster legal, but run one more light pass
    # in case an old save or edge case still has too many players.
    for _, _, team in iter_teams(updated):
        team_name = team.get("name")
        if not team_name:
            continue
        if user_team_name and team_name == user_team_name:
            continue

        trim_actions = trim_cpu_team_to_season_roster_limits(
            league_data = updated,
            team = team,
            season_year = season_year,
        )
        dropped_players.extend(trim_actions.get("droppedPlayers", []))
        two_way_assignments.extend(trim_actions.get("twoWayAssignments", []))
        two_way_drops.extend(trim_actions.get("twoWayDrops", []))

    min_target = get_min_roster_target(updated)
    failed_teams = []
    over_max_teams = []
    over_two_way_teams = []

    for _, _, team in iter_teams(updated):
        team_name = team.get("name")
        if not team_name:
            continue
        if user_team_name and team_name == user_team_name:
            continue

        player_count = len(get_team_players(team))
        two_way_count = len(team.get("twoWayPlayers") or [])

        if player_count < min_target:
            failed_teams.append({
                "teamName": team_name,
                "playerCount": player_count,
                "minPlayers": min_target,
            })

        if player_count > REGULAR_SEASON_MAX_ROSTER:
            over_max_teams.append({
                "teamName": team_name,
                "playerCount": player_count,
                "maxPlayers": REGULAR_SEASON_MAX_ROSTER,
            })

        if two_way_count > TWO_WAY_MAX:
            over_two_way_teams.append({
                "teamName": team_name,
                "twoWayCount": two_way_count,
                "twoWayMax": TWO_WAY_MAX,
            })

    return {
        "ok": len(failed_teams) == 0 and len(over_max_teams) == 0 and len(over_two_way_teams) == 0,
        "leagueData": updated,
        "signings": cleanup_signings,
        "droppedPlayers": dropped_players + two_way_drops,
        "twoWayAssignments": two_way_assignments,
        "failedTeams": failed_teams,
        "overMaxTeams": over_max_teams,
        "overTwoWayTeams": over_two_way_teams,
        "minPlayers": min_target,
        "maxPlayers": REGULAR_SEASON_MAX_ROSTER,
        "twoWayMax": TWO_WAY_MAX,
    }
def handle_request(request: Dict[str, Any]) -> Dict[str, Any]:
    action = request.get("action")
    league_data = request.get("leagueData", {})
    payload = request.get("payload", {}) or {}

    if action == "get_team_cap_snapshot":
        return get_team_cap_snapshot(
            league_data,
            payload.get("teamName", ""),
        )

    if action == "estimate_market_for_player":
        player = payload.get("player", {})
        return {
            "ok": True,
            "marketValue": estimate_market_value(player),
        }

    if action == "generate_market_for_all_free_agents":
        return add_market_values_to_free_agents(league_data)

    if action in ["preview_offseason_contracts", "preview_player_team_options"]:
        return preview_offseason_contracts(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
        )

    if action in ["apply_offseason_contract_decisions", "apply_player_team_options"]:
        return apply_offseason_contract_decisions(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            team_option_decisions = payload.get("teamOptionDecisions", {}) or {},
        )

    if action == "preview_rights_management":
        return preview_rights_management(
            league_data = league_data,
            team_name = payload.get("teamName") or payload.get("userTeamName"),
        )

    if action == "apply_rights_management":
        return apply_rights_management(
            league_data = league_data,
            team_name = payload.get("teamName") or payload.get("userTeamName"),
            rights_decisions = payload.get("rightsDecisions", {}) or {},
        )

    if action == "initialize_free_agency_period":
        return initialize_free_agency_period(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            max_days = int(num(payload.get("maxDays"), DEFAULT_FREE_AGENCY_DAYS)),
        )

    if action == "get_free_agency_state_summary":
        return {
            "ok": True,
            "stateSummary": build_free_agency_state_summary(league_data),
        }

    if action == "get_free_agent_offers":
        return get_free_agent_offers(
            league_data = league_data,
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
        )

    if action == "submit_user_free_agent_offer":
        return submit_user_free_agent_offer(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
            offer = payload.get("offer", {}),
        )

    if action == "advance_free_agency_day":
        return advance_free_agency_day(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
        )

    if action == "process_pending_user_decisions":
        return process_pending_user_decisions(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            selected_player_keys = payload.get("selectedPlayerKeys", []) or [],
            rights_decisions = payload.get("rightsDecisions", {}) or {},
            declined_player_keys = payload.get("declinedPlayerKeys", []) or [],
        )

    if action == "process_pending_rfa_match_decision":
        return process_pending_rfa_match_decision(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            player_key = payload.get("playerKey"),
            decision = payload.get("decision", "decline"),
            rights_decisions = payload.get("rightsDecisions", {}) or {},
        )

    if action == "evaluate_offer":
        player = payload.get("player", {})
        return evaluate_offer(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player = player,
            offer = payload.get("offer", {}),
        )

    if action == "sign_free_agent":
        return sign_free_agent(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
            offer = payload.get("offer", {}),
        )
    if action == "release_player":
        return release_player(
            league_data = league_data,
            team_name = payload.get("teamName", ""),
            player_id = payload.get("playerId"),
            player_name = payload.get("playerName"),
        )

    if action == "repair_cpu_teams_to_min_roster":
        return repair_cpu_teams_to_min_roster(
            league_data = league_data,
            user_team_name = payload.get("userTeamName"),
            min_players = payload.get("minPlayers"),
            current_day = int(num(payload.get("currentDay"), 0)),
        )

    return {
        "ok": False,
        "reason": f"Unknown action '{action}'.",
    }


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({
            "ok": False,
            "reason": "No JSON request provided on stdin.",
        }))
        return

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({
            "ok": False,
            "reason": f"Invalid JSON: {exc}",
        }))
        return

    result = handle_request(request)
    print(json.dumps(result))


if __name__ == "__main__":
    main()