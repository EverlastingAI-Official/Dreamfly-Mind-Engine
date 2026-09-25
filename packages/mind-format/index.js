export const mindSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'slug',
    'version',
    'name',
    'description',
    'persona',
    'memory',
    'assets',
    'capabilities',
  ],
  properties: {
    schema_version: { const: '1.0' },
    slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', minLength: 1, maxLength: 1024 },
    language: { type: 'string', maxLength: 30 },
    persona: {
      type: 'object',
      additionalProperties: false,
      required: ['instructions'],
      properties: {
        instructions: { type: 'string', minLength: 1, maxLength: 30000 },
        self_description: { type: 'string', maxLength: 10000 },
        values: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 300 } },
      },
    },
    memory: {
      type: 'object',
      additionalProperties: false,
      required: ['fragments'],
      properties: {
        fragments: {
          type: 'array',
          maxItems: 2000,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'content'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 100 },
              time: { type: 'string', maxLength: 100 },
              content: { type: 'string', minLength: 1, maxLength: 10000 },
            },
          },
        },
      },
    },
    assets: {
      type: 'object',
      maxProperties: 100,
      additionalProperties: { type: 'string', maxLength: 300 },
    },
    capabilities: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['text-chat'] } },
    extensions: { type: 'object' },
  },
};
export function emptyMind(slug = 'my-mind') {
  return {
    schema_version: '1.0',
    slug,
    version: '1.0.0',
    name: '我的 MindCopy',
    description: '我的人格与记忆',
    language: 'zh-CN',
    persona: {
      instructions: '请以我的表达方式交流，记忆中没有的经历不要编造。',
      self_description: '',
      values: [],
    },
    memory: { fragments: [] },
    assets: {},
    capabilities: ['text-chat'],
  };
}
export const skillSlug = (id) => `mind-${id.toLowerCase()}`;
export const assetMaxBytes = 10 * 1024 * 1024;
export function skillSubmissionIssues(mind) {
  const issues = [];
  if (!mind?.persona?.instructions?.trim()) issues.push('请填写人格与表达方式');
  if (!mind?.persona?.self_description?.trim()) issues.push('请填写自我认知');
  if (!mind?.memory?.fragments?.length) issues.push('请至少填写一条记忆片段');
  else if (mind.memory.fragments.some((m) => !m.content?.trim()))
    issues.push('请填写每条记忆片段的内容，或移除空白片段');
  return issues;
}
export function defaultPublication(mind) {
  return {
    listed: true,
    chat: true,
    download: true,
    memory_ids: mind.memory.fragments.map((m) => m.id),
  };
}
export function publicationSettings(mind, choices) {
  const listed = choices.listed === true,
    download = listed && choices.download === true;
  return {
    listed,
    chat: listed && choices.chat === true,
    download,
    github: download,
    memory_ids: Array.isArray(choices.memory_ids) ? choices.memory_ids : [],
    asset_keys: download ? Object.keys(mind.assets) : [],
  };
}
export function parseMind(source, slug = 'imported-mind') {
  let value =
    typeof source === 'string'
      ? JSON.parse(
          source
            .replace(/^\s*export\s+default\s+/, '')
            .replace(/;\s*$/, '')
            .trim(),
        )
      : structuredClone(source);
  if (value?.schema_version) return { mind: value, warnings: [] };
  const legacyPrompt = value?.metadata?.personality_prompt || value?.metadata?.characterPrompt;
  if (!legacyPrompt || !value?.metadata?.name)
    throw new Error('缺少 metadata.name 或 metadata.personality_prompt');
  const m = emptyMind(slug);
  m.name = value.metadata.name;
  m.description = `${m.name}的数字分身`;
  m.persona.instructions = legacyPrompt;
  m.persona.self_description = value.memory?.self_cognition || value.memory?.selfPerception || '';
  m.memory.fragments = (
    value.memory?.memory_fragments ||
    value.memory?.subconsciousTimeline ||
    []
  ).map((x, i) => ({
    id: `memory-${i + 1}`,
    time: String(x.time || x.year || ''),
    content: typeof x === 'string' ? x : String(x.content || x.event || JSON.stringify(x)),
  }));
  m.extensions = {
    legacy: {
      birth: value.metadata.birth || value.metadata.birthDate,
      occupation: value.metadata.occupation,
      source_id: value.mind_id || value.mind,
      status: value.status,
      consciousness: value.consciousness,
    },
  };
  return {
    mind: m,
    warnings: [
      '已迁移旧格式；运行状态仅保留为来源资料，旧知识库 URL 不自动抓取。',
      ...(value.metadata.voice_prompt || value.metadata.image_data
        ? ['旧音频/图片请作为素材重新上传，未将 Base64 自动发布。']
        : []),
    ],
  };
}
export function skillMarkdown(mind) {
  return `---\nname: ${mind.slug}\ndescription: ${JSON.stringify(mind.description)}\nmetadata:\n  version: "${mind.version}"\n  dreamfly-schema: "${mind.schema_version}"\n---\n\n${mind.persona.instructions}\n\n<!-- dreamfly:details -->\n请读取 mind.json 中的人格与记忆；仅使用已发布的内容。\n`;
}
