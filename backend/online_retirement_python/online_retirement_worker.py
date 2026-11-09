"""Run the unchanged single-player retirement engine in an isolated subprocess.
Input is server-generated only. No browser chooses retirement outcomes or seeds.
"""
import copy
import importlib.util
import json
import pathlib
import sys

source = pathlib.Path(__file__).with_name('retirement_logic.py')
spec = importlib.util.spec_from_file_location('bm_original_retirement_logic', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    request = json.load(sys.stdin)
    state = request['league']
    if not isinstance(state, dict):
        raise ValueError('Invalid retirement snapshot')
    flat = isinstance(state.get('teams'), list)
    shadow = copy.deepcopy(state)
    if flat:
        entries = shadow.pop('teams')
        if len(entries) != 30 or len({t.get('name') for t in entries}) != 30:
            raise ValueError('Invalid flat NBA team list')
        shadow['conferences'] = {'East': entries[:15], 'West': entries[15:]}
    elif not (isinstance(shadow.get('conferences'), dict) and
              all(isinstance(shadow['conferences'].get(k), list) for k in ('East', 'West'))):
        raise ValueError('Expected thirty teams in original league structure')
    members = [t for group in ('East', 'West') for t in shadow['conferences'][group]]
    if len(members) != 30 or len({t.get('name') for t in members}) != 30:
        raise ValueError('Duplicate or missing NBA teams')
    year = request['seasonYear']
    stats = request.get('statsByKey') or {}
    if request.get('mode') == 'preview':
        result = module.preview_player_retirements(shadow, stats_by_key=stats,
                                                   settings={}, season_year=year)
    elif request.get('mode') == 'commit':
        result = module.apply_player_retirements(shadow, stats_by_key=stats,
                                                 settings={}, seed=year, season_year=year)
        if flat:
            next_state = result['leagueData']
            by_conference = next_state.pop('conferences')
            next_state['teams'] = [t for group in ('East', 'West') for t in by_conference[group]]
    else:
        raise ValueError('Invalid retirement action')
    print(json.dumps(result, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'reason': str(exc)[:300]}))
