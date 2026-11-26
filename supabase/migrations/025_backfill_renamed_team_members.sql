WITH team_rosters AS (
  SELECT
    t.id AS team_id,
    p1.full_name AS player1_name,
    p2.full_name AS player2_name
  FROM public.teams t
  JOIN public.team_members tm1 ON tm1.team_id = t.id
  JOIN public.tournament_players tp1 ON tp1.id = tm1.tournament_player_id
  JOIN public.players p1 ON p1.id = tp1.player_id
  JOIN public.team_members tm2 ON tm2.team_id = t.id AND tm2.id > tm1.id
  JOIN public.tournament_players tp2 ON tp2.id = tm2.tournament_player_id
  JOIN public.players p2 ON p2.id = tp2.player_id
)
UPDATE public.teams t
SET team_name = CASE
  WHEN split_part(t.team_name, ' / ', 1) = roster.player1_name
    THEN roster.player1_name || ' / ' || roster.player2_name
  WHEN split_part(t.team_name, ' / ', 1) = roster.player2_name
    THEN roster.player2_name || ' / ' || roster.player1_name
  WHEN split_part(t.team_name, ' / ', 2) = roster.player1_name
    THEN roster.player2_name || ' / ' || roster.player1_name
  ELSE roster.player1_name || ' / ' || roster.player2_name
END
FROM team_rosters roster
WHERE t.id = roster.team_id
  AND cardinality(string_to_array(t.team_name, ' / ')) = 2
  AND (
    split_part(t.team_name, ' / ', 1) ~ '^[0-9]+ (TB-|TBY|TBY[+])$'
    OR split_part(t.team_name, ' / ', 2) ~ '^[0-9]+ (TB-|TBY|TBY[+])$'
  )
  AND (
    (
      split_part(t.team_name, ' / ', 1) = roster.player1_name
      AND split_part(t.team_name, ' / ', 2) <> roster.player2_name
    )
    OR (
      split_part(t.team_name, ' / ', 1) = roster.player2_name
      AND split_part(t.team_name, ' / ', 2) <> roster.player1_name
    )
    OR (
      split_part(t.team_name, ' / ', 2) = roster.player1_name
      AND split_part(t.team_name, ' / ', 1) <> roster.player2_name
    )
    OR (
      split_part(t.team_name, ' / ', 2) = roster.player2_name
      AND split_part(t.team_name, ' / ', 1) <> roster.player1_name
    )
  );
