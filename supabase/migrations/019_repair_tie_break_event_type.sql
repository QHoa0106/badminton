-- Repair legacy tie_break_events event_type constraints.
-- The frontend and RPC use "decider" for a one-match tiebreak.
ALTER TABLE public.tie_break_events
  DROP CONSTRAINT IF EXISTS tie_break_events_event_type_check;

ALTER TABLE public.tie_break_events
  DROP CONSTRAINT IF EXISTS tie_break_event_type_check;

ALTER TABLE public.tie_break_events
  ADD CONSTRAINT tie_break_events_event_type_check
  CHECK (event_type IN (
    'two_team',
    'three_team_round_robin',
    'decider',
    'admin_decision'
  ));

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
  v_existing_event UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Chỉ Admin mới có quyền tạo trận tie-break';
  END IF;

  IF v_len NOT IN (2, 3) THEN
    RAISE EXCEPTION 'Tie-break chỉ áp dụng cho 2 đội hoặc 3 đội đồng điểm';
  END IF;

  v_type := COALESCE(p_event_type, CASE WHEN v_len = 2 THEN 'two_team' ELSE 'three_team_round_robin' END);

  IF v_type NOT IN ('two_team', 'three_team_round_robin', 'decider', 'admin_decision') THEN
    RAISE EXCEPTION 'Loại tie-break không hợp lệ: %', v_type;
  END IF;

  IF v_len = 2 AND v_type NOT IN ('two_team', 'decider') THEN
    RAISE EXCEPTION '2 đội tie-break chỉ hỗ trợ kiểu two_team hoặc decider';
  END IF;

  SELECT id INTO v_existing_event
  FROM public.tie_break_events
  WHERE tournament_id = p_tournament_id
    AND group_id = p_group_id
    AND status IN ('pending', 'in_progress')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_event IS NOT NULL THEN
    RETURN v_existing_event;
  END IF;

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
  VALUES (
    p_tournament_id,
    v_uid,
    'generate_tie_break_matches',
    jsonb_build_object(
      'tie_break_event_id', v_event_id,
      'group_id', p_group_id,
      'event_type', v_type,
      'team_ids', p_team_ids
    )
  );

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tie_break_matches(UUID, UUID, UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tie_break_matches(UUID, UUID, UUID[], TEXT) TO authenticated;
