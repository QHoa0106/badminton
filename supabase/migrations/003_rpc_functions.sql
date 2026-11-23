-- =============================================================================
-- 003_rpc_functions.sql
-- Các PostgreSQL Functions (RPC) xử lý nghiệp vụ cốt lõi phía server
-- Mọi hàm SECURITY DEFINER đều kiểm tra auth.uid(), quyền Admin/Referee,
-- và cố định search_path = public.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. create_tournament_with_admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tournament_with_admin(
  p_name TEXT,
  p_slug TEXT,
  p_event_date DATE DEFAULT NULL,
  p_location TEXT DEFAULT '',
  p_description TEXT DEFAULT '',
  p_court_count INT DEFAULT 4
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tid UUID;
  v_i INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Bạn cần đăng nhập để tạo giải đấu';
  END IF;

  -- Đảm bảo profile tồn tại
  INSERT INTO public.profiles (id, full_name)
  VALUES (v_uid, 'Admin')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tournaments (name, slug, event_date, location, description, created_by)
  VALUES (trim(p_name), lower(trim(p_slug)), p_event_date, COALESCE(p_location, ''), COALESCE(p_description, ''), v_uid)
  RETURNING id INTO v_tid;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_tid, v_uid, 'admin');

  INSERT INTO public.tournament_settings (tournament_id)
  VALUES (v_tid);

  FOR v_i IN 1..GREATEST(1, LEAST(COALESCE(p_court_count, 4), 20)) LOOP
    INSERT INTO public.courts (tournament_id, court_name)
    VALUES (v_tid, 'Sân ' || v_i);
  END LOOP;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (v_tid, v_uid, 'create_tournament', jsonb_build_object('name', p_name, 'slug', p_slug));

  RETURN v_tid;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. generate_team_draw (Bốc thăm ghép 12 đội phía Database)
--    - 6 cặp TB- + TBY
--    - 6 cặp TBY+ + TBY+
-- -----------------------------------------------------------------------------
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
    SELECT 1 FROM public.teams WHERE tournament_id = p_tournament_id AND status = 'confirmed'
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

  -- Xóa các đội draft cũ trước khi tạo đợt bốc thăm mới
  DELETE FROM public.teams WHERE tournament_id = p_tournament_id AND status = 'draft';

  -- 6 đội TB- + TBY
  FOR v_i IN 1..6 LOOP
    SELECT p.full_name INTO v_p1_name
    FROM public.tournament_players tp JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tb_minus[v_i];

    SELECT p.full_name INTO v_p2_name
    FROM public.tournament_players tp JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby[v_i];

    INSERT INTO public.teams (tournament_id, team_type, team_name, status)
    VALUES (p_tournament_id, 'TB-_TBY', v_p1_name || ' / ' || v_p2_name, 'draft')
    RETURNING id INTO v_team_id;

    INSERT INTO public.team_members (team_id, tournament_player_id) VALUES (v_team_id, v_tb_minus[v_i]);
    INSERT INTO public.team_members (team_id, tournament_player_id) VALUES (v_team_id, v_tby[v_i]);

    v_results := v_results || jsonb_build_object(
      'order', v_i,
      'team_id', v_team_id,
      'team_type', 'TB-_TBY',
      'team_name', v_p1_name || ' / ' || v_p2_name,
      'player1', jsonb_build_object('tournament_player_id', v_tb_minus[v_i], 'full_name', v_p1_name, 'skill_level', 'TB-'),
      'player2', jsonb_build_object('tournament_player_id', v_tby[v_i], 'full_name', v_p2_name, 'skill_level', 'TBY')
    );
  END LOOP;

  -- 6 đội TBY+ + TBY+
  FOR v_i IN 1..6 LOOP
    SELECT p.full_name INTO v_p1_name
    FROM public.tournament_players tp JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby_plus[(v_i * 2) - 1];

    SELECT p.full_name INTO v_p2_name
    FROM public.tournament_players tp JOIN public.players p ON p.id = tp.player_id
    WHERE tp.id = v_tby_plus[v_i * 2];

    INSERT INTO public.teams (tournament_id, team_type, team_name, status)
    VALUES (p_tournament_id, 'TBY+_TBY+', v_p1_name || ' / ' || v_p2_name, 'draft')
    RETURNING id INTO v_team_id;

    INSERT INTO public.team_members (team_id, tournament_player_id) VALUES (v_team_id, v_tby_plus[(v_i * 2) - 1]);
    INSERT INTO public.team_members (team_id, tournament_player_id) VALUES (v_team_id, v_tby_plus[v_i * 2]);

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

  UPDATE public.tournaments SET status = 'team_draw', updated_at = now()
  WHERE id = p_tournament_id AND status = 'draft';

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_team_draw', jsonb_build_object('draw_id', v_draw_id, 'team_count', 12));

  RETURN jsonb_build_object('draw_id', v_draw_id, 'teams', v_results);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. confirm_team_draw
