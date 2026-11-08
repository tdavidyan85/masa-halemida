// the parent's scan + review page, with a mocked `ingest`. run from src/ after `npm run build`:  node tests/tscan.js
const {chromium}=require('playwright');const fs=require('fs');
let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
const draft=()=>({schema:'masa-pack/1',subject:{id:'unit',name:'חשבון',grade:'ה',unit:'כפל'},cfg:{},
  topics:[{id:'t1',name:'כפל',glyph:'×',bg:'#cfe3ff',lessons:[{title:'כפל',text:'כופלים.'}],skills:[{id:'s1',name:'כפל בסיסי',pool:'p1',examQ:1}]}],
  pools:{p1:{defaults:{type:'choice'},items:[1,2,3].map(n=>({id:'a'+n,text:`כמה זה ${n}×2?`,options:[String(n*2),String(n*2+1),String(n*2+2)],answer:String(n*2)}))}},
  exams:[{name:'מבחן',sections:[{skill:'s1',n:3}]}]});
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:400,height:900}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const calls=[];let lastSaved=null;let dialogs=[];p.on('dialog',d=>{dialogs.push(d.message());d.accept()});
await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/functions/v1/ingest**',async r=>{const u=new URL(r.request().url()),a=u.searchParams.get('a'),h=r.request().headers();
  calls.push({a,ct:h['content-type'],dev:h['x-device'],len:(r.request().postDataBuffer()||Buffer.alloc(0)).length,body:a=='save'?JSON.parse(r.request().postData()):null});
  const j=(o,s=200)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(o)});
  if(a=='new')return j({id:'ID123456789012345678',token:'TOK',pack:draft(),flags:{namesReplaced:2,contactsRemoved:1,problems:[],notes:'נקרא היטב'}});
  if(a=='save'){const b=JSON.parse(r.request().postData());lastSaved=b.pack;return j({ok:true,status:b.approve?'approved':'draft'})}
  if(a=='get')return j({pack:lastSaved,status:'approved',title:'כפל',flags:{}});
  if(a=='delete')return j({ok:true});return j({},404)});
await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync('deploy/scan.html')}));
await p.goto('https://masa.test/scan/');
ok(/צלמו בלי השם של הילד/.test(await p.innerText('body')),'privacy warning shown before the photo');
// a real image file: 3000x2000 png made in the page, then handed to the file input
const png=await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=3000;c.height=2000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,3000,2000);x.fillStyle='#000';x.font='80px Arial';x.fillText('test',100,200);return c.toDataURL('image/png').split(',')[1]});
await p.setInputFiles('#f',{name:'secret-name-שם-ילד.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
await p.waitForSelector('text=בודקים ומאשרים');
const up=calls.find(c=>c.a=='new');
ok(up&&up.ct=='image/jpeg','photo is re-encoded to jpeg in the browser (drops EXIF)');
ok(up&&up.dev&&up.dev.length>=32,'device token sent');
ok(up&&up.len<1_500_000,'photo shrunk before upload: '+up?.len);
const body=await p.innerText('body');
ok(/הוחלפו 2 שמות/.test(body)&&/הוסרו מספרי טלפון/.test(body)&&/נקרא היטב/.test(body),'privacy flags + notes shown to the parent');
ok(await p.locator('.item').count()==3,'three questions listed');
// edit: change first question, mark option 2 as correct on item 2, delete item 3, approve
await p.locator('.item').nth(0).locator('[data-ed]').click();
await p.locator('.item').nth(0).locator('[data-f=text]').fill('כמה זה שתיים כפול אחת?');await p.locator('.item').nth(0).locator('[data-done]').click();
ok(/שתיים כפול אחת/.test(await p.locator('.item').nth(0).locator('.qt').innerText()),'edited question shows in its card right away');
ok(!/<m>|&lt;m/.test(await p.locator('.item').nth(1).locator('.qt').innerHTML()),'no raw tags shown to the parent');
await p.locator('.item').nth(1).locator('[data-ed]').click();
await p.locator('.item').nth(1).locator('input[type=radio]').nth(1).check();await p.locator('.item').nth(1).locator('[data-done]').click();
ok(await p.locator('.item').nth(1).locator('.chip.right').count()==1,'exactly one option marked correct');
await p.locator('.item').nth(2).locator('[data-rm]').click();
await p.click('#ap');await p.waitForSelector('#share:not([hidden])');
const sv=calls.filter(c=>c.a=='save').pop().body;const items=sv.pack.pools.p1.items;
ok(sv.approve===true&&sv.t=='TOK'&&sv.id=='ID123456789012345678','approve sent with id and edit token');
ok(items.length==2,'deleted question removed');ok(items[0].text=='כמה זה שתיים כפול אחת?','edited text saved');ok(items[1].answer=='5','changed correct option saved');
ok((await p.inputValue('#lnk')).endsWith('/pack/?pack=ID123456789012345678')&&!/TOK/.test(await p.inputValue('#lnk')),'child link has the id only, never the edit token');
ok(JSON.stringify(calls).indexOf('secret-name')<0,'original file name never sent');
// the parent can come back to it later (token kept on this device only)
await p.reload();ok(/היחידות שלי/.test(await p.innerText('body')),'saved units listed on return');
// preview opens only after a successful save
await p.click('[data-open]');await p.waitForSelector('#pv');await p.evaluate(()=>{window.open=u=>{window._opened=u}});await p.click('#pv');await p.waitForFunction(()=>window._opened);const pu=await p.evaluate(()=>window._opened);
ok(/[?&]t=TOK/.test(pu)&&/pack\/\?pack=ID123/.test(pu),'preview link carries the token: '+pu);
ok(errs.length==0,'no page errors '+errs.join(';'));
await b.close();console.log(fails?fails+' FAILED':'all passed');process.exit(fails?1:0)})();
