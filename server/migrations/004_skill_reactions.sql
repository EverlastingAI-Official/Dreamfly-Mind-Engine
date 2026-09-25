CREATE TABLE skill_reactions (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('like', 'favorite')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, skill_id, kind)
);
CREATE INDEX skill_reactions_skill ON skill_reactions(skill_id, kind);
