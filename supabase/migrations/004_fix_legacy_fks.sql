-- =============================================================================
-- 004_fix_legacy_fks.sql
-- Chạy file này nếu project Supabase của bạn có sẵn bảng cũ từ migration trước
-- (ví dụ group_teams / matches trỏ sang tournament_groups thay vì groups).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Đảm bảo group_teams.group_id trỏ về public.groups(id)
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.group_teams'::regclass
      AND contype = 'f'
      AND confrelid <> 'public.groups'::regclass
      AND confrelid <> 'public.teams'::regclass
  ) LOOP
    EXECUTE format('ALTER TABLE public.group_teams DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.group_teams'::regclass
      AND contype = 'f'
      AND confrelid = 'public.groups'::regclass
  ) THEN
    ALTER TABLE public.group_teams
      ADD CONSTRAINT group_teams_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
  END IF;

  -- Đảm bảo matches.group_id trỏ về public.groups(id)
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'f'
      AND confrelid::text LIKE '%tournament_groups%'
  ) LOOP
    EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND contype = 'f'
      AND confrelid = 'public.groups'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
  END IF;

  -- Nới lỏng cột full_name cũ trên tournament_players nếu tồn tại NOT NULL từ schema cũ
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tournament_players'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.tournament_players ALTER COLUMN full_name DROP NOT NULL;
  END IF;
END $$;
