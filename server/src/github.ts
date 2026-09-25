import { Octokit } from '@octokit/rest';
import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { secret } from './config.js';
import { uid, admin } from './auth.js';
import { check, id, params, query } from './errors.js';
import { ownedSkill, exportFiles } from './skills.js';
import { githubTarget, githubStatus } from './github-config.js';
import { weeklyStatus, listBatches } from './github-schedule.js';

function pageNumber(value?:string){
  const page=Number(value||1);check(Number.isInteger(page)&&page>0&&page<=100000,422,'INVALID_PAGE','页码无效');return page;
}

async function retryJob(jobId:string,user:string|null){
  const j=(await pool.query("SELECT * FROM jobs WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) AND type='github'",[id(jobId),user])).rows[0];
  check(j,404,'NOT_FOUND','任务不存在');
  check(j.payload.target?.auth_mode==='owner',409,'GITHUB_LEGACY_JOB','旧 App 任务不能转投统一仓库，请联系管理员核对原提交');
  check(j.status==='failed',409,'NOT_RETRYABLE','仅失败任务可以重试');
  check((await pool.query('SELECT 1 FROM github_batch_jobs WHERE job_id=$1',[j.id])).rowCount,409,'NOT_RETRYABLE','旧即时任务等待每周调度');
  const t=githubTarget();
  check(j.payload.target.owner.toLowerCase()===t.owner&&j.payload.target.repo.toLowerCase()===t.repo&&j.payload.target.branch===t.branch,409,'GITHUB_TARGET_CHANGED','目标已变更，不能重试旧目标任务');
  const result=await pool.query("UPDATE jobs SET status='queued',attempts=0,run_after=now(),last_error=NULL,result=NULL WHERE id=$1 AND status='failed' RETURNING id",[j.id]);
  check(result.rowCount,409,'NOT_RETRYABLE','任务已被重试');return {queued:true};
}

export async function githubRoutes(app:FastifyInstance){
  app.get('/github/status',async r=>{
    const user=uid(r),batches=await listBatches(user);
    return {...githubStatus(),schedule:await weeklyStatus(),latest_batch:batches[0]||null};
  });
  app.get('/github/batches',async r=>listBatches(uid(r),pageNumber(query(r).page)));
  app.get('/admin/github/batches',async r=>{admin(r);return listBatches(null,pageNumber(query(r).page));});
  app.post('/admin/sync-jobs/:id/retry',async r=>{admin(r);return retryJob(params(r).id,null);});
  app.post('/admin/github/check',async r=>{
    admin(r);const t=githubTarget(),api=new Octokit({auth:secret('GITHUB_OWNER_TOKEN'),request:{timeout:30000}});
    try{
      const repo=(await api.repos.get({owner:t.owner,repo:t.repo})).data;
      check(repo.permissions?.push,422,'GITHUB_PERMISSION_REQUIRED','Owner 令牌没有目标仓库的写入权限');
      await api.git.getRef({owner:t.owner,repo:t.repo,ref:'heads/'+t.branch});
      return {reachable:true,message:'仓库和分支可访问；令牌的 Contents 写权限及分支规则需由管理员确认'};
    }catch(e:any){if(e.code?.startsWith('GITHUB'))throw e;check(false,422,'GITHUB_CHECK_FAILED','无法访问仓库或分支 ('+(e.status||'network')+')，请检查 Owner 令牌、权限与目标分支');}
  });
  async function jobs(user:string|null,q:Record<string,string>){
    if(q.skill_id){id(q.skill_id);if(user)await ownedSkill(q.skill_id,user);}
    if(q.batch_id)id(q.batch_id);
    if(q.status)check(['queued','running','succeeded','failed','skipped'].includes(q.status),422,'INVALID_STATUS','同步状态无效');
    for(const date of [q.from,q.to])if(date)check(Number.isFinite(Date.parse(date)),422,'INVALID_DATE','同步日期无效');
    const page=pageNumber(q.page);
    return (await pool.query(`SELECT j.id,j.status,j.attempts,j.last_error,j.result,j.created_at,j.payload->>'skill_id' AS skill_id,
      j.payload->>'version_id' AS version_id,j.payload->'content'->>'version' AS version,j.payload->'target' AS target
      FROM jobs j WHERE ($1::uuid IS NULL OR j.user_id=$1) AND j.type='github'
      AND ($2::text IS NULL OR j.payload->>'skill_id'=$2) AND ($3::text IS NULL OR j.status=$3)
      AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM github_batch_jobs bj WHERE bj.job_id=j.id AND bj.batch_id=$4))
      AND ($5::timestamptz IS NULL OR j.created_at>=$5) AND ($6::timestamptz IS NULL OR j.created_at<$6)
      ORDER BY j.created_at DESC,j.id DESC LIMIT 50 OFFSET $7`,
      [user,q.skill_id||null,q.status||null,q.batch_id||null,q.from?new Date(q.from):null,q.to?new Date(q.to):null,(page-1)*50])).rows;
  }
  app.get('/sync-jobs',async r=>jobs(uid(r),query(r)));
  app.get('/admin/sync-jobs',async r=>{admin(r);return jobs(null,query(r));});
  app.get('/sync-jobs/:id',async r=>{
    const j=(await pool.query("SELECT id,status,attempts,last_error,result FROM jobs WHERE id=$1 AND user_id=$2 AND type='github'",[id(params(r).id),uid(r)])).rows[0];
    check(j,404,'NOT_FOUND','任务不存在');return j;
  });
  app.post('/sync-jobs/:id/retry',async r=>retryJob(params(r).id,uid(r)));
}

