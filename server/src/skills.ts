import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pool, transaction } from './db.js';
import { uid, admin } from './auth.js';
import { body, check, id, params, query, text } from './errors.js';
import { config } from './config.js';
import { importPackage, validateMind, parseMind, skillMarkdown, zipFiles } from './format.js';

export function publicMind(content:any,publication:any){
  const m=structuredClone(content);m.memory.fragments=m.memory.fragments.filter((x:any)=>(publication.memory_ids||[]).includes(x.id));
  m.assets=Object.fromEntries(Object.entries(m.assets).filter(([k])=>(publication.asset_keys||[]).includes(k)));
  delete m.extensions;return m;
}
export async function ownedSkill(skillId:string,user:string,db:any=pool){
  const s=(await db.query('SELECT * FROM skills WHERE id=$1 AND owner_id=$2',[id(skillId),user])).rows[0];check(s,404,'NOT_FOUND','未找到 Skill');return s;
}
export async function accessibleVersion(versionId:string,user:string,capability='chat'){
  const s=(await pool.query(`SELECT v.*,s.owner_id,s.status,s.publication AS current_publication,u.status AS owner_status FROM skill_versions v JOIN skills s ON s.id=v.skill_id JOIN users u ON u.id=s.owner_id WHERE v.id=$1`,[id(versionId)])).rows[0];
  check(s && s.owner_status==='active' && s.status!=='blocked' && (s.owner_id===user||(s.status==='published'&&s.current_publication[capability]&&s.publication[capability])),404,'NOT_FOUND','此 Skill 版本不可访问');
  return {...s,content:s.owner_id===user?s.content:publicMind(s.content,s.publication)};
}
function assetId(reference:string){return id(reference.replace(/^assets\//,'').split('.')[0]);}
async function validateAssets(content:any,user:string){
  for(const ref of Object.values(content.assets) as string[]){const a=(await pool.query('SELECT * FROM assets WHERE id=$1 AND user_id=$2',[assetId(ref),user])).rows[0];check(a,422,'MISSING_ASSET','素材不存在或不属于当前用户');}
}
function media(buffer:Buffer){
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];
  if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return ['image/jpeg','jpg'];
  if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return ['image/webp','webp'];
  if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WAVE')return ['audio/wav','wav'];
  if(buffer.toString('ascii',0,4)==='OggS')return ['audio/ogg','ogg'];
  if(buffer.toString('ascii',0,3)==='ID3'||(buffer[0]===255&&(buffer[1]&224)===224))return ['audio/mpeg','mp3'];
  throw new Error('仅支持 PNG、JPEG、WebP、WAV、OGG、MP3 素材');
}
export async function storeAsset(user:string,name:string,data:Buffer){
  check(data.length<=20*1024*1024,413,'ASSET_TOO_LARGE','素材最大 20 MiB');const [mime,ext]=media(data),asset=randomUUID();
  await mkdir(config.assets,{recursive:true});await writeFile(path.join(config.assets,asset),data,{flag:'wx'});
  try{await pool.query('INSERT INTO assets(id,user_id,name,mime,size) VALUES($1,$2,$3,$4,$5)',[asset,user,name.slice(0,200),mime,data.length]);}
  catch(e){await unlink(path.join(config.assets,asset));throw e;}
  return {id:asset,reference:`assets/${asset}.${ext}`,mime,name};
}
export async function exportFiles(content:any){
  const files=new Map<string,Buffer>([['mind.json',Buffer.from(JSON.stringify(content,null,2))],['SKILL.md',Buffer.from(skillMarkdown(content))]]);
  for(const ref of Object.values(content.assets) as string[])files.set(ref,await readFile(path.join(config.assets,assetId(ref))));return files;
}
async function upload(r:any,save:boolean){
  const file=await r.file();check(file,422,'NO_FILE','请选择 Skill 文件');const buffer=await file.toBuffer();
  if(!file.filename.endsWith('.zip'))check(buffer.length<=config.uploadJSON,413,'FILE_TOO_LARGE','单文件超过上传限制');
  let pkg;try{pkg=await importPackage(file.filename,buffer);}catch(e:any){if(e.statusCode)throw e;check(false,422,'INVALID_SKILL',e.message);}
  if(save){for(const [key,ref]of Object.entries(pkg.mind.assets)as [string,string][]){const content=pkg.files.get(pkg.root+ref);check(content,422,'MISSING_ASSET',`包中缺少 ${ref}`);pkg.mind.assets[key]=(await storeAsset(uid(r),ref,content)).reference;}}
  return {mind:pkg.mind,warnings:pkg.warnings};
}
export async function skillRoutes(app:FastifyInstance){
  app.post('/skills/validate',async r=>r.isMultipart()?upload(r,false):{mind:validateMind(parseMind(body(r).content).mind),warnings:[]});
  app.post('/skills/import',async r=>upload(r,true));
  app.post('/assets',async r=>{const f=await r.file();check(f,422,'NO_FILE','请选择素材');return storeAsset(uid(r),f.filename,await f.toBuffer());});
  app.get('/assets',async r=>(await pool.query('SELECT id,name,mime,size FROM assets WHERE user_id=$1 ORDER BY created_at DESC',[uid(r)])).rows);
  app.get('/assets/:id',async(r,p)=>{
    const a=(await pool.query('SELECT * FROM assets WHERE id=$1',[id(params(r).id)])).rows[0];check(a,404,'NOT_FOUND','素材不存在');
    if(a.user_id!==uid(r)){
      const versions=(await pool.query('SELECT version_id FROM version_assets WHERE asset_id=$1',[a.id])).rows;let allowed=false;
      for(const v of versions){try{const x=await accessibleVersion(v.version_id,uid(r),'download');if(Object.values(x.content.assets).some((ref:any)=>assetId(ref)===a.id))allowed=true;}catch{}}
      check(allowed,404,'NOT_FOUND','素材不存在');
    }
    return p.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type(a.mime).send(await readFile(path.join(config.assets,a.id)));
  });
  app.delete('/assets/:id',async r=>{
    const a=id(params(r).id);check(!(await pool.query('SELECT 1 FROM version_assets WHERE asset_id=$1',[a])).rowCount,409,'ASSET_IN_USE','发布版本仍在引用此素材');
    check(!(await pool.query('SELECT 1 FROM skills WHERE owner_id=$1 AND draft::text LIKE $2',[uid(r),`%${a}%`])).rowCount,409,'ASSET_IN_USE','草稿仍在引用此素材');
    const deleted=await pool.query('DELETE FROM assets WHERE id=$1 AND user_id=$2 RETURNING id',[a,uid(r)]);check(deleted.rowCount,404,'NOT_FOUND','素材不存在');await unlink(path.join(config.assets,a));return {deleted:true};
  });
  app.post('/skills',async r=>{
    const content=validateMind(body(r).content);await validateAssets(content,uid(r));const skill=randomUUID();
    await pool.query('INSERT INTO skills(id,owner_id,slug,name,description,draft) VALUES($1,$2,$3,$4,$5,$6)',[skill,uid(r),content.slug,content.name,content.description,content]);return {id:skill};
  });
  app.patch('/skills/:id',async r=>{
    const s=await ownedSkill(params(r).id,uid(r));const m=validateMind(body(r).content);await validateAssets(m,uid(r));
    check(s.status!=='blocked',403,'BLOCKED','此 Skill 已被管理下架');
    await pool.query('UPDATE skills SET slug=$1,name=$2,description=$3,draft=$4,updated_at=now() WHERE id=$5',[m.slug,m.name,m.description,m,s.id]);return {id:s.id};
  });
  app.get('/skills',{config:{public:true}},async r=>{
    const q=query(r),mine=q.scope==='mine',user=mine?uid(r):null,term=(q.search||'').slice(0,200);const page=Math.max(1,Number(q.page)||1);
    return (await pool.query(`SELECT s.id,s.owner_id,s.slug,CASE WHEN $1::uuid IS NULL THEN v.content->>'name' ELSE s.name END AS name,
      CASE WHEN $1::uuid IS NULL THEN v.content->>'description' ELSE s.description END AS description,s.status,s.published_version_id,u.display_name AS author
      FROM skills s JOIN users u ON u.id=s.owner_id LEFT JOIN skill_versions v ON v.id=s.published_version_id
      WHERE (($1::uuid IS NOT NULL AND s.owner_id=$1) OR ($1::uuid IS NULL AND s.status='published' AND s.publication->>'listed'='true' AND u.status='active'))
      AND (CASE WHEN $1::uuid IS NULL THEN (v.content->>'name')||' '||(v.content->>'description') ELSE s.name||' '||s.description END) ILIKE $2 ORDER BY s.updated_at DESC LIMIT 24 OFFSET $3`,[user,`%${term}%`,(page-1)*24])).rows;
  });
  app.get('/skills/:id',{config:{public:true}},async r=>{
    const s=(await pool.query('SELECT s.*,u.display_name AS author,u.status AS owner_status FROM skills s JOIN users u ON u.id=s.owner_id WHERE s.id=$1',[id(params(r).id)])).rows[0];
    check(s && (s.owner_id===r.user?.id||(s.status==='published'&&s.publication.listed&&s.owner_status==='active')),404,'NOT_FOUND','Skill 不存在');
    const versions=(await pool.query('SELECT id,version,created_at FROM skill_versions WHERE skill_id=$1 ORDER BY created_at DESC',[s.id])).rows;
    if(s.owner_id===r.user?.id)return {...s,versions};
    const v=(await pool.query('SELECT content FROM skill_versions WHERE id=$1',[s.published_version_id])).rows[0];return {id:s.id,name:v.content.name,description:v.content.description,author:s.author,published_version_id:s.published_version_id,publication:{chat:!!s.publication.chat,download:!!s.publication.download},versions};
  });
  app.post('/skills/:id/versions',async r=>{
    const s=await ownedSkill(params(r).id,uid(r));validateMind(s.draft);await validateAssets(s.draft,uid(r));const version=randomUUID();
    await transaction(async db=>{await db.query('INSERT INTO skill_versions(id,skill_id,version,content) VALUES($1,$2,$3,$4)',[version,s.id,s.draft.version,s.draft]);for(const ref of Object.values(s.draft.assets)as string[])await db.query('INSERT INTO version_assets VALUES($1,$2)',[version,assetId(ref)]);});return {id:version};
  });
  app.post('/skills/:id/publish',async r=>{
    const b=body(r),s=await ownedSkill(params(r).id,uid(r));check(s.status!=='blocked',403,'BLOCKED','此 Skill 已被管理下架');validateMind(s.draft);await validateAssets(s.draft,uid(r));
    const pub={listed:b.listed===true,chat:b.chat===true,download:b.download===true,github:b.github===true,memory_ids:Array.isArray(b.memory_ids)?b.memory_ids:[],asset_keys:Array.isArray(b.asset_keys)?b.asset_keys:[]};
    check(pub.memory_ids.every(x=>s.draft.memory.fragments.some((m:any)=>m.id===x)) && pub.asset_keys.every(x=>Object.hasOwn(s.draft.assets,x)),422,'INVALID_PUBLICATION','发布范围包含不存在的记忆或素材');
    return transaction(async db=>{
      const current=(await db.query('SELECT draft,status FROM skills WHERE id=$1 FOR UPDATE',[s.id])).rows[0];
      check(current.status!=='blocked'&&JSON.stringify(current.draft)===JSON.stringify(s.draft),409,'DRAFT_CHANGED','草稿已变更或下架，请刷新后重新发布');
      let v=(await db.query('SELECT * FROM skill_versions WHERE skill_id=$1 AND version=$2',[s.id,s.draft.version])).rows[0];
      if(v){check(JSON.stringify(v.content)===JSON.stringify(JSON.parse(JSON.stringify(s.draft))),409,'VERSION_EXISTS','版本号已存在，请增加版本号');check(!Object.keys(v.publication).length,409,'ALREADY_PUBLISHED','此版本已发布，请创建新版本');}
      else{v={id:randomUUID()};await db.query('INSERT INTO skill_versions(id,skill_id,version,content) VALUES($1,$2,$3,$4)',[v.id,s.id,s.draft.version,s.draft]);}
      await db.query('UPDATE skill_versions SET publication=$1 WHERE id=$2',[pub,v.id]);
      for(const ref of Object.values(s.draft.assets)as string[])await db.query('INSERT INTO version_assets VALUES($1,$2) ON CONFLICT DO NOTHING',[v.id,assetId(ref)]);
      await db.query("UPDATE skills SET published_version_id=$1,publication=$2,status='published',updated_at=now() WHERE id=$3",[v.id,pub,s.id]);
      const target=(await db.query('SELECT * FROM github_targets WHERE skill_id=$1',[s.id])).rows[0];let jobId=null;
      if(pub.github)check(target,422,'GITHUB_TARGET_REQUIRED','请先在 GitHub 同步页面配置此 Skill 的目标仓库');
      if(pub.github&&target){check(config.githubEnabled,422,'GITHUB_DISABLED','GitHub App 尚未配置');jobId=randomUUID();await db.query("INSERT INTO jobs(id,user_id,type,payload,unique_key) VALUES($1,$2,'github',$3,$4)",[jobId,uid(r),{skill_id:s.id,version_id:v.id,target,content:publicMind(s.draft,pub)},`${v.id}:${target.repo_id}:${target.branch}`]);}
      return {version_id:v.id,sync_job_id:jobId};
    });
  });
  app.post('/skills/:id/unpublish',async r=>{const s=await ownedSkill(params(r).id,uid(r));check(s.status!=='blocked',403,'BLOCKED','已被管理下架');await pool.query("UPDATE skills SET status='draft' WHERE id=$1",[s.id]);return {unpublished:true};});
  app.get('/skills/:id/export',async(r,p)=>{
    const version=id(query(r).version);const v=await accessibleVersion(version,uid(r),'download');check(v.skill_id===id(params(r).id),404,'NOT_FOUND','版本不属于此 Skill');
    const files=await exportFiles(v.content);const archive=await zipFiles(new Map([...files].map(([k,vv])=>[`${v.content.slug}/${k}`,vv])));
    return p.header('Content-Disposition',`attachment; filename="${v.content.slug}-${v.version}.zip"`).type('application/zip').send(archive);
  });
  app.get('/admin/users',async r=>{admin(r);return (await pool.query('SELECT id,email,display_name,status,role FROM users ORDER BY created_at DESC LIMIT 100')).rows;});
  app.post('/admin/skills/:id/unpublish',async r=>{admin(r);await transaction(async db=>{await db.query("UPDATE skills SET status='blocked' WHERE id=$1",[id(params(r).id)]);await db.query('INSERT INTO admin_events(id,user_id,action,resource_id) VALUES($1,$2,$3,$4)',[randomUUID(),uid(r),'unpublish',params(r).id]);});return {unpublished:true};});
  app.patch('/admin/users/:id/status',async r=>{admin(r);const status=body(r).status;check(['active','disabled'].includes(status)&&params(r).id!==uid(r),422,'INVALID_STATUS','不能停用自己，状态须为 active 或 disabled');await transaction(async db=>{await db.query('UPDATE users SET status=$1 WHERE id=$2',[status,id(params(r).id)]);await db.query('DELETE FROM auth_sessions WHERE user_id=$1',[params(r).id]);await db.query('INSERT INTO admin_events(id,user_id,action,resource_id) VALUES($1,$2,$3,$4)',[randomUUID(),uid(r),status,params(r).id]);});return {status};});
}
