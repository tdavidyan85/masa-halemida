/* ================= סטודיו התוכן: דף עבודה → יחידת לימוד (prototype) =================
   A parent uploads photos of a worksheet; Claude turns them into a content pack (masa-pack/1);
   the page checks it with the real engine, drops anything broken, lets the parent review every
   question and answer, plays it as a preview, and saves it.                                         */
const STU={pack:null,warn:[],dropped:[],files:[],ctl:null,sample:null,db:null,dl:null,limits:null};
const realHome=home;
home=function(){if(!PK.pack)return studioHome();realHome();studioBar()};
const stuEsc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
(async()=>{try{STU.user=await claude.use('user');STU.uid=STU.user?await STU.user.id():null;STU.owner=STU.user?await STU.user.isOwner():false}catch(e){}try{STU.sample=await claude.use('sample')}catch(e){}try{STU.db=await claude.use('db')}catch(e){}try{STU.dl=await claude.use('downloads')}catch(e){}
  try{STU.limits=STU.sample?await STU.sample.limits():null}catch(e){}if(!PK.pack&&view.querySelector('#stuForm'))studioHome()})();
const GRADES=['א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב'];
function studioHome(){
  stopSpeech();const canImg=!!(STU.limits&&STU.limits.images);
  view.innerHTML=`<section class="lesson" id="stuForm"><div class="coach" style="margin-top:0">${owlSVG(80)}<div class="bubble"><b>סטודיו התוכן</b> – מעלים צילום של דף עבודה, ו-Claude בונה ממנו יחידה שלמה: שיעור קצר, תרגול, מבחנים ודף להדפסה. אחר כך בודקים כל שאלה ותשובה, ומשחקים בתצוגה מקדימה.</div></div>
    ${!STU.sample?`<div class="warn">${window.claude?'מתחבר ל-Claude…':'הסטודיו עובד רק כשהדף פתוח בתוך Claude.'}</div>`:''}
    <div class="stuf">
      <label>מקצוע <input id="sSubj" placeholder="למשל: חשבון, אנגלית, מדעים" maxlength="30"></label>
      <label>כיתה <select id="sGrade">${GRADES.map(g=>`<option ${g=='ה'?'selected':''}>${g}</option>`).join('')}</select></label>
      <label>שם היחידה <input id="sUnit" placeholder="למשל: משוואות עם נעלם אחד" maxlength="50"></label>
      <div class="wide" style="display:flex;gap:18px;flex-wrap:wrap"><label style="flex-direction:row;align-items:center"><input type="checkbox" id="sRead"> קשיי קריאה</label><label style="flex-direction:row;align-items:center"><input type="checkbox" id="sWrite"> לא אוהב/ת לכתוב</label></div>
      <label class="wide">הערות (לא חובה) <textarea id="sNotes" rows="2" placeholder="למשל: הוא מתבלבל בהעברת אגפים. המבחן בעוד שבוע." maxlength="600"></textarea></label>
      <label class="wide">צילומים של דף העבודה ${canImg?`(עד ${STU.limits.images.maxCount})`:''} <input id="sFiles" type="file" multiple accept="${canImg?STU.limits.images.mediaTypes.join(','):'image/*'}" ${canImg?'':'disabled'}></label>
      <div class="wide" id="sThumbs" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    </div>
    <div class="actions"><button class="big green" id="sGo" disabled>✨ ליצור יחידה</button><button class="big sec" id="sStop" hidden>עצירה</button></div>
    <div id="sProg" class="small" style="min-height:1.5em"></div>
    <h2 class="sec-t" style="margin-top:20px">יחידות שמורות</h2><div id="sSaved" class="small">${STU.db?'טוען…':'אין חיבור לשמירה בדף הזה.'}</div></section>`;
  const fi=view.querySelector('#sFiles'),go=view.querySelector('#sGo');
  const upd=()=>{go.disabled=!(STU.sample&&STU.files.length&&view.querySelector('#sSubj').value.trim())};
  fi.onchange=()=>{STU.files=[...fi.files].slice(0,canImg?STU.limits.images.maxCount:0);view.querySelector('#sThumbs').innerHTML=STU.files.map(f=>`<img src="${URL.createObjectURL(f)}" style="height:90px;border:2px solid var(--line);border-radius:8px">`).join('');upd()};
  view.querySelector('#sSubj').oninput=upd;go.onclick=studioGenerate;
  view.querySelector('#sStop').onclick=()=>STU.ctl&&STU.ctl.abort();
  if(STU.db)studioSaved();
}
const PACK_GUIDE=`FORMAT "masa-pack/1" – reply with ONLY one JSON object:
{"schema":"masa-pack/1","subject":{"id":"<latin-id>","name":"<subject in Hebrew>","grade":"<grade>","unit":"<unit name>"},
 "cfg":{"examInfo":"<1 short Hebrew sentence about the sample tests>","testSay":"<short Hebrew greeting>"},
 "topics":[{"id":"t1","name":"<Hebrew>","glyph":"<1-3 chars>","bg":"#cfe3ff","lessons":[{"title":"..","text":".."}],"skills":[{"id":"s1","name":"<Hebrew>","pool":"s1","examQ":1}]}],
 "pools":{"s1":{"defaults":{<fields shared by all items>},"items":[<items>]}},
 "exams":[{"name":"הדף המקורי","fixed":[{"skill":"s1","id":"<item id>","label":"שאלה 1"}]},{"name":"כמו הדף","sections":[{"skill":"s1","n":4,"label":"שאלה {n}"}]}],
 "sheets":[{"id":"sheet1","name":"<worksheet title>","sub":"<short Hebrew>","title":"<title>","sections":[{"layout":"lines","heading":"<instruction from the sheet>","pool":"s1","items":["<item id>"]}]}]}
ITEM fields: id, type ("choice"|"number"|"fraction"|"spell"|"multi"), text (the question, Hebrew), visual (the exercise shown big), sub (small helper line, e.g. a translation),
 paperText (the instruction as printed on the sheet), options (choice: strings or {"t":"shown","v":"value"}), answer, alts (other accepted answers), show (how many options to show),
 accept (number: any value in range {"min":..,"max":..,"exclusive":true,"example":..}), decimal:true, hint (never reveals the answer), steps (2-4 short Hebrew lines that teach the method),
 mistakes ({"<wrong answer>":"short explanation of that mistake"}), line (how to write it on paper), paperLine (the original sheet line with ___ where the answer goes),
 vars (templates: {"a":[2,9] range,"b":{"pick":[10,20]},"c":{"calc":"a*b"}}; use {a} and {=a*b} in any text; answer "=a*b"),
 multi: {"type":"multi","guided":true,"text":..,"parts":[<part items: type, prompt, answer, hint, steps>]} – guided steps for multi-step calculations; the LAST part is the final answer.
TEXT MARKUP (no other HTML): <en>English</en> (read by an English voice) · <m>3 + 4 = 7</m> math · <f>3/4</f> fraction · <mx>2 1/3</mx> mixed number · **bold** · ___ blank · \\n new line.
RULES:
1. Copy EVERY question of the worksheet as an item (the original numbers/words), each in the right skill. Those ids go to exams[0].fixed and to the sheet.
2. Then add new items in the same style, so each pool has 10-20 items. For anything with numbers, prefer vars templates with computed answers ({=..}) – never calculate by hand.
   Expressions may use only numbers, + - * / % ( ), min max round floor ceil abs gcd, and variable names.
3. 1-4 topics, 1-4 skills each. Each topic: 3-4 lesson slides, short, with one worked example.
4. {ACCESS}
5. choice: the answer must equal one option value. spell: one English word, letters only. number answers must be exact.
6. exams: exactly 1 fixed exam (the original sheet) + 3 exams with sections that mirror the sheet's structure.
7. Keep the whole JSON under 30 KB: use pool defaults for repeated fields (text, hint, options...).`;
async function studioGenerate(){
  const subj=view.querySelector('#sSubj').value.trim(),grade=view.querySelector('#sGrade').value,unit=view.querySelector('#sUnit').value.trim(),notes=view.querySelector('#sNotes').value.trim();
  const prog=view.querySelector('#sProg'),go=view.querySelector('#sGo'),stop=view.querySelector('#sStop');go.disabled=true;stop.hidden=false;
  const P=t=>{prog.textContent=t};P('שולח את הדף ל-Claude… (זה לוקח בדרך כלל דקה-שתיים)');
  const rd=view.querySelector('#sRead').checked,wr=view.querySelector('#sWrite').checked;
  const access=(rd?'The student has reading difficulties: short, simple Hebrew sentences, little text per screen. ':'')+(wr?'The student dislikes writing: prefer choice and number answers over typing. ':'')+`Match the level and language to grade ${grade}${['י','יא','יב'].includes(grade)?' (high school: keep full rigor and terminology; break long solutions into guided multi steps)':''}. Multi-step calculations as guided multi steps.`;
  const prompt=`You turn a school worksheet (the attached photos) into a learning unit for "מסע הלמידה", a learning game for a student in grade ${grade} (Israel), subject: ${subj}${unit?`, unit: ${unit}`:''}.
${notes?`Parent notes: ${notes}\n`:''}All content for the child is in Hebrew (English only where the subject is English).
${PACK_GUIDE.replace('{ACCESS}',access)}`;
  STU.ctl=new AbortController();let pack;
  try{pack=await STU.sample.json(prompt,{images:STU.files,modelTier:'complex',signal:STU.ctl.signal,cache:false,onText:({text})=>P(`Claude כותב את היחידה… ${Math.round(text.length/1000)}K תווים`)})}
  catch(e){stop.hidden=true;go.disabled=false;P(e.code=='cancelled'?'נעצר.':e.code=='not_granted'?'צריך לאשר ל-Claude לעבוד מהדף הזה.':e.code=='invalid_json'?'התשובה לא הייתה תקינה (אולי ארוכה מדי). נסו שוב, או עם פחות עמודים.':e.code=='rate_limited'?'יותר מדי בקשות כרגע. נסו שוב בעוד כמה דקות.':`שגיאה: ${e.code}`);return}
  stop.hidden=true;P('בודק את היחידה במנוע…');
  try{const r=studioRepair(pack);if(!r.ok){P('היחידה שהתקבלה לא שמישה: '+r.why+'. נסו שוב.');go.disabled=false;return}}catch(e){P('שגיאה בבדיקה: '+e.message);go.disabled=false;return}
  P('Claude בודק פעם שנייה את התשובות…');await studioReview();
  studioOpen();
}
/* keep only what works: every item is checked alone; broken items, empty skills and dangling references are removed */
function studioRepair(pack){
  STU.dropped=[];if(!pack||typeof pack!='object')return {ok:false,why:'אין JSON'};
  pack.schema='masa-pack/1';pack.subject=pack.subject||{};pack.topics=Array.isArray(pack.topics)?pack.topics:[];pack.pools=pack.pools||{};pkNormalize(pack);
  for(const [pn,items] of Object.entries(pack.pools)){pack.pools[pn]=(Array.isArray(items)?items:[]).filter((it,i)=>{if(it.id==null)it.id=pn+'-'+(i+1);
    const errs=validatePack({schema:'masa-pack/1',topics:[],pools:{x:[it]}});if(errs.length){const m=errs[0].replace(/^x\[[^\]]*\]:?\s*/,'');STU.dropped.push(`${it.id}: ${/not in options/.test(m)?'התשובה לא נמצאת בין האפשרויות':/duplicate/.test(m)?'יש אפשרויות כפולות':/no answer/.test(m)?'חסרה תשובה':/letters/.test(m)?'מילה לכתיבה חייבת להיות באותיות באנגלית':/type/.test(m)?'סוג שאלה לא מוכר':'שגיאה בחישוב התשובה'}`);return false}return true})}
  pack.topics.forEach(t=>{t.id=String(t.id||'t'+Math.random().toString(36).slice(2,6));t.skills=(t.skills||[]).filter(s=>s&&s.pool&&(pack.pools[s.pool]||[]).length)});
  pack.topics=pack.topics.filter(t=>t.skills.length);if(!pack.topics.length)return {ok:false,why:'לא נשארו שאלות תקינות'};
  const skills=new Set(pack.topics.flatMap(t=>t.skills.map(s=>s.id)));const has=(sk,id)=>{const s=pack.topics.flatMap(t=>t.skills).find(x=>x.id==sk);return s&&(pack.pools[s.pool]||[]).some(i=>i.id==id)};
  pack.exams=(pack.exams||[]).map(e=>({...e,fixed:(e.fixed||[]).filter(f=>has(f.skill,f.id)),sections:(e.sections||[]).filter(s=>skills.has(s.skill)&&s.n>0)})).filter(e=>e.fixed.length||e.sections.length);
  pack.sheets=(pack.sheets||[]).map(sh=>({...sh,id:String(sh.id||'sheet'),sections:(sh.sections||[]).map(sec=>({...sec,layout:['lines','story','table','row'].includes(sec.layout)?sec.layout:'lines',items:(sec.items||[]).filter(id=>(pack.pools[sec.pool]||[]).some(i=>i.id==(id&&id.id!=null?id.id:id)))})).filter(sec=>sec.items.length)})).filter(sh=>sh.sections.length);
  loadPack(pack);
  for(const g of Object.keys(TOPIC_OF))for(let i=0;i<20;i++){try{const q=makeQ(g,i%3?{}:{ez:true});if(/undefined|NaN/.test(JSON.stringify(q).replace(/"mistake"|"accept"/g,'')))throw new Error('ערך חסר')}catch(e){STU.dropped.push(`${GNAME[g]}: ${e.message}`);break}}
  for(let id=1;id<=NEXAMS;id++)examItems(id).forEach(it=>{try{makeQ(it.g,it.p,it.seed)}catch(e){STU.dropped.push(`מבחן ${id}: ${e.message}`)}});
  STU.pack=pack;return {ok:true}}
