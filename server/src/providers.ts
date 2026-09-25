import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { uid, rate } from './auth.js';
import { body, check, HttpError, id, params, text } from './errors.js';
import { encrypt, decrypt } from './crypto.js';
import { config } from './config.js';

export const providers = [
  {id:'openai',name:'OpenAI',protocol:'openai-chat',base_url:'https://api.openai.com/v1'},
  {id:'deepseek',name:'DeepSeek',protocol:'openai-chat',base_url:'https://api.deepseek.com/v1'},
  {id:'openrouter',name:'OpenRouter',protocol:'openai-chat',base_url:'https://openrouter.ai/api/v1'},
  {id:'siliconflow',name:'SiliconFlow',protocol:'openai-chat',base_url:'https://api.siliconflow.cn/v1'},
  {id:'anthropic',name:'Anthropic',protocol:'anthropic-messages',base_url:'https://api.anthropic.com'},
  {id:'gemini',name:'Google Gemini',protocol:'gemini-generate-content',base_url:'https://generativelanguage.googleapis.com/v1beta'},
  {id:'custom',name:'自定义 HTTPS 服务',protocol:'openai-chat',base_url:''}
];
export function publicAddress(address:string){
  try {let a=ipaddr.parse(address);if(a.kind()==='ipv6'&&(a as ipaddr.IPv6).isIPv4MappedAddress())a=(a as ipaddr.IPv6).toIPv4Address();return a.range()==='unicast';}catch{return false;}
}
export async function checkedURL(raw:string){
  const url=new URL(raw);check(url.protocol==='https:' && !url.username && !url.password && (!url.port||url.port==='443') && !url.hash,422,'UNSAFE_ENDPOINT','仅支持公开 HTTPS 地址和 443 端口');
  const addresses=await dns.lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  check(addresses.length && addresses.every(x=>publicAddress(x.address)),422,'UNSAFE_ENDPOINT','不能访问回环、私有或保留网络');return {url,addresses};
}
export async function upstream(raw:string,method:string,headers:Record<string,string>,data:unknown,signal?:AbortSignal,timeout=120000){
  const {url,addresses}=await checkedURL(raw);
  return new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{
    // Bind the connection to the addresses just validated, while preserving hostname/SNI.
    const lookup:any=(_host:string,options:any,cb:any)=>options.all?cb(null,addresses):cb(null,addresses[0].address,addresses[0].family);
    const req=https.request(url,{method,headers,lookup,signal},res=>{
      if((res.statusCode||500)>=300){res.resume();reject(new HttpError(502,`UPSTREAM_${res.statusCode}`,res.statusCode===401||res.statusCode===403?'模型凭据无效或无权限':res.statusCode===429?'模型服务限流，请稍后重试':`模型服务返回 ${res.statusCode}`));}
      else resolve(res);
    });
    const timer=setTimeout(()=>req.destroy(new Error('模型请求超时')),timeout);req.on('close',()=>clearTimeout(timer));req.on('error',reject);
    if(data!==undefined)req.write(JSON.stringify(data));req.end();
  });
}
export async function responseJSON(res:AsyncIterable<Buffer>){
  const chunks:Buffer[]=[];let size=0;for await(const c of res){size+=c.length;check(size<8*1024*1024,502,'UPSTREAM_TOO_LARGE','上游响应过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function* sseEvents(stream:AsyncIterable<Uint8Array>):AsyncGenerator<any>{
  const decoder=new TextDecoder();let buffer='';
  for await(const chunk of stream){buffer+=decoder.decode(chunk,{stream:true});check(buffer.length<2*1024*1024,502,'INVALID_STREAM','流事件过大');
    let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=block.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]')yield JSON.parse(data);}
  }
  buffer+=decoder.decode();check(!buffer.trim()||buffer.trim().startsWith(':'),502,'INCOMPLETE_STREAM','模型流未完整结束');
}
export type Message={role:string;content:string};
export function requestConfig(p:any,messages:Message[],stream=true){
  const system=messages.filter(x=>x.role==='system').map(x=>x.content).join('\n');const conversation=messages.filter(x=>x.role!=='system');
  const max_tokens=p.parameters?.max_tokens||1024;const headers:Record<string,string>={'Content-Type':'application/json'};
  const key=decrypt(p.key_cipher,`${p.user_id}:${p.id}`);let url=p.base_url;let data:any;
  if(p.protocol==='anthropic-messages'){
    headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';url+='/v1/messages';data={model:p.model,system,messages:conversation,max_tokens,stream};
  }else if(p.protocol==='gemini-generate-content'){
    headers['x-goog-api-key']=key;url+=`/models/${encodeURIComponent(p.model)}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`;
    data={systemInstruction:{parts:[{text:system}]},contents:conversation.map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]})),generationConfig:{maxOutputTokens:max_tokens}};
  }else{headers.Authorization=`Bearer ${key}`;url+='/chat/completions';data={model:p.model,messages,max_tokens,stream};if(stream)data.stream_options={include_usage:true};}
  if(p.parameters?.temperature!==undefined){if(p.protocol==='gemini-generate-content')data.generationConfig.temperature=p.parameters.temperature;else data.temperature=p.parameters.temperature;}
  return {url,headers,data};
}
export async function* streamChat(p:any,messages:Message[],signal:AbortSignal){
  const req=requestConfig(p,messages);const response=await upstream(req.url,'POST',req.headers,req.data,signal,(p.parameters?.timeout_seconds||120)*1000);
  let content=false,terminal=false;
  for await(const e of sseEvents(response)){
    if(e.error||e.type==='error')throw new HttpError(502,'MODEL_ERROR','模型生成失败');
    let delta:string|undefined;let usage:any;
    if(p.protocol==='anthropic-messages'){
      if(e.type==='content_block_delta'&&e.delta?.type==='text_delta')delta=e.delta.text;
      usage=e.usage||e.message?.usage;if(e.type==='message_stop')terminal=true;
    }else if(p.protocol==='gemini-generate-content'){
      delta=e.candidates?.[0]?.content?.parts?.filter((x:any)=>!x.thought).map((x:any)=>x.text||'').join('');usage=e.usageMetadata;if(e.candidates?.[0]?.finishReason)terminal=true;
    }else{delta=e.choices?.[0]?.delta?.content;usage=e.usage;if(e.choices?.[0]?.finish_reason)terminal=true;}
    if(typeof delta==='string'&&delta){content=true;yield {delta};}if(usage)yield {usage};
  }
  check(content&&terminal,502,'INCOMPLETE_STREAM','模型未返回完整文本结果');
}
export async function profile(user:string,profileId:string){
  const p=(await pool.query('SELECT * FROM model_profiles WHERE id=$1 AND user_id=$2',[id(profileId),user])).rows[0];check(p,404,'NOT_FOUND','未找到模型配置');return p;
}
const view=(p:any)=>({id:p.id,name:p.name,provider:p.provider,protocol:p.protocol,base_url:p.base_url,model:p.model,parameters:p.parameters,consent:p.consent,verified_at:p.verified_at,api_key_configured:!!p.key_cipher});
export function snapshot(p:any){return {provider:p.provider,protocol:p.protocol,base_url:p.base_url,model:p.model,parameters:p.parameters};}
export async function providerRoutes(app:FastifyInstance){
  app.get('/model-providers',async()=>providers);
  app.get('/model-profiles',async r=>({profiles:(await pool.query('SELECT * FROM model_profiles WHERE user_id=$1 ORDER BY created_at',[uid(r)])).rows.map(view),default_profile_id:(await pool.query('SELECT default_profile_id FROM user_preferences WHERE user_id=$1',[uid(r)])).rows[0]?.default_profile_id||null}));
  async function save(r:any,existing?:any){
    const b=body(r),user=uid(r),profileId=existing?.id||randomUUID();const preset=providers.find(x=>x.id===b.provider);check(preset,422,'INVALID_PROVIDER','未知厂商');
    const protocol=preset.id==='custom'?b.protocol:preset.protocol;check(['openai-chat','anthropic-messages','gemini-generate-content'].includes(protocol),422,'INVALID_PROTOCOL','不支持的协议');
    const base=preset.id==='custom'?text(b.base_url,'API 地址',500).replace(/\/$/,''):preset.base_url;
    if(preset.id==='custom')await checkedURL(base);
    const values=b.parameters||{};const timeout=Number(values.timeout_seconds||config.modelTimeout),max=Number(values.max_tokens||1024),context=Number(values.context_chars||24000);
    check(Number.isFinite(timeout)&&timeout>=10&&timeout<=600&&Number.isInteger(max)&&max>=16&&max<=16384,422,'INVALID_PARAMETERS','超时 10–600 秒，输出上限 16–16384');
    check(Number.isInteger(context)&&context>=4000&&context<=200000,422,'INVALID_PARAMETERS','输入字符预算须为 4000–200000');
    const parameters:any={timeout_seconds:timeout,max_tokens:max,context_chars:context};if(values.temperature!==undefined){check(Number.isFinite(Number(values.temperature))&&Number(values.temperature)>=0&&Number(values.temperature)<=2,422,'INVALID_PARAMETERS','temperature 须为 0–2');parameters.temperature=Number(values.temperature);}
    let cipher=existing?.key_cipher;const changed=existing&&(existing.base_url!==base||existing.provider!==b.provider);if(changed)cipher=null;
    const action=b.api_key_action||'keep';check(['keep','replace','clear'].includes(action),422,'INVALID_KEY_ACTION','无效的密钥操作');
    if(action==='clear')cipher=null;if(action==='replace')cipher=encrypt(text(b.api_key,'API Key',4096),`${user}:${profileId}`);
    const name=text(b.name,'连接名称',100),model=text(b.model,'模型 ID',200);const consent=b.consent===true;
    if(existing)await pool.query('UPDATE model_profiles SET name=$1,provider=$2,protocol=$3,base_url=$4,model=$5,parameters=$6,key_cipher=$7,consent=$8,verified_at=NULL WHERE id=$9 AND user_id=$10',[name,b.provider,protocol,base,model,parameters,cipher,consent,profileId,user]);
    else await pool.query('INSERT INTO model_profiles(id,user_id,name,provider,protocol,base_url,model,parameters,key_cipher,consent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[profileId,user,name,b.provider,protocol,base,model,parameters,cipher,consent]);
    return view(await profile(user,profileId));
  }
  app.post('/model-profiles',r=>save(r));app.patch('/model-profiles/:id',async r=>save(r,await profile(uid(r),params(r).id)));
  app.delete('/model-profiles/:id',async r=>{await profile(uid(r),params(r).id);await pool.query('DELETE FROM model_profiles WHERE id=$1 AND user_id=$2',[params(r).id,uid(r)]);return {deleted:true};});
  app.put('/users/me/default-model-profile',async r=>{const p=await profile(uid(r),body(r).profile_id);check(p.key_cipher&&p.consent&&p.verified_at,422,'UNVERIFIED_PROFILE','请先确认数据发送范围并测试连接');await pool.query('INSERT INTO user_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET default_profile_id=$2',[uid(r),p.id]);return {profile_id:p.id};});
  app.post('/model-profiles/:id/test',async r=>{
    await rate(`model-test:${uid(r)}`,10,60);const p=await profile(uid(r),params(r).id);check(p.key_cipher&&p.consent,422,'PROFILE_NOT_READY','请输入密钥并确认发送文本至该厂商');
    let count=0;for await(const e of streamChat({...p,parameters:{...p.parameters,max_tokens:32}},[{role:'user',content:'Reply with OK.'}],new AbortController().signal))if(e.delta)count+=e.delta.length;
    check(count,502,'NO_TEXT','未返回文本');await pool.query('UPDATE model_profiles SET verified_at=now() WHERE id=$1',[p.id]);return {verified:true};
  });
  app.post('/model-profiles/:id/models',async r=>{
    await rate(`model-list:${uid(r)}`,10,60);const p=await profile(uid(r),params(r).id);check(p.key_cipher,422,'NO_KEY','请输入 API Key');
    const req=requestConfig(p,[]);const payload=await responseJSON(await upstream(`${p.base_url}${p.protocol==='anthropic-messages'?'/v1':''}/models`,'GET',req.headers,undefined,undefined,30000));
    return (payload.data||payload.models||[]).slice(0,2000).map((x:any)=>({id:String(x.id||x.name).replace(/^models\//,''),name:x.displayName||x.name||x.id}));
  });
}
