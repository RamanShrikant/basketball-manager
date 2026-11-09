"""Online-only trusted adapter for the *unchanged* Basketball Manager extension engine.

The Node server derives all roster and GM fields from its own league read, not from
browser-submitted state. This adapter is called under Python isolated mode.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from contract_extension_logic import handle_request


def _iterate_teams(state):
    if isinstance(state.get('teams'), list):
        return [t for t in state['teams'] if isinstance(t, dict)]
    confs = state.get('conferences') or {}
    return [t for rows in confs.values() if isinstance(rows, list) for t in rows if isinstance(t, dict)]


def run(req):
    action = req.get('action')
    state = req.get('leagueData')
    date = req.get('currentDate')
    if not isinstance(state, dict) or not isinstance(date, str) or len(date) != 10:
        return {'ok': False, 'reason': 'Invalid authoritative extension snapshot'}
    if action not in ('preview', 'offer', 'close'):
        return {'ok': False, 'reason': 'Unsupported online extension operation'}
    payload = {'currentDate': date}
    if action == 'close':
        masked = copy.deepcopy(state)
        protected = {str(t) for t in req.get('humanTeams', []) if isinstance(t, str)}
        if not protected:
            return {'ok': False, 'reason': 'Human-GM ownership registry unavailable'}
        # Retain original 30-team league structure, but exclude human rosters
        # from CPU automatic extension negotiations. Restore before committing.
        for team in _iterate_teams(masked):
            if team.get('name') in protected:
                team['players'] = []
        result = handle_request({'action': 'close_contract_extension_window',
            'leagueData': masked, 'payload': {'phase': 'veteran_deadline', **payload}})
        if not result.get('ok') or not isinstance(result.get('leagueData'), dict):
            return {'ok': False, 'reason': result.get('reason', 'The CPU deadline could not close')}
        updated = result['leagueData']
        original_teams = {t.get('name'): t for t in _iterate_teams(state)}
        for team in _iterate_teams(updated):
            if team.get('name') in protected:
                team['players'] = copy.deepcopy(original_teams[team['name']]['players'])
        state_after = updated.get('contractExtensionState') or {}
        if 'veteran' not in state_after.get('closedTypes', []):
            return {'ok': False, 'reason': 'Original extension engine failed to close veteran window'}
        cpu = result.get('cpuResult') or {}
        return {'ok': True, 'leagueData': updated,
            'summary': cpu.get('summary') or {},
            'cpuSigned': sum(1 for r in cpu.get('results', []) if r.get('transaction')),
            'processedTeamCount': len([t for t in original_teams if t not in protected])}
    team = req.get('teamName')
    if not isinstance(team, str) or team not in {t.get('name') for t in _iterate_teams(state)}:
        return {'ok': False, 'reason': 'The GM team no longer exists'}
    payload['userTeamName'] = team
    if action == 'preview':
        return handle_request({'action': 'preview_contract_extensions',
            'leagueData': state, 'payload': payload})
    if not isinstance(req.get('playerId'), str) or not isinstance(req.get('offer'), dict):
        return {'ok': False, 'reason': 'Invalid contract extension offer'}
    payload.update({'playerId': req['playerId'], 'offer': req['offer']})
    result = handle_request({'action': 'submit_contract_extension_offer',
        'leagueData': state, 'payload': payload})
    if not result.get('ok'):
        return {'ok': False, 'reason': result.get('reason', 'Offer rejected by the original extension engine')}
    return {'ok': True, 'accepted': bool(result.get('accepted')),
        'decision': result.get('decision') or {}, 'transaction': result.get('transaction'),
        'leagueData': result.get('leagueData')}


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.read())
        print(json.dumps(run(request), ensure_ascii=False, allow_nan=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'reason': str(exc)}))
