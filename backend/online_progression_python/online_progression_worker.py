"""Online-only trusted adapter around the byte-for-byte single-player progression.py.

Input and output are JSON on stdin/stdout. This process never contacts Supabase.
Only roster players and free agents are projected back into the original
state; state mutations outside progression are deliberately discarded.
"""
import copy
import hashlib
import importlib.util
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('bm_original_progression', BASE / 'progression.py')
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)
BUCKETS = ('players', 'twoWayPlayers', 'stashPlayers')
RATING_KEYS = ('age', 'lastBirthdayYear', 'overall', 'potential', 'attrs', 'offRating',
               'defRating', 'stamina', 'scoringRating', 'birthMonth', 'birthDay',
               'devProfileV25', 'careerTimingProfile', 'developmentMomentum')


def _teams(state):
    if isinstance(state.get('teams'), list):
        return state['teams']
    conferences = state.get('conferences')
    if not isinstance(conferences, dict):
        raise ValueError('Missing NBA teams')
    return [t for division in ('East', 'West') for t in conferences.get(division, [])]


def _rows(state):
    seen = set()
    for team in _teams(state):
        if not isinstance(team, dict) or not team.get('name'):
            raise ValueError('Invalid team')
        for bucket in BUCKETS:
            for player in team.get(bucket, []) or []:
                yield from _one(player, team['name'], bucket, seen)
    for player in state.get('freeAgents', []) or []:
        yield from _one(player, 'Free Agents', 'freeAgents', seen)


def _one(player, team, bucket, seen):
    if not isinstance(player, dict):
        raise ValueError('Malformed player record')
    pid = str(player.get('id') or '')
    if not pid or len(pid) > 150 or pid in seen:
        raise ValueError('Missing or duplicate player identity in progression universe')
    seen.add(pid)
    yield (player, team, bucket)


def _current_rookie(p, year):
    meta = p.get('meta') if isinstance(p.get('meta'), dict) else {}
    dy = meta.get('draftYear')
    if dy is None:
        dy = p.get('draftYear', p.get('draftClassYear', p.get('draftedYear', 0)))
    try:
        if int(dy or 0) != year:
            return False
    except (TypeError, ValueError):
        return False
    acquired = str(meta.get('acquiredVia') or p.get('acquiredVia') or '').lower()
    rights = p.get('rights') if isinstance(p.get('rights'), dict) else {}
    return ('draft' in acquired or str(p.get('id')).lower().startswith(f'rookie_{year}_')
            or rights.get('rookieScale') is True or p.get('rookieSigningPending') is True)


def run(state, year, seed):
    if not isinstance(state, dict) or not isinstance(year, int) or not 2026 <= year <= 2100:
        raise ValueError('Invalid input state or season')
    if not isinstance(seed, int) or seed < 0 or seed > 2147483647:
        raise ValueError('Invalid deterministic seed')
    before = list(_rows(state))
    if len(_teams(state)) != 30 or not 200 <= len(before) <= 2000:
        raise ValueError('Progression requires a complete 30-team NBA player pool')

    shadow = copy.deepcopy(state)
    # Reuse the exact Python engine and preserve the original game's young
    # rookie policy: rookies drafted this summer do not age or progress yet.
    protected = {str(p['id']) for p, _, _ in before if _current_rookie(p, year)}
    for player, _, _ in _rows(shadow):
        if str(player['id']) in protected:
            player['__skipProgressionCurrentRookie'] = True

    # The single-player seed/profile calculations use these fields in the
    # worker universe; do not replace the server's actual season identifiers.
    shadow['seasonYear'] = year
    shadow['currentSeasonYear'] = year
    shadow['seasonStartYear'] = year
    seed_token = hashlib.sha256(f'online-progression-v1|{seed}|{year}'.encode()).hexdigest()
    shadow['progressionSeedV25'] = seed_token
    shadow.setdefault('meta', {})
    if isinstance(shadow['meta'], dict):
        shadow['meta']['progressionSeedV25'] = seed_token
    stats = state.get('onlinePlayerStats')
    if not isinstance(stats, dict):
        stats = {}

    outcome = engine.apply_end_of_season_progression_with_deltas(
        shadow, stats_by_key=stats, seed=seed, season_year=year)
    progressed = list(_rows(outcome['league']))
    if len(progressed) != len(before):
        raise ValueError('Progression engine unexpectedly changed roster size')
    after = copy.deepcopy(state)
    destination = list(_rows(after))
    changes = []
    rising = falling = held = aged = rookies = 0
    for (old, team, bucket), (raw, t, b), (target, tt, bb) in zip(before, progressed, destination):
        if (str(old['id']), team, bucket) != (str(raw['id']), t, b) or (str(old['id']), team, bucket) != (str(target['id']), tt, bb):
            raise ValueError('Original engine unexpectedly moved a player')
        key = str(old['id'])
        if key in protected:
            rookies += 1
            # Do not save even hidden profile changes to a brand-new rookie.
        else:
            for field in RATING_KEYS:
                if field in raw:
                    target[field] = copy.deepcopy(raw[field])
            if isinstance(raw.get('meta'), dict) and 'devProfileV25' in raw['meta']:
                meta = copy.deepcopy(old.get('meta') or {})
                if not isinstance(meta, dict):
                    raise ValueError('Malformed career metadata')
                meta['devProfileV25'] = copy.deepcopy(raw['meta']['devProfileV25'])
                target['meta'] = meta
            old_age = int(old.get('age', 25))
            new_age = int(target.get('age', old_age))
            expected = old_age + (1 if int(old.get('lastBirthdayYear') or year - 1) < year else 0)
            if new_age != expected:
                raise ValueError('Age transition differs from the original birthday guard')
            aged += new_age > old_age
        old_ovr = int(old.get('overall') or 0)
        new_ovr = int(target.get('overall') or 0)
        delta = new_ovr - old_ovr
        rising += delta > 0
        falling += delta < 0
        held += delta == 0
        changes.append({
            'id': key, 'name': str(old.get('name') or ''), 'team': team, 'bucket': bucket,
            'ageBefore': int(old.get('age') or 0), 'ageAfter': int(target.get('age') or 0),
            'overallBefore': old_ovr, 'overallAfter': new_ovr, 'overallDelta': delta,
            'potentialBefore': int(old.get('potential') or 0),
            'potentialAfter': int(target.get('potential') or 0),
        })

    summary = {'playerCount': len(changes), 'improved': rising, 'declined': falling,
               'unchanged': held, 'aged': aged, 'protectedRookies': rookies,
               'engineVersion': str(outcome.get('version') or '')}
    after['onlineProgression'] = {'status': 'complete', 'seasonYear': year,
                                  'summary': summary, 'changes': changes}
    after['offseasonState'] = {**(state.get('offseasonState') or {}),
                               'progressionComplete': True,
                               'progressionSeasonYear': year}
    return {'ok': True, 'state': after, 'summary': summary}


def main():
    try:
        payload = json.load(sys.stdin)
        out = run(payload.get('league'), payload.get('year'), payload.get('seed'))
    except Exception as exc:
        out = {'ok': False, 'reason': str(exc)[:350]}
    json.dump(out, sys.stdout, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


if __name__ == '__main__':
    main()
