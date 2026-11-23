-- Align legacy matches status checks with the current application states.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.matches
    ADD CONSTRAINT matches_status_check
    CHECK (status IN (
      'scheduled',
      'in_progress',
      'completed',
      'pending_tiebreak',
      'needs_reconfirmation'
    )) NOT VALID;
END;
$$;
