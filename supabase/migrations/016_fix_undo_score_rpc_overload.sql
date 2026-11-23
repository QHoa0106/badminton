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
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

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

  SELECT set_number INTO v_set_number
  FROM public.match_sets
  WHERE id = v_last.match_set_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy set cần hoàn tác';
  END IF;

  RETURN public.save_match_set_score(
    p_match_id::UUID,
    v_set_number::INT,
    COALESCE(v_last.old_score_a, 0)::INT,
    COALESCE(v_last.old_score_b, 0)::INT,
    'undo'::TEXT,
    v_match.updated_at::TIMESTAMPTZ
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_last_score_change(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_last_score_change(UUID) TO authenticated;
