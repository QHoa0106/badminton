-- Legacy group_teams tables may predate the id column used by the integrity trigger.
ALTER TABLE public.group_teams
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE public.group_teams
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.group_teams
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.group_teams'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.group_teams
      ADD CONSTRAINT group_teams_pkey PRIMARY KEY (id);
  END IF;
END;
$$;
