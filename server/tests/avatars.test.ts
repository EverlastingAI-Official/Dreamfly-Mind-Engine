import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { secret } from '../src/config.js';
import { avatarPreset, emptyMind, skillSlug } from '../../packages/mind-format/index.js';
import { importPackage, validateMind } from '../src/format.js';
import { publicMind } from '../src/public-mind.js';

test('avatar selection survives import and public projection; older Skills still work', async () => {
  const mind = { ...emptyMind(), avatar_id: 'fox' };
  const imported = await importPackage('avatar.mind', Buffer.from(JSON.stringify(mind)));
  assert.equal(publicMind(imported.mind, {}).avatar_id, 'fox');
  delete imported.mind.avatar_id;
  assert.doesNotThrow(() => validateMind(imported.mind));
  assert.equal(avatarPreset(imported.mind.avatar_id).id, 'robot');
  assert.throws(() => validateMind({ ...mind, avatar_id: '../../private' }), {
    code: 'INVALID_SKILL',
  });
});

test('draft avatars stay private until published and conversations retain their version avatar', async (t) => {
  // All writes are confined to a disposable schema, never the application's tables.
  const schema = `test_avatars_${randomUUID().replaceAll('-', '')}`;
  const maintenance = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    password: secret('PGPASSWORD') || undefined,
  });
  await maintenance.connect();
  await maintenance.query(`CREATE SCHEMA ${schema}`);
  const previousOptions = process.env.PGOPTIONS;
  const previousUrl = process.env.DATABASE_URL;
  let closeApp = async () => {};
  let closePool = async () => {};
  t.after(async () => {
    await closeApp();
    await closePool();
    try {
      await maintenance.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await maintenance.end();
      if (previousOptions === undefined) delete process.env.PGOPTIONS;
      else process.env.PGOPTIONS = previousOptions;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  if (previousUrl) {
    const url = new URL(previousUrl);
    url.searchParams.set('options', process.env.PGOPTIONS);
    process.env.DATABASE_URL = url.toString();
  }
  const { pool } = await import('../src/db.js');
  closePool = () => pool.end();
  for (const migration of [
    '001_platform.sql',
    '002_owner_github.sql',
    '003_weekly_github.sql',
    '004_skill_reactions.sql',
  ]) {
    await pool.query(
      await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'),
    );
  }
  const { buildApp } = await import('../src/app.js');
  const { writeSkill, ownedSkill } = await import('../src/services/skills.js');
  const { conversation, conversationView, listConversations } = await import(
    '../src/services/conversations.js'
  );
  const app = await buildApp({ logger: false });
  closeApp = () => app.close();
  const user = randomUUID(),
    skill = randomUUID(),
    chat = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_digest,display_name) VALUES($1,$2,$3,$4)', [
    user,
    'avatars@example.test',
    'unused-test-digest',
    'Avatar test',
  ]);
  const mind = {
    ...emptyMind(skillSlug(skill)),
    avatar_id: 'cat',
    persona: { instructions: 'A friendly companion', self_description: 'An avatar test' },
    memory: { fragments: [{ id: 'one', content: 'An example memory' }] },
  };
  const publication = { listed: true, chat: true, download: false, memory_ids: [] };
  const first = await writeSkill(
    user,
    skill,
    {
      revision: 0,
      content: mind,
      publication,
      request_id: randomUUID(),
      compliance_confirmed: true,
    },
    { create: true, publish: true },
  );
  await pool.query(
    'INSERT INTO conversations(id,user_id,skill_version_id,title,model_config) VALUES($1,$2,$3,$4,$5)',
    [chat, user, first.version_id, 'Avatar chat', {}],
  );
  const draft = await writeSkill(
    user,
    skill,
    {
      revision: first.revision,
      content: { ...mind, avatar_id: 'fox' },
      publication,
    },
    { create: false, publish: false },
  );
  assert.equal((await ownedSkill(skill, user)).draft.avatar_id, 'fox');
  const list = await app.inject('/api/v1/skills');
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().data.items[0].avatar_id, 'cat');
  const detail = await app.inject(`/api/v1/skills/${skill}/public`);
  assert.equal(detail.json().data.avatar_id, 'cat');
  assert.equal(detail.json().data.preview, null);
  assert.equal((await listConversations(user, 1, 50))[0].avatar_id, 'cat');
  assert.equal((await listConversations(randomUUID(), 1, 50)).length, 0);

  await writeSkill(
    user,
    skill,
    {
      revision: draft.revision,
      content: { ...mind, avatar_id: 'fox' },
      publication,
      request_id: randomUUID(),
      compliance_confirmed: true,
    },
    { create: false, publish: true },
  );
  assert.equal((await app.inject('/api/v1/skills')).json().data.items[0].avatar_id, 'fox');
  assert.equal((await app.inject(`/api/v1/skills/${skill}/public`)).json().data.avatar_id, 'fox');
  assert.equal(conversationView(await conversation(chat, user)).avatar_id, 'cat');
});
