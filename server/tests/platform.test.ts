import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import pg from 'pg';
import { secret } from '../src/config.js';

test('PostgreSQL account, skill, model ownership and conversation integration',async t=>{
  // Isolated schema: never truncate or modify the application's live tables.
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  const maintenance=new pg.Client({password:secret('PGPASSWORD')});await maintenance.connect();await maintenance.query(`CREATE SCHEMA ${schema}`);
  process.env.PGOPTIONS=`-c search_path=${schema}`;
  const {pool}=await import('../src/db.js');
  const {buildApp}=await import('../src/app.js');
  const {decrypt,codeDigest}=await import('../src/crypto.js');
  const {emptyMind}=await import('../src/format.js');
  let lastContext:any[]=[];
  async function* fakeModel(_p:any,messages:any[]){lastContext=messages;yield {delta:'你好，保持原文。'};yield {usage:{input_tokens:12,output_tokens:8}};}
  await pool.query(await readFile('migrations/001_platform.sql','utf8'));
  const app=await buildApp({logger:false,transport:fakeModel});await app.ready();
  const origin=process.env.APP_ORIGIN||'http://127.0.0.1:5173';
  async function request(method:any,url:string,payload?:any,auth?:any){return app.inject({method,url:`/api/v1${url}`,headers:{origin,...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{})},...(payload===undefined?{}:{payload})});}
  let a:any,b:any,skillId:string,versionId:string,profileId:string,conversationId:string;
  async function register(email:string){
    const sent=await request('POST','/auth/email-codes',{email,purpose:'register'});assert.equal(sent.statusCode,200);const challenge=sent.json().data.challenge_id;
    const job=(await pool.query("SELECT * FROM jobs WHERE type='email' AND payload->>'challenge_id'=$1",[challenge])).rows[0];const code=decrypt(job.payload.code,`email:${challenge}`);
    const payload={email,challenge_id:challenge,code,password:'Local-test-password-2026',display_name:email.split('@')[0]};
    const registered=await request('POST','/auth/register',payload);assert.equal(registered.statusCode,200,registered.body);
    const repeated=await request('POST','/auth/register',payload);assert.equal(repeated.statusCode,422);
    const login=await request('POST','/auth/login',{email,password:payload.password});assert.equal(login.statusCode,200,login.body);
    return {...login.json().data,cookie:login.cookies.map(x=>`${x.name}=${x.value}`).join('; ')};
  }
  try{
    await t.test('verification codes are single-use, passwords are digests, cookies authenticate',async()=>{
      a=await register('alice@example.test');b=await register('bob@example.test');
      const row=(await pool.query('SELECT password_digest FROM users WHERE id=$1',[a.user.id])).rows[0];assert.match(row.password_digest,/^\$argon2id\$/);
      const me=await request('GET','/auth/me',undefined,a);assert.equal(me.statusCode,200);assert.equal(me.json().data.user.session_digest,undefined);
      const anon=await request('GET','/model-profiles');assert.equal(anon.statusCode,401);
      const csrf=await app.inject({method:'POST',url:'/api/v1/skills',headers:{origin,cookie:a.cookie},payload:{}});assert.equal(csrf.statusCode,403);
    });
    await t.test('SMTP worker delivers only to a local test sink and erases queued plaintext-equivalent data',async()=>{
      let captured='';
      const smtp=createServer(socket=>{socket.write('220 localhost test SMTP\r\n');let buffer='',data=false;socket.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {data=false;socket.write('250 accepted\r\n');}else captured+=line+'\n';}else if(/^EHLO|^HELO/.test(line))socket.write('250 localhost\r\n');else if(line==='DATA'){data=true;socket.write('354 send\r\n');}else if(line==='QUIT'){socket.end('221 bye\r\n');}else socket.write('250 ok\r\n');}});});
      await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));const oldPort=process.env.SMTP_PORT;process.env.SMTP_PORT=String((smtp.address()as any).port);
      const sent=await request('POST','/auth/email-codes',{email:'delivery@example.test',purpose:'register'});assert.equal(sent.statusCode,200);
      const {runOnce}=await import('../src/worker.js');for(let i=0;i<3;i++)await runOnce();
      process.env.SMTP_PORT=oldPort;await new Promise<void>(resolve=>smtp.close(()=>resolve()));assert.match(captured,/delivery@example.test/);
      const done=(await pool.query("SELECT payload,status FROM jobs WHERE payload->>'challenge_id'=$1",[sent.json().data.challenge_id])).rows[0];assert.equal(done.status,'succeeded');assert.equal(done.payload.code,undefined);
    });
    await t.test('failed verification attempts persist and reset codes cannot register accounts',async()=>{
      const cid=randomUUID(),email='wrong-code@example.test';await pool.query("INSERT INTO email_challenges(id,email,purpose,code_digest,expires_at) VALUES($1,$2,'register',$3,now()+interval '10 minutes')",[cid,email,codeDigest(`${cid}:${email}:register:123456`)]);
      for(let n=0;n<5;n++)assert.equal((await request('POST','/auth/register',{email,display_name:'fixture',password:'Local-test-password-2026',challenge_id:cid,code:'000000'})).statusCode,422);
      assert.equal((await pool.query('SELECT attempts FROM email_challenges WHERE id=$1',[cid])).rows[0].attempts,5);
      assert.equal((await request('POST','/auth/register',{email,display_name:'fixture',password:'Local-test-password-2026',challenge_id:cid,code:'123456'})).statusCode,422);
    });
    await t.test('private draft ownership and explicit publication projection',async()=>{
      const mind=emptyMind('alice-mind');mind.memory.fragments=[{id:'public',content:'PUBLIC MEMORY'},{id:'private',content:'PRIVATE SECRET'}];
      const created=await request('POST','/skills',{content:mind},a);assert.equal(created.statusCode,200,created.body);skillId=created.json().data.id;
      assert.equal((await request('GET',`/skills/${skillId}`,undefined,b)).statusCode,404);
      assert.equal((await request('PATCH',`/skills/${skillId}`,{content:mind},b)).statusCode,404);
      const missingTarget=await request('POST',`/skills/${skillId}/publish`,{listed:true,github:true,memory_ids:[],asset_keys:[]},a);
      assert.equal(missingTarget.statusCode,422);assert.equal(missingTarget.json().error.code,'GITHUB_TARGET_REQUIRED');
      assert.equal((await pool.query('SELECT status FROM skills WHERE id=$1',[skillId])).rows[0].status,'draft');
      assert.equal((await pool.query('SELECT count(*)::int n FROM skill_versions WHERE skill_id=$1',[skillId])).rows[0].n,0);
      const published=await request('POST',`/skills/${skillId}/publish`,{listed:true,chat:true,download:true,github:false,memory_ids:['public'],asset_keys:[]},a);assert.equal(published.statusCode,200,published.body);versionId=published.json().data.version_id;
      const publicDetail=await request('GET',`/skills/${skillId}`,undefined,b);assert.equal(publicDetail.statusCode,200);assert.equal(publicDetail.json().data.draft,undefined);assert.ok(!publicDetail.body.includes('PRIVATE SECRET'));
      const search=await request('GET','/skills?search=PRIVATE%20SECRET');assert.deepEqual(search.json().data,[]);
      const download=await request('GET',`/skills/${skillId}/export?version=${versionId}`,undefined,b);assert.equal(download.statusCode,200,download.body.slice(0,100));const {importPackage}=await import('../src/format.js');const imported=await importPackage('skill.zip',download.rawPayload);assert.equal(imported.mind.memory.fragments.length,1);
    });
    await t.test('model secrets stay private and never authorize other users',async()=>{
      const p=await request('POST','/model-profiles',{name:'Test connection',provider:'deepseek',model:'test-model',api_key:'test-key-only',api_key_action:'replace',consent:true,parameters:{max_tokens:1024,timeout_seconds:30}},b);assert.equal(p.statusCode,200,p.body);profileId=p.json().data.id;assert.ok(!p.body.includes('test-key-only'));
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
    await t.test('GitHub retries branch races without force and recognizes a successful remote commit',async()=>{
      const {syncGithub}=await import('../src/github.js');const content=emptyMind('alice-mind');
      await pool.query("UPDATE skills SET publication=publication||'{\"github\":true}'::jsonb WHERE id=$1",[skillId]);
      const job={id:randomUUID(),user_id:a.user.id,payload:{skill_id:skillId,version_id:versionId,content,target:{repo_id:42,branch:'main',mode:'commit'}}};
      let commits:any[]=[],updates=0,created=0;const mock:any={
        git:{getRef:async()=>({data:{object:{sha:'head'}}}),getCommit:async()=>({data:{tree:{sha:'tree'}}}),createBlob:async()=>({data:{sha:'blob'}}),createTree:async()=>({data:{sha:'newtree'}}),createCommit:async({message}:any)=>{created++;return {data:{sha:'newcommit',html_url:'https://github.com/example/repo/commit/newcommit',message}};},updateRef:async(args:any)=>{assert.equal(args.force,false);if(updates++===0)throw {status:422};commits=[{sha:'newcommit',html_url:'https://github.com/example/repo/commit/newcommit',commit:{message:`DreamFly publication ${job.id}`}}];}},
        repos:{listCommits:async()=>({data:commits})}
      };
      const gateway:any=async()=>({repo:{owner:'example',name:'repo'},api:mock});const first=await syncGithub(job,gateway);assert.equal(first.status,'succeeded');assert.equal(created,2);
      const again=await syncGithub(job,gateway);assert.equal(again.commit_url,first.commit_url);assert.equal(created,2);
      mock.pulls={list:async()=>({data:[{html_url:'https://github.com/example/repo/pull/1',number:1,state:'open',merged_at:null}]})};
      job.payload.target.mode='pr';const pr=await syncGithub(job,gateway);assert.equal(pr.status,'awaiting_merge');
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
      const reset=await request('POST','/auth/reset-password',{email:a.user.email,challenge_id:cid,code,password:'Changed-test-password-2026'});assert.equal(reset.statusCode,200,reset.body);
      assert.equal((await request('GET','/auth/me',undefined,a)).statusCode,401);
      assert.equal((await request('POST','/auth/reset-password',{email:a.user.email,challenge_id:cid,code,password:'Changed-again-test-2026'})).statusCode,422);
    });
  }finally{await app.close();await pool.end();await maintenance.query(`DROP SCHEMA ${schema} CASCADE`);await maintenance.end();}
});
