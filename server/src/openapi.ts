import type { RouteOptions } from 'fastify';
const string={type:'string'};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const profile=object({name:string,provider:string,protocol:string,base_url:string,model:string,api_key:string,api_key_action:{enum:['keep','replace','clear']},consent:{type:'boolean'},parameters:object({max_tokens:{type:'integer'},timeout_seconds:{type:'number'},temperature:{type:'number'},context_chars:{type:'integer'}}),id:string,verified_at:{anyOf:[string,{type:'null'}]},api_key_configured:{type:'boolean'}},['name','provider','model']);
const authFields={email:string,password:string,confirm:string,display_name:string,code:string,challenge_id:string};
const schemas:Record<string,unknown>={
  '/auth/email-codes':object({email:string,purpose:{enum:['register','reset_password']}},['email','purpose']),
  '/auth/register':object(authFields,['email','password','display_name','code','challenge_id']),
  '/auth/login':object(authFields,['email','password']),
  '/auth/reset-password':object(authFields,['email','password','code','challenge_id']),
  '/auth/change-password':object({old_password:string,password:string},['old_password','password']),
  '/model-profiles':profile,'/model-profiles/:id':profile,
  '/model-providers/:id/models':object({api_key:string,profile_id:string}),
  '/users/me/default-model-profile':object({profile_id:string},['profile_id']),
  '/conversations/:id/model-profile':object({profile_id:string},['profile_id']),
  '/skills/:id/publish':object({revision:{type:'integer'},request_id:string,listed:{type:'boolean'},chat:{type:'boolean'},download:{type:'boolean'},github:{type:'boolean'},memory_ids:{type:'array',items:string},asset_keys:{type:'array',items:string},compliance_confirmed:{type:'boolean'}},['revision','request_id']),
  '/skills/:id/submit':object({revision:{type:'integer'},request_id:string,content:{type:'object'},publication:{type:'object'},compliance_confirmed:{type:'boolean'}},['revision','request_id','content','publication','compliance_confirmed']),
  '/mindcopies/:skill_id/sessions':object({version_id:string,profile_id:string}),
  '/conversations/:id/messages':object({content:string,client_request_id:string},['content','client_request_id']),
  '/conversations/:id':object({title:string},['title']),
  '/admin/users/:id/status':object({status:{enum:['active','disabled']}},['status'])
};
export function describeRoute(route:RouteOptions){
  const path=route.url.replace(/^\/api\/v1/,'');const methods=Array.isArray(route.method)?route.method:[route.method];
  const canHaveBody=methods.some(x=>['POST','PUT','PATCH'].includes(x));
  route.schema={tags:[path.split('/')[1]||'system'],summary:`${methods.join('/')} ${path}`,security:route.config?.public||route.config?.webhook?[]:[{session:[]}],...route.schema,...(canHaveBody&&schemas[path]?{body:schemas[path] as any}:{})};
}
