-- G3C-A1 (online only): block invalid league universes at the authoritative INSERT.
-- New franchises only; existing franchise/runtime rows remain untouched.
-- Manual Supabase SQL Editor, only after BM_G3C_A1_SEED_INTEGRITY_PRECHECK.sql passes.
-- No older function definition is replaced (avoids overwriting G3A/G3C hotfixes).
BEGIN;

DO $preflight$
BEGIN
 IF pg_catalog.to_regclass('public.bm_online_franchises') IS NULL THEN
   RAISE EXCEPTION 'G3C-A1: online franchise table missing';
 END IF;
 IF pg_catalog.to_regprocedure('public.bm_launch_online_franchise(uuid,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'G3C-A1: authoritative launch RPC missing';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
            WHERE tgrelid='public.bm_online_franchises'::regclass
              AND tgname='bm_online_seed_integrity_g3ca1' AND NOT tgisinternal) THEN
   RAISE EXCEPTION 'G3C-A1 trigger already installed; run read-only postcheck instead';
 END IF;
END
$preflight$;

CREATE FUNCTION public.bm_online_seed_integrity_g3ca1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $integrity$
DECLARE
  s jsonb := NEW.seed_state;
  teams jsonb;
  east jsonb := '[]'::jsonb;
  west jsonb := '[]'::jsonb;
  row jsonb;
  player jsonb;
  contract jsonb;
  salary jsonb;
  pick jsonb;
  bucket jsonb;
  all_players jsonb := '[]'::jsonb;
  all_picks jsonb;
  team_name text;
  conf text;
  div text;
  player_id text;
  player_name text;
  year_value int;
  season int;
  team_names text[] := ARRAY[]::text[];
  seen_ids text[] := ARRAY[]::text[];
  seen_pick_ids text[] := ARRAY[]::text[];
  div_counts jsonb := '{}'::jsonb;
  first_picks int := 0;
  roster_count int;
  i int;
