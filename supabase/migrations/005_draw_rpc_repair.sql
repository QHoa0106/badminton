-- =============================================================================
-- 005_draw_rpc_repair.sql
-- File khac phuc neu 003 da chay nhung PostgREST khong dang ky RPC boc tham
-- hoac schema cache cua project Supabase chua cap nhat.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Live database can have legacy tournament_players without player_id.
  ALTER TABLE public.tournament_players
    ADD COLUMN IF NOT EXISTS player_id UUID;

  -- Create player rows for legacy tournament_players with only full_name.
  INSERT INTO public.players (full_name)
  SELECT DISTINCT COALESCE(NULLIF(BTRIM(tp.full_name), ''), 'VĐV ' || tp.id::text)
  FROM public.tournament_players tp
  WHERE tp.player_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.players p
      WHERE p.full_name = COALESCE(NULLIF(BTRIM(tp.full_name), ''), 'VĐV ' || tp.id::text)
    );

  UPDATE public.tournament_players tp
  SET player_id = p.id
  FROM public.players p
  WHERE tp.player_id IS NULL
    AND p.full_name = COALESCE(NULLIF(BTRIM(tp.full_name), ''), 'VĐV ' || tp.id::text);

  -- Legacy team_members tables can omit id or require tournament_id.
  ALTER TABLE public.team_members
    ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

  ALTER TABLE public.team_members
    ADD COLUMN IF NOT EXISTS tournament_id UUID;

  UPDATE public.team_members tm
  SET tournament_id = t.tournament_id
  FROM public.teams t
  WHERE tm.team_id = t.id
    AND tm.tournament_id IS NULL;

  ALTER TABLE public.team_members
    ALTER COLUMN tournament_id DROP NOT NULL;

  UPDATE public.team_members
  SET id = gen_random_uuid()
  WHERE id IS NULL;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_players
    WHERE player_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Không thể liên kết VĐV legacy với bảng players';
  END IF;

  ALTER TABLE public.tournament_players
    ALTER COLUMN player_id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_players'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%REFERENCES players%'
  ) THEN
    ALTER TABLE public.tournament_players
      ADD CONSTRAINT tournament_players_player_id_fkey
      FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_players'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(tournament_id, player_id)%'
  ) THEN
    ALTER TABLE public.tournament_players
      ADD CONSTRAINT tournament_players_tournament_player_key
      UNIQUE (tournament_id, player_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.team_members'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.team_members
      ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);
  END IF;

  -- Live teams tables can be left with the legacy status default 'active'.
  ALTER TABLE public.teams
    ALTER COLUMN status SET DEFAULT 'draft';

  -- Replace only team CHECK constraints related to team_type or status.
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%team_type%'
        OR pg_get_constraintdef(oid) ILIKE '%status%'
      )
  ) LOOP
    EXECUTE format(
      'ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.teams
    ADD CONSTRAINT teams_team_type_check
    CHECK (team_type IN ('TB-_TBY', 'TBY+_TBY+'));

  ALTER TABLE public.teams
    ADD CONSTRAINT teams_status_check
    CHECK (status IN ('draft', 'confirmed'));

  -- Replace only the draw_type CHECK constraint.
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.draw_history'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%draw_type%'
  ) LOOP
    EXECUTE format(
      'ALTER TABLE public.draw_history DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.draw_history
    ADD CONSTRAINT draw_history_draw_type_check
    CHECK (draw_type IN ('team_draw', 'group_draw'));

  -- Replace only tournament status CHECK constraints. NOT VALID preserves
  -- existing legacy values while enforcing the current status set on writes.
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  ) LOOP
    EXECUTE format(
      'ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.tournaments
    ADD CONSTRAINT tournaments_status_check
    CHECK (status IN (
      'draft',
      'team_draw',
      'group_draw',
      'group_stage',
      'knockout',
      'completed',
      'archived'
    )) NOT VALID;
END $$;

CREATE OR REPLACE FUNCTION public.generate_team_draw(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tb_minus UUID[];
  v_tby UUID[];
  v_tby_plus UUID[];
  v_team_id UUID;
  v_i INT;
  v_p1_name TEXT;
  v_p2_name TEXT;
  v_results JSONB := '[]'::jsonb;
  v_draw_id UUID;
  v_has_confirmed BOOLEAN;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin giải đấu mới có quyền bốc thăm ghép đội';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.teams
    WHERE tournament_id = p_tournament_id AND status = 'confirmed'
  ) INTO v_has_confirmed;

  IF v_has_confirmed THEN
    RAISE EXCEPTION 'Kết quả ghép đội đã được xác nhận và khóa. Hãy reset vòng ghép đội trước nếu muốn bốc thăm lại.';
  END IF;

  SELECT array_agg(id ORDER BY random()) INTO v_tb_minus
  FROM public.tournament_players
  WHERE tournament_id = p_tournament_id AND status = 'active' AND skill_level = 'TB-';

  SELECT array_agg(id ORDER BY random()) INTO v_tby
  FROM public.tournament_players
  WHERE tournament_id = p_tournament_id AND status = 'active' AND skill_level = 'TBY';

  SELECT array_agg(id ORDER BY random()) INTO v_tby_plus
  FROM public.tournament_players
  WHERE tournament_id = p_tournament_id AND status = 'active' AND skill_level = 'TBY+';

  IF COALESCE(array_length(v_tb_minus, 1), 0) <> 6
     OR COALESCE(array_length(v_tby, 1), 0) <> 6
     OR COALESCE(array_length(v_tby_plus, 1), 0) <> 12 THEN
    RAISE EXCEPTION 'Chưa đủ điều kiện bốc thăm: Cần đúng 6 TB-, 6 TBY và 12 TBY+ (hiện có: % TB-, % TBY, % TBY+)',
      COALESCE(array_length(v_tb_minus, 1), 0),
      COALESCE(array_length(v_tby, 1), 0),
      COALESCE(array_length(v_tby_plus, 1), 0);
  END IF;

  DELETE FROM public.teams
  WHERE tournament_id = p_tournament_id AND status = 'draft';

  FOR v_i IN 1..6 LOOP
    SELECT p.full_name INTO v_p1_name
    FROM public.tournament_players tp
    JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tb_minus[v_i];

    SELECT p.full_name INTO v_p2_name
    FROM public.tournament_players tp
    JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby[v_i];

    INSERT INTO public.teams (tournament_id, team_type, team_name, status)
    VALUES (p_tournament_id, 'TB-_TBY', v_p1_name || ' / ' || v_p2_name, 'draft')
    RETURNING id INTO v_team_id;

    INSERT INTO public.team_members (team_id, tournament_player_id)
    VALUES (v_team_id, v_tb_minus[v_i]);
    INSERT INTO public.team_members (team_id, tournament_player_id)
    VALUES (v_team_id, v_tby[v_i]);

    v_results := v_results || jsonb_build_object(
      'order', v_i,
      'team_id', v_team_id,
      'team_type', 'TB-_TBY',
      'team_name', v_p1_name || ' / ' || v_p2_name,
      'player1', jsonb_build_object('tournament_player_id', v_tb_minus[v_i], 'full_name', v_p1_name, 'skill_level', 'TB-'),
      'player2', jsonb_build_object('tournament_player_id', v_tby[v_i], 'full_name', v_p2_name, 'skill_level', 'TBY')
    );
  END LOOP;

  FOR v_i IN 1..6 LOOP
    SELECT p.full_name INTO v_p1_name
    FROM public.tournament_players tp
    JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby_plus[(v_i * 2) - 1];

    SELECT p.full_name INTO v_p2_name
    FROM public.tournament_players tp
    JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby_plus[v_i * 2];

    INSERT INTO public.teams (tournament_id, team_type, team_name, status)
    VALUES (p_tournament_id, 'TBY+_TBY+', v_p1_name || ' / ' || v_p2_name, 'draft')
    RETURNING id INTO v_team_id;

    INSERT INTO public.team_members (team_id, tournament_player_id)
    VALUES (v_team_id, v_tby_plus[(v_i * 2) - 1]);
    INSERT INTO public.team_members (team_id, tournament_player_id)
    VALUES (v_team_id, v_tby_plus[v_i * 2]);

    v_results := v_results || jsonb_build_object(
      'order', 6 + v_i,
      'team_id', v_team_id,
      'team_type', 'TBY+_TBY+',
      'team_name', v_p1_name || ' / ' || v_p2_name,
      'player1', jsonb_build_object('tournament_player_id', v_tby_plus[(v_i * 2) - 1], 'full_name', v_p1_name, 'skill_level', 'TBY+'),
      'player2', jsonb_build_object('tournament_player_id', v_tby_plus[v_i * 2], 'full_name', v_p2_name, 'skill_level', 'TBY+')
    );
  END LOOP;

  INSERT INTO public.draw_history (tournament_id, draw_type, result_json, performed_by)
  VALUES (p_tournament_id, 'team_draw', v_results, v_uid)
  RETURNING id INTO v_draw_id;

  UPDATE public.tournaments
  SET status = 'team_draw', updated_at = now()
  WHERE id = p_tournament_id AND status = 'draft';

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_team_draw',
          jsonb_build_object('draw_id', v_draw_id, 'team_count', 12));

  RETURN jsonb_build_object('draw_id', v_draw_id, 'teams', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_team_draw(p_tournament_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT;
  v_latest_draw UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền xác nhận kết quả ghép đội';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.teams
  WHERE tournament_id = p_tournament_id;

  IF v_count <> 12 THEN
    RAISE EXCEPTION 'Cần đủ 12 đội trước khi xác nhận (hiện có % đội)', v_count;
  END IF;

  UPDATE public.teams
  SET status = 'confirmed'
  WHERE tournament_id = p_tournament_id;

  SELECT id INTO v_latest_draw
  FROM public.draw_history
  WHERE tournament_id = p_tournament_id AND draw_type = 'team_draw'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_latest_draw IS NOT NULL THEN
    UPDATE public.draw_history
    SET confirmed_at = now()
    WHERE id = v_latest_draw;
  END IF;

  UPDATE public.tournaments
  SET status = 'group_draw', updated_at = now()
  WHERE id = p_tournament_id;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'confirm_team_draw',
          jsonb_build_object('draw_id', v_latest_draw));
END;
$$;

REVOKE ALL ON FUNCTION public.generate_team_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_team_draw(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_team_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_team_draw(UUID) TO authenticated;
