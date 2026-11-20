/**
 * Idempotent PostgreSQL DDL for all 17 FlagShip tables.
 * Mirrors src/db/schema.ts and backend-java/src/main/resources/db/migration/V1__init_flagship_schema.sql
 * so FlagShip boots 100% locally and offline-ready with embedded PostgreSQL (PGlite)
 * or connects seamlessly to a local/Docker PostgreSQL 16 server.
 */
export const FLAGSHIP_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  avatar_initials TEXT NOT NULL DEFAULT 'FS',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_member UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS environments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563EB',
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  required_approvers INTEGER NOT NULL DEFAULT 2,
  sdk_key_hash TEXT NOT NULL,
  sdk_key_prefix TEXT NOT NULL,
  sdk_key_plain_preview TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_env_project_key UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  flag_type TEXT NOT NULL DEFAULT 'BOOLEAN',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  default_variation_key TEXT NOT NULL DEFAULT 'off',
  off_variation_key TEXT NOT NULL DEFAULT 'off',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_flag_project_key UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS flag_variations (
  id SERIAL PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  variation_key TEXT NOT NULL,
  name TEXT NOT NULL,
  value_json JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_flag_variation_key UNIQUE (flag_id, variation_key)
);

CREATE TABLE IF NOT EXISTS segments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  included_users JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_users JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_group JSONB NOT NULL,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_segment_project_key UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS rollout_configurations (
  id SERIAL PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  default_variation_key TEXT NOT NULL DEFAULT 'off',
  rollout_variation_key TEXT NOT NULL DEFAULT 'on',
  rollout_percentage INTEGER NOT NULL DEFAULT 0,
  rollout_weights JSONB NOT NULL DEFAULT '[]'::jsonb,
  individual_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  evaluation_count INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at TIMESTAMP,
  full_rollout_since TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rollout_flag_env UNIQUE (flag_id, environment_id)
);

CREATE TABLE IF NOT EXISTS targeting_rules (
  id SERIAL PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  segment_key TEXT,
  rule_group JSONB NOT NULL,
  serve_variation_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flag_versions (
  id SERIAL PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT NOT NULL DEFAULT 'Configuration update',
  snapshot_json JSONB NOT NULL,
  diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  requester_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  required_approvals INTEGER NOT NULL DEFAULT 2,
  approvers JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  current_snapshot JSONB NOT NULL,
  proposed_changes JSONB NOT NULL,
  scheduled_for TIMESTAMP,
  applied_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT 'System',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flag_id INTEGER NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  primary_metric TEXT NOT NULL DEFAULT 'checkout_completed',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  traffic_allocation INTEGER NOT NULL DEFAULT 100,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_variations (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variation_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_control BOOLEAN NOT NULL DEFAULT FALSE,
  expected_weight INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS exposure_events (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL,
  user_key TEXT NOT NULL,
  variation_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goal_events (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  user_key TEXT NOT NULL,
  variation_key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_env_project ON environments(project_id);
CREATE INDEX IF NOT EXISTS idx_flags_project ON feature_flags(project_id);
CREATE INDEX IF NOT EXISTS idx_flags_owner ON feature_flags(owner_id);
CREATE INDEX IF NOT EXISTS idx_variations_flag ON flag_variations(flag_id);
CREATE INDEX IF NOT EXISTS idx_segments_project ON segments(project_id);
CREATE INDEX IF NOT EXISTS idx_rollout_env ON rollout_configurations(environment_id);
CREATE INDEX IF NOT EXISTS idx_targeting_flag_env ON targeting_rules(flag_id, environment_id);
CREATE INDEX IF NOT EXISTS idx_versions_flag_env ON flag_versions(flag_id, environment_id);
CREATE INDEX IF NOT EXISTS idx_approvals_project_status ON approvals(project_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_exp_vars_experiment ON experiment_variations(experiment_id);
CREATE INDEX IF NOT EXISTS idx_exposure_exp_var ON exposure_events(experiment_id, variation_key);
CREATE INDEX IF NOT EXISTS idx_goal_exp_var ON goal_events(experiment_id, variation_key);
`;
