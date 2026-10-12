import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin='http://127.0.0.1:3000';
let cookie='';
async function req(path,method='GET',body,auth=true){const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(auth&&cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {response,json:await response.json()};}
const session=await req('/api/session');assert.equal(session.json.storage,'local','Smoke tests only run against local storage.');
const noauth=await req('/api/events','POST',{name:'test'},false);assert.equal(noauth.response.status,401);
const login=await req('/api/session','POST',{password:process.env.ADMIN_PASSWORD??'local-bridge-admin-2026'});assert.equal(login.response.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];
for(const kind of ['teams','pairs']){
  const created=await req('/api/events','POST',{kind,name:`驗收測試 ${kind} ${Date.now()}`,date:'2026-10-12',venue:'Local automated test',names:['QA A','QA B','QA C','QA D'],rounds:1,boardsPerRound:1});
  assert.equal(created.response.status,201);const id=created.json.id;
  let data=(await req(`/api/events/${id}`)).json;
  assert.ok(data.boards.every(b=>!('deal' in b)));assert.ok(!('audit' in data));assert.equal(data.projection.received,0);
  const admin=await req(`/api/admin/events/${id}`);assert.equal(admin.response.headers.get('cache-control'),'no-store');assert.ok('audit' in admin.json);
  const requestId=randomUUID();const body={action:'results',revision:1,requestId,reason:'自動化整合驗收',results:data.assignments.map(a=>({assignmentId:a.id,board:1,level:3,strain:'NT',doubled:1,declarer:'N',tricks:9,lead:'SA'}))};
  const write=await req(`/api/events/${id}`,'PATCH',body);assert.equal(write.response.status,200);assert.equal(write.json.revision,2);
  const duplicate=await req(`/api/events/${id}`,'PATCH',body);assert.equal(duplicate.json.revision,2);
  const stale=await req(`/api/events/${id}`,'PATCH',{...body,requestId:randomUUID()});assert.equal(stale.response.status,409);
  const invalid=await req(`/api/events/${id}`,'PATCH',{...body,revision:2,requestId:randomUUID(),results:[{...body.results[0],tricks:14}]});assert.equal(invalid.response.status,400);
  data=(await req(`/api/events/${id}`)).json;assert.equal(data.projection.received,data.projection.expected);assert.equal(data.revision,2);
  const settings=await req(`/api/events/${id}`,'PATCH',{action:'settings',revision:2,requestId:randomUUID(),reason:'完成驗收',status:'finished',publishBoards:false});assert.equal(settings.response.status,200);
  const final=(await req(`/api/admin/events/${id}`)).json;assert.equal(final.status,'finished');assert.equal(final.audit.length,3);
  console.log(`${kind}: authentication, privacy, create, scores, persistence, deduplication, conflict, validation, finalization passed (${id})`);
}
const blocked=await fetch(origin+'/api/events',{method:'POST',headers:{Origin:'https://untrusted.example',Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
console.log('Cross-origin write protection passed. Test events retained in local data for inspection.');
