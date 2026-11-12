const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const {check,done,offline}=require('./check');
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for(const mode of ['cloud','down','none']){
const ctx=await b.newContext({viewport:{width:1000,height:850}});await offline(ctx);const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const asked=[];
await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/functions/v1/tts**',r=>{const u=new URL(r.request().url());
  if(u.searchParams.get('status'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:mode!='none'})});
  asked.push(u.searchParams.get('l')+':'+u.searchParams.get('v')+':'+u.searchParams.get('t'));
  if(mode=='down')return r.fulfill({status:502,body:'{}'});
  r.fulfill({status:200,contentType:'audio/wav',body:fs.readFileSync(path.join(__dirname,'silence.wav'))})});
await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync(r.request().url().includes('english')?'deploy/english.min.html':'deploy/index.min.html')}));
await p.addInitScript(()=>{localStorage.setItem('mj-state',JSON.stringify({stars:3,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',rate2:1},tour:{home:1,q:1}}));
  window._said=[];const S=window.speechSynthesis;S.getVoices=()=>[{name:'He',lang:'he-IL'},{name:'En',lang:'en-US'}];
  S.speak=u=>{_said.push(u.text);setTimeout(()=>u.onend&&u.onend(),20)};S.cancel=()=>{}});
await p.goto('https://masa.test/'+(mode=='cloud'?'english/':'math/'));await p.waitForTimeout(700);
const ready=await p.evaluate(()=>TTS.ready);
await p.evaluate(()=>{pickVoice=()=>null;pickEnVoice=()=>null});console.log(mode,'ready',ready,'voiceOK',await p.evaluate(()=>voiceOK()));
await p.evaluate(()=>sayRaw('שלום לך. הוא אומר He is a pupil. עכשיו נפתור.',null,null,null,true));
// wait for the reading itself (cloud mode needs ~3s on an idle machine – a fixed 3s wait raced it under load); the check below still fails if it never ends
await p.waitForFunction(()=>!window._reading,null,{timeout:15000}).catch(()=>{});await p.waitForTimeout(300);
console.log(' cloud asked',asked.length,asked.slice(0,4).map(x=>x.slice(0,40)));
const said=await p.evaluate(()=>_said.slice(0,5));console.log(' device said',said);
const finished=!(await p.evaluate(()=>window._reading)),off=await p.evaluate(()=>TTS.off);
console.log(' reading done',finished,'off',off,errs);
check(finished,`${mode}: the reading finishes`);
check(errs.length==0,`${mode}: no JavaScript errors: `+JSON.stringify(errs));
if(mode=='cloud'){
  check(ready===true&&off===false,'cloud: the cloud voice is ready and stays on');
  check(asked.some(x=>x=='en:jenny:He is a pupil.'),'cloud: the English part goes to the English cloud voice');
  check(asked.length>0&&asked.filter(x=>x!='en:jenny:He is a pupil.').every(x=>x.startsWith('he:hila:')),'cloud: the Hebrew parts go to the Hebrew cloud voice');
  check(said.length==0,'cloud: the device voice is not used');
}else if(mode=='down'){
  check(asked.length>0,'down: the cloud is tried first');
  check(off===true,'down: after a server error the cloud voice is turned off');
  check(said.includes('He is a pupil.')&&said.some(x=>/עכשיו נפתור/.test(x)),'down: the device voice reads the whole sentence instead');
}else{
  check(ready===false&&asked.length==0,'none: an unconfigured cloud voice is never asked');
  check(said.includes('He is a pupil.')&&said.some(x=>/שלום לך/.test(x)),'none: the device voice reads everything');
}
await ctx.close()}
await b.close();done('ttts')})();
