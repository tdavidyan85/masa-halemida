const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1000,height:850}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const sent=[];await p.route('**/rest/v1/usage_events',r=>{sent.push(JSON.parse(r.request().postData()));r.fulfill({status:201,body:''})});
for(const f of ['math','english']){await p.route('https://masa.test/'+f+'/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync('deploy/'+(f=='math'?'index':'english')+'.min.html')}));}
await p.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});if(!localStorage.getItem('mj-state'))localStorage.setItem('mj-state',JSON.stringify({stars:3,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',rate2:1},tour:{home:1,q:1}}))});
await p.goto('https://masa.test/math/?k=5b-pilot');await p.waitForTimeout(500);
await p.evaluate(()=>startSession('gen',TOPICS[0]&&TOPIC_GENS[TOPICS[0].id][0]));await p.waitForTimeout(300);
// answer right then wrong via the engine
await p.evaluate(()=>{const pt=SS.q.parts[SS.part];answer(pt.answer)});await p.waitForTimeout(1500);
await p.evaluate(()=>{for(let k=0;k<20&&SS.q;k++){const pt=SS.q.parts[SS.part];SS.locked=false;answer(pt.answer)}});await p.waitForTimeout(1500);
await p.evaluate(()=>{SS.results=[true,false,true];summary()});await p.waitForTimeout(300);await p.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
await p.goto('https://masa.test/english/');await p.waitForTimeout(500);
console.log(sent.length, JSON.stringify(sent.slice(0,3)), JSON.stringify(sent.slice(-2)));
console.log('kinds',[...new Set(sent.map(x=>x.kind))],'cls',[...new Set(sent.map(x=>x.cls))],'devs',new Set(sent.map(x=>x.dev)).size);
console.log('name leaked?',JSON.stringify(sent).includes('לביא'));
// opt-out
await p.evaluate(()=>{ST.settings.noStats=true;save()});const n=sent.length;await p.reload();await p.waitForTimeout(400);console.log('after opt-out new events',sent.length-n);
console.log(errs);await b.close()})();
