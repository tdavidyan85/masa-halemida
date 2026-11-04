const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for(const mode of ['cloud','down','none']){
const ctx=await b.newContext({viewport:{width:1000,height:850}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const asked=[];
await p.route('https://gwfacvvmlrkmfkstqpkb.supabase.co/functions/v1/tts**',r=>{const u=new URL(r.request().url());
  if(u.searchParams.get('status'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:mode!='none'})});
  asked.push(u.searchParams.get('l')+':'+u.searchParams.get('v')+':'+u.searchParams.get('t'));
  if(mode=='down')return r.fulfill({status:502,body:'{}'});
  r.fulfill({status:200,contentType:'audio/wav',body:fs.readFileSync('silence.wav')})});
await p.route('https://masa.test/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync(r.request().url().includes('english')?'deploy/english.min.html':'deploy/index.min.html')}));
await p.addInitScript(()=>{localStorage.setItem('mj-state',JSON.stringify({stars:3,streak:0,best:0,stats:{},mistakes:[],days:{},copied:0,settings:{auto:false,rate:0.8,voice:'',sound:false,kidName:'לביא',rate2:1},tour:{home:1,q:1}}));
  window._said=[];const S=window.speechSynthesis;S.getVoices=()=>[{name:'He',lang:'he-IL'},{name:'En',lang:'en-US'}];
  S.speak=u=>{_said.push(u.text);setTimeout(()=>u.onend&&u.onend(),20)};S.cancel=()=>{}});
await p.goto('https://masa.test/'+(mode=='cloud'?'english/':'math/'));await p.waitForTimeout(700);
await p.evaluate(()=>{pickVoice=()=>null;pickEnVoice=()=>null});console.log(mode,'ready',await p.evaluate(()=>TTS.ready),'voiceOK',await p.evaluate(()=>voiceOK()));
await p.evaluate(()=>sayRaw('שלום לך. הוא אומר He is a pupil. עכשיו נפתור.',null,null,null,true));await p.waitForTimeout(3000);
console.log(' cloud asked',asked.length,asked.slice(0,4).map(x=>x.slice(0,40)));
console.log(' device said',await p.evaluate(()=>_said.slice(0,5)));
console.log(' reading done',!(await p.evaluate(()=>window._reading)),'off',await p.evaluate(()=>TTS.off),errs);
await ctx.close()}
await b.close()})();
