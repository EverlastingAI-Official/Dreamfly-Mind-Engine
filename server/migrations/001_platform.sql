CREATE TABLE users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_digest text NOT NULL,
 display_name text NOT NULL, role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')), verified_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_challenges (
 id uuid PRIMARY KEY, email text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('register','reset_password')),
 code_digest text NOT NULL, attempts int NOT NULL DEFAULT 0, consumed_at timestamptz,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_challenges_email ON email_challenges(email, purpose, created_at DESC);
CREATE TABLE auth_sessions (
 session_digest text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf text NOT NULL,
 expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (key text PRIMARY KEY, count int NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE model_profiles (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 provider text NOT NULL, protocol text NOT NULL, base_url text NOT NULL, model text NOT NULL,
 parameters jsonb NOT NULL DEFAULT '{}', key_cipher text, verified_at timestamptz,
 consent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_preferences (user_id uuid PRIMARY KEY REFERENCES users(id), default_profile_id uuid REFERENCES model_profiles(id) ON DELETE SET NULL);
CREATE TABLE skills (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), slug text NOT NULL,
 name text NOT NULL, description text NOT NULL, draft jsonb NOT NULL,
 published_version_id uuid, publication jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,slug)
);
CREATE TABLE skill_versions (
 id uuid PRIMARY KEY, skill_id uuid NOT NULL REFERENCES skills(id), version text NOT NULL,
 content jsonb NOT NULL, publication jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_id,version)
);
ALTER TABLE skills ADD FOREIGN KEY (published_version_id) REFERENCES skill_versions(id);
CREATE TABLE assets (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, mime text NOT NULL,
 size int NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE version_assets (version_id uuid REFERENCES skill_versions(id), asset_id uuid REFERENCES assets(id), PRIMARY KEY(version_id,asset_id));
CREATE TABLE conversations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), skill_version_id uuid NOT NULL REFERENCES skill_versions(id),
 title text NOT NULL, profile_id uuid REFERENCES model_profiles(id) ON DELETE SET NULL, model_config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL DEFAULT '', status text NOT NULL,
 client_request_id uuid, model_config jsonb, usage jsonb, ordinal bigserial, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,client_request_id,role)
);
CREATE UNIQUE INDEX one_generation ON messages(conversation_id) WHERE status='generating';
CREATE INDEX messages_order ON messages(conversation_id,created_at,id);
CREATE TABLE github_connections (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), installation_id bigint NOT NULL,
 account text NOT NULL, token_cipher text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(user_id,installation_id)
);
CREATE TABLE github_states (state_digest text PRIMARY KEY, user_id uuid REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE TABLE github_targets (
 skill_id uuid PRIMARY KEY REFERENCES skills(id), connection_id uuid NOT NULL REFERENCES github_connections(id),
 repo_id bigint NOT NULL, owner text NOT NULL, repo text NOT NULL, branch text NOT NULL, mode text NOT NULL CHECK(mode IN ('commit','pr'))
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), type text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued', attempts int NOT NULL DEFAULT 0, run_after timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, last_error text, result jsonb, unique_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ready_jobs ON jobs(status,run_after);
CREATE TABLE admin_events (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), action text NOT NULL, resource_id uuid, created_at timestamptz DEFAULT now());
