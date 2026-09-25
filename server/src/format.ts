import { Ajv } from 'ajv';
import YAML from 'yaml';
import yauzl from 'yauzl';
import yazl from 'yazl';
// Shared portable schema and migration functions are also consumed by the H5 editor.
// @ts-ignore JavaScript package has no build step.
import { mindSchema, parseMind, emptyMind, skillMarkdown } from '../../packages/mind-format/index.js';
import { check, HttpError } from './errors.js';
import { config } from './config.js';
export { parseMind, emptyMind, skillMarkdown };
const validate=new Ajv({allErrors:true}).compile(mindSchema);
export function validateMind(mind:any) {
  if(!validate(mind)) throw new HttpError(422,'INVALID_SKILL','Skill 格式不正确',validate.errors);
  check(new Set(mind.memory.fragments.map((x:any)=>x.id)).size===mind.memory.fragments.length,422,'DUPLICATE_MEMORY','记忆 ID 不可重复');
  for(const value of Object.values(mind.assets)) check(typeof value==='string' && /^assets\/[a-zA-Z0-9._-]+$/.test(value),422,'INVALID_ASSET_PATH','素材必须引用 assets/ 下的文件');
  return mind;
}
export async function unzip(buffer:Buffer):Promise<Map<string,Buffer>> {
  return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(err,zip)=>{
    if(err||!zip)return reject(new HttpError(422,'INVALID_ZIP','无法读取 ZIP'));
    const files=new Map<string,Buffer>();let total=0,count=0,failed=false;
    const fail=(e:unknown)=>{if(failed)return;failed=true;zip.close();reject(e);};
    zip.on('error',fail);zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>{
      try{
        const name=entry.fileName;const mode=(entry.externalFileAttributes>>>16)&0xf000;
        check(++count<=config.uploadFiles && !name.includes('\\') && !name.startsWith('/') && !name.split('/').some((x:string)=>x==='..'||x==='.') && !name.includes(':') && mode!==0xa000 && !(entry.generalPurposeBitFlag&1),422,'UNSAFE_ZIP','ZIP 包含不支持的路径/文件或文件过多');
        if(name.endsWith('/')){zip.readEntry();return;}
        check(!files.has(name) && entry.uncompressedSize<=config.extracted,422,'UNSAFE_ZIP','ZIP 文件重复或过大');
        zip.openReadStream(entry,(error,stream)=>{
          if(error||!stream)return fail(error);const chunks:Buffer[]=[];
          stream.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>config.extracted){stream.destroy();fail(new HttpError(413,'ZIP_TOO_LARGE','ZIP 解压内容过大'));}else chunks.push(chunk);});
          stream.on('error',fail);stream.on('end',()=>{if(!failed){files.set(name,Buffer.concat(chunks));zip.readEntry();}});
        });
      }catch(e){fail(e);}
    });zip.readEntry();
  }));
}
export async function importPackage(name:string, buffer:Buffer) {
  const files=name.endsWith('.zip')?await unzip(buffer):new Map([[name,buffer]]);
  const entries=[...files.keys()];const json=entries.find(x=>x.endsWith('/mind.json')||x==='mind.json'||/\.mind(?:\.js)?$/.test(x));
  const markdown=entries.find(x=>x==='SKILL.md'||x.endsWith('/SKILL.md'));
  let result:any;
  if(json)result=parseMind(files.get(json)!.toString('utf8'));
  if(markdown){
    const source=files.get(markdown)!.toString('utf8');const match=source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    check(match,422,'INVALID_SKILL_MD','SKILL.md 缺少 YAML frontmatter');
    const meta=YAML.parse(match[1],{maxAliasCount:0});check(meta && typeof meta.name==='string' && typeof meta.description==='string',422,'INVALID_SKILL_MD','SKILL.md 缺少名称或说明');
    const instructions=match[2].split('<!-- dreamfly:details -->')[0].trim();
    if(result) check(result.mind.slug===meta.name && result.mind.persona.instructions.trim()===instructions,409,'PERSONA_CONFLICT','mind.json 与 SKILL.md 人格不一致，请修改后重新上传');
    else result={mind:{...emptyMind(meta.name),description:meta.description,persona:{instructions}},warnings:[]};
  }
  check(result,422,'NO_SKILL','未找到 mind.json、.mind 或 SKILL.md');validateMind(result.mind);
  return {...result,files,root:(json||markdown)!.includes('/')?(json||markdown)!.slice(0,(json||markdown)!.lastIndexOf('/')+1):''};
}
export async function zipFiles(files:Map<string,Buffer>):Promise<Buffer>{
  const zip=new yazl.ZipFile(); for(const [name,data]of files)zip.addBuffer(data,name);
  const chunks:Buffer[]=[]; const result=new Promise<Buffer>((resolve,reject)=>{zip.outputStream.on('data',c=>chunks.push(c));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject);});zip.end();return result;
}
