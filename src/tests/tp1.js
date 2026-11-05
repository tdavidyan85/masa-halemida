const {chromium}=require('playwright');const fs=require('fs');const {check,done,offline}=require('./check');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1100,height:950}});await offline(p);const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{localStorage.setItem('mj-state',JSON.stringify({stars:3,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',rate2:1},tour:{home:1,q:1}}))});
await p.goto('file://'+process.cwd()+'/deploy/english.min.html');await p.waitForTimeout(600);
const pack=JSON.parse(fs.readFileSync('packs/english-pronouns.json','utf8'));
const vErr=await p.evaluate(P=>validatePack(P),pack);console.log('validator:',vErr);
check(Array.isArray(vErr)&&vErr.length==0,'validator reports no problems in the English pack: '+JSON.stringify(vErr));
const topics=await p.evaluate(()=>JSON.stringify(TOPIC_GENS));console.log('topics',topics);
check(Object.keys(JSON.parse(topics)).length>0,'the pack defines practice topics');
const r=await p.evaluate(()=>{const out=[];for(const g of Object.keys(TOPIC_OF))for(let i=0;i<200;i++){let q;try{q=makeQ(g,i%3?{}:{ez:true})}catch(e){out.push(g+' '+e.message);break}
  const t=JSON.stringify(q);if(/undefined|NaN|\{=|⟦/.test(t.replace(/"mistake"|"accept"/g,''))){out.push(g+' bad '+(t.match(/.{40}(undefined|NaN).{10}/)||[''])[0]);break}
  for(const pt of q.parts){if(pt.kind=='choice'&&!pt.options.some(o=>o.val==pt.answer)){out.push(g+' noans');break}}}return out});
console.log('fuzz',r);
check(r.length==0,'every skill makes 200 valid questions with the right answer among the options: '+JSON.stringify(r));
// exams 1 and 2 end to end
for(const id of [1,2]){await p.evaluate(id=>startSession('exam',id),id);await p.waitForTimeout(200);let ended=false;
  for(let t=0;t<80;t++){const st=await p.evaluate(()=>{if(!view.querySelector('#partZone'))return 'end';const pt=SS.q.parts[SS.part];const a=String(pt.answer);
    if(pt.kind=='choice')answer(a,document.querySelector(`.opt[data-v="${CSS.escape(a)}"]`));else{for(const c of pt.word)skey({ch:c});skey('ok')}return 1});if(st=='end'){ended=true;break}
    if(t==0)await p.locator('.qcard').screenshot({path:`p_ex${id}.png`});await p.waitForTimeout(220)}
  const [n,right]=await p.evaluate(()=>[SS.results.length,SS.results.filter(Boolean).length]);console.log('exam',id,[n,right]);
  check(ended,`exam ${id} reaches its end`);check(n>0&&right==n,`exam ${id}: all answers counted right (${right}/${n})`)}
// sheets
for(const id of ['en-pro-1','en-pro-2']){await p.evaluate(id=>startSession('sheet',id),id);await p.waitForTimeout(150);let ended=false,steps=0;
  for(let t=0;t<80;t++){const st=await p.evaluate(()=>{if(!view.querySelector('#partZone'))return 'end';const pt=SS.q.parts[SS.part];const a=String(pt.answer);
    if(pt.kind=='choice')answer(a,document.querySelector(`.opt[data-v="${CSS.escape(a)}"]`));else{for(const c of pt.word)skey({ch:c});skey('ok')}return 1});if(st=='end'){ended=true;break}steps++;await p.waitForTimeout(200);
    await p.evaluate(()=>{const n=document.querySelector('#nextQ');if(n)n.click()});await p.waitForTimeout(100)}
  check(ended&&steps>0,`worksheet ${id} is filled to the end (${steps} steps)`);
  await p.emulateMedia({media:'print'});await p.screenshot({path:`p_${id}.png`,fullPage:true});await p.emulateMedia({media:'screen'})}
// a practice story + lesson
await p.evaluate(()=>{SS={mode:'gen',items:[{g:'pk_story'}],idx:0,results:[],starsAt:0,requeued:0};nextQ()});await p.waitForTimeout(200);await p.locator('.qcard').screenshot({path:'p_story.png'});
check(await p.evaluate(()=>!!(SS.q&&SS.q.gen=='pk_story'&&view.querySelector('.qcard'))),'a story question opens');
await p.evaluate(()=>lesson('repl'));await p.waitForTimeout(150);await p.screenshot({path:'p_lesson.png'});
check(await p.evaluate(()=>view.innerText.trim().length>0&&!view.querySelector('#partZone')),'the lesson screen opens');
console.log(errs);check(errs.length==0,'no JavaScript errors on the page: '+JSON.stringify(errs));await b.close();done('tp1')})();
