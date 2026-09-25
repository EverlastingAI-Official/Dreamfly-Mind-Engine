import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels, providerProxyAddress, publicAddress } from '../src/providers.js';

test('unsaved model discovery authenticates without a model ID and requests chat models',async()=>{
  const models=await listModels({provider:'siliconflow',protocol:'openai-chat',base_url:'https://api.siliconflow.cn/v1'},'fixture-key',async(url,headers)=>{
    assert.equal(url,'https://api.siliconflow.cn/v1/models?sub_type=chat');
    assert.equal(headers.Authorization,'Bearer fixture-key');
    return {data:[{id:'vendor/chat-model'}]};
  });
  assert.deepEqual(models,[{id:'vendor/chat-model',name:'vendor/chat-model'}]);
});

test('Gemini discovery follows pagination and excludes models without generateContent',async()=>{
  const calls:string[]=[];
  const result=await listModels({provider:'gemini',protocol:'gemini-generate-content',base_url:'https://generativelanguage.googleapis.com/v1beta'},'fixture-key',async(url,headers)=>{
    calls.push(url);assert.equal(headers['x-goog-api-key'],'fixture-key');assert.equal(headers.Authorization,undefined);
    if(calls.length===1)return {models:[{name:'models/embedding',supportedGenerationMethods:['embedContent']}],nextPageToken:'next page'};
    assert.equal(new URL(url).searchParams.get('pageToken'),'next page');
    return {models:[{name:'models/text-model',displayName:'Text model',supportedGenerationMethods:['generateContent']}]};
  });
  assert.equal(calls.length,2);assert.deepEqual(result,[{id:'text-model',name:'Text model'}]);
});

test('Anthropic discovery preserves display names and follows the last ID cursor',async()=>{
  let calls=0;
  const result=await listModels({provider:'anthropic',protocol:'anthropic-messages',base_url:'https://api.anthropic.com'},'fixture-key',async(url,headers)=>{
    calls++;assert.equal(new URL(url).pathname,'/v1/models');assert.equal(headers['x-api-key'],'fixture-key');assert.equal(headers['anthropic-version'],'2023-06-01');
    if(calls===1)return {data:[{id:'model-a',display_name:'Model A'}],has_more:true,last_id:'model-a'};
    assert.equal(new URL(url).searchParams.get('after_id'),'model-a');
    return {data:[{id:'model-b',display_name:'Model B'}],has_more:false};
  });
  assert.deepEqual(result,[{id:'model-a',name:'Model A'},{id:'model-b',name:'Model B'}]);
});

test('Fake-IP works only for fixed vendor HTTPS endpoints, not arbitrary or private destinations',()=>{
  assert.equal(publicAddress('198.18.0.161'),false);
  assert.equal(providerProxyAddress('https://api.deepseek.com/v1/models','198.18.0.161'),true);
  for(const url of ['https://attacker.test/v1/models','https://api.deepseek.com.attacker.test/v1/models','http://api.deepseek.com/v1/models','https://api.deepseek.com:8443/v1/models','https://api.deepseek.com/other']){
    assert.equal(providerProxyAddress(url,'198.18.0.161'),false,url);
  }
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1'])assert.equal(providerProxyAddress('https://api.deepseek.com/v1/models',address),false);
});
