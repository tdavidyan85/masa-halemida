// screenshots of the parent's screens at phone size (for design review): node tests/shot-scan.js <outDir>
const {chromium}=require('playwright');const fs=require('fs');const out=process.argv[2]||'.';
const mk=(n)=>({id:'a'+n,text:`כמה זה <m>${n}×4</m>?`,options:[String(n*4),String(n*4+2),String(n*4-1)],answer:String(n*4),hint:'כפל'});
const draft={schema:'masa-pack/1',subject:{id:'unit',name:'חשבון',grade:'ה',unit:'כפל וחילוק'},cfg:{},
 topics:[{id:'t1',name:'כפל',glyph:'×',bg:'#cfe3ff',lessons:[{title:'מהו כפל?',text:'כפל הוא חיבור חוזר. שלוש פעמים ארבע זה ארבע ועוד ארבע ועוד ארבע.'}],skills:[{id:'s1',name:'כפל בסיסי',pool:'p1',examQ:1}]}],
 pools:{p1:{defaults:{type:'choice'},items:[1,2,3,4,5,6].map(mk)}},exams:[{name:'מבחן',sections:[{skill:'s1',n:3}]}]};
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});const p=await ctx.newPage();
await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/functions/v1/ingest**',async r=>{const a=new URL(r.request().url()).searchParams.get('a');
 const j=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
 if(a=='new'){await new Promise(x=>setTimeout(x,1500));return j({id:'ID123456789012345678',token:'T',pack:draft,flags:{namesReplaced:2,contactsRemoved:0,problems:[],notes:'נקרא היטב. בדקו שהתשובות נכונות.'}})}
 return j({ok:true,status:'draft'})});
await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync('deploy/scan.html')}));
await p.goto('https://masa.test/scan/');await p.screenshot({path:out+'/1-home.png'});
const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;c.getContext('2d').fillRect(0,0,800,600);return c.toDataURL('image/png').split(',')[1]});
await p.setInputFiles('#f',{name:'a.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForTimeout(400);await p.screenshot({path:out+'/2-wait.png'});
await p.waitForSelector('text=בודקים ומאשרים');await p.screenshot({path:out+'/3-review-top.png'});await p.screenshot({path:out+'/4-review-full.png',fullPage:true});
await b.close()})();
