-- Read-only diagnostics for the draw team flow.
-- Run this in Supabase SQL Editor and share the returned rows.

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'teams',
    'team_members',
    'tournament_players',
    'players',
    'draw_history',
    'tournament_activity_logs',
    'tournaments'
  )
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
    'teams',
    'team_members',
    'tournament_players',
    'draw_history',
    'tournament_activity_logs',
    'tournaments'
  )
ORDER BY conrelid::regclass::text, conname;

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'generate_team_draw',
    'confirm_team_draw',
    'is_tournament_admin'
  )
ORDER BY routine_name;
