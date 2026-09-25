import { SMTPServer } from 'smtp-server';
import { createServer } from 'node:http';
if(process.env.NODE_ENV==='production')throw new Error('Development mailbox cannot run in production');
const mails:{to:string[];received_at:string;source:string}[]=[];
const smtp=new SMTPServer({disabledCommands:['AUTH','STARTTLS'],authOptional:true,banner:'DreamFly local development mailbox',
  onData(stream,session,callback){let text='',size=0;stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<1024*1024)text+=chunk.toString('utf8');});stream.on('end',()=>{
    if(size>=1024*1024)return callback(new Error('Message too large'));
    const split=text.indexOf('\r\n\r\n');
    const content=/Content-Transfer-Encoding: base64/i.test(text.slice(0,split))?Buffer.from(text.slice(split+4).trim(),'base64').toString('utf8'):text;
    mails.unshift({to:session.envelope.rcptTo.map(x=>x.address),received_at:new Date().toISOString(),source:content});mails.splice(100);callback();
  });stream.on('error',callback);}
});
smtp.listen(Number(process.env.DEV_SMTP_PORT||1025),'127.0.0.1');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DreamFly 本地收件箱</title><style>body{max-width:1000px;margin:40px auto;font:15px system-ui;background:#f4f5f0;color:#20372f}article{background:white;padding:20px;margin:20px 0;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px}small{color:#788776}</style><h1>本地开发收件箱</h1><p>仅捕获本机邮件，不向真实邮箱投递；重启后清空。</p><button id="refresh">刷新</button><main></main><script>async function load(){const messages=await(await fetch('/messages')).json();const main=document.querySelector('main');main.replaceChildren();for(const m of messages){const a=document.createElement('article');const h=document.createElement('h3');h.textContent=m.to.join(', ');const p=document.createElement('pre');p.textContent=m.source;a.append(h,p);main.append(a)}}document.querySelector('button').onclick=load;load()</script></html>`;
const web=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.url==='/messages'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mails));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
web.listen(Number(process.env.DEV_MAIL_UI_PORT||8025),'127.0.0.1',()=>console.log('Local mailbox: http://127.0.0.1:8025 (SMTP 127.0.0.1:1025)'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{smtp.close();web.close();});
