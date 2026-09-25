const string = { type: 'string' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const profile = object(
  {
    name: string,
    provider: string,
    protocol: string,
    base_url: string,
    model: string,
    api_key: string,
    api_key_action: { enum: ['keep', 'replace', 'clear'] },
    consent: { type: 'boolean' },
    parameters: object({
      max_tokens: { type: 'integer' },
      timeout_seconds: { type: 'number' },
      temperature: { type: 'number' },
      context_chars: { type: 'integer' },
    }),
    id: string,
    verified_at: { anyOf: [string, { type: 'null' }] },
    api_key_configured: { type: 'boolean' },
  },
  ['name', 'provider', 'model'],
);
const authFields = {
  email: string,
  password: string,
  confirm: string,
  display_name: string,
  code: string,
  challenge_id: string,
};
const skillFields = {
  id: string,
  revision: { type: 'integer' },
  content: { type: 'object' },
  publication: { type: 'object' },
};
export const bodies = {
  createSkill: object(skillFields, ['content']),
  updateSkill: object(skillFields, ['revision']),
  reaction: object({ active: { type: 'boolean' } }, ['active']),
  emailCode: object({ email: string, purpose: { enum: ['register', 'reset_password'] } }, [
    'email',
    'purpose',
  ]),
  register: object(authFields, ['email', 'password', 'display_name', 'code', 'challenge_id']),
  login: object(authFields, ['email', 'password']),
  resetPassword: object(authFields, ['email', 'password', 'code', 'challenge_id']),
  changePassword: object({ old_password: string, password: string }, ['old_password', 'password']),
  modelProfile: profile,
  modelProfileUpdate: profile,
  discoverModels: object({ api_key: string, profile_id: string }),
  defaultProfile: object({ profile_id: string }, ['profile_id']),
  conversationModel: object({ profile_id: string }, ['profile_id']),
  publishSkill: object(
    {
      revision: { type: 'integer' },
      request_id: string,
      listed: { type: 'boolean' },
      chat: { type: 'boolean' },
      download: { type: 'boolean' },
      github: { type: 'boolean' },
      memory_ids: { type: 'array', items: string },
      asset_keys: { type: 'array', items: string },
      compliance_confirmed: { type: 'boolean' },
    },
    ['revision', 'request_id'],
  ),
  submitSkill: object(
    {
      revision: { type: 'integer' },
      request_id: string,
      content: { type: 'object' },
      publication: { type: 'object' },
      compliance_confirmed: { type: 'boolean' },
    },
    ['revision', 'request_id', 'content', 'publication', 'compliance_confirmed'],
  ),
  createConversation: object({ version_id: string, profile_id: string }),
  sendMessage: object({ content: string, client_request_id: string }, [
    'content',
    'client_request_id',
  ]),
  renameConversation: object({ title: string }, ['title']),
  userStatus: object({ status: { enum: ['active', 'disabled'] } }, ['status']),
};
