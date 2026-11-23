-- Legacy group_teams tables may have a required tournament_id column.
-- The current schema derives tournament ownership through group_id instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_teams'
      AND column_name = 'tournament_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.group_teams ALTER COLUMN tournament_id DROP NOT NULL';
  END IF;
END;
$$;
