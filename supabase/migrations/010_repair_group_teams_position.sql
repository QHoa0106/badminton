-- The current group_teams schema does not use the legacy position column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_teams'
      AND column_name = 'position'
  ) THEN
    EXECUTE 'ALTER TABLE public.group_teams ALTER COLUMN position DROP NOT NULL';
  END IF;
END;
$$;
