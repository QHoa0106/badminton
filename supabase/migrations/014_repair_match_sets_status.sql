-- Align legacy match_sets status checks with the current application states.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.match_sets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.match_sets DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.match_sets
    ADD CONSTRAINT match_sets_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed')) NOT VALID;
END;
$$;
