// the photo-pack play page: approved pack plays, draft needs the token, bad id / missing pack show a friendly message, ids are namespaced.
// run from src/ after `npm run build`:  node tests/tpack.js
const {chromium}=require('playwright');const fs=require('fs');
const pack=JSON.parse(fs.readFileSync('packs/english-pronouns.json','utf8'));
// the model's typical ids: "t1"/"s1" -> make sure they get a per-pack prefix
const photo={schema:'masa-pack/1',subject:{id:'unit',name:'חשבון',grade:'ה',unit:'כפל'},cfg:{},
  topics:[{id:'t1',name:'כפל',glyph:'×',bg:'#cfe3ff',lessons:[{title:'כפל',text:'כופלים.'}],skills:[{id:'s1',name:'כפל בסיסי',pool:'p1',examQ:1}]}],
  pools:{p1:{defaults:{type:'choice'},items:[1,2,3,4,5,6].map(n=>({id:'a'+n,text:`כמה זה <m>${n}×2</m>?`,options:[String(n*2),String(n*2+1),String(n*2+2)],answer:String(n*2),hint:'כפל',shuffle:true}))}},
  exams:[{name:'מבחן',sections:[{skill:'s1',n:3,label:'שאלה {n}'}]}]};
let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
(async()=>{const b=await chromium.launch();
async function visit(qs,handler){const ctx=await b.newContext({viewport:{width:420,height:800}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  const seen=[];
  await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/**',r=>{seen.push(r.request().url());const u=new URL(r.request().url());
    if(u.pathname.endsWith('/tts'))return r.fulfill({status:200,contentType:'application/json',body:'{"configured":false}'});
    if(u.pathname.endsWith('/usage_events'))return r.fulfill({status:201,body:''});
    return handler(r,u)});
  await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync('deploy/pack.min.html')}));
  await p.goto('https://masa.test/pack/'+qs);await p.waitForTimeout(900);
  const text=await p.evaluate(()=>document.body.innerText);return {p,ctx,text,errs,seen}}
const json=(r,o,st=200)=>r.fulfill({status:st,contentType:'application/json',body:JSON.stringify(o)});

// 1. approved pack by id
let v=await visit('?pack=abcdefghijklmnopqrstuv',(r,u)=>u.searchParams.get('a')=='pack'?json(r,{pack:JSON.parse(JSON.stringify(photo)),title:'כפל'}):json(r,{},404));
ok(/כפל/.test(v.text)&&!/הקישור לא תקין/.test(v.text),'approved pack loads and shows its topic');
ok(v.seen.some(x=>/a=pack&id=abcdefghijklmnopqrstuv/.test(x)),'asks the public route (no token)');
const ids=await v.p.evaluate(()=>({t:TOPICS.map(t=>t.id),s:Object.keys(PK.skills),subj:SUBJECT}));
ok(ids.t.every(x=>x.startsWith('abcdef_'))&&ids.s.every(x=>x.startsWith('abcdef_')),'topic and skill ids are prefixed per pack: '+JSON.stringify(ids));
ok(!v.seen.some(x=>/abcdefghijklmnopqrstuv/.test(x)&&/usage_events|feedback/.test(x)),'pack id never sent to usage/feedback');
ok(v.errs.length==0,'no page errors '+v.errs.join(';'));await v.ctx.close();

// 2. draft preview needs the token and shows the draft banner
v=await visit('?pack=abcdefghijklmnopqrstuv&t=SECRET',(r,u)=>u.searchParams.get('a')=='get'&&u.searchParams.get('t')=='SECRET'?json(r,{pack:JSON.parse(JSON.stringify(photo)),status:'draft',title:'כפל',flags:{}}):json(r,{},403));
ok(/תצוגה מקדימה/.test(v.text),'draft preview banner shown');await v.ctx.close();

// 3. broken / missing
v=await visit('?pack=bad',(r)=>json(r,{},404));ok(/הקישור לא תקין/.test(v.text),'bad id -> friendly message');await v.ctx.close();
v=await visit('?pack=abcdefghijklmnopqrstuv',(r)=>json(r,{},404));ok(/לא מצאנו/.test(v.text),'missing pack -> friendly message');await v.ctx.close();
const broken=JSON.parse(JSON.stringify(photo));broken.pools.p1.items[0].answer='999';
v=await visit('?pack=abcdefghijklmnopqrstuv',(r,u)=>json(r,{pack:broken,title:'x'}));ok(/עוד לא מוכנה/.test(v.text),'invalid approved pack is not played');await v.ctx.close();

// 3b. a pack from ANY subject plays on the same page (interaction types come from the data, no code per topic)
{const sci={schema:'masa-pack/1',subject:{id:'unit',name:'טבע',grade:'ה',unit:'יונקים'},cfg:{},
  topics:[{id:'t1',name:'מיון',glyph:'🐾',bg:'#d6f5c9',lessons:[{title:'יונקים',text:'יונקים מניקים.'}],skills:[{id:'s1',name:'מיון',pool:'p1'}]}],
  pools:{p1:[{id:'a',type:'sort',text:'מיינו.',bins:['יונק','זוחל'],items:[{t:'דולפין',bin:0},{t:'נחש',bin:1}],hint:'רמז'}]},exams:[]};
 v=await visit('?pack=abcdefghijklmnopqrstuv',(r)=>json(r,{pack:JSON.parse(JSON.stringify(sci)),title:'טבע'}));
 ok(!/עוד לא מוכנה|הקישור לא תקין/.test(v.text),'a non-maths pack with a sort item loads and validates');
 const played=await v.p.evaluate(()=>{SS={mode:'gen',items:[{g:Object.keys(TOPIC_OF)[0],p:{}}],idx:0,results:[],starsAt:0,requeued:0};nextQ();return !!document.querySelector('#bdZone')});
 ok(played,'the sort board renders on the pack page');ok(v.errs.length==0,'no page errors '+v.errs.join(';'));await v.ctx.close()}
// 4. the voice requests of a photo pack use the separate cache folder
{const ctx=await b.newContext();const p=await ctx.newPage();await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync('deploy/pack.min.html')}));
 await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await p.goto('https://masa.test/pack/?pack=bad');const u=await p.evaluate(()=>ttsUrl({lang:'he',text:'שלום'},0.8));ok(/[?&]n=p&/.test(u),'tts url carries n=p: '+u);await ctx.close()}
await b.close();console.log(fails?fails+' FAILED':'all passed');process.exit(fails?1:0)})();
