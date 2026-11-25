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
  v_total_mixed INT;
  v_total_plus INT;
  v_group_type TEXT;
  v_previous_group_type TEXT;
  v_group_name TEXT;
  v_group_id UUID;
  v_team_ids UUID[];
  v_team_idx INT;
  v_group_teams_json JSONB;
  v_group_json JSONB;
  v_draw_id UUID;
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
  ELSIF EXISTS (
    SELECT 1
    FROM public.groups
    WHERE tournament_id = p_tournament_id
      AND (
        distribution_type IS NULL
        OR distribution_type NOT IN ('mixed_only', 'plus_only')
      )
  ) THEN
    RAISE EXCEPTION 'Bản chia bảng nháp theo luật cũ. Hãy reset chia bảng rồi random lại theo luật mới.';
  END IF;

  SELECT COUNT(*)
  INTO v_group_count
  FROM public.groups
  WHERE tournament_id = p_tournament_id;

  IF v_group_count >= 4 THEN
    RAISE EXCEPTION 'Đã random đủ 4 bảng. Hãy xác nhận hoặc random lại từ đầu.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.groups current_group
    JOIN public.groups next_group
      ON next_group.tournament_id = current_group.tournament_id
     AND next_group.group_name = CASE current_group.group_name
       WHEN 'A' THEN 'B'
       WHEN 'B' THEN 'C'
       WHEN 'C' THEN 'D'
     END
    WHERE current_group.tournament_id = p_tournament_id
      AND current_group.distribution_type = next_group.distribution_type
  ) THEN
    RAISE EXCEPTION 'Các bảng nháp chưa xen kẽ theo luật mới. Hãy random lại từ bảng A.';
  END IF;

  IF v_group_count = 0 THEN
    v_group_type := CASE WHEN random() < 0.5 THEN 'mixed_only' ELSE 'plus_only' END;
  ELSE
    SELECT distribution_type INTO v_previous_group_type
    FROM public.groups
    WHERE tournament_id = p_tournament_id
      AND group_name = v_group_names[v_group_count];

    IF v_previous_group_type IS NULL THEN
      RAISE EXCEPTION 'Tiến độ chia bảng không hợp lệ. Hãy random lại từ bảng A.';
    END IF;

    v_group_type := CASE v_previous_group_type
      WHEN 'mixed_only' THEN 'plus_only'
      ELSE 'mixed_only'
    END;
  END IF;

  SELECT array_agg(available.team_id ORDER BY available.random_order)
  INTO v_team_ids
  FROM (
    SELECT t.id AS team_id, random() AS random_order
    FROM public.teams t
    WHERE t.tournament_id = p_tournament_id
      AND t.status = 'confirmed'
      AND (
        (v_group_type = 'mixed_only' AND t.team_type = 'TB-_TBY')
        OR (v_group_type = 'plus_only' AND t.team_type = 'TBY+_TBY+')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.group_teams gt
        JOIN public.groups g ON g.id = gt.group_id
        WHERE g.tournament_id = p_tournament_id AND gt.team_id = t.id
      )
    ORDER BY random_order
    LIMIT 3
  ) AS available;

  IF COALESCE(array_length(v_team_ids, 1), 0) <> 3 THEN
    RAISE EXCEPTION 'Không đủ 3 đội chưa chia cho bảng % (nhóm %, hiện còn % đội)',
      v_group_names[v_group_count + 1],
      v_group_type,
      COALESCE(array_length(v_team_ids, 1), 0);
  END IF;

  v_group_name := v_group_names[v_group_count + 1];

  INSERT INTO public.groups (tournament_id, group_name, distribution_type, status)
  VALUES (p_tournament_id, v_group_name, v_group_type, 'draft')
  RETURNING id INTO v_group_id;

  FOR v_team_idx IN 1..3 LOOP
    INSERT INTO public.group_teams (group_id, team_id)
    VALUES (v_group_id, v_team_ids[v_team_idx]);
  END LOOP;

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
