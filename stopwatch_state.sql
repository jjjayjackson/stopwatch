-- Single shared live stopwatch. Desktop and mobile layouts read/write this row.
CREATE TABLE IF NOT EXISTS public.stopwatch_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  running boolean NOT NULL DEFAULT false,
  started_at bigint,
  accumulated_elapsed bigint NOT NULL DEFAULT 0 CHECK (accumulated_elapsed >= 0),
  session_started_at bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.stopwatch_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.stopwatch_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_stopwatch_state ON public.stopwatch_state;
DROP POLICY IF EXISTS anon_insert_stopwatch_state ON public.stopwatch_state;
DROP POLICY IF EXISTS anon_update_stopwatch_state ON public.stopwatch_state;

CREATE POLICY anon_select_stopwatch_state ON public.stopwatch_state
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY anon_insert_stopwatch_state ON public.stopwatch_state
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY anon_update_stopwatch_state ON public.stopwatch_state
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.stopwatch_state TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'stopwatch_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stopwatch_state;
  END IF;
END $$;
