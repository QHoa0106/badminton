-- Older schemas may enforce a unique match pair across every stage.
-- That prevents a tie-break pair from replaying the same pair as a group match.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN LATERAL (
      SELECT array_agg(a.attname ORDER BY k.ordinality) AS column_names
      FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality)
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = k.attnum
    ) cols ON TRUE
    WHERE c.conrelid = 'public.matches'::regclass
      AND c.contype = 'u'
      AND c.conname <> 'matches_tournament_id_match_number_key'
      AND cols.column_names = ARRAY[
        'tournament_id',
        'group_id',
        'team_a_id',
        'team_b_id'
      ]::NAME[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.matches DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END;
$$;

DROP INDEX IF EXISTS public.matches_tournament_id_group_id_team_a_id_team_b_id_key;
DROP INDEX IF EXISTS public.matches_tournament_id_group_id_team_a_id_team_b_id_idx;

-- Allow the same pair in a group match and in a tie-break match.
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_stage_pair
  ON public.matches (
    tournament_id,
    group_id,
    LEAST(team_a_id, team_b_id),
    GREATEST(team_a_id, team_b_id)
  )
  WHERE stage = 'group'
    AND team_a_id IS NOT NULL
    AND team_b_id IS NOT NULL;
