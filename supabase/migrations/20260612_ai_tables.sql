-- ai_requests: log every API call for rate limiting and auditing
CREATE TABLE IF NOT EXISTS ai_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT        NOT NULL,
  model         TEXT,
  prompt_hash   TEXT        NOT NULL,
  purpose       TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success       BOOLEAN     NOT NULL DEFAULT TRUE,
  error_message TEXT
);

-- ai_outputs: cache responses keyed by prompt hash
CREATE TABLE IF NOT EXISTS ai_outputs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_hash   TEXT        NOT NULL,
  purpose       TEXT        NOT NULL,
  input_prompt  TEXT        NOT NULL,
  output_text   TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_outputs_prompt_hash_idx ON ai_outputs (prompt_hash);
CREATE INDEX        IF NOT EXISTS ai_requests_created_at_idx  ON ai_requests (created_at);
CREATE INDEX        IF NOT EXISTS ai_requests_prompt_hash_idx ON ai_requests (prompt_hash);

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_outputs  ENABLE ROW LEVEL SECURITY;

-- Only service role can write; authenticated users can read their usage stats
CREATE POLICY "service_role_write_ai_requests"
  ON ai_requests FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "authenticated_read_ai_requests"
  ON ai_requests FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "service_role_write_ai_outputs"
  ON ai_outputs FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "authenticated_read_ai_outputs"
  ON ai_outputs FOR SELECT TO authenticated USING (TRUE);
