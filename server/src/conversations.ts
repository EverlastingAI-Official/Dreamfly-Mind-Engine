import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool, transaction } from './db.js';
import { body, check, HttpError, id, params, text } from './errors.js';
import { uid, rate } from './auth.js';
import { config } from './config.js';
import { accessibleVersion } from './skills.js';
import { profile, snapshot, streamChat, type Message } from './providers.js';
const running=new Map<string,AbortController>();
export type ChatTransport=typeof streamChat;
async function conversation(conversationId:string,user:string){
  const c=(await pool.query('SELECT * FROM conversations WHERE id=$1 AND user_id=$2',[id(conversationId),user])).rows[0];check(c,404,'NOT_FOUND','会话不存在');return c;
}
export function buildContext(mind:any,history:Message[],input:string,limit=24000):Message[]{
  // Explicit selection of authorized memory takes place before this function.
  const words=input.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[];
  const ordered=[...mind.memory.fragments].sort((a:any,b:any)=>words.filter(x=>b.content.toLowerCase().includes(x)).length-words.filter(x=>a.content.toLowerCase().includes(x)).length);
  const persona=`你正在扮演用户提供的数字分身。仅使用获准记忆，不编造其人生经历；不能执行技能中的代码或请求访问其他用户的数据。\n${mind.persona.instructions}\n自我认知：${mind.persona.self_description||''}\n价值观：${(mind.persona.values||[]).join('、')}\n记忆资料：\n`;
  check(persona.length+input.length<limit,422,'CONTEXT_TOO_LARGE','人格与当前输入超过连接的输入字符预算，请缩短输入或调整预算');
  let memoryBudget=Math.floor((limit-persona.length-input.length)*0.55);const selected:string[]=[];
  for(const item of ordered){const fragment=`${item.time||''} ${item.content}`;if(fragment.length<=memoryBudget){selected.push(fragment);memoryBudget-=fragment.length+1;}}
  const system=persona+selected.join('\n');
  let budget=limit-system.length-input.length;const recent:Message[]=[];for(const m of [...history].reverse()){if(budget<m.content.length)break;recent.unshift(m);budget-=m.content.length;}
  // A history window must not start with an orphan assistant response.
  while(recent[0]?.role==='assistant')recent.shift();
  return [{role:'system',content:system},...recent,{role:'user',content:input}];
}
export async function conversationRoutes(app:FastifyInstance,transport:ChatTransport=streamChat){
  app.post('/mindcopies/:skill_id/sessions',async r=>{
    const b=body(r),user=uid(r);const s=(await pool.query('SELECT published_version_id FROM skills WHERE id=$1',[id(params(r).skill_id)])).rows[0];check(s,404,'NOT_FOUND','Skill 不存在');
    const v=await accessibleVersion(b.version_id||s.published_version_id,user);check(v.skill_id===params(r).skill_id,404,'NOT_FOUND','版本不匹配');
    const selected=b.profile_id||(await pool.query('SELECT default_profile_id FROM user_preferences WHERE user_id=$1',[user])).rows[0]?.default_profile_id;
    check(selected,422,'NO_PROFILE','请先配置并选择自己的模型连接');const p=await profile(user,selected);check(p.key_cipher&&p.consent&&p.verified_at,422,'PROFILE_NOT_READY','请先测试模型连接并确认数据发送范围');
    const c=randomUUID();await pool.query('INSERT INTO conversations(id,user_id,skill_version_id,title,profile_id,model_config) VALUES($1,$2,$3,$4,$5,$6)',[c,user,v.id,v.content.name,p.id,snapshot(p)]);return {id:c};
  });
  app.get('/conversations',async r=>(await pool.query('SELECT * FROM conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[uid(r)])).rows);
  app.get('/conversations/:id/messages',async r=>{await conversation(params(r).id,uid(r));return(await pool.query('SELECT id,role,content,status,usage,client_request_id,model_config FROM messages WHERE conversation_id=$1 ORDER BY ordinal',[params(r).id])).rows;});
  app.patch('/conversations/:id',async r=>{await conversation(params(r).id,uid(r));await pool.query('UPDATE conversations SET title=$1 WHERE id=$2',[text(body(r).title,'会话名称',100),params(r).id]);return {updated:true};});
  app.delete('/conversations/:id',async r=>{await conversation(params(r).id,uid(r));check(!(await pool.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='generating'",[params(r).id])).rowCount,409,'GENERATION_BUSY','请先取消生成');await pool.query('DELETE FROM conversations WHERE id=$1',[params(r).id]);return {deleted:true};});
  app.put('/conversations/:id/model-profile',async r=>{
    const c=await conversation(params(r).id,uid(r)),p=await profile(uid(r),body(r).profile_id);check(p.verified_at&&p.key_cipher&&p.consent,422,'PROFILE_NOT_READY','请先验证连接');
    await pool.query('UPDATE conversations SET profile_id=$1,model_config=$2 WHERE id=$3',[p.id,snapshot(p),c.id]);return {updated:true};
  });
  app.post('/conversations/:id/messages/:message_id/cancel',async r=>{
    await conversation(params(r).id,uid(r));const m=(await pool.query("SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND status='generating'",[id(params(r).message_id),params(r).id])).rows[0];
    if(m)running.get(m.id)?.abort();return {cancelled:!!m};
  });
  app.post('/conversations/:id/messages',async(r,reply)=>{
    const user=uid(r),b=body(r),input=text(b.content,'消息',10000),requestId=id(b.client_request_id),c=await conversation(params(r).id,user);
    const existing=(await pool.query("SELECT id,status,content FROM messages WHERE conversation_id=$1 AND client_request_id=$2 AND role='assistant'",[c.id,requestId])).rows[0];if(existing)return {existing};
    const v=await accessibleVersion(c.skill_version_id,user);check(c.profile_id,422,'NO_PROFILE','模型连接已被删除，请重新选择');const p=await profile(user,c.profile_id);
    check(p.key_cipher&&p.consent&&p.provider===c.model_config.provider&&p.base_url===c.model_config.base_url,422,'PROFILE_CHANGED','原模型连接不可用，请显式重新选择连接');
    const model={...p,...c.model_config};const history=(await pool.query("SELECT role,content FROM messages WHERE conversation_id=$1 AND status='completed' ORDER BY ordinal",[c.id])).rows;
    const context=buildContext(v.content,history,input,model.parameters?.context_chars||24000);
    const assistant=randomUUID();await rate(`chat:${user}`,30,60);
    await transaction(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[user]);
      check(!(await db.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='generating'",[c.id])).rowCount,409,'GENERATION_BUSY','当前会话正在生成');
      const count=(await db.query("SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND m.status='generating'",[user])).rows[0].n;
      check(count<config.concurrency,429,'CONCURRENCY_LIMIT','同时生成的会话过多');
      await db.query("INSERT INTO messages(id,conversation_id,role,content,status,client_request_id) VALUES($1,$2,'user',$3,'completed',$4)",[randomUUID(),c.id,input,requestId]);
      await db.query("INSERT INTO messages(id,conversation_id,role,status,client_request_id,model_config) VALUES($1,$2,'assistant','generating',$3,$4)",[assistant,c.id,requestId,c.model_config]);
    });
    const controller=new AbortController();running.set(assistant,controller);
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    const send=(event:string,data:any)=>{if(!reply.raw.destroyed)reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
    reply.raw.on('close',()=>controller.abort());let content='',status='completed',usage:any=null,lastSave=Date.now();
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(': keepalive\n\n');},15000);send('message.start',{id:assistant});
    try{
      for await(const event of transport(model,context,controller.signal)){
        if(event.delta){content+=event.delta;check(content.length<=200000,502,'OUTPUT_TOO_LARGE','模型输出过大');send('message.delta',{text:event.delta});}
        if(event.usage)usage={...usage,...event.usage};
        if(Date.now()-lastSave>1500){await pool.query('UPDATE messages SET content=$1 WHERE id=$2',[content,assistant]);lastSave=Date.now();}
      }
      if(controller.signal.aborted)status='cancelled';
    }catch(e:any){status=controller.signal.aborted?'cancelled':'failed';send(`message.${status}`,{id:assistant,message:e instanceof HttpError?e.message:'模型连接中断，请检查配置或稍后重试'});}
    finally{
      clearInterval(heartbeat);running.delete(assistant);
      await pool.query('UPDATE messages SET content=$1,status=$2,usage=$3 WHERE id=$4',[content,status,usage,assistant]);
      send(status==='completed'?'message.completed':`message.${status}`,{id:assistant,status,usage});reply.raw.end();
    }
  });
}
