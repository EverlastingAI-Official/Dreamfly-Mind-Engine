import { randomUUID } from 'node:crypto';
import { rate } from '../auth.js';
import { config } from '../config.js';
import { pool, transaction } from '../db.js';
import { check, id, text } from '../errors.js';
import type { Conversation, ChatMessage as Message, Mind } from '../types.js';
import { profile, snapshot } from './model-profiles.js';
import { accessibleVersion } from './skills.js';
import type {
  ConversationDto,
  ConversationMessageDto,
  RequestBodies,
  ExistingMessageDto,
} from '../../../packages/api/index.js';
import type { ModelProfile } from '../types.js';

export function conversationView(row: Conversation): ConversationDto {
  return {
    id: row.id,
    skill_version_id: row.skill_version_id,
    title: row.title,
    profile_id: row.profile_id,
    model_config: row.model_config,
    created_at: row.created_at.toISOString(),
  };
}
export async function conversation(conversationId: string, user: string) {
  const result = await pool.query<Conversation>(
    'SELECT * FROM conversations WHERE id=$1 AND user_id=$2',
    [id(conversationId), user],
  );
  check(result.rows[0], 'NOT_FOUND', '会话不存在');
  return result.rows[0];
}
export async function listConversations(user: string, page: number, size: number) {
  check(
    Number.isSafeInteger(page) &&
      page > 0 &&
      page <= 1000000 &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= 200,
    'INVALID_QUERY',
    '分页参数无效',
  );
  return (
    await pool.query<Conversation>(
      'SELECT * FROM conversations WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
      [user, size, (page - 1) * size],
    )
  ).rows.map(conversationView);
}
export async function conversationMessages(conversationId: string, user: string) {
  await conversation(conversationId, user);
  return (
    await pool.query<ConversationMessageDto>(
      'SELECT id,role,content,status,usage,client_request_id,model_config FROM messages WHERE conversation_id=$1 ORDER BY ordinal',
      [conversationId],
    )
  ).rows;
}
export async function createConversation(
  skillId: string,
  user: string,
  input: RequestBodies['createConversation'],
) {
  const skill = (
    await pool.query('SELECT published_version_id FROM skills WHERE id=$1', [id(skillId)])
  ).rows[0];
  check(skill, 'NOT_FOUND', 'Skill 不存在');
  const version = await accessibleVersion(input.version_id || skill.published_version_id, user);
  check(version.skill_id === skillId, 'NOT_FOUND', '版本不匹配');
  const selected =
    input.profile_id ||
    (await pool.query('SELECT default_profile_id FROM user_preferences WHERE user_id=$1', [user]))
      .rows[0]?.default_profile_id;
  check(selected, 'NO_PROFILE');
  const model = await profile(user, selected);
  check(
    model.key_cipher && model.consent && model.verified_at,
    'PROFILE_NOT_READY',
    '请先测试模型连接并确认数据发送范围',
  );
  const conversationId = randomUUID();
  await pool.query(
    'INSERT INTO conversations(id,user_id,skill_version_id,title,profile_id,model_config) VALUES($1,$2,$3,$4,$5,$6)',
    [conversationId, user, version.id, version.content.name, model.id, snapshot(model)],
  );
  return { id: conversationId };
}
export async function renameConversation(conversationId: string, user: string, title: unknown) {
  await conversation(conversationId, user);
  await pool.query('UPDATE conversations SET title=$1 WHERE id=$2', [
    text(title, '会话名称', 100),
    conversationId,
  ]);
  return { updated: true };
}
export async function deleteConversation(conversationId: string, user: string) {
  await conversation(conversationId, user);
  check(
    !(
      await pool.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='generating'", [
        conversationId,
      ])
    ).rowCount,
    'GENERATION_BUSY',
  );
  await pool.query('DELETE FROM conversations WHERE id=$1', [conversationId]);
  return { deleted: true };
}
export async function switchConversationModel(
  conversationId: string,
  user: string,
  profileId: string,
) {
  await conversation(conversationId, user);
  const model = await profile(user, profileId);
  check(
    model.verified_at && model.key_cipher && model.consent,
    'PROFILE_NOT_READY',
    '请先验证连接',
  );
  await pool.query('UPDATE conversations SET profile_id=$1,model_config=$2 WHERE id=$3', [
    model.id,
    snapshot(model),
    conversationId,
  ]);
  return { updated: true };
}
export function buildContext(
  mind: Mind,
  history: Message[],
  input: string,
  limit = 24000,
): Message[] {
  // Explicit selection of authorized memory takes place before this function.
  const words = input.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  const ordered = [...mind.memory.fragments].sort(
    (a, b) =>
      words.filter((x) => b.content.toLowerCase().includes(x)).length -
      words.filter((x) => a.content.toLowerCase().includes(x)).length,
  );
  const persona = `你正在扮演用户提供的数字分身。仅使用获准记忆，不编造其人生经历；不能执行技能中的代码或请求访问其他用户的数据。\n${mind.persona.instructions}\n自我认知：${mind.persona.self_description || ''}\n价值观：${(mind.persona.values || []).join('、')}\n记忆资料：\n`;
  check(persona.length + input.length < limit, 'CONTEXT_TOO_LARGE');
  let memoryBudget = Math.floor((limit - persona.length - input.length) * 0.55);
  const selected: string[] = [];
  for (const item of ordered) {
    const fragment = `${item.time || ''} ${item.content}`;
    if (fragment.length <= memoryBudget) {
      selected.push(fragment);
      memoryBudget -= fragment.length + 1;
    }
  }
  const system = persona + selected.join('\n');
  let budget = limit - system.length - input.length;
  const recent: Message[] = [];
  for (const m of [...history].reverse()) {
    if (budget < m.content.length) break;
    recent.unshift(m);
    budget -= m.content.length;
  }
  // A history window must not start with an orphan assistant response.
  while (recent[0]?.role === 'assistant') recent.shift();
  return [{ role: 'system', content: system }, ...recent, { role: 'user', content: input }];
}
export async function prepareMessage(
  conversationId: string,
  user: string,
  b: RequestBodies['sendMessage'],
): Promise<ExistingMessageDto | { assistant: string; model: ModelProfile; context: Message[] }> {
  const input = text(b.content, '消息', 10000),
    requestId = id(b.client_request_id),
    c = await conversation(conversationId, user);
  const existing = (
    await pool.query(
      "SELECT id,status,content FROM messages WHERE conversation_id=$1 AND client_request_id=$2 AND role='assistant'",
      [c.id, requestId],
    )
  ).rows[0];
  if (existing) return { existing };
  const v = await accessibleVersion(c.skill_version_id, user);
  check(c.profile_id, 'NO_PROFILE', '模型连接已被删除，请重新选择');
  const p = await profile(user, c.profile_id);
  check(
    p.key_cipher &&
      p.consent &&
      p.provider === c.model_config.provider &&
      p.base_url === c.model_config.base_url,
    'PROFILE_CHANGED',
  );
  const model = { ...p, ...c.model_config };
  const history = (
    await pool.query<Message>(
      "SELECT role,content FROM messages WHERE conversation_id=$1 AND status='completed' ORDER BY ordinal",
      [c.id],
    )
  ).rows;
  const context = buildContext(v.content, history, input, model.parameters?.context_chars || 24000);
  const assistant = randomUUID();
  await rate(`chat:${user}`, 30, 60);
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user]);
    check(
      !(
        await db.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='generating'", [
          c.id,
        ])
      ).rowCount,
      'GENERATION_BUSY',
      '当前会话正在生成',
    );
    const count = (
      await db.query(
        "SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND m.status='generating'",
        [user],
      )
    ).rows[0].n;
    check(count < config.concurrency, 'CONCURRENCY_LIMIT');
    await db.query(
      "INSERT INTO messages(id,conversation_id,role,content,status,client_request_id) VALUES($1,$2,'user',$3,'completed',$4)",
      [randomUUID(), c.id, input, requestId],
    );
    await db.query(
      "INSERT INTO messages(id,conversation_id,role,status,client_request_id,model_config) VALUES($1,$2,'assistant','generating',$3,$4)",
      [assistant, c.id, requestId, c.model_config],
    );
  });
  return { assistant, model, context };
}