async function authorizeGithub(job:any){
  const configured=githubTarget(),target=job.payload.target;
  check(target?.auth_mode==='owner',422,'GITHUB_LEGACY_JOB','旧 App 任务已停止，请管理员核对原仓库；不会自动转投统一仓库');
  check(target.owner.toLowerCase()===configured.owner.toLowerCase()&&target.repo.toLowerCase()===configured.repo.toLowerCase()&&target.branch===configured.branch,
    422,'GITHUB_TARGET_CHANGED','平台同步目标已变更，此任务仍保留原目标，请管理员核对');
  return {repo:{owner:target.owner,name:target.repo},api:new Octokit({auth:secret('GITHUB_OWNER_TOKEN'),request:{timeout:30000}})};
}

async function publicationAllowed(job:any){
  const skill=await ownedSkill(job.payload.skill_id,job.user_id);
  const owner=(await pool.query('SELECT status FROM users WHERE id=$1',[job.user_id])).rows[0];
  return owner?.status==='active'&&skill.status==='published'&&skill.publication.github
    &&job.payload.content.memory.fragments.every((m:any)=>skill.publication.memory_ids?.includes(m.id));
}

export async function syncGithub(job:any,authorize:typeof authorizeGithub=authorizeGithub){
  check(job.payload.target?.auth_mode==='owner',422,'GITHUB_LEGACY_JOB','旧 App 任务已停止，不会自动转投统一仓库');
  const skipped={status:'skipped',reason:'已下架、账号停用或记忆公开范围已撤销'};
  if(!await publicationAllowed(job))return skipped;
  const {repo,api}=await authorize(job),t=job.payload.target;
  const owner=repo.owner,repoName=repo.name,branch=t.branch;
  const content=job.payload.content,dir=`skills/${job.user_id}/${job.payload.skill_id}/${content.version}/${content.slug}`;
  const marker=`DreamFly publication ${job.id}`;
  const lockKey=`${owner.toLowerCase()}/${repoName.toLowerCase()}:${branch}`,lock=await pool.connect();
  let locked=false;
  try{
    locked=(await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[lockKey])).rows[0].locked;
    if(!locked)return {status:'deferred'};
    if(!await publicationAllowed(job))return skipped;
    let head:string;
    try{head=(await api.git.getRef({owner,repo:repoName,ref:'heads/'+branch})).data.object.sha;}
    catch(e:any){
      if(e.status!==404&&e.status!==409)throw e;
      const branches=(await api.repos.listBranches({owner,repo:repoName})).data;
      check(branches.length===0,422,'GITHUB_BRANCH_NOT_FOUND','目标分支不存在，请联系管理员');
      const initial=await api.repos.createOrUpdateFileContents({owner,repo:repoName,path:'README.md',message:'Initialize DreamFly content repository',content:Buffer.from('# Mind Skills\n').toString('base64'),branch});
      head=initial.data.commit.sha!;
    }
    const previous=await api.repos.listCommits({owner,repo:repoName,sha:branch,path:dir+'/mind.json',per_page:100});
    let commit=previous.data.find(x=>x.commit.message===marker);
    if(!commit){
      const files=await exportFiles(content),entries=[];
      for(const [name,data]of files){const blob=await api.git.createBlob({owner,repo:repoName,content:data.toString('base64'),encoding:'base64'});entries.push({path:dir+'/'+name,mode:'100644' as const,type:'blob' as const,sha:blob.data.sha});}
      for(let attempt=0;attempt<3;attempt++){
        if(!await publicationAllowed(job))return skipped;
        const parent=await api.git.getCommit({owner,repo:repoName,commit_sha:head});
        const tree=await api.git.createTree({owner,repo:repoName,base_tree:parent.data.tree.sha,tree:entries});
        const created=await api.git.createCommit({owner,repo:repoName,message:marker,tree:tree.data.sha,parents:[head]});
        try{await api.git.updateRef({owner,repo:repoName,ref:'heads/'+branch,sha:created.data.sha,force:false});commit={sha:created.data.sha,html_url:created.data.html_url} as any;break;}
        catch(e:any){if(![409,422].includes(e.status)||attempt===2)throw e;head=(await api.git.getRef({owner,repo:repoName,ref:'heads/'+branch})).data.object.sha;}
      }
    }
    check(commit,502,'GITHUB_COMMIT_FAILED','无法创建提交');
    return {status:'succeeded',commit_url:commit.html_url};
  }finally{try{if(locked)await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[lockKey]);}finally{lock.release();}}
}
