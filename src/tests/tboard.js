// The subject-independent interaction mechanics (sort / match / order / tap / cells) – played like a child would:
// right first time, wrong then right, wrong twice (step-by-step explanation), plus a pack from another subject.
// run from src/ after `npm run build`:  node tests/tboard.js
const {chromium}=require('playwright');const fs=require('fs');const {check,done,offline}=require('./check');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1000,height:900}});await offline(p);const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{localStorage.setItem('mj-state',JSON.stringify({stars:3,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא'},tour:{home:1,q:1}}))});
await p.goto('file://'+process.cwd()+'/deploy/fractions.min.html');await p.waitForTimeout(600);

const open=async(g,pid)=>{await p.evaluate(([g,pid])=>{SS={mode:'gen',items:[{g,p:pid?{id:pid}:{}}],idx:0,results:[],starsAt:0,requeued:0};nextQ()},[g,pid]);await p.waitForTimeout(250)};
const part=()=>p.evaluate(()=>{const pt=SS.q.parts[SS.part];return {mode:pt.mode,answer:pt.answer,d:pt.d}});
const click=async(a,i)=>p.click(`#bdZone [data-a="${a}"][data-i="${i}"]`);
/* build the board: right=true → the correct arrangement, right=false → a wrong one */
async function play(pt,right){
  const d=pt.d;
  if(pt.mode=='sort'){const nb=d.bins.length;for(let i=0;i<d.items.length;i++){await click('chip',i);await click('bin',right?d.items[i].b:(d.items[i].b+1)%nb)}}
  if(pt.mode=='match'){const n=d.L.length;for(let i=0;i<n;i++){await click('L',i);await click('R',right?i:(i+1)%n)}}
  if(pt.mode=='order'){const n=d.items.length;const seq=[...Array(n).keys()];if(!right)seq.reverse();for(const i of seq)await click('pick',i)}
  if(pt.mode=='tap'){const ok=d.ok.map((x,i)=>x?i:-1).filter(i=>i>=0);const bad=d.ok.findIndex(x=>!x);for(const i of right?ok:[bad])await click('tok',i)}
  if(pt.mode=='cells'){const total=d.parts*d.wholes;const n=right?d.count:(d.count>1?d.count-1:d.count+1);if(n>total)throw new Error('cannot make a wrong cells answer');for(let k=0;k<n;k++)await click('cell',k)}
  await p.click('#bdOk')}
const res=()=>p.evaluate(()=>SS.results.slice());

// every mechanic in the fractions unit: [skill, item id (or none)]
const CASES=[['pk_sizes','s1'],['pk_words','w1'],['pk_order','o1'],['pk_equal','e1'],['pk_equal','e2'],['pk_paint','pie'],['pk_paint','bar'],['pk_paintbig','pb1'],['pk_words','w3'],['pk_order','o3']];
for(const [g,id] of CASES){
  // A) right first time
  await open(g,id);let pt=await part();check(!!pt.mode&&pt.d,`${g}/${id}: opens as a board (${pt.mode})`);
  await play(pt,true);await p.waitForTimeout(200);let r=await res();
  check(r.length==1&&r[0]===true,`${g}/${id}: right first time counts as first-try`);
  // B) wrong, a hint, the wrong pieces are taken back, then right
  await open(g,id);pt=await part();await play(pt,false);await p.waitForTimeout(150);
  check(await p.evaluate(()=>!!document.querySelector('#coachZone .bubble')),`${g}/${id}: a wrong answer gets coach feedback`);
  if(pt.mode!='cells')check(await p.evaluate(()=>!!document.querySelector('#bdZone .wrong,#bdZone .miss')),`${g}/${id}: wrong pieces are marked`);
  await p.waitForTimeout(1400);
  check(await p.evaluate(()=>!!document.querySelector('#bdZone')&&!SS.locked&&SS.results.length==0),`${g}/${id}: the board stays open after a wrong try`);
  // clean slate for the second attempt: rebuild from scratch (what is left on the board depends on the mechanic)
  await open(g,id);pt=await part();await play(pt,false);await p.waitForTimeout(100);await p.waitForTimeout(1400);
  await p.evaluate(()=>{const pt=SS.q.parts[SS.part];answer(String(pt.answer),null)});await p.waitForTimeout(200);r=await res();
  check(r.length==1&&r[0]===false,`${g}/${id}: wrong then right is not first-try`);
  // C) wrong twice → step-by-step explanation → finishes
  await open(g,id);pt=await part();await play(pt,false);await p.waitForTimeout(1400);
  await p.evaluate(()=>answer('99,99,99',null));await p.waitForTimeout(250);
  check(await p.evaluate(()=>!!document.querySelector('#explainZone .explain')),`${g}/${id}: a second wrong answer opens the explanation`);
  const sawAnswer=await p.evaluate(()=>/התשובה הנכונה/.test(document.querySelector('#explainZone').innerText)||SS.q.parts[SS.part].steps.length>0);
  check(sawAnswer,`${g}/${id}: the explanation has steps or shows the answer`);
  for(let t=0;t<12&&await p.evaluate(()=>!!document.querySelector('#explainZone #enext'));t++){await p.click('#explainZone #enext');await p.waitForTimeout(120)}
  r=await res();check(r.length==1&&r[0]===false&&await p.evaluate(()=>SS.explained===true),`${g}/${id}: after the explanation the question ends (not first-try)`);
}

// keyboard: a colour cell can be toggled with Enter
await open('pk_paint','pie');await p.focus('#bdZone [data-a="cell"][data-i="0"]');await p.keyboard.press('Enter');
check(await p.evaluate(()=>SS.bd.on[0]===true),'a cell toggles with the keyboard (Enter)');
// the answer does not depend on WHICH cells are coloured, only how many
await open('pk_paint','pie');pt=await part();const total=pt.d.parts;
for(let k=total-1;k>=total-pt.d.count;k--)await click('cell',k);await p.click('#bdOk');await p.waitForTimeout(200);
check((await res())[0]===true,'colouring the last cells instead of the first is also right');
// incomplete boards are not checked
await open('pk_sizes','s1');await p.click('#bdOk');await p.waitForTimeout(100);
check(await p.evaluate(()=>SS.results.length==0&&/עוד לא/.test(document.querySelector('#coachZone').innerText)),'an unfinished board is not marked wrong; the child is told what is missing');

// the exam: all board questions answered right
await p.evaluate(()=>startSession('exam',1));await p.waitForTimeout(250);let ended=false;
for(let t=0;t<40;t++){const st=await p.evaluate(()=>{if(!view.querySelector('#partZone'))return 'end';const pt=SS.q.parts[SS.part];answer(String(pt.answer),null);return 1});if(st=='end'){ended=true;break}await p.waitForTimeout(220)}
const [n,right]=await p.evaluate(()=>[SS.results.length,SS.results.filter(Boolean).length]);
check(ended&&n>=5&&right==n,`exam: reaches its end with every answer counted right (${right}/${n})`);

// a different subject, same mechanics: nothing in the board knows about maths
const sci={schema:'masa-pack/1',subject:{id:'sci',name:'טבע',grade:'ה'},cfg:{},
 topics:[{id:'an',name:'בעלי חיים',glyph:'🐾',bg:'#d6f5c9',lessons:[{title:'יונקים',text:'יונקים מניקים את הצעירים.'}],
   skills:[{id:'cls',name:'מיון',pool:'cls'},{id:'ev',name:'סדר',pool:'ev'},{id:'mt',name:'חיבור',pool:'mt'},{id:'tp',name:'מציאה',pool:'tp'}]}],
 pools:{cls:[{id:'c',type:'sort',text:'מיינו את בעלי החיים.',bins:['יונק','זוחל'],items:[{t:'דולפין',bin:'יונק'},{t:'נחש',bin:'זוחל'},{t:'חתול',bin:'יונק'},{t:'לטאה',bin:'זוחל'}],hint:'יונקים מניקים.'}],
  ev:[{id:'e',type:'order',text:'סדרו את שלבי חיי הפרפר.',items:['ביצה','זחל','גולם','פרפר'],hint:'מתחילים בביצה.'}],
  mt:[{id:'m',type:'match',text:'חברו מילה לתרגום.',pairs:[{l:'<en>dog</en>',r:'כלב'},{l:'<en>cat</en>',r:'חתול'},{l:'<en>bird</en>',r:'ציפור'}],hint:'dog = כלב.'}],
  tp:[{id:'t',type:'tap',text:'לחצו על הפועל.',tokens:['<en>The</en>','<en>cat</en>',{t:'<en>runs</en>',ok:true},'<en>fast</en>'],hint:'פועל אומר מה עושים.'}]}};
const sciErr=await p.evaluate(P=>validatePack(JSON.parse(JSON.stringify(P))),sci);
check(sciErr.length==0,'a science/English pack with the same mechanics validates: '+JSON.stringify(sciErr));
await p.evaluate(P=>loadPack(P),sci);
for(const g of ['pk_cls','pk_ev','pk_mt','pk_tp']){await open(g);const q=await part();await play(q,true);await p.waitForTimeout(200);
  check((await res())[0]===true,`${g}: works in another subject (${q.mode})`)}

// the look (kids / teen) follows the pack's class
check(await p.evaluate(()=>document.documentElement.dataset.look)=='kids','a pack for class ה׳ gets the kids look');
const looks=await p.evaluate(()=>Object.fromEntries(['א','ו׳','ז','ח׳','יב','3','7',''].map(g=>[g,bdLookOf({subject:{grade:g}})])));
check(looks['א']=='kids'&&looks['ו׳']=='kids'&&looks['3']=='kids'&&looks['']=='kids','classes א–ו (and 1–6, or none) are kids: '+JSON.stringify(looks));
check(looks['ז']=='teen'&&looks['ח׳']=='teen'&&looks['יב']=='teen'&&looks['7']=='teen','classes ז and up are teen: '+JSON.stringify(looks));
check(await p.evaluate(()=>bdLookOf({subject:{grade:'ח'},cfg:{look:'kids'}}))=='kids','cfg.look overrides the class');
await p.evaluate(P=>{const t=JSON.parse(JSON.stringify(P));t.subject.grade='ט';loadPack(t)},sci);
check(await p.evaluate(()=>document.documentElement.dataset.look)=='teen','loading a pack for class ט׳ switches the page to the teen look');
await open('pk_cls');let q=await part();await play(q,true);await p.waitForTimeout(250);
check((await res())[0]===true&&await p.evaluate(()=>!document.querySelector('.confetti,#confetti,[class*="confetti"]')),'teen look: the board works and there is no confetti');
check((await p.evaluate(()=>validatePack({schema:'masa-pack/1',cfg:{look:'wild'},topics:[],pools:{}}))).some(e=>/cfg.look/.test(e)),'validator: cfg.look must be kids or teen');
// the colour of an item follows its group (and is neutral while it is in the tray)
await p.evaluate(P=>loadPack(P),sci);await open('pk_cls');await p.click('#bdZone .bd-tray .bd-chip');
check(await p.evaluate(()=>document.querySelector('#bdZone .bd-tray .bd-chip').dataset.k==='' ),'an item in the tray has no group colour');
await p.click('#bdZone .bd-bin[data-k="1"] .bd-binh');
check(await p.evaluate(()=>!!document.querySelector('#bdZone .bd-bin[data-k="1"] .bd-chip[data-k="1"]')),'an item placed in a group takes that group\'s colour');

// the validator catches broken board items
const bad=(item)=>p.evaluate(it=>validatePack({schema:'masa-pack/1',topics:[{id:'t',name:'t',skills:[{id:'s',name:'s',pool:'p'}]}],pools:{p:[it]}}),item);
check((await bad({id:'x',type:'sort',bins:['a','b'],items:[{t:'1',bin:5},{t:'2',bin:0}]})).length>0,'validator: sort item with a missing bin');
check((await bad({id:'x',type:'match',pairs:[{l:'a',r:'x'},{l:'b',r:'x'}]})).length>0,'validator: match with the same right side twice');
check((await bad({id:'x',type:'order',items:['a','a']})).length>0,'validator: order with duplicate items');
check((await bad({id:'x',type:'tap',tokens:['a','b']})).length>0,'validator: tap without a correct token');
check((await bad({id:'x',type:'cells',parts:4,count:9})).length>0,'validator: cells count above the number of parts');

console.log(errs);check(errs.length==0,'no JavaScript errors on the page: '+JSON.stringify(errs));await b.close();done('tboard')})();
