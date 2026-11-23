-- =============================================================================
-- 001_schema.sql
-- Badminton Tournament Management - Thiết kế Database Supabase PostgreSQL
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. PROFILES (liên kết auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tự động tạo profile khi có user mới trong auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE WHEN public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. TOURNAMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  event_date DATE,
  location TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'team_draw', 'group_draw', 'group_stage', 'knockout', 'completed', 'archived')),
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_slug ON public.tournaments(slug);
CREATE INDEX IF NOT EXISTS idx_tournaments_public ON public.tournaments(is_public);

-- -----------------------------------------------------------------------------
-- 3. TOURNAMENT_MEMBERS (phân quyền theo giải: admin / referee)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'referee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_members_user ON public.tournament_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_members_tournament ON public.tournament_members(tournament_id);

-- -----------------------------------------------------------------------------
-- 4. PLAYERS & TOURNAMENT_PLAYERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  skill_level TEXT NOT NULL CHECK (skill_level IN ('TB-', 'TBY', 'TBY+')),
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_players_tid ON public.tournament_players(tournament_id);

-- -----------------------------------------------------------------------------
-- 5. TEAMS & TEAM_MEMBERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_type TEXT NOT NULL CHECK (team_type IN ('TB-_TBY', 'TBY+_TBY+')),
  team_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_tid ON public.teams(tournament_id);

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tournament_player_id UUID NOT NULL REFERENCES public.tournament_players(id) ON DELETE CASCADE,
  -- Đảm bảo 1 VĐV chỉ thuộc tối đa 1 đội trong cùng 1 giải
  UNIQUE (tournament_player_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members(team_id);

-- Trigger: Đảm bảo 1 đội tối đa 2 thành viên và cùng thuộc tournament_id với team
CREATE OR REPLACE FUNCTION public.check_team_member_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_team_tid UUID;
  v_tp_tid UUID;
  v_count INT;
BEGIN
  SELECT tournament_id INTO v_team_tid FROM public.teams WHERE id = NEW.team_id;
  SELECT tournament_id INTO v_tp_tid FROM public.tournament_players WHERE id = NEW.tournament_player_id;

  IF v_team_tid IS DISTINCT FROM v_tp_tid THEN
    RAISE EXCEPTION 'Vận động viên không thuộc cùng giải đấu với đội này';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.team_members
  WHERE team_id = NEW.team_id
    AND id IS DISTINCT FROM NEW.id;

  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Mỗi đội chỉ được có tối đa 2 vận động viên';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_team_member_integrity ON public.team_members;
CREATE TRIGGER trg_check_team_member_integrity
  BEFORE INSERT OR UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.check_team_member_integrity();

-- -----------------------------------------------------------------------------
-- 6. GROUPS & GROUP_TEAMS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL CHECK (group_name IN ('A', 'B', 'C', 'D')),
  distribution_type TEXT CHECK (distribution_type IN ('2_mixed_1_plus', '1_mixed_2_plus')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  manual_resolution_note TEXT,
  manual_resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  manual_resolved_at TIMESTAMPTZ,
  UNIQUE (tournament_id, group_name)
);

CREATE TABLE IF NOT EXISTS public.group_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  manual_rank INT CHECK (manual_rank IN (1, 2, 3)),
  -- Đảm bảo 1 đội chỉ thuộc 1 bảng trong 1 giải
  UNIQUE (team_id),
  UNIQUE (group_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_group_teams_group ON public.group_teams(group_id);

-- Trigger: Đảm bảo đội và bảng cùng tournament_id và mỗi bảng tối đa 3 đội
CREATE OR REPLACE FUNCTION public.check_group_team_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_tid UUID;
  v_team_tid UUID;
  v_count INT;
BEGIN
  SELECT tournament_id INTO v_group_tid FROM public.groups WHERE id = NEW.group_id;
  SELECT tournament_id INTO v_team_tid FROM public.teams WHERE id = NEW.team_id;

  IF v_group_tid IS DISTINCT FROM v_team_tid THEN
    RAISE EXCEPTION 'Đội và bảng đấu không thuộc cùng một giải đấu';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.group_teams
  WHERE group_id = NEW.group_id
    AND id IS DISTINCT FROM NEW.id;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'Mỗi bảng đấu chỉ được chứa tối đa 3 đội';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_group_team_integrity ON public.group_teams;
CREATE TRIGGER trg_check_group_team_integrity
  BEFORE INSERT OR UPDATE ON public.group_teams
  FOR EACH ROW EXECUTE FUNCTION public.check_group_team_integrity();

-- -----------------------------------------------------------------------------
-- 7. COURTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  court_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, court_name)
);

-- -----------------------------------------------------------------------------
-- 8. TIE_BREAK_EVENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tie_break_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('two_team', 'three_team_round_robin', 'decider', 'admin_decision')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  reason TEXT DEFAULT '',
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tie_break_events_group ON public.tie_break_events(group_id);

-- -----------------------------------------------------------------------------
-- 9. MATCHES & MATCH_SETS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  tie_break_event_id UUID REFERENCES public.tie_break_events(id) ON DELETE CASCADE,
  match_number INT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('group', 'tie_break', 'quarterfinal', 'semifinal', 'third_place', 'final')),
  bracket_slot TEXT, -- Ví dụ: QF1, QF2, QF3, QF4, SF1, SF2, THIRD, FINAL
  team_a_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  team_b_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  winner_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  court_id UUID REFERENCES public.courts(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  assigned_referee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_points INT NOT NULL DEFAULT 30 CHECK (target_points > 0),
  best_of INT NOT NULL DEFAULT 1 CHECK (best_of IN (1, 3)),
  win_by INT NOT NULL DEFAULT 2 CHECK (win_by >= 1),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'pending_tiebreak', 'needs_reconfirmation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (team_a_id IS NULL OR team_b_id IS NULL OR team_a_id <> team_b_id),
  CHECK (winner_team_id IS NULL OR winner_team_id = team_a_id OR winner_team_id = team_b_id),
  UNIQUE (tournament_id, match_number)
);

