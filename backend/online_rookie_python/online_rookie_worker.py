"""Trusted wrapper for the unchanged single-player rookie signing engine.
Only returns per-rookie transitions; never returns a replacement league snapshot.
"""
import copy
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import team_roster_logic as engine

CHOICES = {'standard', 'two_way', 'stash', 'release'}

def teams(state):
    rows = state.get('teams')
    if isinstance(rows, list):
        return rows
    return [team for group in (state.get('conferences') or {}).values() for team in group]

def main(request):
    state = copy.deepcopy(request['league'])
    mode = request['mode']
    year = int(request['draftYear'])
    selected = request.get('teamNames') or []
    decisions = request.get('decisions') or {}
    all_teams = teams(state)
    names = [t.get('name') for t in all_teams]
    if mode not in ('preview', 'human', 'cpu') or len(names) != len(set(names)):
        raise ValueError('Invalid rookie signing request')
    if mode == 'preview':
        team_name = selected[0]
        if team_name not in names:
            raise ValueError('Unknown GM team')
        result = engine.preview_rookie_signings(state, {'seasonYear': year, 'userTeamName': team_name})
        return {'rows': result['userPendingRookies'], 'summary': result['summary']}

    if not selected or len(selected) != len(set(selected)) or any(n not in names for n in selected):
        raise ValueError('Invalid target teams')
    if mode == 'human' and len(selected) != 1:
        raise ValueError('Human managers can resolve one team only')
    originals = {t['name']: copy.deepcopy(t.get('pendingRookieSignings') or []) for t in all_teams if t.get('name') in selected}
    pending_ids = [str(p['id']) for roster in originals.values() for p in roster]
    if not pending_ids or len(set(pending_ids)) != len(pending_ids):
        raise ValueError('No unambiguous unsigned rookies to resolve')
    if mode == 'human':
        if set(decisions.keys()) != set(pending_ids) or any(choice not in CHOICES for choice in decisions.values()):
            raise ValueError('Every rookie requires one valid GM decision')
    elif decisions:
        raise ValueError('CPU decisions cannot be supplied by a client')
    # Hide other teams' pending rookies from the original batch processor. Its
    # unrelated roster normalization side effects are deliberately not exported.
    for team in all_teams:
        if team['name'] not in selected:
            team['pendingRookieSignings'] = []
    result = engine.apply_rookie_signings(state, {
        'seasonYear': year,
        'userTeamName': selected[0] if mode == 'human' else '__ONLINE_CPU_ALL__',
        'decisions': decisions if mode == 'human' else {},
    })
    if not result.get('ok'):
        raise ValueError(result.get('reason') or 'Original rookie engine rejected the request')
    after = result['leagueData']
    final_by_team = {t['name']: t for t in teams(after)}
    actions = []
    for team_name in selected:
        current = final_by_team[team_name]
        rookie_rows = []
        for old in originals[team_name]:
            key = str(old['id'])
            places = [('standard', current.get('players') or []),
                      ('two_way', current.get('twoWayPlayers') or []),
                      ('stash', current.get('stashPlayers') or []),
                      ('release', after.get('freeAgents') or [])]
            found = [(d, p) for d, roster in places for p in roster if str(p.get('id')) == key]
            if len(found) != 1 or found[0][1].get('rookieSigningPending') is not False:
                raise ValueError('Original engine produced ambiguous rookie ownership')
            decision, player = found[0]
            if mode == 'human' and decision != decisions[key]:
                raise ValueError('Original engine changed the GM decision')
            rookie_rows.append({'id': key, 'decision': decision, 'player': player})
        actions.append({'teamName': team_name, 'rookies': rookie_rows})
    return {'actions': actions, 'count': len(pending_ids), 'year': year}

if __name__ == '__main__':
    try:
        output = main(json.load(sys.stdin))
        print(json.dumps({'ok': True, **output}, separators=(',', ':')))
    except Exception as exc:
        print(json.dumps({'ok': False, 'reason': str(exc)[:300]}))