-- -----------------------------------------------------------------------------
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

  SELECT COUNT(*) INTO v_count FROM public.teams WHERE tournament_id = p_tournament_id;
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'Cần đủ 12 đội trước khi xác nhận (hiện có % đội)', v_count;
  END IF;

  UPDATE public.teams SET status = 'confirmed' WHERE tournament_id = p_tournament_id;

  SELECT id INTO v_latest_draw
  FROM public.draw_history
  WHERE tournament_id = p_tournament_id AND draw_type = 'team_draw'
  ORDER BY created_at DESC LIMIT 1;

  IF v_latest_draw IS NOT NULL THEN
    UPDATE public.draw_history SET confirmed_at = now() WHERE id = v_latest_draw;
  END IF;

  UPDATE public.tournaments SET status = 'group_draw', updated_at = now() WHERE id = p_tournament_id;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'confirm_team_draw', jsonb_build_object('draw_id', v_latest_draw));
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. generate_group_draw (Random chia 4 bảng A, B, C, D đúng điều kiện 2-1 & 1-2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_group_draw(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_mixed_teams UUID[];
  v_plus_teams UUID[];
  v_dist_types TEXT[];
  v_group_names TEXT[] := ARRAY['A', 'B', 'C', 'D'];
  v_group_id UUID;
  v_mixed_idx INT := 1;
  v_plus_idx INT := 1;
  v_i INT;
  v_has_confirmed BOOLEAN;
  v_result JSONB := '[]'::jsonb;
  v_group_teams_json JSONB;
  v_draw_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền random chia bảng';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.groups WHERE tournament_id = p_tournament_id AND status = 'confirmed'
  ) INTO v_has_confirmed;

  IF v_has_confirmed THEN
    RAISE EXCEPTION 'Kết quả chia bảng đã được xác nhận. Hãy reset chia bảng trước nếu muốn random lại.';
  END IF;

  SELECT array_agg(id ORDER BY random()) INTO v_mixed_teams
  FROM public.teams
  WHERE tournament_id = p_tournament_id AND status = 'confirmed' AND team_type = 'TB-_TBY';

  SELECT array_agg(id ORDER BY random()) INTO v_plus_teams
  FROM public.teams
  WHERE tournament_id = p_tournament_id AND status = 'confirmed' AND team_type = 'TBY+_TBY+';

  IF COALESCE(array_length(v_mixed_teams, 1), 0) <> 6
     OR COALESCE(array_length(v_plus_teams, 1), 0) <> 6 THEN
    RAISE EXCEPTION 'Cần xác nhận đủ 6 đội TB- + TBY và 6 đội TBY+ + TBY+ trước khi chia bảng';
  END IF;

  -- Random vị trí 2 bảng (2 mixed + 1 plus) và 2 bảng (1 mixed + 2 plus)
  SELECT array_agg(distribution_type ORDER BY random()) INTO v_dist_types
  FROM unnest(
    ARRAY['2_mixed_1_plus', '2_mixed_1_plus', '1_mixed_2_plus', '1_mixed_2_plus']::TEXT[]
  ) AS distributions(distribution_type);

  -- Xóa bảng draft cũ
  DELETE FROM public.groups WHERE tournament_id = p_tournament_id AND status = 'draft';

  FOR v_i IN 1..4 LOOP
    INSERT INTO public.groups (tournament_id, group_name, distribution_type, status)
    VALUES (p_tournament_id, v_group_names[v_i], v_dist_types[v_i], 'draft')
    RETURNING id INTO v_group_id;

    IF v_dist_types[v_i] = '2_mixed_1_plus' THEN
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_plus_teams[v_plus_idx]);
      v_plus_idx := v_plus_idx + 1;
    ELSE
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_plus_teams[v_plus_idx]);
      v_plus_idx := v_plus_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id) VALUES (v_group_id, v_plus_teams[v_plus_idx]);
      v_plus_idx := v_plus_idx + 1;
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
      'team_id', t.id,
      'team_name', t.team_name,
      'team_type', t.team_type
    )) INTO v_group_teams_json
    FROM public.group_teams gt
    JOIN public.teams t ON t.id = gt.team_id
    WHERE gt.group_id = v_group_id;

    v_result := v_result || jsonb_build_object(
      'group_id', v_group_id,
      'group_name', v_group_names[v_i],
      'distribution_type', v_dist_types[v_i],
      'teams', v_group_teams_json
    );
  END LOOP;

  INSERT INTO public.draw_history (tournament_id, draw_type, result_json, performed_by)
  VALUES (p_tournament_id, 'group_draw', v_result, v_uid)
  RETURNING id INTO v_draw_id;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_group_draw', jsonb_build_object('draw_id', v_draw_id));

  RETURN jsonb_build_object('draw_id', v_draw_id, 'groups', v_result);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. confirm_group_draw
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_group_draw(p_tournament_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group_count INT;
  v_team_count INT;
  v_latest_draw UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền xác nhận chia bảng';
  END IF;

  SELECT COUNT(*) INTO v_group_count FROM public.groups WHERE tournament_id = p_tournament_id;
  SELECT COUNT(*) INTO v_team_count
  FROM public.group_teams gt JOIN public.groups g ON g.id = gt.group_id
  WHERE g.tournament_id = p_tournament_id;

  IF v_group_count <> 4 OR v_team_count <> 12 THEN
    RAISE EXCEPTION 'Cần đủ 4 bảng và 12 đội trước khi xác nhận chia bảng';
  END IF;

  UPDATE public.groups SET status = 'confirmed' WHERE tournament_id = p_tournament_id;

  SELECT id INTO v_latest_draw
  FROM public.draw_history
  WHERE tournament_id = p_tournament_id AND draw_type = 'group_draw'
  ORDER BY created_at DESC LIMIT 1;

  IF v_latest_draw IS NOT NULL THEN
    UPDATE public.draw_history SET confirmed_at = now() WHERE id = v_latest_draw;
  END IF;

  UPDATE public.tournaments SET status = 'group_stage', updated_at = now() WHERE id = p_tournament_id;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'confirm_group_draw', jsonb_build_object('draw_id', v_latest_draw));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. generate_group_matches (Sinh 12 trận vòng bảng: 3 trận/bảng, 1 set 30 điểm)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_group_matches(p_tournament_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group_count INT;
  v_unconfirmed INT;
  v_team_count INT;
  v_existing INT;
  v_group RECORD;
  v_teams UUID[];
  v_match_no INT := 0;
  v_match_id UUID;
  v_target_points INT := 30;
  v_win_by INT := 2;
  v_pairs INT[][] := ARRAY[[1,2],[1,3],[2,3]];
  v_p INT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền tạo lịch thi đấu vòng bảng';
  END IF;

  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giải đấu';
  END IF;

  SELECT COUNT(*) INTO v_group_count
  FROM public.groups
  WHERE tournament_id = p_tournament_id;

  SELECT COUNT(*) INTO v_unconfirmed
  FROM public.groups WHERE tournament_id = p_tournament_id AND status <> 'confirmed';
  IF v_group_count <> 4 OR v_unconfirmed > 0 THEN
    RAISE EXCEPTION 'Phải xác nhận kết quả chia 4 bảng trước khi sinh lịch thi đấu';
  END IF;

  SELECT COUNT(*) INTO v_team_count
  FROM public.group_teams gt
  JOIN public.groups g ON g.id = gt.group_id
  WHERE g.tournament_id = p_tournament_id;

  IF v_team_count <> 12 THEN
    RAISE EXCEPTION 'Cần đủ 12 đội trong 4 bảng trước khi sinh lịch thi đấu (hiện có % đội)', v_team_count;
  END IF;

  SELECT COUNT(*) INTO v_existing
  FROM public.matches WHERE tournament_id = p_tournament_id AND stage = 'group';
  IF v_existing = 12 THEN
    RETURN v_existing;
  ELSIF v_existing > 0 THEN
    RAISE EXCEPTION 'Lịch vòng bảng đang có % trận; cần kiểm tra dữ liệu trước khi tạo lại', v_existing;
  END IF;

  SELECT
    COALESCE(
      (SELECT (settings_json->>'group_target_points')::INT
       FROM public.tournament_settings WHERE tournament_id = p_tournament_id),
      30
    ),
    COALESCE(
      (SELECT (settings_json->>'win_by')::INT
       FROM public.tournament_settings WHERE tournament_id = p_tournament_id),
      2
    )
  INTO v_target_points, v_win_by;

  SELECT COALESCE(MAX(match_number), 0) INTO v_match_no
  FROM public.matches WHERE tournament_id = p_tournament_id;

  FOR v_group IN
    SELECT id, group_name FROM public.groups
    WHERE tournament_id = p_tournament_id
    ORDER BY group_name
  LOOP
    SELECT array_agg(team_id ORDER BY id) INTO v_teams
    FROM public.group_teams WHERE group_id = v_group.id;

    IF COALESCE(array_length(v_teams, 1), 0) <> 3 THEN
      RAISE EXCEPTION 'Bảng % chưa có đủ 3 đội', v_group.group_name;
    END IF;

    FOR v_p IN 1..3 LOOP
      v_match_no := v_match_no + 1;
      INSERT INTO public.matches (
        tournament_id, group_id, match_number, stage,
        team_a_id, team_b_id, target_points, best_of, win_by, status
      )
      VALUES (
        p_tournament_id, v_group.id, v_match_no, 'group',
        v_teams[v_pairs[v_p][1]], v_teams[v_pairs[v_p][2]],
        v_target_points, 1, v_win_by, 'scheduled'
      )
      RETURNING id INTO v_match_id;

      INSERT INTO public.match_sets (match_id, set_number, score_a, score_b, status)
      VALUES (v_match_id, 1, 0, 0, 'pending');
    END LOOP;
  END LOOP;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_group_matches', jsonb_build_object('created_matches', 12));

  RETURN 12;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. generate_tie_break_matches (Tạo trận tie-break 2 đội hoặc 3 đội mini round robin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_tie_break_matches(
  p_tournament_id UUID,
  p_group_id UUID,
  p_team_ids UUID[],
  p_event_type TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_len INT := COALESCE(array_length(p_team_ids, 1), 0);
  v_type TEXT;
  v_event_id UUID;
  v_match_no INT;
  v_match_id UUID;
  v_i INT;
  v_j INT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền tạo trận tie-break';
  END IF;

  IF v_len NOT IN (2, 3) THEN
    RAISE EXCEPTION 'Tie-break chỉ áp dụng cho 2 đội hoặc 3 đội đồng điểm';
  END IF;

  v_type := COALESCE(p_event_type, CASE WHEN v_len = 2 THEN 'two_team' ELSE 'three_team_round_robin' END);

  INSERT INTO public.tie_break_events (tournament_id, group_id, event_type, status)
  VALUES (p_tournament_id, p_group_id, v_type, 'in_progress')
  RETURNING id INTO v_event_id;

  SELECT COALESCE(MAX(match_number), 0) INTO v_match_no
  FROM public.matches WHERE tournament_id = p_tournament_id;

  FOR v_i IN 1..(v_len - 1) LOOP
    FOR v_j IN (v_i + 1)..v_len LOOP
      v_match_no := v_match_no + 1;
      INSERT INTO public.matches (
        tournament_id, group_id, tie_break_event_id, match_number, stage,
        team_a_id, team_b_id, target_points, best_of, win_by, status
      )
      VALUES (
        p_tournament_id, p_group_id, v_event_id, v_match_no, 'tie_break',
        p_team_ids[v_i], p_team_ids[v_j], 15, 1, 2, 'scheduled'
      )
      RETURNING id INTO v_match_id;

      INSERT INTO public.match_sets (match_id, set_number, score_a, score_b, status)
      VALUES (v_match_id, 1, 0, 0, 'pending');
    END LOOP;
  END LOOP;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_tie_break_matches', jsonb_build_object(
    'tie_break_event_id', v_event_id,
    'group_id', p_group_id,
    'event_type', v_type,
    'team_ids', p_team_ids
  ));

  RETURN v_event_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. save_match_set_score (Admin & Referee - có kiểm tra xung đột & audit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_match_set_score(
  p_match_id UUID,
  p_set_number INT,
  p_score_a INT,
  p_score_b INT,
  p_action TEXT DEFAULT 'manual_score',
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_match RECORD;
  v_set RECORD;
  v_set_id UUID;
  v_set_completed BOOLEAN;
  v_sets_won_a INT := 0;
  v_sets_won_b INT := 0;
  v_needed_sets INT;
  v_new_winner UUID := NULL;
  v_new_status TEXT;
  v_now TIMESTAMPTZ := now();
  v_next_set INT;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy trận đấu';
  END IF;

  IF v_uid IS NULL OR NOT public.is_tournament_staff(v_match.tournament_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền nhập tỷ số cho giải đấu này';
  END IF;

  IF p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Điểm số phải là số nguyên không âm';
  END IF;

  IF p_set_number < 1 OR p_set_number > v_match.best_of THEN
    RAISE EXCEPTION 'Số set (%) không hợp lệ cho thể thức BO%', p_set_number, v_match.best_of;
  END IF;

  -- Kiểm tra xung đột đồng thời giữa các trọng tài
  IF p_expected_updated_at IS NOT NULL
     AND date_trunc('milliseconds', v_match.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) THEN
    RAISE EXCEPTION 'CONFLICT: Trận đấu vừa được cập nhật bởi trọng tài khác. Vui lòng làm mới dữ liệu.';
  END IF;

  -- Kiểm tra set đã đạt điều kiện thắng chưa (đạt tối thiểu target_points và hơn ít nhất win_by điểm)
  v_set_completed := (
    (p_score_a >= v_match.target_points OR p_score_b >= v_match.target_points)
    AND ABS(p_score_a - p_score_b) >= v_match.win_by
  );

  SELECT * INTO v_set
  FROM public.match_sets
  WHERE match_id = p_match_id AND set_number = p_set_number;

  IF FOUND THEN
    v_set_id := v_set.id;
    UPDATE public.match_sets
    SET score_a = p_score_a,
        score_b = p_score_b,
        status = CASE WHEN v_set_completed THEN 'completed' ELSE 'in_progress' END,
        updated_at = v_now
    WHERE id = v_set_id;

    INSERT INTO public.match_score_audit (
      match_id, match_set_id, old_score_a, old_score_b, new_score_a, new_score_b, action, user_id
    ) VALUES (
      p_match_id, v_set_id, v_set.score_a, v_set.score_b, p_score_a, p_score_b, COALESCE(p_action, 'update_score'), v_uid
    );
  ELSE
    INSERT INTO public.match_sets (match_id, set_number, score_a, score_b, status, updated_at)
    VALUES (
      p_match_id, p_set_number, p_score_a, p_score_b,
      CASE WHEN v_set_completed THEN 'completed' ELSE 'in_progress' END,
      v_now
    )
    RETURNING id INTO v_set_id;

    INSERT INTO public.match_score_audit (
      match_id, match_set_id, old_score_a, old_score_b, new_score_a, new_score_b, action, user_id
    ) VALUES (
      p_match_id, v_set_id, 0, 0, p_score_a, p_score_b, COALESCE(p_action, 'create_set_score'), v_uid
    );
  END IF;

  -- Tính tổng số set thắng của mỗi đội
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed' AND score_a > score_b),
    COUNT(*) FILTER (WHERE status = 'completed' AND score_b > score_a)
  INTO v_sets_won_a, v_sets_won_b
  FROM public.match_sets
  WHERE match_id = p_match_id;

  v_needed_sets := (v_match.best_of / 2) + 1;

  IF v_sets_won_a >= v_needed_sets THEN
    v_new_winner := v_match.team_a_id;
    v_new_status := 'completed';
  ELSIF v_sets_won_b >= v_needed_sets THEN
    v_new_winner := v_match.team_b_id;
    v_new_status := 'completed';
  ELSE
    v_new_winner := NULL;
    IF p_score_a > 0 OR p_score_b > 0 OR v_sets_won_a > 0 OR v_sets_won_b > 0 THEN
      v_new_status := 'in_progress';
    ELSE
      v_new_status := 'scheduled';
    END IF;
  END IF;

  -- Tự động tạo set tiếp theo nếu BO3 và set hiện tại đã xong nhưng trận chưa xong
  IF v_match.best_of = 3 AND v_set_completed AND v_new_winner IS NULL AND p_set_number < 3 THEN
    v_next_set := p_set_number + 1;
    INSERT INTO public.match_sets (match_id, set_number, score_a, score_b, status)
    VALUES (p_match_id, v_next_set, 0, 0, 'pending')
    ON CONFLICT (match_id, set_number) DO NOTHING;
  END IF;

  UPDATE public.matches
  SET winner_team_id = v_new_winner,
      status = v_new_status,
      updated_at = v_now
  WHERE id = p_match_id;

  -- Nếu là trận tie_break và toàn bộ trận trong tie_break_event đã hoàn thành -> cập nhật event
  IF v_match.tie_break_event_id IS NOT NULL AND v_new_status = 'completed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.matches
      WHERE tie_break_event_id = v_match.tie_break_event_id AND status <> 'completed'
    ) THEN
      UPDATE public.tie_break_events
      SET status = 'completed', completed_at = v_now
      WHERE id = v_match.tie_break_event_id;
    END IF;
  END IF;

  -- Nếu là trận knockout hoàn thành, tự động đẩy đội thắng vào vòng sau (chỉ khi ô kế tiếp còn trống hoặc chưa bắt đầu)
  IF v_match.stage IN ('quarterfinal', 'semifinal') AND v_new_status = 'completed' THEN
    PERFORM public.advance_winners(v_match.tournament_id, false);
  END IF;

  RETURN jsonb_build_object(
    'match_id', p_match_id,
    'set_id', v_set_id,
    'set_completed', v_set_completed,
    'sets_won_a', v_sets_won_a,
    'sets_won_b', v_sets_won_b,
    'winner_team_id', v_new_winner,
    'status', v_new_status,
    'updated_at', v_now
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. undo_last_score_change (Hoàn tác thao tác cộng/trừ điểm gần nhất)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_last_score_change(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_match RECORD;
  v_last RECORD;
  v_set_number INT;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy trận đấu';
  END IF;

  IF v_uid IS NULL OR NOT public.is_tournament_staff(v_match.tournament_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền hoàn tác điểm';
  END IF;

  SELECT * INTO v_last
  FROM public.match_score_audit
  WHERE match_id = p_match_id
    AND action <> 'undo'
    AND match_set_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không có thao tác nào để hoàn tác';
  END IF;

  SELECT set_number INTO v_set_number FROM public.match_sets WHERE id = v_last.match_set_id;

  RETURN public.save_match_set_score(
    p_match_id::UUID,
    v_set_number::INT,
    COALESCE(v_last.old_score_a, 0)::INT,
    COALESCE(v_last.old_score_b, 0)::INT,
    'undo'::TEXT,
    NULL::TIMESTAMPTZ
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. update_match_result (Xác nhận hoặc sửa kết quả trận đấu, cảnh báo nhánh sau)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_match_result(
  p_match_id UUID,
  p_status TEXT DEFAULT NULL,
  p_force_cascade BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_match RECORD;
  v_downstream_has_scores BOOLEAN := false;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy trận đấu';
  END IF;

  IF v_uid IS NULL OR NOT public.is_tournament_staff(v_match.tournament_id) THEN
    RAISE EXCEPTION 'Bạn không có quyền cập nhật kết quả trận đấu';
  END IF;

  -- Kiểm tra nếu là trận knockout và có trận phía sau đã thi đấu
  IF v_match.stage IN ('quarterfinal', 'semifinal') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.tournament_id = v_match.tournament_id
        AND (
          (v_match.stage = 'quarterfinal' AND m.stage IN ('semifinal', 'third_place', 'final'))
          OR (v_match.stage = 'semifinal' AND m.stage IN ('third_place', 'final'))
        )
        AND m.status IN ('in_progress', 'completed')
    ) INTO v_downstream_has_scores;

    IF v_downstream_has_scores AND NOT p_force_cascade THEN
      RETURN jsonb_build_object(
        'warning', true,
        'message', 'Trận đấu ở vòng sau đã có tỷ số. Cần Admin xác nhận trước khi cập nhật nhánh đấu. Không tự động xóa kết quả trận phía sau.'
      );
    END IF;
  END IF;

  IF p_status IS NOT NULL THEN
    UPDATE public.matches SET status = p_status, updated_at = now() WHERE id = p_match_id;
  END IF;

  IF v_match.stage IN ('quarterfinal', 'semifinal') THEN
    PERFORM public.advance_winners(v_match.tournament_id, p_force_cascade);
  END IF;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (v_match.tournament_id, v_uid, 'update_match_result', jsonb_build_object(
    'match_id', p_match_id,
    'status', COALESCE(p_status, v_match.status),
    'force_cascade', p_force_cascade
  ));

  RETURN jsonb_build_object('warning', false, 'updated', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. resolve_group_standings (Admin xác nhận thứ hạng đặc biệt kèm lý do bắt buộc)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_group_standings(
  p_tournament_id UUID,
  p_group_id UUID,
  p_ordered_team_ids UUID[],
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_i INT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền quyết định thứ hạng bảng đấu';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Bắt buộc phải nhập lý do khi Admin quyết định thứ hạng';
  END IF;

  IF COALESCE(array_length(p_ordered_team_ids, 1), 0) <> 3 THEN
    RAISE EXCEPTION 'Phải cung cấp thứ tự đủ 3 đội trong bảng';
  END IF;

  FOR v_i IN 1..3 LOOP
    UPDATE public.group_teams
    SET manual_rank = v_i
    WHERE group_id = p_group_id AND team_id = p_ordered_team_ids[v_i];
  END LOOP;

  UPDATE public.groups
  SET manual_resolution_note = trim(p_reason),
      manual_resolved_by = v_uid,
      manual_resolved_at = now()
  WHERE id = p_group_id AND tournament_id = p_tournament_id;

  INSERT INTO public.tie_break_events (tournament_id, group_id, event_type, status, reason, resolved_by, completed_at)
  VALUES (p_tournament_id, p_group_id, 'admin_decision', 'completed', trim(p_reason), v_uid, now());

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'resolve_group_standings', jsonb_build_object(
    'group_id', p_group_id,
    'ordered_team_ids', p_ordered_team_ids,
    'reason', trim(p_reason)
  ));
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. generate_knockout_matches (Sinh Tứ kết, Bán kết, Tranh hạng 3, Chung kết)
--     QF1: Nhất A vs Nhì B
--     QF2: Nhất B vs Nhì A
--     QF3: Nhất C vs Nhì D
--     QF4: Nhất D vs Nhì C
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_knockout_matches(
  p_tournament_id UUID,
  p_qualified JSONB -- {"A": [firstId, secondId], "B": [...], "C": [...], "D": [...]}
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_incomplete_group INT;
  v_incomplete_tb INT;
  v_existing INT;
  v_match_no INT;
  v_qf_sf_pts INT := 15;
  v_final_pts INT := 21;
  v_win_by INT := 2;
  v_m_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền tạo vòng loại trực tiếp';
  END IF;

  SELECT COUNT(*) INTO v_incomplete_group
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND stage = 'group' AND status <> 'completed';

  IF v_incomplete_group > 0 THEN
    RAISE EXCEPTION 'Vẫn còn % trận vòng bảng chưa hoàn thành', v_incomplete_group;
  END IF;

  SELECT COUNT(*) INTO v_incomplete_tb
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND stage = 'tie_break' AND status <> 'completed';

  IF v_incomplete_tb > 0 THEN
    RAISE EXCEPTION 'Vẫn còn % trận tie-break chưa hoàn thành', v_incomplete_tb;
  END IF;

  SELECT COUNT(*) INTO v_existing
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND stage IN ('quarterfinal', 'semifinal', 'third_place', 'final');

  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Vòng loại trực tiếp đã được tạo trước đó';
  END IF;

  SELECT
    COALESCE((settings_json->>'qf_sf_target_points')::INT, 15),
    COALESCE((settings_json->>'final_third_target_points')::INT, 21),
    COALESCE((settings_json->>'win_by')::INT, 2)
  INTO v_qf_sf_pts, v_final_pts, v_win_by
  FROM public.tournament_settings
  WHERE tournament_id = p_tournament_id;

  SELECT COALESCE(MAX(match_number), 0) INTO v_match_no
  FROM public.matches WHERE tournament_id = p_tournament_id;

  -- QF1: Nhất A vs Nhì B
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, team_a_id, team_b_id, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'quarterfinal', 'QF1', (p_qualified->'A'->>0)::UUID, (p_qualified->'B'->>1)::UUID, v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- QF2: Nhất B vs Nhì A
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, team_a_id, team_b_id, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'quarterfinal', 'QF2', (p_qualified->'B'->>0)::UUID, (p_qualified->'A'->>1)::UUID, v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- QF3: Nhất C vs Nhì D
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, team_a_id, team_b_id, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'quarterfinal', 'QF3', (p_qualified->'C'->>0)::UUID, (p_qualified->'D'->>1)::UUID, v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- QF4: Nhất D vs Nhì C
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, team_a_id, team_b_id, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'quarterfinal', 'QF4', (p_qualified->'D'->>0)::UUID, (p_qualified->'C'->>1)::UUID, v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- SF1: Thắng QF1 vs Thắng QF3
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'semifinal', 'SF1', v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- SF2: Thắng QF2 vs Thắng QF4
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'semifinal', 'SF2', v_qf_sf_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- Tranh hạng 3: Thua SF1 vs Thua SF2 (BO3, 21 điểm)
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'third_place', 'THIRD', v_final_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  -- Chung kết: Thắng SF1 vs Thắng SF2 (BO3, 21 điểm)
  v_match_no := v_match_no + 1;
  INSERT INTO public.matches (tournament_id, match_number, stage, bracket_slot, target_points, best_of, win_by)
  VALUES (p_tournament_id, v_match_no, 'final', 'FINAL', v_final_pts, 3, v_win_by)
  RETURNING id INTO v_m_id;
  INSERT INTO public.match_sets (match_id, set_number, status) VALUES (v_m_id, 1, 'pending');

  UPDATE public.tournaments SET status = 'knockout', updated_at = now() WHERE id = p_tournament_id;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'generate_knockout_matches', jsonb_build_object('qualified', p_qualified));

  RETURN 8;
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. advance_winners (Đẩy đội thắng/thua vào Bán kết, Tranh hạng 3, Chung kết)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_winners(
  p_tournament_id UUID,
  p_force_overwrite BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1_win UUID; v_sf1_lose UUID;
  v_sf2_win UUID; v_sf2_lose UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_staff(p_tournament_id) THEN
    RAISE EXCEPTION 'Không có quyền cập nhật nhánh đấu';
  END IF;

  SELECT winner_team_id INTO v_qf1 FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'QF1';
  SELECT winner_team_id INTO v_qf2 FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'QF2';
  SELECT winner_team_id INTO v_qf3 FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'QF3';
  SELECT winner_team_id INTO v_qf4 FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'QF4';

  -- Cập nhật SF1 (Thắng QF1 vs Thắng QF3) chỉ khi chưa thi đấu hoặc được phép force
  UPDATE public.matches
  SET team_a_id = v_qf1, team_b_id = v_qf3, updated_at = now()
  WHERE tournament_id = p_tournament_id
    AND bracket_slot = 'SF1'
    AND (status = 'scheduled' OR p_force_overwrite);

  -- Cập nhật SF2 (Thắng QF2 vs Thắng QF4)
  UPDATE public.matches
  SET team_a_id = v_qf2, team_b_id = v_qf4, updated_at = now()
  WHERE tournament_id = p_tournament_id
    AND bracket_slot = 'SF2'
    AND (status = 'scheduled' OR p_force_overwrite);

  SELECT
    winner_team_id,
    CASE WHEN winner_team_id = team_a_id THEN team_b_id WHEN winner_team_id = team_b_id THEN team_a_id ELSE NULL END
  INTO v_sf1_win, v_sf1_lose
  FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'SF1';

  SELECT
    winner_team_id,
    CASE WHEN winner_team_id = team_a_id THEN team_b_id WHEN winner_team_id = team_b_id THEN team_a_id ELSE NULL END
  INTO v_sf2_win, v_sf2_lose
  FROM public.matches WHERE tournament_id = p_tournament_id AND bracket_slot = 'SF2';

  -- Tranh hạng 3
  UPDATE public.matches
  SET team_a_id = v_sf1_lose, team_b_id = v_sf2_lose, updated_at = now()
  WHERE tournament_id = p_tournament_id
    AND bracket_slot = 'THIRD'
    AND (status = 'scheduled' OR p_force_overwrite);

  -- Chung kết
  UPDATE public.matches
  SET team_a_id = v_sf1_win, team_b_id = v_sf2_win, updated_at = now()
  WHERE tournament_id = p_tournament_id
    AND bracket_slot = 'FINAL'
    AND (status = 'scheduled' OR p_force_overwrite);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. reset_tournament_stage (Reset theo từng giai đoạn, có log)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_tournament_stage(
  p_tournament_id UUID,
  p_stage TEXT -- 'knockout' | 'group_matches' | 'group_draw' | 'team_draw'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền reset giai đoạn giải đấu';
  END IF;

  IF p_stage = 'knockout' THEN
    DELETE FROM public.matches
    WHERE tournament_id = p_tournament_id
      AND stage IN ('quarterfinal', 'semifinal', 'third_place', 'final');
    UPDATE public.tournaments SET status = 'group_stage', updated_at = now() WHERE id = p_tournament_id;

  ELSIF p_stage = 'group_matches' THEN
    DELETE FROM public.matches WHERE tournament_id = p_tournament_id;
    DELETE FROM public.tie_break_events WHERE tournament_id = p_tournament_id;
    UPDATE public.group_teams SET manual_rank = NULL
    WHERE group_id IN (SELECT id FROM public.groups WHERE tournament_id = p_tournament_id);
    UPDATE public.groups
    SET manual_resolution_note = NULL, manual_resolved_by = NULL, manual_resolved_at = NULL
    WHERE tournament_id = p_tournament_id;
    UPDATE public.tournaments SET status = 'group_stage', updated_at = now() WHERE id = p_tournament_id;

  ELSIF p_stage = 'group_draw' THEN
    DELETE FROM public.matches WHERE tournament_id = p_tournament_id;
    DELETE FROM public.tie_break_events WHERE tournament_id = p_tournament_id;
    DELETE FROM public.groups WHERE tournament_id = p_tournament_id;
    UPDATE public.tournaments SET status = 'group_draw', updated_at = now() WHERE id = p_tournament_id;

  ELSIF p_stage = 'team_draw' THEN
    DELETE FROM public.matches WHERE tournament_id = p_tournament_id;
    DELETE FROM public.tie_break_events WHERE tournament_id = p_tournament_id;
    DELETE FROM public.groups WHERE tournament_id = p_tournament_id;
    DELETE FROM public.teams WHERE tournament_id = p_tournament_id;
    UPDATE public.tournaments SET status = 'team_draw', updated_at = now() WHERE id = p_tournament_id;

  ELSE
    RAISE EXCEPTION 'Giai đoạn reset không hợp lệ: %', p_stage;
  END IF;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'reset_tournament_stage', jsonb_build_object('stage', p_stage));
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. copy_players_from_tournament (Sao chép VĐV từ giải cũ sang giải mới)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_players_from_tournament(
  p_source_tournament_id UUID,
  p_target_tournament_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_copied INT := 0;
  v_has_full_name BOOLEAN;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_target_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin giải đích mới có quyền sao chép danh sách vận động viên';
  END IF;

  IF NOT public.can_read_tournament(p_source_tournament_id) THEN
    RAISE EXCEPTION 'Không có quyền đọc dữ liệu giải đấu nguồn';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tournament_players'
      AND column_name = 'full_name'
  ) INTO v_has_full_name;

  IF v_has_full_name THEN
    EXECUTE $query$
      INSERT INTO public.tournament_players (
        tournament_id, player_id, skill_level, note, status, full_name
      )
      SELECT $1, tp.player_id, tp.skill_level, tp.note, 'active', p.full_name
      FROM public.tournament_players tp
      JOIN public.players p ON p.id = tp.player_id
      WHERE tp.tournament_id = $2
      ON CONFLICT (tournament_id, player_id) DO NOTHING
    $query$
    USING p_target_tournament_id, p_source_tournament_id;
  ELSE
    INSERT INTO public.tournament_players (tournament_id, player_id, skill_level, note, status)
    SELECT p_target_tournament_id, tp.player_id, tp.skill_level, tp.note, 'active'
    FROM public.tournament_players tp
    WHERE tp.tournament_id = p_source_tournament_id
    ON CONFLICT (tournament_id, player_id) DO NOTHING;
  END IF;

  GET DIAGNOSTICS v_copied = ROW_COUNT;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_target_tournament_id, v_uid, 'copy_players', jsonb_build_object(
    'source_tournament_id', p_source_tournament_id,
    'copied_count', v_copied
  ));

  RETURN v_copied;
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. add_tournament_member_by_email (Admin thêm trọng tài hoặc admin qua email)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_tournament_member_by_email(
  p_tournament_id UUID,
  p_email TEXT,
  p_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target_user UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền thêm thành viên quản trị/trọng tài';
  END IF;

  IF p_role NOT IN ('admin', 'referee') THEN
    RAISE EXCEPTION 'Vai trò không hợp lệ';
  END IF;

  SELECT id INTO v_target_user
  FROM public.profiles
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_target_user IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản với email "%". Hãy tạo tài khoản trong Supabase Auth Dashboard trước.', p_email;
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (p_tournament_id, v_target_user, p_role)
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (p_tournament_id, v_uid, 'add_tournament_member', jsonb_build_object('email', p_email, 'role', p_role));

  RETURN v_target_user;
END;
$$;

-- -----------------------------------------------------------------------------
-- Cấp quyền EXECUTE đúng vai trò (KHÔNG cấp cho anon các hàm ghi dữ liệu!)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_tournament_with_admin(TEXT, TEXT, DATE, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_team_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_team_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_group_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_group_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_group_matches(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_tie_break_matches(UUID, UUID, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_match_set_score(UUID, INT, INT, INT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_last_score_change(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_result(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_group_standings(UUID, UUID, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_knockout_matches(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_winners(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_tournament_stage(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copy_players_from_tournament(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_tournament_member_by_email(UUID, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_tournament_with_admin(TEXT, TEXT, DATE, TEXT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_team_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_team_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_group_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_group_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_group_matches(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_tie_break_matches(UUID, UUID, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_match_set_score(UUID, INT, INT, INT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_score_change(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_result(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_group_standings(UUID, UUID, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_knockout_matches(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_winners(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tournament_stage(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_players_from_tournament(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_tournament_member_by_email(UUID, TEXT, TEXT) TO authenticated;
