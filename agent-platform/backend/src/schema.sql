CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY,
  prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 12000),
  task_type TEXT NOT NULL CHECK (task_type IN ('app', 'platform', 'book_to_app', 'general')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  plan JSONB,
  error_code TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_tasks_created_at_idx ON agent_tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_audit_events_created_at_idx ON agent_audit_events (created_at DESC);