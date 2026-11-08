// install-to-home-screen + offline, and the progress trend line in the parent report.
// run from src/ after `npm run publish-site`:  node tests/tpwa.js
const {chromium}=require('playwright');const path=require('path');const fs=require('fs');const http=require('http');
const ROOT=path.join(__dirname,'..','..');
let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
// static files
for(const d of ['math','english','fractions']){
  let m;try{m=JSON.parse(fs.readFileSync(path.join(ROOT,d,'manifest.webmanifest'),'utf8'))}catch(e){m=null}
  ok(m&&m.start_url&&m.display=='standalone'&&m.lang=='he','manifest ok: '+d);
  ok(m&&m.icons.every(i=>fs.existsSync(path.join(ROOT,d,i.src))),'manifest icons exist: '+d);
  ok(fs.readFileSync(path.join(ROOT,d,'sw.js'),'utf8')==fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8'),'sw.js is the shared copy: '+d);
  ok(/rel="manifest"/.test(fs.readFileSync(path.join(ROOT,d,'index.html'),'utf8')),'page links the manifest: '+d)}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv=http.createServer((q,r)=>{let f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));if(f.endsWith(path.sep)||fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');
  if(!fs.existsSync(f)){r.writeHead(404);return r.end()}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f))});
(async()=>{await new Promise(r=>srv.listen(0,r));const port=srv.address().port,base=`http://localhost:${port}/`;
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:420,height:800}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route(/^https?:\/\/(?!localhost)/,r=>r.abort());
await p.goto(base+'math/');await p.waitForTimeout(1200);
const reg=await p.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return !!r.active});
ok(reg,'service worker registers and activates');
await ctx.setOffline(true);
await p.goto(base+'math/').catch(()=>{});await p.waitForTimeout(800);
const t=await p.evaluate(()=>document.body.innerText).catch(()=>'');
ok(/משימה|מסע/.test(t),'page opens with no network');
await ctx.setOffline(false);
// trend line
await p.goto(base+'math/');await p.waitForTimeout(800);
const tl=await p.evaluate(()=>{const mk=(a,f)=>{const D={};let d=new Date(2026,9,1);for(let i=0;i<16;i++){const k=`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;D[k]=i<8?{n:10,first:a}:{n:10,first:f};d.setDate(d.getDate()+1)}return D};
  const out={};ST.daily=mk(5,8);out.up=trendLine();ST.daily=mk(8,5);out.down=trendLine();ST.daily=mk(7,7);out.flat=trendLine();
  ST.daily={'2026-10-1':{n:10,first:5},'2026-10-2':{n:10,first:9}};out.few=trendLine();ST.daily={};out.none=trendLine();return out});
ok(/50%.*80%.*שיפור/.test(tl.up),'trend: improvement shown: '+tl.up);
ok(/80%.*50%.*ירידה/.test(tl.down),'trend: decline shown');
ok(/יציב/.test(tl.flat),'trend: stable');
ok(tl.few===''&&tl.none==='','trend: says nothing without enough data');
ok(errs.length==0,'no page errors '+errs.join(';'));
await b.close();srv.close();console.log(fails?`✗ tpwa: ${fails} failed`:'✓ tpwa: all passed');process.exit(fails?1:0)})();
