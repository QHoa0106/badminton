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
  FROM public.groups
  WHERE tournament_id = p_tournament_id AND status <> 'confirmed';

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
  FROM public.matches
  WHERE tournament_id = p_tournament_id AND stage = 'group';

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
  FROM public.matches
  WHERE tournament_id = p_tournament_id;

  FOR v_group IN
    SELECT id, group_name
    FROM public.groups
    WHERE tournament_id = p_tournament_id
    ORDER BY group_name
  LOOP
    SELECT array_agg(team_id ORDER BY id) INTO v_teams
    FROM public.group_teams
    WHERE group_id = v_group.id;

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

REVOKE ALL ON FUNCTION public.generate_group_matches(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_group_matches(UUID) TO authenticated;
