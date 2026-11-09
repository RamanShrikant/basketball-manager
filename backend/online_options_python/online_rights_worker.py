"""Multiplayer adapter for the unchanged single-player Bird/QO/rights engine.

Runs in an isolated trusted Python subprocess. Player decisions are validated by
stable ID against the original cap-hold preview; no browser-supplied rosters.
"""
import copy
import importlib.util
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('bm_original_rights', BASE / 'free_agency_logic.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def league_for_original(source, year):
    original = copy.deepcopy(source)
    original['contractSeasonYear'] = year
    if isinstance(original.get('teams'), list):
        teams = original.pop('teams')
        if len(teams) != 30:
            raise ValueError('Expected exactly thirty NBA teams')
        original['conferences'] = {'East': teams[:15], 'West': teams[15:]}
    return original


def available(row):
    if isinstance(row.get('qualifyingOfferEligible'), dict) and row['qualifyingOfferEligible'].get('status') == 'pending':
        return ['extend_qo', 'decline_qo', 'renounce']
    if isinstance(row.get('qualifyingOffer'), dict) and row['qualifyingOffer'].get('status') == 'extended':
        return ['keep_qo', 'withdraw_qo', 'renounce']
    return ['keep', 'renounce']


def preview(original, team):
    result = engine.preview_rights_management(original, team_name=team)
    if result.get('ok') is not True:
        raise ValueError(result.get('reason') or 'Original Bird-rights preview unavailable')
    rows = []
    ids = set()
    for row in result.get('rightsRows', []):
        player_id = row.get('playerId')
        if player_id is None or not str(player_id) or str(player_id) in ids:
            raise ValueError('Ambiguous free-agent identity in rights preview')
        ids.add(str(player_id))
        rows.append({
            'playerId': str(player_id), 'playerName': row.get('playerName'),
            'position': row.get('position'), 'overall': row.get('overall'),
            'age': row.get('age'), 'birdLevel': row.get('birdLevel'),
            'restrictedFreeAgent': bool(row.get('restrictedFreeAgent')),
            'capHold': row.get('capHoldAmount', 0),
            'qualifyingOffer': row.get('qualifyingOffer'),
            'qualifyingOfferEligible': row.get('qualifyingOfferEligible'),
            'availableDecisions': available(row),
        })
    # The original cap-hold preview intentionally omits zero-hold rights.
    # They still require a keep/renounce choice before the shared stage closes.
    for player in result.get('leagueData', {}).get('freeAgents', []):
        rights = engine.get_player_rights(player)
        player_id = player.get('id')
        if rights.get('heldByTeam') != team or player_id is None or str(player_id) in ids:
            continue
        ids.add(str(player_id))
        candidate = {
            'playerId': str(player_id), 'playerName': player.get('name'),
            'position': player.get('pos') or player.get('position'),
            'overall': player.get('overall'), 'age': player.get('age'),
            'birdLevel': rights.get('birdLevel', 'none'),
            'restrictedFreeAgent': bool(rights.get('restrictedFreeAgent')),
            'capHold': 0,
            'qualifyingOffer': player.get('qualifyingOffer'),
            'qualifyingOfferEligible': player.get('qualifyingOfferEligible'),
        }
        candidate['availableDecisions'] = available(candidate)
        rows.append(candidate)
    rows.sort(key=lambda row: (-int(row.get('capHold') or 0), str(row.get('playerName') or '')))
    return rows, result.get('summary', {})


def validate(rows, decisions):
    if not isinstance(decisions, dict):
        raise ValueError('Rights choices must be a player-ID object')
    expected = {r['playerId']: r for r in rows}
    if set(decisions) != set(expected) or len(decisions) > 100:
        raise ValueError('Rights choices must include exactly your eligible free agents')
    for player_id, choice in decisions.items():
        if not player_id or len(player_id) > 150 or type(choice) is not str or choice not in expected[player_id]['availableDecisions']:
            raise ValueError('Invalid Bird rights or qualifying-offer decision')
    return True


def execute(data):
    state, year, humans = data['league'], data['year'], data['humanTeams']
    if not isinstance(state, dict) or type(year) is not int or not 2026 <= year <= 2100:
        raise ValueError('Invalid league or offseason year')
    if not isinstance(humans, list) or not 1 <= len(humans) <= 4 or len(humans) != len(set(humans)):
        raise ValueError('Invalid active human-GM assignments')
    original = league_for_original(state, year)
    all_teams = [t.get('name') for group in original.get('conferences', {}).values() for t in group]
    if len(all_teams) != 30 or len(set(all_teams)) != 30 or any(t not in all_teams for t in humans):
        raise ValueError('Invalid NBA team assignments')
    mode = data.get('mode')
    if mode in ('preview', 'validate'):
        team = data.get('teamName')
        if team not in humans:
            raise ValueError('You do not manage this team')
        rows, summary = preview(original, team)
        if mode == 'validate':
            validate(rows, data.get('decisions'))
            return {'ok': True, 'year': year, 'count': len(rows)}
        return {'ok': True, 'year': year, 'rows': rows, 'summary': summary}
    if mode != 'finalize':
        raise ValueError('Unknown rights operation')
    choices = data.get('decisionsByTeam')
    if not isinstance(choices, dict) or set(choices) != set(humans):
        raise ValueError('All human managers must submit rights decisions')
    logs = []
    summary = {'year': year, 'teamSummaries': {}, 'decisions': 0}
    before = copy.deepcopy(original)
    for team in humans:
        rows, _ = preview(before, team)
        validate(rows, choices[team])
        # No options on anyone else's team can be submitted as a player choice.
        result = engine.apply_rights_management(original, team_name=team, rights_decisions=choices[team])
        if result.get('ok') is not True or not isinstance(result.get('leagueData'), dict):
            raise ValueError(result.get('reason') or 'Original rights engine declined this decision')
        original = result['leagueData']
        summary['teamSummaries'][team] = result.get('summary', {})
        for entry in result.get('decisionLog', []):
            if entry.get('teamName') != team or str(entry.get('playerId')) not in choices[team]:
                raise ValueError('Original rights engine processed an unexpected player')
            logs.append(entry)
    summary['decisions'] = len(logs)
    after = original.get('freeAgents', [])
    prior = state.get('freeAgents', [])
    if not isinstance(after, list) or not isinstance(prior, list) or len(after) != len(prior):
        raise ValueError('Rights management changed the free-agent population')
    SAFE = {'rights', 'rightsRenounced', 'qualifyingOffer', 'qualifyingOfferEligible', 'marketValue'}
    for old, new in zip(prior, after):
        if old.get('id') != new.get('id') or {k:v for k,v in old.items() if k not in SAFE} != {k:v for k,v in new.items() if k not in SAFE}:
            raise ValueError('Original rights management changed non-rights player data')
    return {'ok': True, 'year': year, 'freeAgents': after, 'summary': summary, 'decisionLog': logs}


if __name__ == '__main__':
    try:
        print(json.dumps(execute(json.load(sys.stdin)), allow_nan=False, separators=(',', ':')))
    except Exception as error:
        print(json.dumps({'ok': False, 'reason': str(error)[:340]}))
