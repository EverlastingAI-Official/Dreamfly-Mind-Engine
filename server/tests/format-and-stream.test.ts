import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseMind,validateMind,emptyMind,skillMarkdown,importPackage,zipFiles } from '../src/format.js';
import { sseEvents,publicAddress,requestConfig } from '../src/services/model-provider.js';
import { publicMind } from '../src/public-mind.js';
import { encrypt,decrypt } from '../src/crypto.js';
// @ts-ignore Shared browser/server publication rules.
import { defaultPublication, publicationSettings, skillSubmissionIssues } from '../../packages/mind-format/index.js';

test('submission feedback requires all three content fields and rejects blank memory entries',()=>{
  const mind=emptyMind();mind.persona.instructions='';
  assert.equal(skillSubmissionIssues(mind).length,3);
  mind.persona.instructions='表达方式';mind.persona.self_description='自我认知';mind.memory.fragments=[{id:'one',content:'真实经历'}];
  assert.deepEqual(skillSubmissionIssues(mind),[]);
  mind.memory.fragments.push({id:'two',content:' \n '});assert.equal(skillSubmissionIssues(mind).length,1);
});

test('new skills select all permissions and memories, with download including every asset',()=>{
  const mind=emptyMind();mind.memory.fragments=[{id:'one',content:'memory'}];mind.assets={image:'assets/image.png',audio:'assets/audio.wav'};
  const defaults=defaultPublication(mind);assert.deepEqual(defaults,{listed:true,chat:true,download:true,memory_ids:['one']});
  const publication=publicationSettings(mind,defaults);assert.equal(publication.github,true);assert.deepEqual(publication.asset_keys,['image','audio']);
  assert.equal(publicationSettings(mind,{...defaults,download:false,github:true}).github,false);
});

test('existing mind samples migrate with valid personas and memory',()=>{
  const folders=['tests/fixtures/legacy-minds/pages/consciousness/interaction','tests/fixtures/legacy-minds/static/consciousness','tests/fixtures/legacy-minds/static/minds'];let count=0;
  for(const folder of folders)for(const name of readdirSync(folder).filter(x=>x.endsWith('.mind'))){validateMind(parseMind(readFileSync(`${folder}/${name}`,'utf8')).mind);count++;}
  assert.equal(count,11);
});
test('standard ZIP round trip and conflicting persona detection',async()=>{
  const mind=emptyMind();mind.memory.fragments=[{id:'a',content:'真实经历'}];
  const archive=await zipFiles(new Map([['my-mind/mind.json',Buffer.from(JSON.stringify(mind))],['my-mind/SKILL.md',Buffer.from(skillMarkdown(mind))]]));
  assert.deepEqual((await importPackage('mind.zip',archive)).mind,mind);
  const conflict=await zipFiles(new Map([['mind.json',Buffer.from(JSON.stringify(mind))],['SKILL.md',Buffer.from(skillMarkdown({...mind,persona:{instructions:'不同人格'}}))]]));
  await assert.rejects(()=>importPackage('mind.zip',conflict),/人格不一致/);
});
test('private memories and legacy personal fields are excluded before generation/export',()=>{
  const mind=emptyMind();mind.memory.fragments=[{id:'public',content:'可公开'},{id:'private',content:'私密经历'}];mind.extensions={legacy:{birth:'private-date'}};mind.assets={voice:'assets/private.wav'};
  const projected=publicMind(mind,{memory_ids:['public'],asset_keys:[]});
  assert.deepEqual(projected.memory.fragments,[{id:'public',content:'可公开'}]);assert.equal(projected.extensions,undefined);assert.deepEqual(projected.assets,{});assert.equal(mind.memory.fragments.length,2);
});
test('SSE decoding preserves split Chinese/emoji and multi-line events',async()=>{
  const bytes=Buffer.from('data: {"text":"你好🦋"}\r\n\r\ndata: {"finished":\ndata: true}\n\ndata: [DONE]\n\n');
  async function* stream(){for(let i=0;i<bytes.length;i++)yield bytes.subarray(i,i+1);}
  const result=[];for await(const event of sseEvents(stream()))result.push(event);assert.deepEqual(result,[{text:'你好🦋'},{finished:true}]);
  async function* broken(){yield Buffer.from('data: {"x":1}');}await assert.rejects(async()=>{for await(const _ of sseEvents(broken())){}},/未完整结束/);
});
test('SSRF blocks local, mapped IPv4, metadata, reserved and multicast ranges',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1','224.0.0.1','0.0.0.0'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
});
test('encrypted provider credentials cannot be moved between user profiles',()=>{
  const secret=encrypt('test-key','user-a:profile-a');assert.equal(decrypt(secret,'user-a:profile-a'),'test-key');assert.throws(()=>decrypt(secret,'user-b:profile-a'));
});
test('ZIP parent traversal is rejected before extraction',async()=>{
  const archive=await zipFiles(new Map([['aa/evil.txt',Buffer.from('not allowed')]]));
  const unsafe=Buffer.from(archive);const from=Buffer.from('aa/evil.txt'),to=Buffer.from('../evil.txt');let start=0;
  while((start=unsafe.indexOf(from,start))>=0){to.copy(unsafe,start);start+=from.length;}
  await assert.rejects(()=>importPackage('unsafe.zip',unsafe));
});
test('provider adapters separate system messages and use correct authentication and roles',()=>{
  const p={id:'profile',user_id:'user',key_cipher:encrypt('fixture-key','user:profile'),base_url:'https://example.com',model:'model',parameters:{max_tokens:32}};
  const messages=[{role:'system',content:'persona'},{role:'user',content:'Hello'},{role:'assistant',content:'Hi'}];
  const a=requestConfig({...p,protocol:'anthropic-messages'},messages);assert.equal(a.url,'https://example.com/v1/messages');assert.equal(a.data.system,'persona');assert.equal(a.data.messages.length,2);assert.equal(a.headers['x-api-key'],'fixture-key');
  const g=requestConfig({...p,protocol:'gemini-generate-content'},messages);assert.equal(g.data.contents[1].role,'model');assert.equal(g.data.systemInstruction.parts[0].text,'persona');assert.ok(!g.headers.Authorization);
  const o=requestConfig({...p,protocol:'openai-chat'},messages);assert.equal(o.data.messages.length,3);assert.equal(o.headers.Authorization,'Bearer fixture-key');
});

test('standalone supported files are parsed regardless of basename while ZIP keeps package conventions', async()=>{
  const mind=emptyMind();
  for(const name of ['mind.json','backup.json','backup.JSON','export.js','export.mind.js']) {
    const content=name.endsWith('.js') ? 'export default '+JSON.stringify(mind)+';' : JSON.stringify(mind);
    assert.deepEqual((await importPackage(name,Buffer.from(content))).mind,mind,name);
  }
  assert.equal((await importPackage('notes.md',Buffer.from(skillMarkdown(mind)))).mind.persona.instructions,mind.persona.instructions);
  await assert.rejects(()=>importPackage('backup.json',Buffer.from('bad JSON')), {code:'INVALID_SKILL',statusCode:422});
  const zip=await zipFiles(new Map([['unrelated.json',Buffer.from(JSON.stringify(mind))]]));
  await assert.rejects(()=>importPackage('backup.zip',zip),{code:'NO_SKILL'});
});
