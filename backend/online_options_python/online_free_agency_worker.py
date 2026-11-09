"""Trusted multi-GM adapter for the unchanged single-player FA offer engine.

This first online market stage opens a shared ten-day offer board and records
validated GM offers. Resolution/signings are deliberately deferred until the
multi-GM pending-decision queue is implemented; no client can award a player.
"""
import copy
import importlib.util
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location('bm_original_free_agency', BASE / 'free_agency_logic.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class HumanTeams(str):
    def __new__(cls, names):
        obj = super().__new__(cls, 'ONLINE_HUMAN_TEAMS')
        obj.names = frozenset(names)
        return obj
    def __eq__(self, other):
        return isinstance(other, str) and other in self.names
    def __ne__(self, other):
        return not self.__eq__(other)
    __hash__ = str.__hash__


def prepare(source, year, humans):
    if type(source) is not dict or type(year) is not int or not (2026 <= year <= 2100):
        raise ValueError('Invalid offseason season or league state')
    if type(humans) is not list or not (1 <= len(humans) <= 4) or any(type(x) is not str for x in humans) or len(set(humans)) != len(humans):
        raise ValueError('Invalid human GM roster assignments')
    out = copy.deepcopy(source)
    flat = isinstance(out.get('teams'), list)
    if flat:
        teams = out.pop('teams')
        if len(teams) != 30:
            raise ValueError('Online free agency requires exactly 30 NBA teams')
        out['conferences'] = {'East': teams[:15], 'West': teams[15:]}
    all_teams = [team for group in out.get('conferences', {}).values() for team in group]
    names = [t.get('name') for t in all_teams]
    if len(names) != 30 or len(set(names)) != 30 or any(h not in names for h in humans):
        raise ValueError('Invalid online team ownership')
    out['contractSeasonYear'] = year
    return out, flat


def open_market(original, humans, year):
    shadow, _ = prepare(original, year, humans)
    if shadow.get('freeAgencyState', {}).get('isActive') or original.get('onlineOffseasonMarket', {}).get('status') == 'active':
        raise ValueError('Offseason free agency is already active')
    engine.refresh_free_agent_market_values(shadow)
    state = engine.ensure_free_agency_state(shadow)
    state.update({
        'seasonYear': year, 'contractSeasonYear': year, 'payrollSeasonYear': year,
        'currentPayrollSeasonYear': year, 'salarySeasonYear': year,
        'targetSeasonYear': year, 'isActive': True, 'currentDay': 1,
        'maxDays': 10, 'offersByPlayer': {}, 'dailyLog': [],
        'signedPlayersLog': [], 'offerHistory': [], 'userOfferOutcomeLog': [],
        'pendingUserDecisions': [], 'pendingRfaMatchDecisions': [],
        'exceptionUsageByTeam': {}, 'teamNeedProfiles': {},
        'rightsRenounceLog': [], 'blockedCapHoldRenounceLog': [],
        'fullActionLog': [], 'rfaDebugLog': [], 'cpuOfferDebugLog': [],
        'rfaMatchDebugLog': [], 'finalizeDebugLog': [],
        'freeAgencyDebugErrors': [], 'processedRfaMatchDecisionKeys': [],
        'pendingUserTeamName': None, 'pendingUserTeamSnapshot': None,
        'marketComplete': False, 'freeAgencyComplete': False,
        'completed': False, 'isComplete': False, 'status': 'active',
    })
    # Reuse the original CPU team-offer algorithm, but never include any human GM.
    # This stage only generates offers: it does not sign or move roster players.
    generated = engine.generate_cpu_offers_for_day(shadow, user_team_name=HumanTeams(humans))
    if any(offer.get('teamName') in humans for offer in generated):
        raise ValueError('Original CPU offer engine attempted to represent a human GM')
    state['pendingUserTeamName'] = None
    state['pendingUserTeamSnapshot'] = None
    state['dailyLog'].append({'day': 1, 'type': 'online_market_open', 'offersGenerated': len(generated)})
    return {'ok': True, 'market': state, 'generatedOffers': len(generated), 'year': year}


def submit_offer(source, humans, year, team, player_id, first_salary, years, option):
    shadow, _ = prepare(source, year, humans)
    if team not in humans:
        raise ValueError('Only your managed team may submit this offer')
    state = shadow.get('freeAgencyState')
    if not isinstance(state, dict) or state.get('isActive') is not True or state.get('status') != 'active':
        raise ValueError('The offseason free agency market is not active')
    if state.get('pendingUserDecisions') or state.get('pendingRfaMatchDecisions'):
        raise ValueError('Resolve outstanding player decisions before new offers')
    if not any(str(p.get('id')) == player_id for p in shadow.get('freeAgents', [])):
        raise ValueError('This free agent is not currently available')
    if type(first_salary) is not int or not (100_000 <= first_salary <= 120_000_000) or first_salary % 1000:
        raise ValueError('Offer must use a valid first-year salary in $1,000 increments')
    if type(years) is not int or years not in range(1, 6):
        raise ValueError('Offer must be one to five seasons')
    if option not in ('none', 'team', 'player') or (years == 1 and option != 'none'):
        raise ValueError('Invalid final-year option')
    player = next(p for p in shadow.get('freeAgents', []) if str(p.get('id')) == player_id)
    rights = engine.get_player_rights(player)
    bird = rights.get('heldByTeam') == team and rights.get('birdLevel') == 'bird'
    raise_pct = engine.BIRD_FREE_AGENT_RAISE_PCT if bird else engine.STANDARD_FREE_AGENT_RAISE_PCT
    contract = {
        'salaryByYear': engine.build_legal_salary_by_year(first_salary, years, raise_pct),
        'option': {'type': option, 'yearIndices': [years - 1]} if option != 'none' else None,
    }
    result = engine.submit_user_free_agent_offer(shadow, team_name=team, player_id=player.get('id'), offer=contract)
    if not result.get('ok') or not isinstance(result.get('leagueData'), dict):
        raise ValueError(str(result.get('reason') or 'Original free-agency contract engine declined this offer')[:300])
    record = result.get('submittedOffer')
    market = result['leagueData'].get('freeAgencyState')
    # Soft bids cannot spend exceptions or change cap ledgers until finalized.
    if isinstance(market, dict):
        market['exceptionUsageByTeam'] = copy.deepcopy(state.get('exceptionUsageByTeam', {}))
    if (not isinstance(record, dict) or not isinstance(market, dict) or
        record.get('teamName') != team or str(record.get('playerId')) != player_id or record.get('source') != 'user'):
        raise ValueError('Original free-agency engine returned an invalid offer')
    if market.get('currentDay') != state.get('currentDay') or market.get('isActive') is not True:
        raise ValueError('Offer submission attempted to advance the market')
    # A proposal is not a signing. Never persist the original engine's automatic
    # rights normalization or any team roster changes as an offer side effect.
    return {'ok': True, 'market': market, 'submittedOffer': record, 'year': year}



def _project(source, shadow, flat):
    """Project only market/financial changes; do not persist the engine's other mutations."""
    out = copy.deepcopy(source)
    teams = [t for conference in shadow['conferences'].values() for t in conference]
    if len(teams) != 30:
        raise ValueError('Original engine produced an invalid NBA roster layout')
    if flat:
        if [t.get('name') for t in teams] != [t.get('name') for t in source['teams']]:
            raise ValueError('Original engine reordered NBA teams')
        out['teams'] = teams
    else:
        if list(shadow['conferences']) != list(source['conferences']):
            raise ValueError('Original engine changed conference layout')
        for key in source['conferences']:
            if [t.get('name') for t in shadow['conferences'][key]] != [t.get('name') for t in source['conferences'][key]]:
                raise ValueError('Original engine changed conference membership')
        out['conferences'] = shadow['conferences']
    out['freeAgents'] = shadow.get('freeAgents', [])
    out['freeAgencyState'] = shadow['freeAgencyState']
    if 'deadCapByTeam' in shadow:
        out['deadCapByTeam'] = shadow['deadCapByTeam']
    return out


def _pending(market):
    return (market.get('pendingUserDecisions') or []) + (market.get('pendingRfaMatchDecisions') or [])


def _phase_after_decision(state):
    return 'decisions' if _pending(state) else ('needs_finish' if state['currentDay'] >= state['maxDays'] else 'needs_next')


def market_step(source, humans, year, mode, team=None, player_key=None, kind=None, choice=None):
    shadow, flat = prepare(source, year, humans)
    stage = source.get('onlineOffseasonMarket', {})
    market = shadow.get('freeAgencyState', {})
    if not isinstance(market, dict) or stage.get('status') != 'active' or market.get('isActive') is not True:
        raise ValueError('Offseason market is not active')
    if stage.get('year') != year or stage.get('day') != market.get('currentDay'):
        raise ValueError('Online market day does not match the engine')
    day = market['currentDay']
    if type(day) is not int or day < 1 or day > 10 or market.get('maxDays') != 10:
        raise ValueError('Invalid free-agency day')
    events = []
    if mode == 'resolve':
        if stage.get('phase') != 'offers' or _pending(market) or stage.get('lastResolvedDay') == day:
            raise ValueError('Finish existing GM decisions before resolving another day')
        # Original engine assumes one human GM and otherwise stamps all pending
        # signings with the synthetic multi-GM sentinel. Route each decision to
        # its ACTUAL offer team before it becomes part of shared state.
        original_pending = engine.upsert_pending_user_decision
        def online_pending(*args, **kwargs):
            chosen = kwargs.get('chosen_offer') or (args[3] if len(args) > 3 else {})
            actual_team = chosen.get('teamName') if isinstance(chosen, dict) else None
            if actual_team not in humans:
                raise ValueError('Original engine tried to assign a pending signing to an unowned GM')
            if args:
                args = list(args)
                args[1] = actual_team
                return original_pending(*args, **kwargs)
            kwargs['team_name'] = actual_team
            return original_pending(**kwargs)
        engine.upsert_pending_user_decision = online_pending
        try:
            result = engine.advance_free_agency_day(shadow, user_team_name=HumanTeams(humans))
        finally:
            engine.upsert_pending_user_decision = original_pending
        if not result.get('ok') or not isinstance(result.get('leagueData'), dict):
            raise ValueError(result.get('reason') or 'Original free-agency engine rejected the resolution')
        shadow = result['leagueData']; market = shadow['freeAgencyState']
        events = result.get('signings') or []
        if market.get('status') == 'complete':
            phase, status = 'complete', 'complete'
        elif _pending(market):
            phase, status = 'decisions', 'active'
        else:
            phase, status = 'offers', 'active'
        last_resolved = day
    elif mode == 'decision':
        if stage.get('phase') != 'decisions' or team not in humans:
            raise ValueError('There are no GM decisions available')
        if kind not in ('signing', 'rfa') or choice not in ('accept', 'decline', 'match') or not player_key:
            raise ValueError('Invalid free-agency decision')
        if kind == 'rfa':
            if choice not in ('match', 'decline'):
                raise ValueError('Restricted free agents require Match or Decline')
            row = next((r for r in market.get('pendingRfaMatchDecisions', []) if r.get('playerKey') == player_key), None)
            if not row or row.get('rightsTeamName') != team:
                raise ValueError('Only the rights-owning GM can decide an RFA offer sheet')
            before_other = [r for r in market['pendingRfaMatchDecisions'] if r.get('playerKey') != player_key]
            result = engine.process_pending_rfa_match_decision(shadow, user_team_name=team,
                  player_key=player_key, decision='match' if choice == 'match' else 'decline')
            if not result.get('ok') or not isinstance(result.get('leagueData'), dict):
                raise ValueError(result.get('reason') or 'The RFA decision could not be finalized')
            shadow = result['leagueData']; market = shadow['freeAgencyState']
            if [r for r in market.get('pendingRfaMatchDecisions', []) if r.get('playerKey') != player_key] != before_other:
                raise ValueError('RFA decision changed another GM pending offer')
            events = result.get('processedSignings') or []
        else:
            if choice not in ('accept', 'decline'):
                raise ValueError('Select Accept or Decline for a player signing')
            row = next((r for r in market.get('pendingUserDecisions', []) if r.get('playerKey') == player_key), None)
            if not row or row.get('teamName') != team:
                raise ValueError('Only the GM receiving this offer can decide the signing')
            other_rows = [r for r in market['pendingUserDecisions'] if r.get('playerKey') != player_key]
            if choice == 'accept':
                player = next((p for p in shadow.get('freeAgents', []) if engine.get_player_key_from_player(p) == player_key), None)
                if not player:
                    raise ValueError('Free agent has already been acquired')
                offer = copy.deepcopy(row.get('chosenOffer') or {})
                offer['teamName'] = team
                offer['source'] = 'user'
                offer['contract'] = engine.normalize_contract(offer.get('contract') or row.get('contract'))
                # A different human GM's RFA rights may not be auto-matched.
                rights = engine.get_player_rights(player)
                if rights.get('restrictedFreeAgent') and rights.get('heldByTeam') in humans and rights.get('heldByTeam') != team:
                    engine.upsert_pending_rfa_match_decision(shadow, player, offer, row.get('allOffers') or [offer], day)
                    market = shadow['freeAgencyState']
                    market.setdefault('dailyLog', []).append({'day': day, 'type': 'online_rfa_offer_sheet_pending',
                        'playerKey': player_key, 'offeringTeamName': team, 'rightsTeamName': rights['heldByTeam']})
                else:
                    prepared = engine.prepare_user_offer_for_conditional_finalization(shadow, team, player, offer)
                    if not prepared.get('ok'):
                        raise ValueError(prepared.get('reason') or 'This signing is no longer financially legal')
                    # CPU RFA rights can be matched by the original engine.
                    shadow = prepared.get('leagueData', shadow)
                    signed = engine.finalize_free_agent_signing_from_offer(shadow, prepared.get('player', player),
                                                                           prepared.get('chosenOffer', offer), day)
                    if not signed:
                        raise ValueError('Original engine could not finalize the offer under current roster and cap rules')
                    events = [signed]
                    market = shadow['freeAgencyState']
            else:
                for offer in market.get('offersByPlayer', {}).get(player_key, []):
                    if offer.get('source') == 'user' and offer.get('teamName') == team and offer.get('status', 'active') == 'active':
                        offer['status'] = 'declined_by_user'
                        offer['userDeclinedDecisionDay'] = day
                market.setdefault('dailyLog', []).append({'day': day, 'type': 'user_declined_pending_signing',
                    'playerKey': player_key, 'playerName': row.get('playerName'), 'teamName': team})
            market['pendingUserDecisions'] = other_rows
        phase, status, last_resolved = _phase_after_decision(market), 'active', stage.get('lastResolvedDay')
    elif mode == 'next':
        if stage.get('phase') not in ('needs_next', 'needs_finish') or _pending(market) or stage.get('lastResolvedDay') != day:
            raise ValueError('Market must resolve all pending GM decisions before continuing')
        if day < 10:
            market['currentDay'] = day + 1
            engine.generate_cpu_offers_for_day(shadow, user_team_name=HumanTeams(humans))
            market.setdefault('dailyLog', []).append({'day': day + 1, 'type': 'offer_generation_online_resume'})
            phase, status = 'offers', 'active'
        else:
            # The original engine can generate replacement free agents at market close.
            # Do not bypass pending GM decisions or fabricate roster spots. The SQL
            # roster transfer verifier will independently reject unsupported arrivals.
            generated = engine.finalize_cpu_min_roster_cleanup(shadow, current_day=day,
                user_team_name=HumanTeams(humans), min_roster_target_override=engine.get_min_roster_target(shadow),
                allow_generated_replacements=True)
            events = generated or []
            market.update({'isActive':False, 'marketComplete':True,'freeAgencyComplete':True,
                           'completed':True,'isComplete':True,'status':'complete'})
            phase, status = 'complete', 'complete'
        last_resolved = day
    else:
        raise ValueError('Unknown online resolution operation')
    if any(r.get('teamName') not in humans for r in market.get('pendingUserDecisions', [])):
        raise ValueError('A pending user signing belongs to a CPU team')
    if any(r.get('rightsTeamName') not in humans for r in market.get('pendingRfaMatchDecisions', [])):
        raise ValueError('A pending RFA decision belongs to a CPU team')
    out = _project(source, shadow, flat)
    out['onlineOffseasonMarket'] = {**stage, 'status':status, 'phase':phase,
                                  'year':year, 'day':market['currentDay'], 'lastResolvedDay':last_resolved}
    if status == 'complete':
        out.setdefault('offseasonState', {})['freeAgencyComplete'] = True
    return {'ok': True, 'state':out, 'year':year,'day':market['currentDay'],
            'phase':phase,'signings':events,'pendingUserCount':len(market.get('pendingUserDecisions', [])),
            'pendingRfaCount':len(market.get('pendingRfaMatchDecisions', []))}

def main():
    try:
        source = json.load(sys.stdin)
        mode = source.get('mode')
        if mode == 'open':
            out = open_market(source['league'], source['humanTeams'], source['year'])
        elif mode == 'offer':
            out = submit_offer(source['league'], source['humanTeams'], source['year'],
                               source['teamName'], source['playerId'], source['salary'],
                               source['years'], source['optionType'])
        elif mode in ('resolve', 'decision', 'next'):
            out = market_step(source['league'], source['humanTeams'], source['year'], mode,
                              source.get('teamName'),source.get('playerKey'),source.get('kind'),source.get('choice'))
        else:
            raise ValueError('Unsupported online free agency action')
        print(json.dumps(out, allow_nan=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'reason': str(exc)[:300]}))

if __name__ == '__main__':
    main()