/* a second, independent look at every answer (AI can be wrong; a wrong answer teaches the wrong thing) */
async function studioReview(){STU.warn=[];if(!STU.sample)return;
  const list=[];for(const [pn,items] of Object.entries(STU.pack.pools))items.forEach(it=>{if(it.vars)return;const parts=it.type=='multi'?it.parts:[it];
    list.push({pool:pn,id:it.id,q:String(it.text||'')+' '+String(it.visual||''),parts:parts.map(p=>({prompt:p.prompt||'',options:p.options,answer:p.answer,accept:p.accept}))})});
  if(!list.length)return;
  try{const r=await STU.sample.json(`Check these quiz items for a grade ${STU.pack.subject.grade||''} ${STU.pack.subject.name||''} unit. For each item decide if the given answer is correct and the question is clear.
Reply with ONLY a JSON array of the problems found (empty array if none): [{"pool":"..","id":"..","problem":"<short Hebrew explanation>"}]
ITEMS:\n${JSON.stringify(list).slice(0,120000)}`,{modelTier:'default',cache:false});
    if(Array.isArray(r))STU.warn=r.filter(x=>x&&x.id!=null).slice(0,60)}catch(e){STU.warn=[];STU.reviewFailed=e.code}}
function studioOpen(){loadPack(STU.pack);home()}
function studioBar(){if(!STU.pack)return;const n=Object.values(STU.pack.pools).reduce((a,x)=>a+x.length,0);
  const bar=document.createElement('div');bar.className='stubar noprint';
  bar.innerHTML=`<div><b>תצוגה מקדימה:</b> ${stuEsc(STU.pack.subject.unit||STU.pack.subject.name||'יחידה')} · ${n} שאלות${STU.warn.length?` · <span style="color:var(--bad)">⚠️ ${STU.warn.length} לבדיקה</span>`:' · ✓ נבדק'}${STU.dropped.length?` · הוסרו ${STU.dropped.length}`:''}</div>
    <div class="actions" style="margin:0"><button class="big sec" id="stuRev">📋 לבדוק שאלות</button><button class="big green" id="stuSave">💾 לשמור</button>${STU.owner?'':'<button class="big" id="stuSend">📤 לשלוח לבעל האתר</button>'}<button class="big sec" id="stuDl">⬇️ JSON</button><button class="big sec" id="stuBack">🛠️ לסטודיו</button></div>`;
  view.prepend(bar);
  bar.querySelector('#stuRev').onclick=studioList;const sd=bar.querySelector('#stuSend');if(sd)sd.onclick=studioSend;bar.querySelector('#stuSave').onclick=studioSave;bar.querySelector('#stuBack').onclick=()=>{STU.pack=null;PK.pack=null;studioHome()};
  bar.querySelector('#stuDl').onclick=async()=>{if(!STU.dl)return alert('הורדה לא זמינה כאן.');try{await STU.dl.save({filename:(STU.pack.subject.id||'unit')+'.json',data:JSON.stringify(STU.pack,null,1)})}catch(e){}};
}
/* the parent sees every question with its answer, and can remove any of them */
function studioList(){stopSpeech();const P=STU.pack;const W=new Map(STU.warn.map(w=>[w.pool+'|'+w.id,w.problem]));
  const ans=it=>{const parts=it.type=='multi'?it.parts:[it];return parts.map(p=>p.accept?`בין ${p.accept.min} ל-${p.accept.max}`:p.options?(()=>{const o=p.options.map(x=>typeof x=='string'?{t:x,v:x}:x).find(x=>String(x.v)==String(p.answer));return o?pkHtml(o.t):pkHtml(String(p.answer))})():pkHtml(String(p.answer).replace(/^=/,'{=')+(String(p.answer).startsWith('=')?'}':''),pkVars(it.vars))).join(' → ')};
  view.innerHTML=`<section class="lesson"><div class="actions" style="margin-top:0"><button class="big green" id="lBack">▶ חזרה לתצוגה המקדימה</button></div>
    ${STU.dropped.length?`<div class="warn"><b>הוסרו אוטומטית (לא עברו בדיקה):</b><br>${STU.dropped.map(stuEsc).join('<br>')}</div>`:''}
    ${STU.reviewFailed?`<div class="warn">הבדיקה הכפולה לא רצה (${stuEsc(STU.reviewFailed)}). כדאי לעבור על התשובות בעיון.</div>`:''}
    ${P.topics.map(t=>`<h2 class="sec-t">${stuEsc(t.name)}</h2>`+t.skills.map(s=>`<h3>${stuEsc(s.name)}</h3><div class="stulist">${(P.pools[s.pool]||[]).map(it=>{const w=W.get(s.pool+'|'+it.id);
      return `<div class="sturow ${w?'bad':''}"><div style="flex:1;min-width:0"><div>${pkHtml(it.text||'',pkVars(it.vars))} ${it.visual?pkHtml(it.visual,pkVars(it.vars)):''}</div><div class="small">תשובה: <b>${ans(it)}</b>${it.vars?' · (מספרים משתנים)':''}</div>${w?`<div class="small" style="color:var(--bad)">⚠️ ${stuEsc(w)}</div>`:''}</div>
        <button class="iconbtn" data-del="${stuEsc(s.pool)}|${stuEsc(it.id)}">🗑️ להסיר</button></div>`}).join('')}</div>`).join('')).join('')}</section>`;
  view.querySelector('#lBack').onclick=studioOpen;
  view.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const [pool,id]=b.dataset.del.split('|');P.pools[pool]=P.pools[pool].filter(i=>String(i.id)!=id);STU.warn=STU.warn.filter(w=>!(w.pool==pool&&String(w.id)==id));
    const r=studioRepair(P);if(!r.ok){alert('אחרי ההסרה לא נשארו שאלות.');return}studioList()});
}
async function studioSave(){if(!STU.db||!STU.uid)return alert('אין חיבור לשמירה בדף הזה.');const P=STU.pack;const json=JSON.stringify(P);
  if(json.length>240000)return alert('היחידה גדולה מדי לשמירה. אפשר להוריד אותה כקובץ.');
  const id=(String(P.subject.id||'unit').replace(/[^a-z0-9-]/gi,'').slice(0,30)||'unit')+'-'+Date.now().toString(36);
  try{await STU.db.collection('data/users/'+STU.uid).doc(id).set({name:P.subject.unit||P.subject.name||'יחידה',subject:P.subject.name||'',grade:P.subject.grade||'',created:Date.now(),items:Object.values(P.pools).reduce((a,x)=>a+x.length,0),warn:STU.warn.length,json});
    alert(STU.owner?'נשמר ✓ אפשר לבקש מ-Claude בשיחה להעלות את היחידה לאתר.':'נשמר ✓ רק את/ה רואה את היחידות שלך. כדי שהיחידה תעלה לאתר, לוחצים "📤 לשלוח לבעל האתר".')}catch(e){alert('השמירה נכשלה: '+(e.code||e.message))}}
