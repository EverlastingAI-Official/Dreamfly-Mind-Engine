import { mkdir,writeFile,readFile,access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
async function exists(file:string){try{await access(file);return true;}catch{return false;}}
await mkdir('../secrets',{recursive:true});
for(const name of ['postgres_password','email_code_secret','api_key_encryption_key']){
  const file=`../secrets/${name}.txt`;if(!await exists(file))await writeFile(file,randomBytes(32).toString('hex'),{flag:'wx'});
}
if(!await exists('.env'))await writeFile('.env',await readFile('.env.example','utf8'),{flag:'wx'});
console.log('Local configuration initialized; existing files were preserved. Configure PostgreSQL in server/.env before migrating.');
