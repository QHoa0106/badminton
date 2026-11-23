-- =============================================================================
-- 002_rls.sql
-- Row Level Security (RLS) cho toàn bộ bảng trong Badminton Tournament Management
-- =============================================================================

-- Helper functions với SECURITY DEFINER + search_path cố định
CREATE OR REPLACE FUNCTION public.is_tournament_admin(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_members
    WHERE tournament_id = p_tournament_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_staff(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_members
    WHERE tournament_id = p_tournament_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'referee')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_public(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments
    WHERE id = p_tournament_id
      AND is_public = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_tournament(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_tournament_public(p_tournament_id)
      OR public.is_tournament_staff(p_tournament_id);
$$;

-- Cấp quyền thực thi helper cho anon & authenticated
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_staff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_public(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_tournament(UUID) TO anon, authenticated;

-- Bật RLS trên tất cả các bảng
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tie_break_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_score_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- -----------------------------------------------------------------------------
-- TOURNAMENTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tournaments_select" ON public.tournaments;
CREATE POLICY "tournaments_select" ON public.tournaments
  FOR SELECT TO anon, authenticated
  USING (is_public = true OR public.is_tournament_staff(id));

DROP POLICY IF EXISTS "tournaments_update_admin" ON public.tournaments;
CREATE POLICY "tournaments_update_admin" ON public.tournaments
  FOR UPDATE TO authenticated
  USING (public.is_tournament_admin(id))
  WITH CHECK (public.is_tournament_admin(id));

DROP POLICY IF EXISTS "tournaments_delete_admin" ON public.tournaments;
CREATE POLICY "tournaments_delete_admin" ON public.tournaments
  FOR DELETE TO authenticated
  USING (public.is_tournament_admin(id));

-- -----------------------------------------------------------------------------
-- TOURNAMENT_MEMBERS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tournament_members_select" ON public.tournament_members;
CREATE POLICY "tournament_members_select" ON public.tournament_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tournament_staff(tournament_id));

DROP POLICY IF EXISTS "tournament_members_manage_admin" ON public.tournament_members;
CREATE POLICY "tournament_members_manage_admin" ON public.tournament_members
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- PLAYERS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "players_select" ON public.players;
CREATE POLICY "players_select" ON public.players
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournament_players tp
      WHERE tp.player_id = players.id
        AND public.can_read_tournament(tp.tournament_id)
    )
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tournament_members tm WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    ))
  );

DROP POLICY IF EXISTS "players_insert_admin" ON public.players;
CREATE POLICY "players_insert_admin" ON public.players
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournament_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "players_update_admin" ON public.players;
CREATE POLICY "players_update_admin" ON public.players
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournament_players tp
      WHERE tp.player_id = players.id AND public.is_tournament_admin(tp.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- TOURNAMENT_PLAYERS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tournament_players_select" ON public.tournament_players;
CREATE POLICY "tournament_players_select" ON public.tournament_players
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "tournament_players_manage_admin" ON public.tournament_players;
CREATE POLICY "tournament_players_manage_admin" ON public.tournament_players
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- TEAMS & TEAM_MEMBERS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "teams_select" ON public.teams;
CREATE POLICY "teams_select" ON public.teams
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "teams_manage_admin" ON public.teams;
CREATE POLICY "teams_manage_admin" ON public.teams
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

DROP POLICY IF EXISTS "team_members_select" ON public.team_members;
CREATE POLICY "team_members_select" ON public.team_members
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
        AND public.can_read_tournament(t.tournament_id)
    )
  );

DROP POLICY IF EXISTS "team_members_manage_admin" ON public.team_members;
CREATE POLICY "team_members_manage_admin" ON public.team_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
        AND public.is_tournament_admin(t.tournament_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
        AND public.is_tournament_admin(t.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- GROUPS & GROUP_TEAMS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "groups_select" ON public.groups;
CREATE POLICY "groups_select" ON public.groups
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "groups_manage_admin" ON public.groups;
CREATE POLICY "groups_manage_admin" ON public.groups
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

DROP POLICY IF EXISTS "group_teams_select" ON public.group_teams;
CREATE POLICY "group_teams_select" ON public.group_teams
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_teams.group_id
        AND public.can_read_tournament(g.tournament_id)
    )
  );

DROP POLICY IF EXISTS "group_teams_manage_admin" ON public.group_teams;
CREATE POLICY "group_teams_manage_admin" ON public.group_teams
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_teams.group_id
        AND public.is_tournament_admin(g.tournament_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_teams.group_id
        AND public.is_tournament_admin(g.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- COURTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "courts_select" ON public.courts;
CREATE POLICY "courts_select" ON public.courts
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "courts_manage_admin" ON public.courts;
CREATE POLICY "courts_manage_admin" ON public.courts
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- TIE_BREAK_EVENTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tie_break_events_select" ON public.tie_break_events;
CREATE POLICY "tie_break_events_select" ON public.tie_break_events
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "tie_break_events_manage_admin" ON public.tie_break_events;
CREATE POLICY "tie_break_events_manage_admin" ON public.tie_break_events
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- MATCHES & MATCH_SETS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "matches_select" ON public.matches;
CREATE POLICY "matches_select" ON public.matches
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "matches_manage_admin" ON public.matches;
CREATE POLICY "matches_manage_admin" ON public.matches
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- Referee có quyền đọc và cập nhật tỷ số thông qua RPC save_match_set_score / update_match_result
-- Không cho phép Referee sửa team_a_id, team_b_id, stage, group_id trực tiếp.

DROP POLICY IF EXISTS "match_sets_select" ON public.match_sets;
CREATE POLICY "match_sets_select" ON public.match_sets
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_sets.match_id
        AND public.can_read_tournament(m.tournament_id)
    )
  );

DROP POLICY IF EXISTS "match_sets_manage_admin" ON public.match_sets;
CREATE POLICY "match_sets_manage_admin" ON public.match_sets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_sets.match_id
        AND public.is_tournament_admin(m.tournament_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_sets.match_id
        AND public.is_tournament_admin(m.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- DRAW_HISTORY
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "draw_history_select" ON public.draw_history;
CREATE POLICY "draw_history_select" ON public.draw_history
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "draw_history_manage_admin" ON public.draw_history;
CREATE POLICY "draw_history_manage_admin" ON public.draw_history
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));

-- -----------------------------------------------------------------------------
-- MATCH_SCORE_AUDIT
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "match_score_audit_select" ON public.match_score_audit;
CREATE POLICY "match_score_audit_select" ON public.match_score_audit
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_score_audit.match_id
        AND public.is_tournament_staff(m.tournament_id)
    )
  );

-- -----------------------------------------------------------------------------
-- TOURNAMENT_ACTIVITY_LOGS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "activity_logs_select_staff" ON public.tournament_activity_logs;
CREATE POLICY "activity_logs_select_staff" ON public.tournament_activity_logs
  FOR SELECT TO authenticated
  USING (public.is_tournament_staff(tournament_id));

-- -----------------------------------------------------------------------------
-- TOURNAMENT_SETTINGS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "settings_select" ON public.tournament_settings;
CREATE POLICY "settings_select" ON public.tournament_settings
  FOR SELECT TO anon, authenticated
  USING (public.can_read_tournament(tournament_id));

DROP POLICY IF EXISTS "settings_manage_admin" ON public.tournament_settings;
CREATE POLICY "settings_manage_admin" ON public.tournament_settings
  FOR ALL TO authenticated
  USING (public.is_tournament_admin(tournament_id))
  WITH CHECK (public.is_tournament_admin(tournament_id));