CREATE INDEX IF NOT EXISTS idx_matches_tid ON public.matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_stage ON public.matches(tournament_id, stage);
CREATE INDEX IF NOT EXISTS idx_matches_group ON public.matches(group_id);

-- Không cho phép tạo 2 trận trùng cặp đấu trong cùng 1 bảng vòng bảng chính thức
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_stage_pair
  ON public.matches (
    tournament_id,
    group_id,
    LEAST(team_a_id, team_b_id),
    GREATEST(team_a_id, team_b_id)
  )
  WHERE stage = 'group' AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.match_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number INT NOT NULL CHECK (set_number BETWEEN 1 AND 3),
  score_a INT NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b INT NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('pending', 'in_progress', 'completed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_match_sets_match ON public.match_sets(match_id);

-- -----------------------------------------------------------------------------
-- 10. DRAW_HISTORY, MATCH_SCORE_AUDIT, TOURNAMENT_ACTIVITY_LOGS, SETTINGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draw_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  draw_type TEXT NOT NULL CHECK (draw_type IN ('team_draw', 'group_draw')),
  result_json JSONB NOT NULL,
  performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_draw_history_tid ON public.draw_history(tournament_id, draw_type);

CREATE TABLE IF NOT EXISTS public.match_score_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  match_set_id UUID REFERENCES public.match_sets(id) ON DELETE SET NULL,
  old_score_a INT,
  old_score_b INT,
  new_score_a INT,
  new_score_b INT,
  action TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_score_audit_match ON public.match_score_audit(match_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_tid ON public.tournament_activity_logs(tournament_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL UNIQUE REFERENCES public.tournaments(id) ON DELETE CASCADE,
  settings_json JSONB NOT NULL DEFAULT '{
    "group_target_points": 30,
    "tiebreak_target_points": 15,
    "qf_sf_target_points": 15,
    "final_third_target_points": 21,
    "win_by": 2,
    "default_courts": 4
  }'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10b. BỔ SUNG CỘT NẾU BẢNG ĐÃ TỒN TẠI TỪ MIGRATION CŨ (IDEMPOTENT)
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.tournament_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.tournament_players ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS distribution_type TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS manual_resolution_note TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS manual_resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS manual_resolved_at TIMESTAMPTZ;
ALTER TABLE public.group_teams ADD COLUMN IF NOT EXISTS manual_rank INT;
ALTER TABLE public.courts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.tie_break_events ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';
ALTER TABLE public.tie_break_events ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tie_break_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS bracket_slot TEXT;

-- -----------------------------------------------------------------------------
-- 11. DATABASE VIEW: BẢNG XẾP HẠNG VÒNG BẢNG TỰ ĐỘNG (KHÔNG TÍNH TIE-BREAK)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.group_standings_view AS
WITH official_matches AS (
  SELECT
    m.id AS match_id,
    m.tournament_id,
    m.group_id,
    m.team_a_id,
    m.team_b_id,
    m.winner_team_id,
    COALESCE(SUM(ms.score_a), 0) AS total_score_a,
    COALESCE(SUM(ms.score_b), 0) AS total_score_b
  FROM public.matches m
  LEFT JOIN public.match_sets ms ON ms.match_id = m.id
  WHERE m.stage = 'group'
    AND m.status = 'completed'
    AND m.winner_team_id IS NOT NULL
  GROUP BY m.id
),
team_match_stats AS (
  SELECT
    om.group_id,
    om.team_a_id AS team_id,
    1 AS played,
    CASE WHEN om.winner_team_id = om.team_a_id THEN 1 ELSE 0 END AS won,
    CASE WHEN om.winner_team_id = om.team_b_id THEN 1 ELSE 0 END AS lost,
    om.total_score_a AS points_for,
    om.total_score_b AS points_against
  FROM official_matches om
  UNION ALL
  SELECT
    om.group_id,
    om.team_b_id AS team_id,
    1 AS played,
    CASE WHEN om.winner_team_id = om.team_b_id THEN 1 ELSE 0 END AS won,
    CASE WHEN om.winner_team_id = om.team_a_id THEN 1 ELSE 0 END AS lost,
    om.total_score_b AS points_for,
    om.total_score_a AS points_against
  FROM official_matches om
)
SELECT
  g.tournament_id,
  g.id AS group_id,
  g.group_name,
  gt.team_id,
  t.team_name,
  t.team_type,
  gt.manual_rank,
  COALESCE(SUM(s.played), 0)::INT AS played,
  COALESCE(SUM(s.won), 0)::INT AS won,
  COALESCE(SUM(s.lost), 0)::INT AS lost,
  COALESCE(SUM(s.points_for), 0)::INT AS points_for,
  COALESCE(SUM(s.points_against), 0)::INT AS points_against,
  (COALESCE(SUM(s.points_for), 0) - COALESCE(SUM(s.points_against), 0))::INT AS point_diff
FROM public.groups g
JOIN public.group_teams gt ON gt.group_id = g.id
JOIN public.teams t ON t.id = gt.team_id
LEFT JOIN team_match_stats s ON s.group_id = g.id AND s.team_id = gt.team_id
GROUP BY g.tournament_id, g.id, g.group_name, gt.team_id, t.team_name, t.team_type, gt.manual_rank;

-- -----------------------------------------------------------------------------
-- 12. ENABLE SUPABASE REALTIME FOR KEY TABLES
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.matches; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.match_sets; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.groups; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.group_teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tie_break_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
