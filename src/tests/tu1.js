const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const errs=[];
for(const [f,w] of [['index.min.html',1200],['english.min.html',390]]){const p=await b.newPage({viewport:{width:w,height:900}});p.on('pageerror',e=>errs.push(f+': '+e.message));
await p.addInitScript(()=>{localStorage.setItem('mj-state',JSON.stringify({stars:30,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,srs:{},settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',rate2:1},tour:{home:1,q:1}}))});
await p.goto('file://'+process.cwd()+'/deploy/'+f);await p.waitForTimeout(500);
await p.screenshot({path:`u_${f[0]}_home.png`,fullPage:true});
console.log(f,await p.evaluate(()=>document.querySelector('#goBtn').innerText.replace(/\n/g,' | ')));
await p.click('.tabb[data-tab="exam"]');await p.waitForTimeout(100);console.log('exam visible',await p.isVisible('#examSec'),'map hidden',!(await p.isVisible('.map')));
await p.click('.tabb[data-tab="more"]');await p.click('#parent');await p.waitForTimeout(100);
const q=await p.evaluate(()=>document.querySelector('#leaveBox b').textContent);const [a,bb]=q.split('×').map(x=>+x.trim());
await p.fill('#pgIn','1');await p.click('#pgOk');console.log('wrong msg',await p.textContent('#pgMsg'));
await p.fill('#pgIn',String(a*bb));await p.click('#pgOk');await p.waitForTimeout(200);console.log('parent opened',await p.evaluate(()=>!!document.querySelector('#repText')));
await p.evaluate(()=>home());await p.waitForTimeout(100);console.log('tab remembered',await p.evaluate(()=>document.querySelector('.tabb.on').dataset.tab));
await p.evaluate(()=>{document.querySelector('#goBtn').click()});await p.waitForTimeout(300);console.log('go →',await p.evaluate(()=>SS&&SS.mode||document.querySelector('#mb')?.innerText?.slice(0,30)));
await p.close()}
console.log(errs);await b.close()})();
