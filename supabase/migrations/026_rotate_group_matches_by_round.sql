ALTER TABLE public.group_teams
  ADD COLUMN IF NOT EXISTS display_order INTEGER;

WITH ordered_group_teams AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY ctid)::INTEGER AS display_order
  FROM public.group_teams
)
UPDATE public.group_teams gt
SET display_order = ordered_group_teams.display_order
FROM ordered_group_teams
WHERE gt.id = ordered_group_teams.id
  AND gt.display_order IS NULL;

ALTER TABLE public.group_teams
  ALTER COLUMN display_order SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.group_teams'::regclass
      AND conname = 'group_teams_group_display_order_key'
  ) THEN
    ALTER TABLE public.group_teams
      ADD CONSTRAINT group_teams_group_display_order_key
      UNIQUE (group_id, display_order);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_group_team_display_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.display_order IS NULL THEN
    SELECT COALESCE(MAX(display_order), 0) + 1
    INTO NEW.display_order
    FROM public.group_teams
    WHERE group_id = NEW.group_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    SELECT COALESCE(MAX(display_order), 0) + 1
    INTO NEW.display_order
    FROM public.group_teams
    WHERE group_id = NEW.group_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_group_team_display_order ON public.group_teams;
CREATE TRIGGER trg_assign_group_team_display_order
  BEFORE INSERT OR UPDATE ON public.group_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_group_team_display_order();

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

  FOR v_p IN 1..3 LOOP
    FOR v_group IN
      SELECT id, group_name
      FROM public.groups
      WHERE tournament_id = p_tournament_id
      ORDER BY group_name
    LOOP
      SELECT array_agg(team_id ORDER BY display_order) INTO v_teams
      FROM public.group_teams
      WHERE group_id = v_group.id;

      IF COALESCE(array_length(v_teams, 1), 0) <> 3 THEN
        RAISE EXCEPTION 'Bảng % chưa có đủ 3 đội', v_group.group_name;
      END IF;

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

DO $$
DECLARE
  v_tournament_id UUID;
  v_max_match_number INT;
  v_offset INT;
  v_updated INT;
BEGIN
  FOR v_tournament_id IN
    SELECT tournament_id
    FROM public.matches
    WHERE stage = 'group'
    GROUP BY tournament_id
    HAVING COUNT(*) = 12
  LOOP
    SELECT COALESCE(MAX(match_number), 0)
    INTO v_max_match_number
    FROM public.matches
    WHERE tournament_id = v_tournament_id;

    v_offset := v_max_match_number + 12;

    UPDATE public.matches
    SET match_number = match_number + v_offset
    WHERE tournament_id = v_tournament_id
      AND stage = 'group';

    WITH team_slots AS (
      SELECT group_id, team_id, display_order
      FROM public.group_teams
    ),
    ordered_matches AS (
      SELECT
        m.id,
        g.group_name,
        CASE
          WHEN (slot_a.display_order = 1 AND slot_b.display_order = 2)
            OR (slot_a.display_order = 2 AND slot_b.display_order = 1) THEN 1
          WHEN (slot_a.display_order = 1 AND slot_b.display_order = 3)
            OR (slot_a.display_order = 3 AND slot_b.display_order = 1) THEN 2
          ELSE 3
        END AS round_number
      FROM public.matches m
      JOIN public.groups g ON g.id = m.group_id
      JOIN team_slots slot_a ON slot_a.group_id = m.group_id AND slot_a.team_id = m.team_a_id
      JOIN team_slots slot_b ON slot_b.group_id = m.group_id AND slot_b.team_id = m.team_b_id
      WHERE m.tournament_id = v_tournament_id
        AND m.stage = 'group'
    ),
    desired_order AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY round_number, group_name) AS position
      FROM ordered_matches
    ),
    available_numbers AS (
      SELECT
        match_number - v_offset AS match_number,
        ROW_NUMBER() OVER (ORDER BY match_number) AS position
      FROM public.matches
      WHERE tournament_id = v_tournament_id
        AND stage = 'group'
    ),
    match_number_map AS (
      SELECT desired_order.id, available_numbers.match_number
      FROM desired_order
      JOIN available_numbers USING (position)
    )
    UPDATE public.matches m
    SET match_number = match_number_map.match_number,
        updated_at = now()
    FROM match_number_map
    WHERE m.id = match_number_map.id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 12 THEN
      RAISE EXCEPTION 'Không thể sắp xếp lại đủ 12 trận vòng bảng cho giải đấu %', v_tournament_id;
    END IF;
  END LOOP;
END;
$$;
