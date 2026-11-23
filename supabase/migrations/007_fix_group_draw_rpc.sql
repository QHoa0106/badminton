-- Repair generate_group_draw for databases where migration 003 is already applied.
-- Explicitly name the unnest output column so the distribution array is TEXT[].
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
    SELECT 1
    FROM public.groups
    WHERE tournament_id = p_tournament_id AND status = 'confirmed'
  ) INTO v_has_confirmed;

  IF v_has_confirmed THEN
    RAISE EXCEPTION 'Kết quả chia bảng đã được xác nhận. Hãy reset chia bảng trước nếu muốn random lại.';
  END IF;

  SELECT array_agg(id ORDER BY random()) INTO v_mixed_teams
  FROM public.teams
  WHERE tournament_id = p_tournament_id
    AND status = 'confirmed'
    AND team_type = 'TB-_TBY';

  SELECT array_agg(id ORDER BY random()) INTO v_plus_teams
  FROM public.teams
  WHERE tournament_id = p_tournament_id
    AND status = 'confirmed'
    AND team_type = 'TBY+_TBY+';

  IF COALESCE(array_length(v_mixed_teams, 1), 0) <> 6
     OR COALESCE(array_length(v_plus_teams, 1), 0) <> 6 THEN
    RAISE EXCEPTION 'Cần xác nhận đủ 6 đội TB- + TBY và 6 đội TBY+ + TBY+ trước khi chia bảng';
  END IF;

  SELECT array_agg(distribution_type ORDER BY random()) INTO v_dist_types
  FROM unnest(
    ARRAY['2_mixed_1_plus', '2_mixed_1_plus', '1_mixed_2_plus', '1_mixed_2_plus']::TEXT[]
  ) AS distributions(distribution_type);

  DELETE FROM public.groups
  WHERE tournament_id = p_tournament_id AND status = 'draft';

  FOR v_i IN 1..4 LOOP
    INSERT INTO public.groups (tournament_id, group_name, distribution_type, status)
    VALUES (p_tournament_id, v_group_names[v_i], v_dist_types[v_i], 'draft')
    RETURNING id INTO v_group_id;

    IF v_dist_types[v_i] = '2_mixed_1_plus' THEN
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_plus_teams[v_plus_idx]);
      v_plus_idx := v_plus_idx + 1;
    ELSE
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_mixed_teams[v_mixed_idx]);
      v_mixed_idx := v_mixed_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_plus_teams[v_plus_idx]);
      v_plus_idx := v_plus_idx + 1;
      INSERT INTO public.group_teams (group_id, team_id)
      VALUES (v_group_id, v_plus_teams[v_plus_idx]);
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

REVOKE ALL ON FUNCTION public.generate_group_draw(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_group_draw(UUID) TO authenticated;
