import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import { secret, config } from '../src/config.js';

test('PostgreSQL account, skill, model ownership and conversation integration',async t=>{
  const githubEnv={GITHUB_OWNER:'fixture',GITHUB_REPOSITORY:'memories',GITHUB_BRANCH:'main',GITHUB_OWNER_TOKEN:'test-only-never-send',GITHUB_OWNER_TOKEN_FILE:'',GITHUB_SYNC_TIMEZONE:'Asia/Shanghai',GITHUB_SYNC_WEEKDAY:'1',GITHUB_SYNC_TIME:'03:00'};
  for(const [key,value]of Object.entries(githubEnv)){const previous=process.env[key];t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});process.env[key]=value;}
  const enabledBefore=config.githubEnabled;config.githubEnabled=true;t.after(()=>{config.githubEnabled=enabledBefore;});
  // Isolated schema: never truncate or modify the application's live tables.
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const maintenance=new pg.Client({password:secret('PGPASSWORD')});await maintenance.connect();await maintenance.query(`CREATE SCHEMA ${schema}`);
  process.env.PGOPTIONS=`-c search_path=${schema}`;
  const {pool}=await import('../src/db.js');
  const {buildApp}=await import('../src/app.js');
  const {decrypt,codeDigest}=await import('../src/crypto.js');
  const {emptyMind}=await import('../src/format.js');
  let lastContext:any[]=[];
  async function* fakeModel(_p:any,messages:any[]){lastContext=messages;if(messages.at(-1)?.content==='fixture:fail'){yield {delta:'partial'};const {HttpError}=await import('../src/errors.js');throw new HttpError(502,'UPSTREAM_429','fixture rate limit');}yield {delta:'你好，保持原文。'};yield {usage:{input_tokens:12,output_tokens:8}};}
  await pool.query(await readFile('migrations/001_platform.sql','utf8'));
  await pool.query(await readFile('migrations/002_owner_github.sql','utf8'));
  await t.test('weekly migration stops immediate jobs while retaining successful records and remote markers',async()=>{
    const pending=randomUUID(),success=randomUUID();
    const payload={target:{auth_mode:'owner',owner:'fixture',repo:'memories',branch:'main',mode:'commit'}};
    await pool.query("INSERT INTO jobs(id,type,status,payload) VALUES($1,'github','running',$3),($2,'github','succeeded',$3)",[pending,success,payload]);
    await pool.query(await readFile('migrations/003_weekly_github.sql','utf8'));
    const rows=(await pool.query('SELECT id,status,payload FROM jobs WHERE id=ANY($1::uuid[])',[[pending,success]])).rows;
    assert.equal(rows.find(x=>x.id===pending).status,'skipped');assert.equal(rows.find(x=>x.id===success).status,'succeeded');
    assert.deepEqual(rows.find(x=>x.id===pending).payload,payload);
    await pool.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[[pending,success]]);
  });
  const {scheduleWeeklyGithub,weeklyWindow}=await import('../src/services/github-schedule.js');
  await pool.query(await readFile('migrations/004_skill_reactions.sql','utf8'));
  const discoveryCalls:{endpoint:any;key:string}[]=[];
  const app=await buildApp({logger:false,transport:fakeModel,modelListTransport:async(endpoint,key)=>{discoveryCalls.push({endpoint,key});return [{id:'test-model',name:'Test model'}];}});await app.ready();
  const origin=process.env.APP_ORIGIN||'http://127.0.0.1:5173';
  async function request(method:any,url:string,payload?:any,auth?:any){
    if(payload&&(method==='PATCH'&&/^\/skills\/[^/]+$/.test(url)||url.endsWith('/publish'))){
      const row=(await pool.query('SELECT revision FROM skills WHERE id=$1',[url.split('/')[2]])).rows[0];
      payload={revision:row?.revision,...(url.endsWith('/publish')?{request_id:randomUUID()}:{}),...payload};
    }
    return app.inject({method,url:`/api/v1${url}`,headers:{origin,...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{})},...(payload===undefined?{}:{payload})});
  }
  let a:any,b:any,skillId:string,versionId:string,profileId:string,conversationId:string;
  async function register(email:string){
    const sent=await request('POST','/auth/email-codes',{email,purpose:'register'});assert.equal(sent.statusCode,200);const challenge=sent.json().data.challenge_id;
    const job=(await pool.query("SELECT * FROM jobs WHERE type='email' AND payload->>'challenge_id'=$1",[challenge])).rows[0];const code=decrypt(job.payload.code,`email:${challenge}`);
    const payload={email,challenge_id:challenge,code,password:'abc12345',display_name:email.split('@')[0]};
    const registered=await request('POST','/auth/register',payload);assert.equal(registered.statusCode,200,registered.body);
    const repeated=await request('POST','/auth/register',payload);assert.equal(repeated.statusCode,422);
    const login=await request('POST','/auth/login',{email,password:payload.password});assert.equal(login.statusCode,200,login.body);
    return {...login.json().data,cookie:login.cookies.map(x=>`${x.name}=${x.value}`).join('; ')};
  }
  try{
    await t.test('development loopback origins can request email codes while foreign origins are rejected',async()=>{
      for(const [index,requestOrigin] of ['http://127.0.0.1:5173','http://localhost:5173','http://[::1]:5173'].entries()){
        const response=await app.inject({method:'POST',url:'/api/v1/auth/email-codes',headers:{origin:requestOrigin},payload:{email:`origin-${index}@example.test`,purpose:'reset_password'}});
        assert.equal(response.statusCode,200,response.body);
      }
      for(const requestOrigin of [undefined,'null','http://localhost:5174','http://localhost.attacker.test:5173','https://attacker.test']){
        const response=await app.inject({method:'POST',url:'/api/v1/auth/email-codes',headers:requestOrigin?{origin:requestOrigin}:{},payload:{email:'origin-blocked@example.test',purpose:'reset_password'}});
        assert.equal(response.statusCode,403);
        assert.equal(response.json().error.code,'ORIGIN_REJECTED');
      }
    });
    await t.test('verification codes are single-use, passwords are digests, cookies authenticate',async()=>{
      a=await register('alice@example.test');b=await register('bob@example.test');
      const row=(await pool.query('SELECT password_digest FROM users WHERE id=$1',[a.user.id])).rows[0];assert.match(row.password_digest,/^\$argon2id\$/);
      const me=await request('GET','/auth/me',undefined,a);assert.equal(me.statusCode,200);assert.equal(me.json().data.user.session_digest,undefined);
      const anon=await request('GET','/model-profiles');assert.equal(anon.statusCode,401);
      const csrf=await app.inject({method:'POST',url:'/api/v1/skills',headers:{origin,cookie:a.cookie},payload:{}});assert.equal(csrf.statusCode,403);
    });
    await t.test('new passwords require at least eight characters with letters and digits on every write route',async()=>{
      for(const password of ['abc1234','abcdefgh','12345678','a1'.repeat(65)]){
        const payload={email:a.user.email,challenge_id:randomUUID(),code:'123456',display_name:'fixture',password};
        for(const route of ['/auth/register','/auth/reset-password','/auth/change-password']){
          const response=await request('POST',route,route==='/auth/change-password'?{old_password:'abc12345',password}:payload,a);
          assert.equal(response.statusCode,422,response.body);
          assert.equal(response.json().error.code,'INVALID_PASSWORD');
        }
      }
    });
    await t.test('SMTP worker delivers only to a local test sink and erases queued plaintext-equivalent data',async t=>{
      // Real SMTP settings in .env must never leak into this local fixture.
      const smtpEnv={SMTP_HOST:'127.0.0.1',SMTP_PORT:'0',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'false',SMTP_USER:'',SMTP_PASSWORD_FILE:'',SMTP_FROM:'DreamFly <noreply@localhost.test>'};
      for(const [key,value] of Object.entries(smtpEnv)){
        const previous=process.env[key];
        t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
        process.env[key]=value;
      }
      let captured='';
      const smtp=createServer(socket=>{socket.write('220 localhost test SMTP\r\n');let buffer='',data=false;socket.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {data=false;socket.write('250 accepted\r\n');}else captured+=line+'\n';}else if(/^EHLO|^HELO/.test(line))socket.write('250 localhost\r\n');else if(line==='DATA'){data=true;socket.write('354 send\r\n');}else if(line==='QUIT'){socket.end('221 bye\r\n');}else socket.write('250 ok\r\n');}});});
      await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));
      t.after(()=>new Promise<void>(resolve=>smtp.close(()=>resolve())));
      process.env.SMTP_PORT=String((smtp.address()as any).port);
      const sent=await request('POST','/auth/email-codes',{email:'delivery@example.test',purpose:'register'});assert.equal(sent.statusCode,200);
      const {runOnce}=await import('../src/worker.js');for(let i=0;i<3;i++)await runOnce();
      assert.match(captured,/delivery@example.test/);
      const done=(await pool.query("SELECT payload,status FROM jobs WHERE payload->>'challenge_id'=$1",[sent.json().data.challenge_id])).rows[0];assert.equal(done.status,'succeeded');assert.equal(done.payload.code,undefined);
    });
    await t.test('failed verification attempts persist and reset codes cannot register accounts',async()=>{
      const cid=randomUUID(),email='wrong-code@example.test';await pool.query("INSERT INTO email_challenges(id,email,purpose,code_digest,expires_at) VALUES($1,$2,'register',$3,now()+interval '10 minutes')",[cid,email,codeDigest(`${cid}:${email}:register:123456`)]);
      for(let n=0;n<5;n++)assert.equal((await request('POST','/auth/register',{email,display_name:'fixture',password:'Local-test-password-2026',challenge_id:cid,code:'000000'})).statusCode,422);
      assert.equal((await pool.query('SELECT attempts FROM email_challenges WHERE id=$1',[cid])).rows[0].attempts,5);
      assert.equal((await request('POST','/auth/register',{email,display_name:'fixture',password:'Local-test-password-2026',challenge_id:cid,code:'123456'})).statusCode,422);
    });
    await t.test('private draft ownership and explicit publication projection',async t=>{
      const mind=emptyMind('alice-mind');mind.persona.self_description='我重视真实的个人经历。';mind.memory.fragments=[{id:'public',content:'PUBLIC MEMORY'},{id:'private',content:'PRIVATE SECRET'}];
      const {storeAsset}=await import('../src/services/assets.js');
      const image=await storeAsset(a.user.id,'fixture.png',Buffer.from([137,80,78,71,13,10,26,10]));
      const audio=await storeAsset(a.user.id,'fixture.wav',Buffer.from('RIFF0000WAVE'));
      t.after(async()=>{await unlink(path.join(config.assets,image.id));await unlink(path.join(config.assets,audio.id));});
      mind.assets={image:image.reference,audio:audio.reference};
      const allocated=randomUUID();
      const created=await request('POST','/skills',{id:allocated,content:mind},a);assert.equal(created.statusCode,200,created.body);skillId=created.json().data.id;
      assert.equal(skillId,allocated);assert.equal(created.json().data.slug,`mind-${allocated}`);
      assert.equal((await request('PATCH',`/skills/${skillId}`,{content:mind},a)).json().error.code,'SLUG_READONLY');
      mind.slug=created.json().data.slug;
      assert.equal((await request('PATCH',`/skills/${skillId}`,{content:mind},a)).statusCode,200);
      assert.equal((await request('GET',`/skills/${skillId}`,undefined,b)).statusCode,404);
      assert.equal((await request('PATCH',`/skills/${skillId}`,{content:mind},b)).statusCode,404);
      config.githubEnabled=false;
      const missingTarget=await request('POST',`/skills/${skillId}/publish`,{listed:true,download:true,github:false,memory_ids:[],asset_keys:[],compliance_confirmed:true},a);
      config.githubEnabled=true;
      assert.equal(missingTarget.statusCode,200);assert.equal(missingTarget.json().data.published,true);assert.equal(missingTarget.json().data.sync_policy,'weekly');
      assert.equal((await pool.query('SELECT status FROM skills WHERE id=$1',[skillId])).rows[0].status,'published');
      assert.equal((await pool.query('SELECT count(*)::int n FROM skill_versions WHERE skill_id=$1',[skillId])).rows[0].n,1);
      const published=await request('POST',`/skills/${skillId}/publish`,{listed:true,chat:true,download:true,github:false,memory_ids:['public'],asset_keys:[],compliance_confirmed:true},a);assert.equal(published.statusCode,200,published.body);versionId=published.json().data.version_id;
      assert.equal(published.json().data.sync_job_id,null);
      assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE type='github'")).rows[0].n,0);
      const publicDetail=await request('GET',`/skills/${skillId}`,undefined,b);assert.equal(publicDetail.statusCode,200);assert.equal(publicDetail.json().data.draft,undefined);assert.ok(!publicDetail.body.includes('PRIVATE SECRET'));
      const search=await request('GET','/skills?search=PRIVATE%20SECRET');assert.deepEqual(search.json().data.items,[]);
      const download=await request('GET',`/skills/${skillId}/export?version=${versionId}`,undefined,b);assert.equal(download.statusCode,200,download.body.slice(0,100));const {importPackage}=await import('../src/format.js');const imported=await importPackage('skill.zip',download.rawPayload);assert.equal(imported.mind.memory.fragments.length,1);assert.equal(Object.keys(imported.mind.assets).length,2);
    });
    await t.test('discovery filters, public projection, private favorites and idempotent likes',async()=>{
      const sid=randomUUID(),content=emptyMind('fixture');content.name='Discovery 思想';content.language='en';
      content.persona.self_description='Published self';content.memory.fragments=[{id:'shared',content:'Visible memory'},{id:'hidden',content:'Discovery secret memory'}];
      const created=await request('POST',`/skills/${sid}/submit`,{revision:0,request_id:randomUUID(),content,publication:{listed:true,chat:true,download:true,memory_ids:['shared']},compliance_confirmed:true},a);
      assert.equal(created.statusCode,200,created.body);const version=created.json().data.version_id;
      const query=async(suffix:string,user?:any)=>{const response=await request('GET','/skills?'+suffix,undefined,user);assert.equal(response.statusCode,200,response.body);return response.json().data;};
      for(const search of [sid,sid.slice(0,8),`mind-${sid}`,'Discovery','思想','alice']){
        assert.ok((await query(`search=${encodeURIComponent(search)}&language=en&download=true&chat=true`)).items.some((x:any)=>x.id===sid));
      }
      assert.equal((await query(`search=${sid}&language=zh`)).total,0);
      assert.equal((await query('search=Discovery%20secret%20memory')).total,0);
      assert.equal((await query('search=%25')).total,0);
      const empty=await query(`search=${sid}&page=2&page_size=1`);assert.equal(empty.total,1);assert.deepEqual(empty.items,[]);
      for(const sort of ['newest','oldest','name','likes'])assert.equal((await query(`search=${sid}&sort=${sort}`)).items[0].id,sid);
      for(const invalid of ['page=1.5','page=Infinity','sort=unknown','page_size=101','chat=maybe'])assert.equal((await request('GET','/skills?'+invalid)).statusCode,422);
      assert.equal((await request('GET','/skills?collection=favorites')).statusCode,401);
      const publicUrl=`/skills/${sid}/public`;
      const anon=(await request('GET',publicUrl)).json().data;assert.equal(anon.preview,null);assert.equal(anon.memory_count,1);assert.equal(anon.draft,undefined);assert.equal(anon.versions,undefined);
      const owner=(await request('GET',publicUrl,undefined,a)).json().data;assert.equal(owner.is_owner,true);assert.deepEqual(owner.preview.memory.fragments,[content.memory.fragments[0]]);
      const state=(await request('GET',`/skills/${sid}`,undefined,a)).json().data;
      const saved=await request('PATCH',`/skills/${sid}`,{revision:state.revision,content:{...state.draft,name:'PRIVATE DRAFT TITLE',persona:{...state.draft.persona,self_description:'PRIVATE DRAFT SELF'}}},a);assert.equal(saved.statusCode,200,saved.body);
      assert.equal((await query('search=PRIVATE%20DRAFT%20TITLE')).total,0);
      assert.equal((await request('GET',publicUrl,undefined,a)).json().data.name,content.name);
      assert.equal((await request('PUT',`/skills/${sid}/reactions/like`,{active:true})).statusCode,401);
      const likes=await Promise.all([1,2,3].map(()=>request('PUT',`/skills/${sid}/reactions/like`,{active:true},b)));
      for(const response of likes)assert.equal(response.statusCode,200,response.body);
      const favorite=await request('PUT',`/skills/${sid}/reactions/favorite`,{active:true},b);assert.equal(favorite.json().data.like_count,1);assert.equal(favorite.json().data.favorited,true);
      assert.equal((await query(`search=${sid}&collection=favorites`,b)).total,1);assert.equal((await query(`search=${sid}&collection=liked`,b)).total,1);
      assert.equal((await query(`search=${sid}&collection=favorites`,a)).total,0);
      const outsider=(await request('GET',publicUrl,undefined,a)).json().data;assert.equal(outsider.favorited,false);assert.equal(outsider.like_count,1);assert.equal(outsider.favorite_count,undefined);
      const zipped=await request('GET',`/skills/${sid}/export?scope=public&version=${version}`,undefined,a);assert.equal(zipped.statusCode,200,zipped.body.slice(0,100));
      const {importPackage}=await import('../src/format.js');assert.deepEqual((await importPackage('skill.zip',zipped.rawPayload)).mind.memory.fragments,[content.memory.fragments[0]]);
      const unlike=await request('PUT',`/skills/${sid}/reactions/like`,{active:false},b);assert.equal(unlike.json().data.like_count,0);
      await request('POST',`/skills/${sid}/unpublish`,undefined,a);
      assert.equal((await query(`search=${sid}&collection=favorites`,b)).total,0);
      assert.equal((await request('GET',publicUrl,undefined,a)).statusCode,404);
      assert.equal((await request('GET',`/skills/${sid}/export?scope=public&version=${version}`,undefined,a)).statusCode,404);
      assert.equal((await request('PUT',`/skills/${sid}/reactions/like`,{active:true},b)).statusCode,404);
      assert.equal((await request('PUT',`/skills/${sid}/reactions/favorite`,{active:false},b)).statusCode,200);
    });
    await t.test('unlisted publication disables interaction, downloads and GitHub despite conflicting request flags',async()=>{
      const draft=emptyMind();draft.name='';draft.persona.self_description='我重视独立思考。';draft.memory.fragments=[{id:'one',content:'一次学习经历'}];
      const created=await request('POST','/skills',{content:draft},a);assert.equal(created.statusCode,200);
      const skill=await request('GET',`/skills/${created.json().data.id}`,undefined,a);assert.equal(skill.json().data.name,'alice的mindcopy');
      const published=await request('POST',`/skills/${created.json().data.id}/publish`,{listed:false,chat:true,download:true,github:true,compliance_confirmed:true},a);assert.equal(published.statusCode,200,published.body);assert.equal(published.json().data.sync_job_id,null);
      const version=(await pool.query('SELECT publication FROM skill_versions WHERE id=$1',[published.json().data.version_id])).rows[0];assert.deepEqual(version.publication,{listed:false,chat:false,download:false,github:false,memory_ids:[],asset_keys:[],compliance_confirmed:true});
    });
    await t.test('saving and publishing reject incomplete content, and publishing requires explicit authorization',async()=>{
      const content=emptyMind();content.persona.self_description='我重视真实。';content.memory.fragments=[{id:'one',content:'一次真实经历'}];
      const created=await request('POST','/skills',{content},a);assert.equal(created.statusCode,200,created.body);const sid=created.json().data.id;content.slug=created.json().data.slug;
      for(const change of [(m:any)=>{m.persona.instructions=''},(m:any)=>{m.persona.instructions='   '},(m:any)=>{m.persona.self_description=' \n '},(m:any)=>{m.memory.fragments=[]},(m:any)=>{m.memory.fragments[0].content='  '}]){
        const incomplete=structuredClone(content);change(incomplete);
        assert.equal((await request('POST','/skills',{content:incomplete},a)).statusCode,422);
        assert.equal((await request('PATCH',`/skills/${sid}`,{content:incomplete},a)).statusCode,422);
        await pool.query('UPDATE skills SET draft=$1 WHERE id=$2',[incomplete,sid]);
        assert.equal((await request('POST',`/skills/${sid}/publish`,{listed:false,compliance_confirmed:true},a)).statusCode,422);
      }
      await pool.query('UPDATE skills SET draft=$1 WHERE id=$2',[content,sid]);
      for(const compliance_confirmed of [undefined,false]){
        const rejected=await request('POST',`/skills/${sid}/publish`,{listed:false,compliance_confirmed},a);assert.equal(rejected.statusCode,422,rejected.body);assert.equal(rejected.json().error.code,'COMPLIANCE_CONFIRMATION_REQUIRED');
      }
      assert.equal((await pool.query('SELECT count(*)::int n FROM skill_versions WHERE skill_id=$1',[sid])).rows[0].n,0);
      const accepted=await request('POST',`/skills/${sid}/publish`,{listed:false,compliance_confirmed:true},a);assert.equal(accepted.statusCode,200,accepted.body);
      assert.equal((await pool.query('SELECT publication FROM skill_versions WHERE id=$1',[accepted.json().data.version_id])).rows[0].publication.compliance_confirmed,true);
    });
    await t.test('asset size limit accepts 10 MB and rejects larger uploads and legacy assets on publication',async t=>{
      const {assetMaxBytes}=await import('../src/format.js');const {storeAsset}=await import('../src/services/assets.js');
      const bytes=Buffer.alloc(assetMaxBytes+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
      await assert.rejects(()=>storeAsset(a.user.id,'too-large.png',bytes),(e:any)=>e.code==='ASSET_TOO_LARGE');
      const asset=await storeAsset(a.user.id,'limit.png',bytes.subarray(0,assetMaxBytes));t.after(()=>unlink(path.join(config.assets,asset.id)));
      const content=emptyMind();content.persona.self_description='我重视真实。';content.memory.fragments=[{id:'one',content:'一次经历'}];content.assets={image:asset.reference};
      const created=await request('POST','/skills',{content},a);assert.equal(created.statusCode,200,created.body);
      await pool.query('UPDATE assets SET size=$1 WHERE id=$2',[assetMaxBytes+1,asset.id]);
      const blocked=await request('POST',`/skills/${created.json().data.id}/publish`,{listed:false,compliance_confirmed:true},a);assert.equal(blocked.statusCode,422,blocked.body);assert.equal(blocked.json().error.code,'ASSET_TOO_LARGE');
    });
    await t.test('image upload rejects audio content without creating an asset',async()=>{
      const boundary='fixture-boundary',before=(await pool.query('SELECT count(*)::int n FROM assets')).rows[0].n;
      const payload=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nimage\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="renamed.png"\r\nContent-Type: image/png\r\n\r\nRIFF0000WAVE\r\n--${boundary}--\r\n`);
      const result=await app.inject({method:'POST',url:'/api/v1/assets',headers:{origin,cookie:a.cookie,'x-csrf-token':a.csrf,'content-type':`multipart/form-data; boundary=${boundary}`},payload});
      assert.equal(result.statusCode,422,result.body);assert.equal(result.json().error.code,'ASSET_KIND_MISMATCH');assert.equal((await pool.query('SELECT count(*)::int n FROM assets')).rows[0].n,before);
    });
    await t.test('model secrets stay private and never authorize other users',async()=>{
      const before=(await pool.query('SELECT count(*)::int n FROM model_profiles')).rows[0].n;
      const discovered=await request('POST','/model-providers/deepseek/models',{api_key:'unsaved-fixture-key'},b);
      assert.equal(discovered.statusCode,200,discovered.body);assert.equal(discovered.json().data[0].id,'test-model');assert.ok(!discovered.body.includes('unsaved-fixture-key'));
      assert.equal(discoveryCalls.at(-1)?.key,'unsaved-fixture-key');assert.equal(discoveryCalls.at(-1)?.endpoint.base_url,'https://api.deepseek.com/v1');
      assert.equal((await pool.query('SELECT count(*)::int n FROM model_profiles')).rows[0].n,before);
      assert.equal((await request('POST','/model-providers/deepseek/models',{},b)).statusCode,422);
      const p=await request('POST','/model-profiles',{name:'Test connection',provider:'deepseek',model:'test-model',api_key:'test-key-only',api_key_action:'replace',consent:true,parameters:{max_tokens:1024,timeout_seconds:30}},b);assert.equal(p.statusCode,200,p.body);profileId=p.json().data.id;assert.ok(!p.body.includes('test-key-only'));
      assert.equal((await request('POST','/model-providers/deepseek/models',{profile_id:profileId},b)).statusCode,200);
      assert.equal(discoveryCalls.at(-1)?.key,'test-key-only');
      assert.equal((await request('POST','/model-providers/deepseek/models',{profile_id:profileId,api_key:'replacement-fixture'},b)).statusCode,200);
      assert.equal(discoveryCalls.at(-1)?.key,'replacement-fixture');
      assert.equal((await request('POST','/model-providers/deepseek/models',{profile_id:profileId},a)).statusCode,404);
      assert.equal((await request('POST','/model-providers/gemini/models',{profile_id:profileId},b)).statusCode,422);
      assert.equal((await request('DELETE',`/model-profiles/${profileId}`,undefined,a)).statusCode,404);
      await pool.query('UPDATE model_profiles SET verified_at=now() WHERE id=$1',[profileId]);
      const defaulted=await request('PUT','/users/me/default-model-profile',{profile_id:profileId},b);assert.equal(defaulted.statusCode,200);
    });
    await t.test('conversation uses visitor model and authorized memory, retains casing and deduplicates',async()=>{
      const created=await request('POST',`/mindcopies/${skillId}/sessions`,{version_id:versionId,profile_id:profileId},b);assert.equal(created.statusCode,200,created.body);conversationId=created.json().data.id;
      const requestId=randomUUID(),payload={content:'Keep MY Case!',client_request_id:requestId};const sent=await request('POST',`/conversations/${conversationId}/messages`,payload,b);assert.equal(sent.statusCode,200,sent.body);assert.match(sent.body,/message.completed/);
      assert.equal(lastContext.at(-1).content,'Keep MY Case!');assert.ok(lastContext[0].content.includes('PUBLIC MEMORY'));assert.ok(!lastContext[0].content.includes('PRIVATE SECRET'));
      assert.equal((await request('GET',`/conversations/${conversationId}/messages`,undefined,a)).statusCode,404);
      const repeated=await request('POST',`/conversations/${conversationId}/messages`,payload,b);assert.equal(repeated.json().data.existing.status,'completed');assert.equal((await pool.query('SELECT count(*)::int n FROM messages WHERE conversation_id=$1',[conversationId])).rows[0].n,2);
    });
    await t.test('old conversation links remain accessible beyond the first 200 rows and enforce ownership', async () => {
      const ids = Array.from({length: 201}, () => randomUUID());
      await pool.query("INSERT INTO conversations(id,user_id,skill_version_id,title,profile_id,model_config) SELECT value,$2,$3,'newer fixture',$4,'{}'::jsonb FROM unnest($1::uuid[]) value", [ids,b.user.id,versionId,profileId]);
      const list=await request('GET','/conversations?page=1&page_size=200',undefined,b);
      assert.equal(list.json().data.length,200);
      assert.ok(!list.json().data.some((item:{id:string})=>item.id===conversationId));
      const detail=await request('GET','/conversations/'+conversationId,undefined,b);
      assert.equal(detail.statusCode,200,detail.body);
      assert.equal(detail.json().data.id,conversationId);
      assert.equal((await request('GET','/conversations/'+conversationId,undefined,a)).statusCode,404);
      const later=await request('GET','/conversations?page=2&page_size=200',undefined,b);
      assert.ok(later.json().data.some((item:{id:string})=>item.id===conversationId));
      await pool.query('DELETE FROM conversations WHERE id=ANY($1::uuid[])',[ids]);
    });
    await t.test('invalid image bytes return a useful client error instead of a server failure', async () => {
      const boundary='invalid-media-test';
      const payload='--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="bad.png"\r\nContent-Type: image/png\r\n\r\nnot an image\r\n--'+boundary+'--\r\n';
      const response=await app.inject({method:'POST',url:'/api/v1/assets',headers:{origin,cookie:a.cookie,'x-csrf-token':a.csrf,'content-type':'multipart/form-data; boundary='+boundary},payload});
      assert.equal(response.statusCode,422,response.body);
      assert.equal(response.json().error.code,'INVALID_MEDIA');
    });
    await t.test('SSE failure is emitted once with its explanation and invalid JSON is a client error', async () => {
      const response=await request('POST','/conversations/'+conversationId+'/messages',{content:'fixture:fail',client_request_id:randomUUID()},b);
      assert.equal(response.statusCode,200,response.body);
      assert.equal((response.body.match(/event: message.failed/g)||[]).length,1);
      assert.match(response.body,/fixture rate limit/);
      const history=await request('GET','/conversations/'+conversationId+'/messages',undefined,b);
      assert.equal(history.json().data.at(-1).status,'failed');
      assert.equal(history.json().data.at(-1).content,'partial');
      const invalid=await request('POST','/skills/validate',{content:'not JSON'},a);
      assert.equal(invalid.statusCode,422,invalid.body);
      assert.equal(invalid.json().error.code,'INVALID_SKILL');
    });
    await t.test('weekly scheduling selects latest versions once, catches up and retains failed task identity',async()=>{
      const sid=randomUUID(),content=emptyMind('mind-'+sid);
      content.persona.self_description='真实的我';content.memory.fragments=[{id:'shared',content:'分享'},{id:'hidden',content:'不可公开'}];
      const publication={listed:true,chat:true,download:true,memory_ids:['shared']};
      const payload={request_id:randomUUID(),revision:0,content,publication,compliance_confirmed:true};
      const replies=await Promise.all([request('POST','/skills/'+sid+'/submit',payload,a),request('POST','/skills/'+sid+'/submit',payload,a)]);
      const first=replies[0].json().data;assert.deepEqual(first,replies[1].json().data);assert.equal(first.sync_job_id,null);
      assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE type='github'")).rows[0].n,0);
      assert.equal((await request('POST','/skills/'+sid+'/submit',{...payload,publication:{...publication,memory_ids:['hidden']}},a)).json().error.code,'REQUEST_REUSED');
      assert.equal((await request('PATCH','/skills/'+sid,{revision:0,content,publication},a)).json().error.code,'DRAFT_CHANGED');
      const updated=structuredClone(content);updated.memory.fragments[0].content='本周最新';
      const next=(await request('POST','/skills/'+sid+'/submit',{...payload,request_id:randomUUID(),revision:first.revision,content:updated},a)).json().data;
      assert.equal(next.version,'1.0.1');
      const due=new Date('2030-01-06T19:00:00Z');
      await pool.query('UPDATE github_schedule SET next_run_at=$1',[due]);
      assert.equal(await scheduleWeeklyGithub(new Date(due.getTime()-1)),null);
      const batches=await Promise.all([scheduleWeeklyGithub(due),scheduleWeeklyGithub(due)]);
      assert.equal(batches.filter(Boolean).length,1);const batch=batches.find(Boolean);
      const job=(await pool.query("SELECT * FROM jobs WHERE payload->>'skill_id'=$1",[sid])).rows[0];
      assert.equal(job.payload.version_id,next.version_id);assert.deepEqual(job.payload.content.memory.fragments,[updated.memory.fragments[0]]);
      assert.ok(!JSON.stringify(job).includes('不可公开'));assert.ok(!JSON.stringify(job).includes('test-only-never-send'));
      assert.equal((await request('GET','/sync-jobs?batch_id='+batch+'&status=queued&skill_id='+sid,undefined,a)).json().data.length,1);
      assert.equal((await request('GET','/sync-jobs?batch_id='+batch,undefined,b)).json().data.length,0);
      assert.equal((await request('GET','/github/batches',undefined,b)).json().data.length,0);
      assert.equal((await request('GET','/admin/github/batches',undefined,a)).statusCode,403);
      await pool.query("UPDATE users SET role='admin' WHERE id=$1",[a.user.id]);
      const adminBatches=await request('GET','/admin/github/batches',undefined,a);assert.equal(adminBatches.statusCode,200);assert.ok(adminBatches.json().data.some((x:any)=>x.id===batch));
      assert.equal((await request('GET','/admin/sync-jobs?batch_id='+batch,undefined,a)).statusCode,200);
      await pool.query("UPDATE users SET role='user' WHERE id=$1",[a.user.id]);
      assert.equal((await request('GET','/sync-jobs?page=0',undefined,a)).statusCode,422);
      assert.equal((await request('GET','/sync-jobs?from=invalid',undefined,a)).statusCode,422);
      // Uploads after the cutoff do not change the batch snapshot.
      const newest=structuredClone(updated);newest.memory.fragments[0].content='下周内容';
      const newer=(await request('POST','/skills/'+sid+'/submit',{...payload,request_id:randomUUID(),revision:next.revision,content:newest},a)).json().data;
      assert.equal((await pool.query('SELECT payload FROM jobs WHERE id=$1',[job.id])).rows[0].payload.content.memory.fragments[0].content,'本周最新');
      assert.equal(await scheduleWeeklyGithub(due),null);
      await pool.query("UPDATE jobs SET status='succeeded' WHERE type='github'");
      const catchup=await scheduleWeeklyGithub(new Date('2030-02-03T20:00:00Z'));assert.ok(catchup);
      assert.equal((await pool.query('SELECT count(*)::int n FROM github_batches')).rows[0].n,2);
      const latestJob=(await pool.query("SELECT * FROM jobs WHERE payload->>'version_id'=$1",[newer.version_id])).rows[0];
      await pool.query("UPDATE jobs SET status='failed' WHERE id=$1",[latestJob.id]);
      const retryBatch=await scheduleWeeklyGithub(new Date('2030-02-10T19:00:00Z'));
      assert.equal((await pool.query('SELECT job_id FROM github_batch_jobs WHERE batch_id=$1',[retryBatch])).rows[0].job_id,latestJob.id);
      assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE payload->>'version_id'=$1",[newer.version_id])).rows[0].n,1);
      await pool.query("UPDATE jobs SET status='succeeded' WHERE type='github'");
      await pool.query("UPDATE jobs SET payload=jsonb_set(payload,'{target,owner}','\"Fixture\"'::jsonb) WHERE id=$1",[latestJob.id]);
      const empty=await scheduleWeeklyGithub(new Date('2030-02-17T19:00:00Z'));
      assert.equal((await pool.query('SELECT count(*)::int n FROM github_batch_jobs WHERE batch_id=$1',[empty])).rows[0].n,0);
      const current=(await request('GET','/skills/'+sid,undefined,a)).json().data;
      const unchanged=(await request('POST','/skills/'+sid+'/submit',{...payload,request_id:randomUUID(),revision:current.revision,content:current.draft},a)).json().data;
      assert.equal(unchanged.unchanged,true);assert.equal(unchanged.version_id,newer.version_id);
      const saved=await request('PATCH','/skills/'+sid,{content:current.draft,publication:{...publication,download:false}},a);assert.equal(saved.statusCode,200);
      const state=(await request('GET','/skills/'+sid,undefined,a)).json().data;
      assert.equal(state.draft_publication.download,false);assert.equal(state.publication.download,true);
      const disabled=(await request('POST','/skills/'+sid+'/submit',{...payload,request_id:randomUUID(),revision:state.revision,content:state.draft,publication:{...publication,download:false}},a)).json().data;
      assert.equal(disabled.sync_policy,'disabled');
      const excluded=await scheduleWeeklyGithub(new Date('2030-02-24T19:00:00Z'));
      assert.equal((await pool.query('SELECT count(*)::int n FROM github_batch_jobs WHERE batch_id=$1',[excluded])).rows[0].n,0);
    });
    await t.test('concurrent uploads with assets reuse transaction connections beyond pool capacity',async t=>{
      const {storeAsset}=await import('../src/services/assets.js');
      const asset=await storeAsset(a.user.id,'parallel.png',Buffer.from([137,80,78,71,13,10,26,10]));
      t.after(()=>unlink(path.join(config.assets,asset.id)));
      const responses=await Promise.all(Array.from({length:12},async()=>{
        const sid=randomUUID(),content=emptyMind(`mind-${sid}`);content.persona.self_description='并发上传';content.memory.fragments=[{id:'one',content:'记忆'}];content.assets={image:asset.reference};
        return request('POST',`/skills/${sid}/submit`,{request_id:randomUUID(),revision:0,content,publication:{listed:false,memory_ids:['one']},compliance_confirmed:true},a);
      }));
      for(const response of responses){assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.published,true);}
    });
    await t.test('missing GitHub configuration does not block publishing, search or downloads',async()=>{
      const sid=randomUUID(),content=emptyMind('mind-'+sid);content.persona.self_description='自我认知';content.memory.fragments=[{id:'one',content:'可下载'}];content.name='weekly-download';
      const payload={request_id:randomUUID(),revision:0,content,publication:{listed:true,download:true,memory_ids:['one']},compliance_confirmed:true};
      const token=process.env.GITHUB_OWNER_TOKEN;process.env.GITHUB_OWNER_TOKEN='';
      try{
        const response=await request('POST','/skills/'+sid+'/submit',payload,a);assert.equal(response.json().data.published,true);
        assert.equal((await request('GET','/skills/'+sid+'/export?version='+response.json().data.version_id,undefined,b)).statusCode,200);
        assert.ok((await request('GET','/skills?search=weekly-download')).json().data.items.some((x:any)=>x.id===sid));
        const due=new Date('2030-03-03T19:00:00Z');
        assert.equal(await scheduleWeeklyGithub(due),null);
        assert.ok((await pool.query('SELECT last_error FROM github_schedule')).rows[0].last_error);
        assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE payload->>'skill_id'=$1",[sid])).rows[0].n,0);
      }finally{process.env.GITHUB_OWNER_TOKEN=token;}
      const recovered=await scheduleWeeklyGithub(new Date('2030-03-03T19:01:00Z'));assert.ok(recovered);
      const status=(await request('GET','/github/status',undefined,a)).json().data;assert.equal(status.schedule.frequency,'weekly');assert.equal(status.schedule.last_error,null);
    });
    await t.test('weekly calendar uses Shanghai boundaries and schedule changes do not trigger an immediate export',async()=>{
      const before=await weeklyWindow(pool,new Date('2030-01-06T18:59:59Z'));
      assert.equal(before.next.toISOString(),'2030-01-06T19:00:00.000Z');
      const after=await weeklyWindow(pool,new Date('2030-01-06T19:00:00Z'));
      assert.equal(after.next.toISOString(),'2030-01-13T19:00:00.000Z');
      process.env.GITHUB_SYNC_TIME='04:00';
      try{assert.equal(await scheduleWeeklyGithub(new Date('2030-03-04T00:00:00Z')),null);
        assert.equal((await pool.query('SELECT next_run_at FROM github_schedule')).rows[0].next_run_at.toISOString(),'2030-03-10T20:00:00.000Z');
      }finally{process.env.GITHUB_SYNC_TIME='03:00';}
      await scheduleWeeklyGithub(new Date('2030-03-04T00:00:00Z'));
    });
    await t.test('worker recovers leases and lets other jobs proceed while a failed item backs off',async()=>{
      const {runOnce}=await import('../src/worker.js');
      await pool.query("UPDATE jobs SET status='succeeded' WHERE type='github'");
      const target={auth_mode:'owner',owner:'fixture',repo:'memories',branch:'main',mode:'commit'},first=randomUUID(),second=randomUUID(),batch=randomUUID();
      await pool.query('INSERT INTO github_batches(id,target,scheduled_for) VALUES($1,$2,now())',[batch,target]);
      await pool.query("INSERT INTO jobs(id,user_id,type,payload,created_at) VALUES($1,$2,'github',$3,now()-interval '1 second'),($4,$2,'github',$3,now())",[first,a.user.id,{target,skill_id:skillId},second]);
      await pool.query('INSERT INTO github_batch_jobs VALUES($1,$2),($1,$3)',[batch,first,second]);
      await runOnce('github',async()=>({status:'deferred'}));
      assert.equal((await pool.query('SELECT attempts FROM jobs WHERE id=$1',[first])).rows[0].attempts,0);
      await runOnce('github',async j=>{assert.equal(j.id,second);return {status:'succeeded',commit_url:'fixture'};});
      await pool.query('UPDATE jobs SET run_after=now() WHERE id=$1',[first]);
      await runOnce('github',async()=>{throw new Error('network');});
      assert.equal((await pool.query('SELECT status FROM jobs WHERE id=$1',[first])).rows[0].status,'queued');
      await pool.query("UPDATE jobs SET status='running',lease_until=now()-interval '1 second' WHERE id=$1",[first]);
      await runOnce('github',async j=>{assert.equal(j.id,first);return {status:'succeeded',commit_url:'fixture'};});
      await pool.query("UPDATE jobs SET status='queued',run_after=now() WHERE id=$1",[second]);
      await runOnce('github',async()=>{throw {status:401};});
      assert.equal((await pool.query('SELECT status FROM jobs WHERE id=$1',[second])).rows[0].status,'failed');
      assert.equal((await request('POST','/sync-jobs/'+second+'/retry',undefined,b)).statusCode,404);
      assert.equal((await request('POST','/sync-jobs/'+second+'/retry',undefined,a)).statusCode,200);
      await runOnce('github',async()=>({status:'succeeded',commit_url:'fixture'}));
      const legacy=randomUUID();await pool.query("INSERT INTO jobs(id,user_id,type,status,payload) VALUES($1,$2,'github','failed',$3)",[legacy,a.user.id,{target:{repo_id:42},skill_id:skillId}]);
      assert.equal((await request('POST','/sync-jobs/'+legacy+'/retry',undefined,a)).json().error.code,'GITHUB_LEGACY_JOB');
    });
    await t.test('GitHub retries branch races without force and recognizes a successful remote commit',async()=>{
      const {syncGithub}=await import('../src/services/github-sync.js');const content=emptyMind('alice-mind');
      await pool.query("UPDATE skills SET publication=publication||'{\"github\":true}'::jsonb WHERE id=$1",[skillId]);
      const job={id:randomUUID(),user_id:a.user.id,payload:{skill_id:skillId,version_id:versionId,content,target:{auth_mode:'owner',owner:'example',repo:'repo',branch:'main',mode:'commit'}}};
      let commits:any[]=[],updates=0,created=0;const mock:any={
        git:{getRef:async()=>({data:{object:{sha:'head'}}}),getCommit:async()=>({data:{tree:{sha:'tree'}}}),createBlob:async()=>({data:{sha:'blob'}}),createTree:async()=>({data:{sha:'newtree'}}),createCommit:async({message}:any)=>{created++;return {data:{sha:'newcommit',html_url:'https://github.com/example/repo/commit/newcommit',message}};},updateRef:async(args:any)=>{assert.equal(args.force,false);if(updates++===0)throw {status:422};commits=[{sha:'newcommit',html_url:'https://github.com/example/repo/commit/newcommit',commit:{message:`DreamFly publication ${job.id}`}}];}},
        repos:{listCommits:async()=>({data:commits})}
      };
      const gateway:any=async()=>({repo:{owner:'example',name:'repo'},api:mock});const first=await syncGithub(job,gateway);assert.equal(first.status,'succeeded');assert.equal(created,2);
      const again=await syncGithub(job,gateway);assert.equal(again.commit_url,first.commit_url);assert.equal(created,2);
      const lock=await pool.connect();
      try{await lock.query("SELECT pg_advisory_lock(hashtext('example/repo:main'))");assert.equal((await syncGithub(job,gateway)).status,'deferred');}
      finally{await lock.query("SELECT pg_advisory_unlock(hashtext('example/repo:main'))");lock.release();}
      const legacy={...job,payload:{...job.payload,target:{repo_id:42,branch:'main'}}};
      await assert.rejects(()=>syncGithub(legacy,gateway),{code:'GITHUB_LEGACY_JOB'});
      commits=[];mock.git.updateRef=async()=>{throw {status:403};};
      await assert.rejects(()=>syncGithub(job,gateway),(e:any)=>e.status===403);
      content.memory.fragments=[{id:'withdrawn',content:'不再公开'}];
      assert.equal((await syncGithub(job,async()=>{throw new Error('must not contact GitHub after revocation');})).status,'skipped');
    });
    await t.test('unpublishing revokes further public generation and logout invalidates old cookie',async()=>{
      assert.equal((await request('POST',`/skills/${skillId}/unpublish`,undefined,a)).statusCode,200);
      assert.equal((await request('POST',`/conversations/${conversationId}/messages`,{content:'hello',client_request_id:randomUUID()},b)).statusCode,404);
      assert.equal((await request('POST','/auth/logout',undefined,b)).statusCode,200);assert.equal((await request('GET','/auth/me',undefined,b)).statusCode,401);
    });
    await t.test('password reset revokes existing sessions and consumes its challenge',async()=>{
      await pool.query("UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",[`mail:${a.user.email}`]);
      const sent=await request('POST','/auth/email-codes',{email:a.user.email,purpose:'reset_password'});assert.equal(sent.statusCode,200);const cid=sent.json().data.challenge_id;
      const job=(await pool.query("SELECT payload FROM jobs WHERE payload->>'challenge_id'=$1",[cid])).rows[0];const code=decrypt(job.payload.code,`email:${cid}`);
      const reset=await request('POST','/auth/reset-password',{email:a.user.email,challenge_id:cid,code,password:'reset123'});assert.equal(reset.statusCode,200,reset.body);
      assert.equal((await request('GET','/auth/me',undefined,a)).statusCode,401);
      assert.equal((await request('POST','/auth/reset-password',{email:a.user.email,challenge_id:cid,code,password:'Changed-again-test-2026'})).statusCode,422);
      const login=await request('POST','/auth/login',{email:a.user.email,password:'reset123'});assert.equal(login.statusCode,200,login.body);
      const session={...login.json().data,cookie:login.cookies.map(x=>`${x.name}=${x.value}`).join('; ')};
      const changed=await request('POST','/auth/change-password',{old_password:'reset123',password:'newpass8'},session);assert.equal(changed.statusCode,200,changed.body);
      assert.equal((await request('POST','/auth/login',{email:a.user.email,password:'newpass8'})).statusCode,200);
    });
  }finally{await app.close();await pool.end();await maintenance.query(`DROP SCHEMA ${schema} CASCADE`);await maintenance.end();}
});
