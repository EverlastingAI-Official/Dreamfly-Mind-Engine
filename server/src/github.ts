import { randomUUID, createHmac } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { FastifyInstance } from 'fastify';
import { pool, transaction } from './db.js';
import { config, secret } from './config.js';
import { uid } from './auth.js';
import { body, check, id, params, query, text } from './errors.js';
import { token, digest, equal, encrypt, decrypt } from './crypto.js';
import { ownedSkill, exportFiles } from './skills.js';

function enabled(){check(config.githubEnabled,503,'GITHUB_DISABLED','GitHub 同步未启用，请配置 GitHub App');}
function installationClient(installationId:number){return new Octokit({authStrategy:createAppAuth,auth:{appId:process.env.GITHUB_APP_ID,privateKey:secret('GITHUB_APP_PRIVATE_KEY',true),installationId}});}
async function connection(user:string,connectionId:string){
  const c=(await pool.query('SELECT * FROM github_connections WHERE id=$1 AND user_id=$2 AND active=true',[id(connectionId),user])).rows[0];check(c,404,'GITHUB_DISCONNECTED','GitHub 连接已失效');return c;
}
async function repositories(c:any){
  const userClient=new Octokit({auth:decrypt(c.token_cipher,`github:${c.user_id}:${c.id}`)});
  const result:any[]=await userClient.paginate('GET /user/installations/{installation_id}/repositories',{installation_id:Number(c.installation_id),per_page:100});
  return result.map(x=>({id:x.id,name:x.name,owner:x.owner.login,private:x.private,default_branch:x.default_branch,permissions:x.permissions}));
}
export async function githubRoutes(app:FastifyInstance){
  app.get('/github/connections',async r=>({enabled:config.githubEnabled,connections:(await pool.query('SELECT id,account,installation_id,active FROM github_connections WHERE user_id=$1',[uid(r)])).rows}));
  app.post('/github/connect',async r=>{
    enabled();const state=token();await pool.query("INSERT INTO github_states VALUES($1,$2,now()+interval '10 minutes')",[digest(state),uid(r)]);
    const url=new URL('https://github.com/login/oauth/authorize');url.searchParams.set('client_id',process.env.GITHUB_APP_CLIENT_ID||'');url.searchParams.set('state',state);url.searchParams.set('redirect_uri',process.env.GITHUB_CALLBACK_URL||`${config.origin}/api/v1/github/callback`);
    return {authorize_url:url.href,install_url:`https://github.com/apps/${process.env.GITHUB_APP_SLUG||''}/installations/new`};
  });
  app.get('/github/callback',async(r,p)=>{
    enabled();const q=query(r),user=uid(r);
    const state=await pool.query('DELETE FROM github_states WHERE state_digest=$1 AND user_id=$2 AND expires_at>now() RETURNING user_id',[digest(q.state||''),user]);check(state.rowCount,403,'INVALID_STATE','GitHub 授权状态失效，请重新绑定');
    const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.GITHUB_APP_CLIENT_ID,client_secret:secret('GITHUB_APP_CLIENT_SECRET',true),code:q.code,redirect_uri:process.env.GITHUB_CALLBACK_URL||`${config.origin}/api/v1/github/callback`}),signal:AbortSignal.timeout(30000)});
    const data:any=await response.json();check(data.access_token,422,'GITHUB_AUTH_FAILED','GitHub 授权失败');
    const client=new Octokit({auth:data.access_token});const installations:any[]=await client.paginate('GET /user/installations',{per_page:100});
    for(const install of installations.filter(x=>String(x.app_id)===process.env.GITHUB_APP_ID)){
      const old=(await pool.query('SELECT id FROM github_connections WHERE user_id=$1 AND installation_id=$2',[user,install.id])).rows[0];const cid=old?.id||randomUUID();
      await pool.query('INSERT INTO github_connections(id,user_id,installation_id,account,token_cipher) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,installation_id) DO UPDATE SET token_cipher=excluded.token_cipher,active=true',[cid,user,install.id,install.account.login,encrypt(data.access_token,`github:${user}:${cid}`)]);
    }
    return p.redirect(`${config.origin}/#/pages/platform/index?view=github`);
  });
  app.get('/github/repositories',async r=>{enabled();const c=await connection(uid(r),query(r).connection_id);return repositories(c);});
  app.delete('/github/connections/:id',async r=>{await pool.query('UPDATE github_connections SET active=false WHERE id=$1 AND user_id=$2',[id(params(r).id),uid(r)]);return {disconnected:true};});
  app.put('/skills/:id/github-target',async r=>{
    enabled();const s=await ownedSkill(params(r).id,uid(r)),b=body(r),c=await connection(uid(r),b.connection_id);const repo=(await repositories(c)).find(x=>x.id===Number(b.repo_id));check(repo,403,'REPO_FORBIDDEN','没有此仓库的访问权限');
    const branch=text(b.branch||repo.default_branch,'分支',200);check(!/[~^:?*\[\\\s]/.test(branch)&&!branch.includes('..')&&!branch.endsWith('/')&&!branch.startsWith('/'),422,'INVALID_BRANCH','分支名无效');check(['commit','pr'].includes(b.mode),422,'INVALID_MODE','同步模式无效');
    await pool.query('INSERT INTO github_targets VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(skill_id) DO UPDATE SET connection_id=$2,repo_id=$3,owner=$4,repo=$5,branch=$6,mode=$7',[s.id,c.id,repo.id,repo.owner,repo.name,branch,b.mode]);return {saved:true};
  });
  app.get('/skills/:id/github-target',async r=>{await ownedSkill(params(r).id,uid(r));return(await pool.query('SELECT * FROM github_targets WHERE skill_id=$1',[params(r).id])).rows[0]||null;});
  app.delete('/skills/:id/github-target',async r=>{await ownedSkill(params(r).id,uid(r));await pool.query('DELETE FROM github_targets WHERE skill_id=$1',[params(r).id]);return {deleted:true};});
  app.get('/sync-jobs',async r=>(await pool.query("SELECT id,status,attempts,last_error,result,created_at,payload->>'skill_id' AS skill_id FROM jobs WHERE user_id=$1 AND type='github' ORDER BY created_at DESC LIMIT 100",[uid(r)])).rows);
  app.get('/sync-jobs/:id',async r=>{const j=(await pool.query("SELECT id,status,attempts,last_error,result FROM jobs WHERE id=$1 AND user_id=$2 AND type='github'",[id(params(r).id),uid(r)])).rows[0];check(j,404,'NOT_FOUND','任务不存在');return j;});
  app.post('/sync-jobs/:id/retry',async r=>{const j=await pool.query("UPDATE jobs SET status='queued',attempts=0,run_after=now(),last_error=NULL WHERE id=$1 AND user_id=$2 AND type='github' AND status='failed' RETURNING id",[id(params(r).id),uid(r)]);check(j.rowCount,409,'NOT_RETRYABLE','仅失败任务可以重试');return {queued:true};});
}
async function authorizeGithub(job:any){
  enabled();const t=job.payload.target,c=await connection(job.user_id,t.connection_id);const repo=(await repositories(c)).find(x=>x.id===Number(t.repo_id));check(repo,403,'REPO_FORBIDDEN','仓库授权已撤销，请重新绑定');
  return {repo,api:installationClient(Number(c.installation_id))};
}
export async function syncGithub(job:any,authorize:typeof authorizeGithub=authorizeGithub){
  const {repo,api}=await authorize(job);const t=job.payload.target;
  const skill=await ownedSkill(job.payload.skill_id,job.user_id);check(skill.status==='published'&&skill.publication.github,409,'PUBLICATION_REVOKED','已下架或已撤销 GitHub 分发授权');
  const ownerState=(await pool.query('SELECT status FROM users WHERE id=$1',[job.user_id])).rows[0];check(ownerState?.status==='active',403,'ACCOUNT_DISABLED','账号已停用');
  const owner=repo.owner,repoName=repo.name;
  const content=job.payload.content,dir=`skills/${job.user_id}/${skill.id}/${content.version}/${content.slug}`;
  const marker=`DreamFly publication ${job.id}`;
  const branch=t.mode==='pr'?`dreamfly/${job.id}`:t.branch;
  const lock=await pool.connect();await lock.query('SELECT pg_advisory_lock(hashtext($1))',[`${t.repo_id}:${t.branch}`]);
  try{
    let head:any;
    try{head=(await api.git.getRef({owner,repo:repoName,ref:`heads/${branch}`})).data.object.sha;}
    catch(e:any){
      if(e.status!==404&&e.status!==409)throw e;
      if(t.mode==='pr'){
        const base=(await api.git.getRef({owner,repo:repoName,ref:`heads/${t.branch}`})).data.object.sha;
        try{head=(await api.git.createRef({owner,repo:repoName,ref:`refs/heads/${branch}`,sha:base})).data.object.sha;}catch(err:any){if(err.status!==422)throw err;head=(await api.git.getRef({owner,repo:repoName,ref:`heads/${branch}`})).data.object.sha;}
      }else{
        const branches=(await api.repos.listBranches({owner,repo:repoName})).data;check(branches.length===0,422,'BRANCH_NOT_FOUND','目标分支不存在');
        const initial=await api.repos.createOrUpdateFileContents({owner,repo:repoName,path:'README.md',message:'Initialize DreamFly content repository',content:Buffer.from('# Mind Skills\n').toString('base64'),branch:t.branch});head=initial.data.commit.sha;
      }
    }
    const previous=await api.repos.listCommits({owner,repo:repoName,sha:branch,path:`${dir}/mind.json`,per_page:100});
    let commit=previous.data.find(x=>x.commit.message===marker);
    if(!commit){
      const files=await exportFiles(content);const entries=[];
      for(const [name,data]of files){const blob=await api.git.createBlob({owner,repo:repoName,content:data.toString('base64'),encoding:'base64'});entries.push({path:`${dir}/${name}`,mode:'100644' as const,type:'blob' as const,sha:blob.data.sha});}
      for(let attempt=0;attempt<3;attempt++){
        const parent=await api.git.getCommit({owner,repo:repoName,commit_sha:head});const tree=await api.git.createTree({owner,repo:repoName,base_tree:parent.data.tree.sha,tree:entries});
        const created=await api.git.createCommit({owner,repo:repoName,message:marker,tree:tree.data.sha,parents:[head]});
        try{await api.git.updateRef({owner,repo:repoName,ref:`heads/${branch}`,sha:created.data.sha,force:false});commit={sha:created.data.sha,html_url:created.data.html_url} as any;break;}
        catch(e:any){if(e.status!==422||attempt===2)throw e;head=(await api.git.getRef({owner,repo:repoName,ref:`heads/${branch}`})).data.object.sha;}
      }
    }
    check(commit,502,'GITHUB_COMMIT_FAILED','无法创建提交');
    if(t.mode==='pr'){
      const existing=(await api.pulls.list({owner,repo:repoName,head:`${owner}:${branch}`,state:'all'})).data[0];
      const pr=existing||(await api.pulls.create({owner,repo:repoName,head:branch,base:t.branch,title:`发布 ${content.name} ${content.version}`,body:`由 DreamFly 发布。\n\n${marker}`})).data;
      return {status:pr.merged_at?'succeeded':pr.state==='closed'?'closed':'awaiting_merge',commit_url:commit.html_url,pr_url:pr.html_url,pr_number:pr.number};
    }
    return {status:'succeeded',commit_url:commit.html_url};
  }finally{await lock.query('SELECT pg_advisory_unlock(hashtext($1))',[`${t.repo_id}:${t.branch}`]);lock.release();}
}
export async function githubWebhook(raw:Buffer,signature:string){
  const expected=`sha256=${createHmac('sha256',secret('GITHUB_WEBHOOK_SECRET',true)).update(raw).digest('hex')}`;check(equal(signature,expected),403,'INVALID_SIGNATURE','签名无效');
  const data=JSON.parse(raw.toString('utf8'));
  if(data.action==='deleted'||data.action==='suspend')await pool.query('UPDATE github_connections SET active=false WHERE installation_id=$1',[data.installation?.id||0]);
  if(data.pull_request){const pr=data.pull_request;await pool.query("UPDATE jobs SET status=$1,result=result||$2::jsonb WHERE type='github' AND status='awaiting_merge' AND result->>'pr_url'=$3",[pr.merged?'succeeded':pr.state==='closed'?'closed':'awaiting_merge',{status:pr.merged?'succeeded':pr.state==='closed'?'closed':'awaiting_merge'},pr.html_url]);}
  return {received:true};
}
