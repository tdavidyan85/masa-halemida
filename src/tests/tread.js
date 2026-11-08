// reading options in the parents corner: toggles set data attributes, persist, and survive a reload.
// run from src/ after `npm run build`:  node tests/tread.js
const {chromium}=require('playwright');const path=require('path');
let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:420,height:800}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route(/^https?:\/\/(?!localhost)/,r=>r.abort());
const url=require('url').pathToFileURL(path.join(__dirname,'..','deploy','index.min.html')).href;
await p.goto(url);await p.waitForTimeout(900);
const attrs=()=>p.evaluate(()=>({...document.documentElement.dataset}));
let a=await attrs();ok(!a.rdBig&&!a.rdSpace&&!a.rdPlain,'off by default');
await p.evaluate(()=>{window._parentOK=true;parentReal()});await p.waitForTimeout(300);
ok(await p.locator('#rdBig').count()==1,'settings are shown in the parents corner');
await p.locator('#rdBig').check();await p.locator('#rdSpace').check();await p.locator('#rdPlain').check();
a=await attrs();ok(a.rdBig=='1'&&a.rdSpace=='1'&&a.rdPlain=='1','all three switch on');
const fs=await p.evaluate(()=>getComputedStyle(document.body).fontSize);ok(fs=='24px','body text grows: '+fs);
await p.locator('#rdSpace').uncheck();a=await attrs();ok(!a.rdSpace&&a.rdBig=='1','one option switches off alone');
await p.reload();await p.waitForTimeout(900);a=await attrs();ok(a.rdBig=='1'&&a.rdPlain=='1'&&!a.rdSpace,'choices survive a reload');
ok(errs.length==0,'no page errors '+errs.join(';'));
await b.close();console.log(fails?`✗ tread: ${fails} failed`:'✓ tread: all passed');process.exit(fails?1:0)})();
