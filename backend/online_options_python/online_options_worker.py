"""Online-only adapter for the UNMODIFIED single-player free-agency option engine.

Every input is assembled by the authenticated backend from the authoritative runtime.
No player/roster data or human-team assignments come from a browser request.
"""
import copy
import importlib.util
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('bm_singleplayer_options', BASE / 'free_agency_logic.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class HumanTeams(str):
    """Allow the original *single-player* per-team choice branches for each online GM.

    The original code compares ``team_name == user_team_name`` and checks truthiness.
    This str subclass opts multiple human team names into those same exact branches.
    All NBA and CPU evaluation functions themselves remain unchanged.
    """
    def __new__(cls, names):
        out = super().__new__(cls, 'ONLINE_HUMAN_TEAMS')
        out.names = frozenset(names)
        return out

    def __eq__(self, other):
        return isinstance(other, str) and other in self.names

    __hash__ = str.__hash__


def team_rows(preview, team):
    return {
        'teamOptions': [r for r in preview.get('teamOptions', []) if r.get('teamName') == team],
        'playerOptions': [r for r in preview.get('playerOptions', []) if r.get('teamName') == team],
        'expiredContracts': [r for r in preview.get('expiredContracts', []) if r.get('teamName') == team],
        'twoWay': [r for r in preview.get('twoWayDecisions', []) if r.get('teamName') == team],
        'stash': [r for r in preview.get('stashDecisions', []) if r.get('teamName') == team],
    }


def require_exact_decisions(rows, decisions):
    if not isinstance(decisions, dict) or set(decisions) != {'teamOptions', 'twoWay', 'stash'}:
        raise ValueError('Team option choices must include exactly three decision categories')
    expected = {
        'teamOptions': {str(row['playerId']) for row in rows['teamOptions']},
        'twoWay': {str(row['playerId']) for row in rows['twoWay']},
        'stash': {str(row['playerId']) for row in rows['stash']},
    }
    for category, ids in expected.items():
        values = decisions[category]
        if not isinstance(values, dict) or set(values) != ids or any(len(k) > 150 for k in values):
            raise ValueError(f'Missing, extra or ambiguous {category} decision')
        if category == 'teamOptions':
            if any(type(value) is not bool for value in values.values()):
                raise ValueError('Each team option needs a true/false choice')
        else:
            by_id = {str(row['playerId']): row for row in rows[category]}
            for player_id, choice in values.items():
                allowed = by_id[player_id].get('availableDecisions') or ([] if category == 'stash' else ['convert', 'release'])
                if not isinstance(choice, str) or choice not in allowed:
                    raise ValueError(f'Illegal {category} choice for {player_id}')
    return True


def main():
    request = json.load(sys.stdin)
    state = request['league']
    if not isinstance(state, dict):
        raise ValueError('Invalid online league snapshot')
    year = request['year']
    if type(year) is not int or not 2026 <= year <= 2100:
        raise ValueError('Invalid offseason year')
    shadow = copy.deepcopy(state)
    # The online season remains the *completed* season until rollover. The
    # original option processor needs the NEXT payroll year at this checkpoint.
    shadow['contractSeasonYear'] = year
    flat = isinstance(shadow.get('teams'), list)
    if flat:
        original_teams = shadow.pop('teams')
        if len(original_teams) != 30:
            raise ValueError('Expected 30 NBA teams')
        shadow['conferences'] = {'East': original_teams[:15], 'West': original_teams[15:]}
    names = request.get('humanTeams', [])
    if not isinstance(names, list) or not names or len(set(names)) != len(names):
        raise ValueError('Missing active human teams')
    roster = [t for c in ('East', 'West') for t in shadow.get('conferences', {}).get(c, [])]
    team_names = [t.get('name') for t in roster]
    if len(team_names) != 30 or len(set(team_names)) != 30 or any(n not in team_names for n in names):
        raise ValueError('Invalid league team membership')
    preview = engine.preview_offseason_contracts(shadow, user_team_name=None)
    if not preview.get('ok') or preview.get('seasonYear') != year:
        raise ValueError('Original option engine returned the wrong offseason year')
    if request['mode'] == 'preview':
        team = request['teamName']
        if team not in names:
            raise ValueError('Cannot preview another GM\'s option choices')
        return {'ok': True, 'year': year, 'rows': team_rows(preview, team), 'summary': preview.get('summary', {})}
    if request['mode'] == 'validate':
        team = request['teamName']
        if team not in names:
            raise ValueError('Cannot submit another GM\'s decisions')
        require_exact_decisions(team_rows(preview, team), request['decisions'])
        return {'ok': True, 'year': year, 'counts': {k: len(v) for k,v in request['decisions'].items()}}
    if request['mode'] != 'finalize':
        raise ValueError('Unknown original option-engine action')
    submitted = request['decisionsByTeam']
    if not isinstance(submitted, dict) or set(submitted) != set(names):
        raise ValueError('Every human GM must submit their option choices')
    options = {}
    twoway = {}
    stash = {}
    seen = set()
    for team in names:
        own_rows = team_rows(preview, team)
        choices = submitted[team]
        require_exact_decisions(own_rows, choices)
        for category, target in [('teamOptions', options), ('twoWay', twoway), ('stash', stash)]:
            for player_id, value in choices[category].items():
                if player_id in seen:
                    raise ValueError('Duplicate option-player ID across human rosters')
                seen.add(player_id)
                target[player_id] = value
    choices = {**options, '__twoWayDecisions': twoway, '__stashDecisions': stash}
    # The original option engine contains all CPU decisions and contract logic.
    # Multi-GM scope only selects which teams' choices are user-controlled.
    result = engine.apply_offseason_contract_decisions(shadow, user_team_name=HumanTeams(names), team_option_decisions=choices)
    if not result.get('ok'):
        raise ValueError(result.get('reason') or 'Original player/team option engine rejected this batch')
    new_state = result['leagueData']
    if flat:
        next_groups = new_state.pop('conferences')
        new_state['teams'] = [t for c in ('East','West') for t in next_groups[c]]
    # The artificial payroll-year context exists only inside the worker.
    if 'contractSeasonYear' not in state:
        new_state.pop('contractSeasonYear', None)
    else:
        new_state['contractSeasonYear'] = state['contractSeasonYear']
    if new_state.get('onlineDraft') != state.get('onlineDraft'):
        raise ValueError('Original options processor modified drafted players')
    result['leagueData'] = new_state
    return {'ok': True, 'year': year, 'leagueData': new_state,
            'summary': result.get('summary', {}), 'decisionLog': result.get('decisionLog', [])}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), separators=(',', ':'), allow_nan=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'reason': str(exc)[:380]}))
