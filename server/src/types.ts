import type { Mind, Publication, PublicationChoices } from '../../packages/mind-format/index.js';
export type { Mind, Publication, PublicationChoices };
export interface Skill {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string;
  draft: Mind;
  draft_publication: PublicationChoices;
  publication: PublicationChoices;
  published_version_id: string | null;
  revision: number;
  status: 'draft' | 'published' | 'blocked';
}
export interface SkillVersion {
  id: string;
  skill_id: string;
  version: string;
  content: Mind;
  publication: PublicationChoices;
}
export interface SkillWrite extends PublicationChoices {
  id?: string;
  revision: number;
  content?: Mind;
  publication?: PublicationChoices;
  request_id?: string;
  compliance_confirmed?: boolean;
}
export interface SkillWriteResult {
  id: string;
  slug: string;
  revision: number;
  published: boolean;
  version_id?: string;
  version?: string;
  unchanged?: boolean;
  sync_job_id?: null;
  sync_policy?: 'weekly' | 'disabled';
}
export interface ModelParameters {
  timeout_seconds?: number;
  max_tokens?: number;
  context_chars?: number;
  temperature?: number;
}
export interface ModelConfig {
  provider: string;
  protocol: string;
  base_url: string;
  model: string;
  parameters: ModelParameters;
}
export interface ModelProfile extends ModelConfig {
  id: string;
  user_id: string;
  name: string;
  key_cipher: string | null;
  consent: boolean;
  verified_at: Date | null;
}
export interface ModelProfileInput extends ModelConfig {
  name: string;
  consent?: boolean;
  api_key?: string;
  api_key_action?: 'keep' | 'replace' | 'clear';
}
export interface Conversation {
  id: string;
  user_id: string;
  skill_version_id: string;
  title: string;
  profile_id: string | null;
  model_config: ModelConfig;
  created_at: Date;
}
export type Usage = Record<string, number>;
export interface ChatMessage {
  role: string;
  content: string;
}
export interface ModelEvent {
  delta?: string;
  usage?: Usage;
}
export interface GithubTarget {
  auth_mode: 'owner';
  owner: string;
  repo: string;
  branch: string;
  mode: 'commit';
}
export interface GithubJob {
  id: string;
  user_id: string;
  payload: { skill_id: string; version_id: string; content: Mind; target: GithubTarget };
}
export type QueuedJob =
  | (GithubJob & { type: 'github'; attempts: number })
  | {
      id: string;
      type: 'email';
      attempts: number;
      payload: { challenge_id: string; code: string };
    };
export interface JobResult {
  status: 'succeeded' | 'skipped' | 'deferred';
  reason?: string;
  commit_url?: string;
  skill_url?: string;
}
