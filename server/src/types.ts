import type { Mind, PublicationChoices } from '../../packages/mind-format/index.js';
import type {
  ModelConfig,
  Usage,
  GithubTarget,
  ConversationDto,
} from '../../packages/api/index.js';
export type { Mind, Publication, PublicationChoices } from '../../packages/mind-format/index.js';
export type {
  SkillWrite,
  SkillWriteResult,
  ModelParameters,
  ModelConfig,
  ModelProfileInput,
  Usage,
  GithubTarget,
  JobResult,
} from '../../packages/api/index.js';

// Persistence records belong here. Public request/response DTOs live in packages/api.
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
export interface ModelProfile extends ModelConfig {
  id: string;
  user_id: string;
  name: string;
  key_cipher: string | null;
  consent: boolean;
  verified_at: Date | null;
}
export interface Conversation extends Omit<ConversationDto, 'created_at'> {
  user_id: string;
  created_at: Date;
}
export interface ChatMessage {
  role: string;
  content: string;
}
export interface ModelEvent {
  delta?: string;
  usage?: Usage;
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
