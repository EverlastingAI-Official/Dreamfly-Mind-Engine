import type { Mind, Publication, PublicationChoices } from '../mind-format/index.js';
import type { ApiFailure } from './errors.js';

/** JSON wire dates are ISO strings, never database Date objects. */
export type ISODate = string;
export interface UserDto {
  id: string;
  email: string;
  display_name: string;
  role: 'user' | 'admin';
}
export interface SessionDto {
  user: UserDto;
  csrf: string;
}
export interface AdminUserDto extends UserDto {
  status: 'active' | 'disabled';
}
export interface MessageResult {
  message: string;
}
export interface EmailCodeResult extends MessageResult {
  challenge_id: string;
  expires_in: number;
}
export interface IdResult {
  id: string;
}
export interface DeletedResult {
  deleted: boolean;
}
export interface UpdatedResult {
  updated: boolean;
}
export interface PageDto<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
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
export interface ModelProfileInput {
  name: string;
  provider: string;
  model: string;
  protocol?: string;
  base_url?: string;
  parameters?: ModelParameters;
  consent?: boolean;
  api_key?: string;
  api_key_action?: 'keep' | 'replace' | 'clear';
}
export interface ModelProfileDto extends ModelConfig {
  id: string;
  name: string;
  consent: boolean;
  verified_at: ISODate | null;
  api_key_configured: boolean;
}
export interface ModelProfilesDto {
  profiles: ModelProfileDto[];
  default_profile_id: string | null;
}
export interface ModelProviderDto {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
}
export interface ModelOptionDto {
  id: string;
  name: string;
}
export interface ModelTestResult {
  verified: boolean;
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
export interface ReactionDto {
  like_count: number;
  liked: boolean;
  favorited: boolean;
}
export interface SkillSummaryDto extends ReactionDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'blocked';
  published_version_id: string | null;
  author: string;
  language: string | null;
  version: string | null;
  listed_at: ISODate;
  publication: Pick<Publication, 'listed' | 'chat' | 'download'>;
}
export interface PublicSkillDto extends ReactionDto {
  id: string;
  slug: string;
  is_owner: boolean;
  name: string;
  description: string;
  author: string;
  language?: string;
  version: string;
  published_at: ISODate;
  published_version_id: string;
  publication: Pick<Publication, 'chat' | 'download'>;
  memory_count: number;
  asset_count: number;
  preview: Pick<Mind, 'persona' | 'memory'> | null;
  github_url: string | null;
}
export interface OwnedSkillDto {
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
  author: string;
  versions: { id: string; version: string; created_at: ISODate }[];
  github_url: string | null;
}
export type SkillDetailDto = OwnedSkillDto | PublicSkillDto;
export interface ImportedSkillDto {
  mind: Mind;
  warnings: string[];
}
export interface AssetDto {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface UploadedAssetDto {
  id: string;
  reference: string;
  mime: string;
  name: string;
}

export type Usage = Record<string, number>;
export type MessageStatus = 'generating' | 'completed' | 'failed' | 'cancelled';
export interface ConversationDto {
  id: string;
  skill_version_id: string;
  title: string;
  profile_id: string | null;
  model_config: ModelConfig;
  created_at: ISODate;
}
export interface ConversationMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  usage: Usage | null;
  client_request_id: string;
  model_config: ModelConfig | null;
}
export interface ExistingMessageDto {
  existing: Pick<ConversationMessageDto, 'id' | 'status' | 'content'>;
}
export interface MessageTerminalDto {
  id: string;
  status: Exclude<MessageStatus, 'generating'>;
  usage: Usage | null;
}
export interface MessageEvents {
  'message.start': IdResult;
  'message.delta': { text: string };
  'message.completed': MessageTerminalDto & { status: 'completed' };
  'message.cancelled': MessageTerminalDto & { status: 'cancelled' };
  'message.failed': MessageTerminalDto & {
    status: 'failed';
    error: ApiFailure;
    request_id: string;
  };
}
export type MessageEventHandler = (
  ...event: {
    [K in keyof MessageEvents]: [event: K, data: MessageEvents[K]];
  }[keyof MessageEvents]
) => void;

export interface GithubTarget {
  auth_mode: 'owner';
  owner: string;
  repo: string;
  branch: string;
  mode: 'commit';
}
export interface GithubBatchDto {
  id: string;
  scheduled_for: ISODate;
  created_at: ISODate;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  pending: number;
}
export interface GithubScheduleDto {
  frequency: 'weekly';
  timezone?: string;
  weekday?: number;
  local_time?: string;
  next_run_at?: ISODate;
  last_error?: string | null;
}
export interface GithubStatusDto {
  enabled: boolean;
  configured: boolean;
  target?: GithubTarget;
  message?: string;
  schedule: GithubScheduleDto;
  latest_batch: GithubBatchDto | null;
}
export interface JobResult {
  status: 'succeeded' | 'skipped' | 'deferred';
  reason?: string;
  commit_url?: string;
  skill_url?: string;
}
export interface SyncJobDto {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  attempts: number;
  last_error: string | null;
  result: JobResult | null;
}
export interface SyncJobSummaryDto extends SyncJobDto {
  created_at: ISODate;
  skill_id: string;
  version_id: string;
  version: string;
  target: GithubTarget;
}
