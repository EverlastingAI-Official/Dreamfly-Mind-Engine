import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import { randomUUID } from 'node:crypto';
import { auth } from './auth.js';
import { providerRoutes, type ModelListTransport } from './providers.js';
import { skillRoutes } from './skills.js';
import { conversationRoutes, type ChatTransport } from './conversations.js';
import { githubRoutes } from './github.js';
import { HttpError } from './errors.js';
import { config } from './config.js';
import { describeRoute } from './openapi.js';
export async function buildApp(options:{transport?:ChatTransport;modelListTransport?:ModelListTransport;logger?:boolean}={}){
  const app=Fastify({logger:options.logger??{level:process.env.LOG_LEVEL||'info',redact:['req.headers.cookie','req.headers.authorization','res.headers["set-cookie"]'],serializers:{req:(r:any)=>({method:r.method,url:r.url?.split('?')[0]})}},bodyLimit:config.uploadJSON+1024*1024,genReqId:()=>randomUUID()});
  await app.register(cookie);await app.register(multipart,{limits:{fileSize:config.uploadZIP,files:1,fields:5}});
  app.addHook('onRoute',describeRoute);
  await app.register(swagger,{openapi:{info:{title:'DreamFly API',version:'1.0.0'},components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:config.cookie}}}}});
  app.setErrorHandler((e:any,r,p)=>{
    const duplicate=e.code==='23505';const status=e instanceof HttpError?e.statusCode:duplicate?409:e instanceof SyntaxError?422:e.statusCode&&e.statusCode<500?e.statusCode:500;
    if(status>=500)r.log.error({code:e.code||'INTERNAL',request_id:r.id},'Request failed');
    return p.code(status).send({error:{code:duplicate?'ALREADY_EXISTS':e instanceof HttpError?e.code:status===500?'INTERNAL_ERROR':'INVALID_REQUEST',message:duplicate?'相同版本、名称或请求已存在':e instanceof HttpError?e.message:status===500?'服务暂时不可用，请检查运行状态':'请求格式无效',details:e instanceof HttpError?e.details:undefined},request_id:r.id});
  });
  app.addHook('preSerialization',async(r,p,value)=>{
    if(value&&typeof value==='object'&&!Buffer.isBuffer(value)&&!(value as any).error&&r.url!=='/api/v1/openapi.json')return {data:value,request_id:r.id};return value;
  });
  await app.register(async api=>{
    await auth(api);
    api.get('/health',{config:{public:true}},async()=>({status:'ok'}));
    api.get('/openapi.json',{config:{public:true}},async()=>app.swagger());
    await providerRoutes(api,options.modelListTransport);await skillRoutes(api);await conversationRoutes(api,options.transport);await githubRoutes(api);
  },{prefix:'/api/v1'});
  return app;
}
