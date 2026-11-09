"""Execute the unmodified single-player draft logic in isolated Python.
Trusted backend passes server-derived league, draft order, and player selections.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import draft_logic


def main():
    request = json.load(sys.stdin)
    action = request['action']
    if action not in ('initialize_draft', 'make_user_pick', 'sim_one_pick'):
        raise ValueError('Unsupported authoritative draft action')
    result = draft_logic.handle_request({
        'action': action,
        'leagueData': request['league'],
        'payload': request['payload'],
    })
    json.dump(result, sys.stdout, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