BEGIN
  IF coalesce(pg_catalog.jsonb_typeof(s),'missing') <> 'object' OR pg_catalog.octet_length(s::text) > 12000000 THEN
    RAISE EXCEPTION 'Online starting roster must be a valid JSON object under 12 MB';
  END IF;
  IF pg_catalog.jsonb_typeof(s->'seasonStartYear') = 'number' THEN
    season := (s->>'seasonStartYear')::numeric;
  ELSIF pg_catalog.jsonb_typeof(s->'seasonYear') = 'number' THEN
    season := (s->>'seasonYear')::numeric;
  ELSIF pg_catalog.jsonb_typeof(s->'currentSeasonYear') = 'number' THEN
    season := (s->>'currentSeasonYear')::numeric;
  END IF;
  IF season IS NULL OR season NOT BETWEEN 2026 AND 2028 THEN
    RAISE EXCEPTION 'Online starting season must be 2026, 2027 or 2028';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(s) AS kv(key,value)
    WHERE kv.key IN ('seasonStartYear','seasonYear','currentSeasonYear')
      AND (coalesce(pg_catalog.jsonb_typeof(kv.value),'missing') <> 'number' OR (kv.value #>> '{}')::numeric <> season)
  ) THEN
    RAISE EXCEPTION 'Conflicting or invalid online starting season fields';
  END IF;

  IF pg_catalog.jsonb_typeof(s->'teams')='array' THEN
    IF s ? 'conferences' THEN
      RAISE EXCEPTION 'Starting roster cannot contain both teams and conferences';
    END IF;
    teams := s->'teams';
    IF pg_catalog.jsonb_array_length(teams) <> 30 THEN
      RAISE EXCEPTION 'Online NBA calendar requires 30 teams';
    END IF;
    -- Normalize flat format; every custom team must supply a valid division.
    FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(teams) LOOP
      IF coalesce(pg_catalog.jsonb_typeof(row),'missing') <> 'object' THEN RAISE EXCEPTION 'Invalid team JSON'; END IF;
      div := row->>'division';
      conf := coalesce(nullif(row->>'conference',''),nullif(row->>'conf',''));
      IF conf IS NULL THEN
        IF div IN ('Atlantic','Central','Southeast') THEN conf:='East';
        ELSIF div IN ('Northwest','Pacific','Southwest') THEN conf:='West'; END IF;
      END IF;
      IF conf='East' THEN east:=east||pg_catalog.jsonb_build_array(row || pg_catalog.jsonb_build_object('conference',conf));
      ELSIF conf='West' THEN west:=west||pg_catalog.jsonb_build_array(row || pg_catalog.jsonb_build_object('conference',conf));
      ELSE RAISE EXCEPTION 'Flat teams need a valid East/West conference'; END IF;
    END LOOP;
    s := (s - 'teams') || pg_catalog.jsonb_build_object('conferences',pg_catalog.jsonb_build_object('East',east,'West',west));
  ELSIF pg_catalog.jsonb_typeof(s #> '{conferences,East}')='array' AND
        pg_catalog.jsonb_typeof(s #> '{conferences,West}')='array' THEN
    IF s ? 'teams' THEN RAISE EXCEPTION 'Malformed teams field alongside conferences'; END IF;
    east:=s #> '{conferences,East}'; west:=s #> '{conferences,West}';
  ELSE RAISE EXCEPTION 'Online league needs East/West conferences or flat teams';
  END IF;
  IF pg_catalog.jsonb_array_length(east)<>15 OR pg_catalog.jsonb_array_length(west)<>15 THEN
    RAISE EXCEPTION 'Starting league needs 15 East and 15 West teams';
  END IF;
  teams:=east||west;

  FOR i IN 0..29 LOOP
    row:=teams->i;
    team_name:=pg_catalog.btrim(row->>'name');
    conf:=CASE WHEN i<15 THEN 'East' ELSE 'West' END;
    div:=row->>'division';
    IF coalesce(pg_catalog.jsonb_typeof(row),'missing') <> 'object' OR team_name IS NULL OR
       pg_catalog.char_length(team_name) NOT BETWEEN 2 AND 80 OR
       pg_catalog.lower(team_name)=ANY(team_names) THEN
      RAISE EXCEPTION 'Starting league contains invalid or duplicate team names';
    END IF;
    team_names:=pg_catalog.array_append(team_names,pg_catalog.lower(team_name));
    IF (row ? 'conference' AND row->>'conference'<>conf) OR
       (row ? 'conf' AND row->>'conf'<>conf) THEN
      RAISE EXCEPTION 'Conflicting conference assignment for %',team_name;
    END IF;
    IF div IS NULL OR NOT ((conf='East' AND div IN ('Atlantic','Central','Southeast')) OR
            (conf='West' AND div IN ('Northwest','Pacific','Southwest'))) THEN
      RAISE EXCEPTION 'Missing or invalid NBA division for %',team_name;
    END IF;
    div_counts:=pg_catalog.jsonb_set(div_counts,ARRAY[div],pg_catalog.to_jsonb(coalesce((div_counts->>div)::int,0)+1),true);
    bucket:=row->'players';
    IF coalesce(pg_catalog.jsonb_typeof(bucket),'missing') <> 'array' THEN
      RAISE EXCEPTION '% has no standard player roster',team_name;
    END IF;
    roster_count:=pg_catalog.jsonb_array_length(bucket);
    IF roster_count NOT BETWEEN 8 AND 20 THEN
      RAISE EXCEPTION '% must have 8–20 standard players',team_name;
    END IF;
    IF (SELECT pg_catalog.count(DISTINCT pg_catalog.lower(pg_catalog.btrim(p.value->>'name')))
        FROM pg_catalog.jsonb_array_elements(bucket) AS p(value)) <> roster_count THEN
      RAISE EXCEPTION '% has duplicate active player names',team_name;
    END IF;
    all_players:=all_players||bucket;
    FOREACH div IN ARRAY ARRAY['twoWayPlayers','stashPlayers','stashedPlayers'] LOOP
      IF row ? div THEN
        IF coalesce(pg_catalog.jsonb_typeof(row->div),'missing') <> 'array' THEN
          RAISE EXCEPTION 'Invalid % player bucket on %',div,team_name;
        END IF;
        all_players:=all_players || (row->div);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH div IN ARRAY ARRAY['Atlantic','Central','Southeast','Northwest','Pacific','Southwest'] LOOP
    IF coalesce((div_counts->>div)::int,0)<>5 THEN
      RAISE EXCEPTION 'The % division must contain five teams',div;
    END IF;
  END LOOP;
  IF coalesce(pg_catalog.jsonb_typeof(s->'financials'),'missing') <> 'object' THEN
    RAISE EXCEPTION 'Starting league needs salary-cap financials';
  END IF;
  IF coalesce(pg_catalog.jsonb_typeof(s->'calendar'),'missing') <> 'object' OR
     (s #>> '{calendar,regularSeasonStart}') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR
     (s #>> '{calendar,regularSeasonEnd}') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR
     pg_catalog.to_char(pg_catalog.to_date(s #>> '{calendar,regularSeasonStart}','YYYY-MM-DD'),'YYYY-MM-DD') IS DISTINCT FROM (s #>> '{calendar,regularSeasonStart}') OR
     pg_catalog.to_char(pg_catalog.to_date(s #>> '{calendar,regularSeasonEnd}','YYYY-MM-DD'),'YYYY-MM-DD') IS DISTINCT FROM (s #>> '{calendar,regularSeasonEnd}') OR
     (s #>> '{calendar,regularSeasonStart}') >= (s #>> '{calendar,regularSeasonEnd}') OR
     pg_catalog.left(s #>> '{calendar,regularSeasonStart}',4)::int<>season OR
     pg_catalog.left(s #>> '{calendar,regularSeasonEnd}',4)::int<>season+1 THEN
    RAISE EXCEPTION 'Starting calendar needs valid regular-season dates';
  END IF;
  IF coalesce(pg_catalog.jsonb_typeof(s->'freeAgents'),'missing') <> 'array' THEN
    RAISE EXCEPTION 'Starting league must define a freeAgents array';
  END IF;
  all_players:=all_players||(s->'freeAgents');
  IF pg_catalog.jsonb_array_length(all_players)>1500 THEN
    RAISE EXCEPTION 'Too many initial NBA players';
  END IF;
  FOR player IN SELECT value FROM pg_catalog.jsonb_array_elements(all_players) LOOP
    player_id:=pg_catalog.btrim(player->>'id');
    player_name:=pg_catalog.btrim(player->>'name');
    IF coalesce(pg_catalog.jsonb_typeof(player),'missing') <> 'object' OR player_id IS NULL OR
       player_id='' OR pg_catalog.length(player_id)>120 OR player_id=ANY(seen_ids) OR
       coalesce(pg_catalog.jsonb_typeof(player->'id'),'missing') NOT IN ('string','number') OR
       player_name IS NULL OR pg_catalog.char_length(player_name) NOT BETWEEN 2 AND 100 OR
       coalesce(pg_catalog.length(player->>'pos'),0) NOT BETWEEN 1 AND 12 OR
       coalesce(pg_catalog.jsonb_typeof(player->'overall'),'missing') <> 'number' OR
       (player->>'overall')::numeric NOT BETWEEN 0 AND 100 OR
       coalesce(pg_catalog.jsonb_typeof(player->'attrs'),'missing') <> 'array' OR
       pg_catalog.jsonb_array_length(player->'attrs')<>15 THEN
      RAISE EXCEPTION 'Missing, duplicated or invalid initial NBA player attributes';
    END IF;
    seen_ids:=pg_catalog.array_append(seen_ids,player_id);
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(player->'attrs') AS a(v)
               WHERE coalesce(pg_catalog.jsonb_typeof(a.v),'missing') <> 'number' OR (a.v #>> '{}')::numeric NOT BETWEEN 0 AND 100) THEN
      RAISE EXCEPTION 'Player % has invalid skill ratings',player_name;
    END IF;
    contract:=player->'contract';
    IF contract IS NOT NULL AND coalesce(pg_catalog.jsonb_typeof(contract),'missing') <> 'null' THEN
      IF coalesce(pg_catalog.jsonb_typeof(contract),'missing') <> 'object' OR
         coalesce(pg_catalog.jsonb_typeof(contract->'startYear'),'missing') <> 'number' OR
         coalesce(pg_catalog.jsonb_typeof(contract->'salaryByYear'),'missing') <> 'array' OR
         pg_catalog.jsonb_array_length(contract->'salaryByYear') NOT BETWEEN 1 AND 8 THEN
        RAISE EXCEPTION 'Invalid initial contract for %',player_name;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(contract->'salaryByYear') AS sal(v)
                WHERE coalesce(pg_catalog.jsonb_typeof(sal.v),'missing') <> 'number' OR ((sal.v #>> '{}')::numeric NOT BETWEEN 0 AND 1000000000 OR
                     (sal.v #>> '{}')::numeric <> pg_catalog.floor((sal.v #>> '{}')::numeric))) THEN
        RAISE EXCEPTION 'Invalid initial salary for %',player_name;
      END IF;
    END IF;
  END LOOP;
  -- Rostered players must have contracts covering the first year.
  FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(teams) LOOP
    FOR player IN SELECT value FROM pg_catalog.jsonb_array_elements(row->'players') LOOP
      contract:=player->'contract';
      IF coalesce(pg_catalog.jsonb_typeof(contract),'missing') <> 'object' OR
         coalesce(pg_catalog.jsonb_typeof(contract->'startYear'),'missing') <> 'number' OR
         (contract->>'startYear')::numeric <> pg_catalog.floor((contract->>'startYear')::numeric) OR
         (contract->>'startYear')::numeric>season OR
         (contract->>'startYear')::numeric + pg_catalog.jsonb_array_length(contract->'salaryByYear')<=season THEN
        RAISE EXCEPTION 'Rostered player % has no salary contract for this season',player->>'name';
      END IF;
    END LOOP;
  END LOOP;
  all_picks:=s->'draftPicks';
  IF coalesce(pg_catalog.jsonb_typeof(all_picks),'missing') <> 'array' OR pg_catalog.jsonb_array_length(all_picks)>1500 THEN
    RAISE EXCEPTION 'Starting league must have a valid NBA draft-pick ledger';
  END IF;
  FOR pick IN SELECT value FROM pg_catalog.jsonb_array_elements(all_picks) LOOP
    player_id:=pg_catalog.btrim(pick->>'id');
    IF coalesce(pg_catalog.jsonb_typeof(pick),'missing') <> 'object' OR player_id IS NULL OR player_id='' OR
       player_id=ANY(seen_pick_ids) OR
       coalesce(pg_catalog.jsonb_typeof(pick->'id'),'missing') NOT IN ('string','number') OR
       coalesce(pg_catalog.jsonb_typeof(pick->'year'),'missing') <> 'number' OR
       (pick->>'year')::numeric < season+1 OR (pick->>'year')::numeric > season+10 OR
       (pick->>'year')::numeric <> pg_catalog.floor((pick->>'year')::numeric) OR
       coalesce(pg_catalog.jsonb_typeof(pick->'round'),'missing') <> 'number' OR
       (pick->>'round')::numeric NOT IN (1,2) OR
       coalesce(pg_catalog.length(pick->>'ownerTeam'),0)<2 OR
       NOT pg_catalog.lower(pg_catalog.btrim(pick->>'ownerTeam'))=ANY(team_names) THEN
      RAISE EXCEPTION 'Invalid or duplicate NBA draft-pick ledger entry';
    END IF;
    seen_pick_ids:=pg_catalog.array_append(seen_pick_ids,player_id);
    IF (pick->>'year')::numeric=season+1 THEN first_picks:=first_picks+1; END IF;
  END LOOP;
  IF first_picks < 60 THEN
    RAISE EXCEPTION 'First NBA draft has too few pick/swap rights entries';
  END IF;

  NEW.seed_state:=s;
  RETURN NEW;
END
$integrity$;

REVOKE ALL ON FUNCTION public.bm_online_seed_integrity_g3ca1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bm_online_seed_integrity_g3ca1
  BEFORE INSERT ON public.bm_online_franchises
  FOR EACH ROW EXECUTE FUNCTION public.bm_online_seed_integrity_g3ca1();
COMMIT;
