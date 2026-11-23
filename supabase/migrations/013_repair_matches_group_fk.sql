-- Remove legacy matches foreign keys that still point group_id to tournament_groups.
DO $$
DECLARE
  r RECORD;
  v_group_id_attnum SMALLINT;
BEGIN
  SELECT attnum INTO v_group_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.matches'::regclass
    AND attname = 'group_id'
    AND NOT attisdropped;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'f'
      AND v_group_id_attnum = ANY (conkey)
      AND confrelid <> 'public.groups'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE public.matches DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'f'
      AND confrelid = 'public.groups'::regclass
      AND array_length(conkey, 1) = 1
      AND conkey[1] = v_group_id_attnum
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
  END IF;
END;
$$;
