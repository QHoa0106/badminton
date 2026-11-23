-- Knockout placeholder matches have no teams until the previous round completes.
ALTER TABLE public.matches
  ALTER COLUMN team_a_id DROP NOT NULL,
  ALTER COLUMN team_b_id DROP NOT NULL;
