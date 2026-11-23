CREATE OR REPLACE FUNCTION public.generate_next_group_draw(
  p_tournament_id UUID,
  p_restart BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group_names TEXT[] := ARRAY['A', 'B', 'C', 'D'];
  v_group_count INT;
  v_used_two_mixed INT;
  v_used_one_mixed INT;
  v_remaining_two_mixed INT;
  v_remaining_one_mixed INT;
  v_total_mixed INT;
  v_total_plus INT;
  v_group_type TEXT;
  v_group_name TEXT;
  v_group_id UUID;
  v_draw_id UUID;
  v_mixed_teams UUID[];
  v_plus_teams UUID[];
  v_mixed_idx INT := 1;
  v_plus_idx INT := 1;
  v_group_teams_json JSONB;
  v_group_json JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền random chia bảng';
  END IF;

  PERFORM 1
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giải đấu';
  END IF;

  SELECT COUNT(*) FILTER (WHERE team_type = 'TB-_TBY'),
         COUNT(*) FILTER (WHERE team_type = 'TBY+_TBY+')
  INTO v_total_mixed, v_total_plus
  FROM public.teams
  WHERE tournament_id = p_tournament_id AND status = 'confirmed';

  IF v_total_mixed <> 6 OR v_total_plus <> 6 THEN
    RAISE EXCEPTION 'Cần xác nhận đủ 6 đội TB- + TBY và 6 đội TBY+ + TBY+ trước khi chia bảng';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.groups
    WHERE tournament_id = p_tournament_id AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Kết quả chia bảng đã được xác nhận. Hãy reset chia bảng trước nếu muốn random lại.';
  END IF;

  IF p_restart THEN
    DELETE FROM public.groups
    WHERE tournament_id = p_tournament_id AND status = 'draft';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE distribution_type = '2_mixed_1_plus'),
         COUNT(*) FILTER (WHERE distribution_type = '1_mixed_2_plus')
  INTO v_group_count, v_used_two_mixed, v_used_one_mixed
  FROM public.groups
  WHERE tournament_id = p_tournament_id;

  IF v_group_count >= 4 THEN
    RAISE EXCEPTION 'Đã random đủ 4 bảng. Hãy xác nhận hoặc random lại từ đầu.';
  END IF;

  v_remaining_two_mixed := 2 - v_used_two_mixed;
  v_remaining_one_mixed := 2 - v_used_one_mixed;

  IF v_remaining_two_mixed < 0
     OR v_remaining_one_mixed < 0
     OR v_remaining_two_mixed + v_remaining_one_mixed <> 4 - v_group_count THEN
    RAISE EXCEPTION 'Tiến độ chia bảng không hợp lệ. Hãy random lại từ bảng A.';
  END IF;

  IF v_remaining_two_mixed = 0 THEN
    v_group_type := '1_mixed_2_plus';
  ELSIF v_remaining_one_mixed = 0 THEN
    v_group_type := '2_mixed_1_plus';
  ELSIF random() < 0.5 THEN
    v_group_type := '2_mixed_1_plus';
  ELSE
    v_group_type := '1_mixed_2_plus';
  END IF;

  SELECT array_agg(t.id ORDER BY random()) INTO v_mixed_teams
  FROM public.teams t
  WHERE t.tournament_id = p_tournament_id
    AND t.status = 'confirmed'
    AND t.team_type = 'TB-_TBY'
    AND NOT EXISTS (
      SELECT 1
      FROM public.group_teams gt
      JOIN public.groups g ON g.id = gt.group_id
      WHERE g.tournament_id = p_tournament_id AND gt.team_id = t.id
    );

  SELECT array_agg(t.id ORDER BY random()) INTO v_plus_teams
  FROM public.teams t
  WHERE t.tournament_id = p_tournament_id
    AND t.status = 'confirmed'
    AND t.team_type = 'TBY+_TBY+'
    AND NOT EXISTS (
      SELECT 1
      FROM public.group_teams gt
      JOIN public.groups g ON g.id = gt.group_id
      WHERE g.tournament_id = p_tournament_id AND gt.team_id = t.id
    );

  IF v_group_type = '2_mixed_1_plus' THEN
    IF COALESCE(array_length(v_mixed_teams, 1), 0) < 2
       OR COALESCE(array_length(v_plus_teams, 1), 0) < 1 THEN
      RAISE EXCEPTION 'Không đủ đội chưa chia để random bảng tiếp theo';
    END IF;
  ELSIF COALESCE(array_length(v_mixed_teams, 1), 0) < 1
        OR COALESCE(array_length(v_plus_teams, 1), 0) < 2 THEN
    RAISE EXCEPTION 'Không đủ đội chưa chia để random bảng tiếp theo';
  END IF;

  v_group_name := v_group_names[v_group_count + 1];

  INSERT INTO public.groups (tournament_id, group_name, distribution_type, status)
  VALUES (p_tournament_id, v_group_name, v_group_type, 'draft')
  RETURNING id INTO v_group_id;

  IF v_group_type = '2_mixed_1_plus' THEN
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
    v_mixed_idx := v_mixed_idx + 1;
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
    v_mixed_idx := v_mixed_idx + 1;
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_plus_teams[v_plus_idx]);
  ELSE
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_plus_teams[v_plus_idx]);
    v_plus_idx := v_plus_idx + 1;
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_plus_teams[v_plus_idx]);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'team_id', t.id,
    'team_name', t.team_name,
    'team_type', t.team_type
  )) INTO v_group_teams_json
  FROM public.group_teams gt
  JOIN public.teams t ON t.id = gt.team_id
  WHERE gt.group_id = v_group_id;

  v_group_json := jsonb_build_object(
    'group_id', v_group_id,
    'group_name', v_group_name,
    'distribution_type', v_group_type,
    'teams', v_group_teams_json
  );

  IF v_group_count = 0 THEN
    INSERT INTO public.draw_history (tournament_id, draw_type, result_json, performed_by)
    VALUES (p_tournament_id, 'group_draw', jsonb_build_array(v_group_json), v_uid)
    RETURNING id INTO v_draw_id;
  ELSE
    SELECT id INTO v_draw_id
    FROM public.draw_history
    WHERE tournament_id = p_tournament_id
      AND draw_type = 'group_draw'
      AND confirmed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_draw_id IS NULL THEN
      INSERT INTO public.draw_history (tournament_id, draw_type, result_json, performed_by)
      VALUES (p_tournament_id, 'group_draw', jsonb_build_array(v_group_json), v_uid)
      RETURNING id INTO v_draw_id;
    ELSE
      UPDATE public.draw_history
      SET result_json = COALESCE(result_json, '[]'::jsonb) || jsonb_build_array(v_group_json)
      WHERE id = v_draw_id;
    END IF;
  END IF;

  INSERT INTO public.tournament_activity_logs (tournament_id, user_id, action, details)
  VALUES (
    p_tournament_id,
    v_uid,
    'generate_group_draw',
    jsonb_build_object('draw_id', v_draw_id, 'group_name', v_group_name)
  );

  RETURN jsonb_build_object(
    'draw_id', v_draw_id,
    'group_id', v_group_id,
    'group_name', v_group_name,
    'distribution_type', v_group_type,
    'teams', v_group_teams_json,
    'group_count', v_group_count + 1,
    'total_groups', 4
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_next_group_draw(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_next_group_draw(UUID, BOOLEAN) TO authenticated;
