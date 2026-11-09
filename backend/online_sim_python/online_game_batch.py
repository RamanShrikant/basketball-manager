"""Trusted stdin/stdout adapter for original game_sim.simulate_game.
Input is constructed exclusively from server-fetched Online franchise state.
No arbitrary Python execution, external network calls or untrusted module paths.
"""
import asyncio
import json
import random
import sys
import os

# -I removes script directory from sys.path; restore this trusted bundled path only.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game_sim import simulate_game


async def run():
    payload = json.load(sys.stdin)
    games = payload.get('games')
    if not isinstance(games, list) or not 1 <= len(games) <= 16:
        raise ValueError('Invalid online game batch')
    random.seed(int(payload.get('seed', 0)))
    result = []
    for item in games:
        if not isinstance(item, dict) or not all(k in item for k in ('id', 'home', 'away')):
            raise ValueError('Invalid game entry')
        simulated = await simulate_game(item['home'], item['away'])
        result.append({'id': item['id'], 'result': simulated})
    json.dump({'games': result}, sys.stdout, allow_nan=False, separators=(',', ':'))


if __name__ == '__main__':
    try:
        asyncio.run(run())
    except Exception as exc:
        print(f'Online game simulation failed: {type(exc).__name__}', file=sys.stderr)
        sys.exit(1)
