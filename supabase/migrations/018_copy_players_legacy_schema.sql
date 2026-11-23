CREATE OR REPLACE FUNCTION public.copy_players_from_tournament(
  p_source_tournament_id UUID,
  p_target_tournament_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.copy_players_from_tournament(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_players_from_tournament(UUID, UUID) TO authenticated;
