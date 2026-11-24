-- Repair legacy foreign keys on tie_break_events.
-- Some older databases point tournament_id/group_id to legacy tables.

DO $$
DECLARE
  r RECORD;
  v_tournament_attnum SMALLINT;
  v_group_attnum SMALLINT;
BEGIN
  SELECT attnum INTO v_tournament_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.tie_break_events'::regclass
    AND attname = 'tournament_id'
    AND NOT attisdropped;

  SELECT attnum INTO v_group_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.tie_break_events'::regclass
    AND attname = 'group_id'
    AND NOT attisdropped;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tie_break_events'::regclass
      AND contype = 'f'
      AND (
        v_tournament_attnum = ANY (conkey)
        OR v_group_attnum = ANY (conkey)
      )
      AND NOT (
        (confrelid = 'public.tournaments'::regclass
          AND v_tournament_attnum = ANY (conkey))
        OR
        (confrelid = 'public.groups'::regclass
          AND v_group_attnum = ANY (conkey))
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.tie_break_events DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tie_break_events'::regclass
      AND contype = 'f'
      AND confrelid = 'public.tournaments'::regclass
      AND conkey = ARRAY[v_tournament_attnum]
  ) THEN
    ALTER TABLE public.tie_break_events
      ADD CONSTRAINT tie_break_events_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tie_break_events'::regclass
      AND contype = 'f'
      AND confrelid = 'public.groups'::regclass
      AND conkey = ARRAY[v_group_attnum]
  ) THEN
    ALTER TABLE public.tie_break_events
      ADD CONSTRAINT tie_break_events_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;
END;
$$;

