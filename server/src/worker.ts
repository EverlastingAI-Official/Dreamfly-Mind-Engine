import nodemailer from 'nodemailer';
import { pool, transaction } from './db.js';
import { config, secret } from './config.js';
import { decrypt } from './crypto.js';
import { syncGithub } from './github.js';

export async function runOnce(){
  const job=await transaction(async db=>(await db.query(`WITH next AS (
    SELECT id FROM jobs WHERE (status='queued' AND run_after<=now()) OR (status='running' AND lease_until<now())
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE jobs SET status='running',attempts=attempts+1,lease_until=now()+$1*interval '1 second' FROM next WHERE jobs.id=next.id RETURNING jobs.*`,[config.lease])).rows[0]);
  if(!job)return false;
  const heartbeat=setInterval(()=>{void pool.query("UPDATE jobs SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND status='running' AND attempts=$2",[job.id,job.attempts,config.lease]).catch(()=>{});},config.lease*1000/4);
  try{
    let result:any;
    if(job.type==='email'){
      const c=(await pool.query('SELECT * FROM email_challenges WHERE id=$1 AND consumed_at IS NULL AND expires_at>now()',[job.payload.challenge_id])).rows[0];
      if(c){
        const transport=nodemailer.createTransport({host:process.env.SMTP_HOST||'127.0.0.1',port:Number(process.env.SMTP_PORT||1025),secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.SMTP_REQUIRE_TLS==='true',connectionTimeout:15000,socketTimeout:30000,...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:secret('SMTP_PASSWORD',true)}}:{})});
        await transport.sendMail({from:process.env.SMTP_FROM||'DreamFly <noreply@localhost.test>',to:c.email,subject:c.purpose==='register'?'DreamFly 注册验证码':'DreamFly 重置密码验证码',text:`您的验证码：${decrypt(job.payload.code,`email:${c.id}`)}\n请在有效期内使用。若非本人操作，请忽略。`,textEncoding:'base64'});transport.close();
      }
      result={status:'succeeded'};
    }else result=await syncGithub(job);
    await pool.query("UPDATE jobs SET status=$1,result=$2,last_error=NULL,lease_until=NULL,payload=CASE WHEN type='email' THEN jsonb_build_object('challenge_id',payload->>'challenge_id') ELSE payload END WHERE id=$3 AND attempts=$4",[result.status,result,job.id,job.attempts]);
  }catch(e:any){
    const permanent=[400,401,403,404,409,422].includes(e.status||e.statusCode);const exhausted=job.attempts>=5;
    const message=job.type==='email'?'邮件投递失败，请检查 SMTP 配置或重试':e.code?.startsWith?.('GITHUB')||e.statusCode?e.message:`GitHub 请求失败 (${e.status||'network'})，请检查授权或稍后重试`;
    await pool.query("UPDATE jobs SET status=$1,last_error=$2,lease_until=NULL,run_after=now()+$3*interval '1 second',payload=CASE WHEN type='email' AND $1='failed' THEN jsonb_build_object('challenge_id',payload->>'challenge_id') ELSE payload END WHERE id=$4 AND attempts=$5",[permanent||exhausted?'failed':'queued',message,Math.min(300,2**job.attempts*5),job.id,job.attempts]);
  }finally{clearInterval(heartbeat);}return true;
}
if(process.argv[1]?.endsWith('worker.ts')||process.argv[1]?.endsWith('worker.js')){
  let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
  while(!stopping){try{await runOnce();}catch{console.error('Worker database unavailable; retrying');}await new Promise(resolve=>setTimeout(resolve,Number(process.env.WORKER_POLL_INTERVAL_MS||1000)));}
  await pool.end();
}
