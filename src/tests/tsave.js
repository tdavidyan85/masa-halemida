// R10-A: a hostile restore link (…/#save=<code>) is the one way a stranger can put data into the PUBLIC game pages.
// Every string, key and number in a real saved state is replaced with markup; the page must show it as text on every screen.
// Usage: node tests/tsave.js                       (the built pages in deploy/)
//        node tests/tsave.js some/dir/math.html …  (any copies, e.g. the live site downloaded for an audit)
const {chromium}=require('playwright');const path=require('path');const {check,done,offline}=require('./check');
const P='<img src=x onerror="window.__pw=(window.__pw||0)+1"><svg onload="window.__pw=(window.__pw||0)+1">';
const files=process.argv.slice(2).length?process.argv.slice(2).map(f=>path.resolve(f)):['index.min.html','english.min.html','fractions.min.html'].map(f=>path.join(process.cwd(),'deploy',f));
const seed={r10probe:true,stars:40,streak:2,best:5,stats:{},mistakes:[],days:{},copied:1,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',owlName:'ינשופי',rate2:1,gender:'none',cloud:'device',focus:['num'],read:{big:true}},tour:{home:1,q:1},
  // every field the engine keeps, so each one is attacked below (R10-A: backupAt was shown raw and the old probe never had it)
  backupAt:'2026-11-1',plan:{note:'לתרגל חיבור',focus:['num']},sheets:{s1:{first:[true,false],date:'2026-11-1',earned:3}},lessons:{num:'2026-11-1'},
  mtypes:{'טעות בחיבור':2},owl:{hat:'grad'},owned:['hat:grad'],days:{'2026-11-1':true},daily:{'2026-11-1':{n:4,first:2}},
  // practice-exam records (math: exams, other subjects: exams_<subject>) – R11-A: the R10-A cleaner dropped them
  exams:{'1':{best:3,tries:2,last:3,n:5,date:'2026-11-1'}},exams_english:{'2':{best:4,tries:1,last:4,n:6,date:'2026-11-2'}},exams_fractions:{'1':{best:1,tries:1,last:1,n:4,date:'2026-11-3'}}};
// key order does not matter when two states are compared
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v=='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
// keys mode renames the keys INSIDE the maps (the top-level names must stay, or it is not a save at all)
function deep(v,mode,depth=0){
  if(Array.isArray(v))return v.map(x=>deep(x,mode,depth+1));
  if(v&&typeof v=='object'){const o={};for(const [k,x] of Object.entries(v))o[mode=='keys'&&depth>=1?P+k:k]=deep(x,mode,depth+1);return o}
  if(typeof v=='string')return mode=='strings'?P:v;
  if(typeof v=='number')return mode=='numbers'?P:v;
  return v}
const enc=o=>'j'+Buffer.from(JSON.stringify({v:1,ST:o}),'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
(async()=>{const b=await chromium.launch();
for(const file of files){const name=path.basename(file);
  // 1. a realistic saved state: some right and wrong answers in two topics, a name, an owl name, a shop visit
  const c0=await b.newContext({viewport:{width:1000,height:850}});await offline(c0);const p0=await c0.newPage();
  await p0.addInitScript(s=>{if(!localStorage.getItem('mj-state'))localStorage.setItem('mj-state',JSON.stringify(s))},seed);
  await p0.goto('file://'+file);await p0.waitForTimeout(500);
  const ST=await p0.evaluate(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
    for(const t of (window.TOPICS||[]).slice(0,2)){try{startSession('gen',TOPIC_GENS[t.id][0])}catch(e){continue}
      for(let k=0;k<6&&SS&&SS.q;k++){const pt=SS.q.parts[SS.part];SS.locked=false;try{answer(k%3==1?'__wrong__':pt.answer)}catch(e){}await w(30)}}
    try{saveSession&&saveSession()}catch(e){}try{save()}catch(e){}return JSON.parse(localStorage.getItem('mj-state'))});
  // R11-A: the cleaner must keep EVERY field of a state the engine itself wrote – otherwise publishing the fix wipes children's progress
  const kept=await p0.evaluate(s=>typeof stClean=='function'?stClean(s):s,ST);
  const lost=Object.keys(ST||{}).filter(k=>JSON.stringify(canon(ST[k]))!==JSON.stringify(canon(kept&&kept[k])));
  await c0.close();
  check(ST&&ST.settings&&Object.keys(ST).length>5,`${name}: a realistic saved state was made (${Object.keys(ST||{}).length} fields)`);
  check(lost.length===0,`${name}: a real saved state passes the cleaner unchanged (changed or lost: ${lost.join(',')||'none'})`);
  check(['exams','exams_english','exams_fractions'].every(k=>ST&&ST[k]),`${name}: the state includes practice-exam records for all subjects`);
  for(const mode of ['strings','keys','numbers']){
    const ctx=await b.newContext({viewport:{width:1000,height:850}});await offline(ctx);const p=await ctx.newPage();const dialogs=[],errs=[];
    p.on('dialog',d=>{dialogs.push(d.type()+':'+d.message().slice(0,60));d.type()=='confirm'?d.accept():d.dismiss()});p.on('pageerror',e=>errs.push(e.message+' @ '+(e.stack||'').split('\n')[1]));
    await p.addInitScript(s=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('mj-state',JSON.stringify(s))}},{...seed,stars:0});
    await p.goto('file://'+file+'#save='+enc(deep(ST,mode)));await p.waitForTimeout(800);
    const restored=await p.evaluate(()=>/r10probe/.test(localStorage.getItem('mj-state')||''));
    const r=await p.evaluate(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),seen=[];
      const visit=async(n,f)=>{try{f();seen.push(n)}catch(e){}await w(120)};
      await visit('home',()=>home());
      for(const t of [...document.querySelectorAll('.tabb')].map(x=>x.dataset.tab))await visit('tab:'+t,()=>showTab(t));
      await visit('shop',()=>shop());await visit('parents',()=>parentReal());await visit('report',()=>{const t=buildReport();document.body.insertAdjacentText('beforeend',t)});
      await visit('backup',()=>backupBox());await visit('resume',()=>resumeSession&&resumeSession());await visit('summary',()=>summary&&summary());
      await visit('home2',()=>home());
      return {pw:window.__pw||0,seen,injected:document.querySelectorAll('img[src="x"],svg[onload],img[onerror]').length}});
    console.log(name,mode,JSON.stringify({restored,...r,dialogs,errs:errs.slice(0,2)}));
    check(restored,'‎'+`${name} [${mode}]: the hostile link was accepted as a save (so every screen really used it)`);
    check(r.pw===0&&r.injected===0,`${name} [${mode}]: no markup from the save link ran or was inserted (ran ${r.pw}, inserted ${r.injected}, screens ${r.seen.length})`);
    check(r.seen.includes('home')&&r.seen.includes('home2'),`${name} [${mode}]: the page still works after the hostile link (screens ${r.seen.join(',')}; ${errs[0]||'no error'})`);
    check(!dialogs.some(d=>/<img|onerror/.test(d)&&d.startsWith('alert')),`${name} [${mode}]: no alert shows raw markup`);
    await ctx.close()}
}
await b.close();done('tsave.js')})();
