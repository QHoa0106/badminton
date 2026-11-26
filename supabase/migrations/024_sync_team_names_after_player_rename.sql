UPDATE public.teams t
SET team_name = CASE
  WHEN t.team_name = tp1.skill_level || ' / ' || p2.full_name
    THEN p1.full_name || ' / ' || p2.full_name
  WHEN t.team_name = p1.full_name || ' / ' || tp2.skill_level
    THEN p1.full_name || ' / ' || p2.full_name
  WHEN t.team_name = tp1.skill_level || ' / ' || tp2.skill_level
    THEN p1.full_name || ' / ' || p2.full_name
  WHEN t.team_name = p2.full_name || ' / ' || tp1.skill_level
    THEN p2.full_name || ' / ' || p1.full_name
  WHEN t.team_name = tp2.skill_level || ' / ' || p1.full_name
    THEN p2.full_name || ' / ' || p1.full_name
  WHEN t.team_name = tp2.skill_level || ' / ' || tp1.skill_level
    THEN p2.full_name || ' / ' || p1.full_name
END
FROM public.team_members tm1
JOIN public.tournament_players tp1 ON tp1.id = tm1.tournament_player_id
JOIN public.players p1 ON p1.id = tp1.player_id
JOIN public.team_members tm2 ON tm2.team_id = tm1.team_id AND tm2.id > tm1.id
JOIN public.tournament_players tp2 ON tp2.id = tm2.tournament_player_id
JOIN public.players p2 ON p2.id = tp2.player_id
WHERE t.id = tm1.team_id
  AND t.team_name IN (
    tp1.skill_level || ' / ' || p2.full_name,
    p1.full_name || ' / ' || tp2.skill_level,
    tp1.skill_level || ' / ' || tp2.skill_level,
    p2.full_name || ' / ' || tp1.skill_level,
    tp2.skill_level || ' / ' || p1.full_name,
    tp2.skill_level || ' / ' || tp1.skill_level
  );

CREATE OR REPLACE FUNCTION public.sync_team_name_after_player_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name THEN
    RETURN NEW;
  END IF;

  UPDATE public.teams t
  SET team_name = CASE
    WHEN t.team_name = OLD.full_name || ' / ' || other_p.full_name
      THEN NEW.full_name || ' / ' || other_p.full_name
    ELSE other_p.full_name || ' / ' || NEW.full_name
  END
  FROM public.team_members changed_tm
  JOIN public.tournament_players changed_tp
    ON changed_tp.id = changed_tm.tournament_player_id
  JOIN public.team_members other_tm
    ON other_tm.team_id = changed_tm.team_id
   AND other_tm.id <> changed_tm.id
  JOIN public.tournament_players other_tp
    ON other_tp.id = other_tm.tournament_player_id
  JOIN public.players other_p
    ON other_p.id = other_tp.player_id
  WHERE changed_tp.player_id = NEW.id
    AND t.id = changed_tm.team_id
    AND (
      t.team_name = OLD.full_name || ' / ' || other_p.full_name
      OR t.team_name = other_p.full_name || ' / ' || OLD.full_name
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_team_name_after_player_rename ON public.players;
CREATE TRIGGER trg_sync_team_name_after_player_rename
  AFTER UPDATE OF full_name ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_team_name_after_player_rename();
