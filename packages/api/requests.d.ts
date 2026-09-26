import type { Mind, PublicationChoices } from '../mind-format/index.js';
import type { ModelProfileInput, SkillWrite } from './dto.js';

export interface LoginRequest {
  email: string;
  password: string;
}
export interface VerificationRequest {
  email: string;
  code: string;
  challenge_id: string;
}
export interface RegisterRequest extends LoginRequest, VerificationRequest {
  display_name: string;
}
export interface ResetPasswordRequest extends LoginRequest, VerificationRequest {}
export interface RequestBodies {
  emailCode: { email: string; purpose: 'register' | 'reset_password' };
  register: RegisterRequest;
  login: LoginRequest;
  resetPassword: ResetPasswordRequest;
  changePassword: { old_password: string; password: string };
  createSkill: { id?: string; content: Mind; revision?: number; publication?: PublicationChoices };
  updateSkill: Pick<SkillWrite, 'revision' | 'content' | 'publication'>;
  submitSkill: {
    revision: number;
    request_id: string;
    content: Mind;
    publication: PublicationChoices;
    compliance_confirmed: boolean;
  };
  publishSkill: Omit<SkillWrite, 'id' | 'content' | 'publication'> & { request_id: string };
  reaction: { active: boolean };
  modelProfile: ModelProfileInput;
  modelProfileUpdate: ModelProfileInput;
  discoverModels: { api_key?: string; profile_id?: string };
  defaultProfile: { profile_id: string };
  conversationModel: { profile_id: string };
  createConversation: { version_id?: string; profile_id?: string };
  sendMessage: { content: string; client_request_id: string };
  renameConversation: { title: string };
  userStatus: { status: 'active' | 'disabled' };
}