async function studioSaved(){const el=view.querySelector('#sSaved');if(!el)return;if(!STU.uid){el.textContent='צריך להיות מחובר/ת ל-Claude כדי לשמור.';return}
  try{const snap=await STU.db.collection('data/users/'+STU.uid).orderBy('created','desc').limit(30).get();if(!view.contains(el))return;
    if(snap.empty){el.textContent='עוד אין יחידות שמורות.';return}
    el.innerHTML=snap.docs.map(d=>{const x=d.data()||{};return `<div class="sturow"><div style="flex:1"><b>${stuEsc(x.name)}</b> · ${stuEsc(x.subject)} · כיתה ${stuEsc(x.grade)} · ${x.items||0} שאלות · ${new Date(x.created||0).toLocaleDateString('he-IL')}</div><button class="iconbtn" data-open="${stuEsc(d.id)}">▶ לפתוח</button><button class="iconbtn" data-rm="${stuEsc(d.id)}">🗑️</button></div>`}).join('');
    el.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{const d=await STU.db.collection('data/users/'+STU.uid).doc(b.dataset.open).get();const x=d.data();if(!x)return;STU.warn=[];STU.dropped=[];const r=studioRepair(JSON.parse(x.json));if(r.ok)studioOpen()});
    el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=async()=>{if(!confirm('למחוק את היחידה?'))return;await STU.db.collection('data/users/'+STU.uid).doc(b.dataset.rm).delete();studioSaved()})}
  catch(e){el.textContent='לא הצלחתי לטעון את היחידות השמורות.'}}

/* a parent who is not the site owner can send a unit to the owner (they can't read each other's) */
async function studioSend(){if(!STU.db)return alert('אין חיבור.');const P=STU.pack;const json=JSON.stringify(P);if(json.length>240000)return alert('היחידה גדולה מדי. אפשר להוריד אותה כקובץ ולשלוח.');
  const note=prompt('הערה לבעל האתר (לא חובה): למשל שם בית הספר, או מה לבדוק','')??'';
  if(!STU.uid)return alert('צריך להיות מחובר/ת ל-Claude.');
  try{await STU.db.collection('submissions').doc(STU.uid).set({name:P.subject.unit||P.subject.name||'יחידה',subject:P.subject.name||'',grade:P.subject.grade||'',created:Date.now(),note:String(note).slice(0,300),warn:STU.warn.length,json});alert('נשלח ✓ תודה! (כל שליחה חדשה מחליפה את הקודמת)')}
  catch(e){alert('השליחה נכשלה: '+(e.code||e.message))}}
