/* ================= CONTENT PACKS (format "masa-pack/1") =================
   A subject is plain JSON data: topics → skills → pools of items, plus lessons, exams and class worksheets.
   No code in the content, so packs can be written by hand, converted from a worksheet, or produced by an AI and validated.
   Text uses a small safe markup (everything else is escaped):
     <en>…</en> English (read by an English voice) · <m>…</m> math · <f>3/4</f> fraction · <mx>2 1/3</mx> mixed number
     **bold** · ___ blank · new line = line break · {a} a template variable · {=a*b} a computed value                  */
const PK={pack:null,items:{}};
const pkEsc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/* safe arithmetic for templates: numbers, + − * / % ( ), min/max/round/floor, variables */
function pkCalc(expr,V){const t=String(expr).match(/\d+\.?\d*|[a-zA-Z_]\w*|[-+*/%(),]/g)||[];let i=0;
  const peek=()=>t[i],take=()=>t[i++];
  const prim=()=>{const x=take();if(x=='(' ){const v=add();take();return v}if(x=='-')return -prim();if(/^\d/.test(x))return +x;
    if(['min','max','round','floor','ceil','abs','gcd'].includes(x)){take();const a=[add()];while(peek()==','){take();a.push(add())}take();
      return x=='gcd'?gcd(Math.abs(a[0]),Math.abs(a[1])):Math[x](...a)}
    if(x in V)return +V[x];throw new Error('unknown '+x)};
  const mul=()=>{let v=prim();while(['*','/','%'].includes(peek())){const o=take(),r=prim();v=o=='*'?v*r:o=='/'?v/r:v%r}return v};
  const add=()=>{let v=mul();while(['+','-'].includes(peek())){const o=take(),r=mul();v=o=='+'?v+r:v-r}return v};
  const v=add();if(i<t.length)throw new Error('bad expression');return Math.round(v*1e9)/1e9}
function pkVars(spec){const V={};for(const [k,d] of Object.entries(spec||{})){
    V[k]=Array.isArray(d)?(d.length==2&&d.every(Number.isFinite)?R(d[0],d[1]):pick(d)):d&&d.pick?pick(d.pick):d&&d.calc?pkCalc(d.calc,V):d}
  return V}
function pkSub(s,V){return String(s??'').replace(/\{=([^}]+)\}/g,(_,e)=>{try{return fmtNum(pkCalc(e,V))}catch(x){return '?'}}).replace(/\{(\w+)\}/g,(m,k)=>k in V?V[k]:m)}
const fmtNum=n=>Number.isInteger(n)&&Math.abs(n)>=10000?fmt(n):String(n);
/* markup → html (escaped first, so pack text can never inject html) */
function pkHtml(s,V){if(s==null||s==='')return '';let h=pkEsc(pkSub(s,V||{}));
  h=h.replace(/&lt;f&gt;\s*(\d+)\s*\/\s*(\d+)\s*&lt;\/f&gt;/g,(_,n,d)=>F(+n,+d))
     .replace(/&lt;mx&gt;\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*&lt;\/mx&gt;/g,(_,w,n,d)=>MX(+w,+n,+d))
     .replace(/&lt;en&gt;([\s\S]*?)&lt;\/en&gt;/g,(_,x)=>`<span class="eng" dir="ltr" lang="en">${x}</span>`)
     .replace(/&lt;m&gt;([\s\S]*?)&lt;\/m&gt;/g,(_,x)=>M(x))
     .replace(/\*\*([\s\S]+?)\*\*/g,'<b>$1</b>').replace(/_{3,}/g,'<span class="eng" data-say="מה">___</span>').replace(/\n/g,'<br>');
  return h}
const pkFill=(s,a,V)=>pkHtml(String(s).replace(/_{3,}/,'⟦'+a+'⟧'),V).replace(/⟦([^⟧]*)⟧/,'<span class="ans">$1</span>');
function pkItem(pool,id){const P=PK.pack.pools[pool]||[];return id!=null?P.find(x=>x.id==id)||P[id]:pick(P)}
/* one item → one engine part */
function pkPart(it,V,o={}){
  const T=x=>pkHtml(x,V);const base={hint:T(it.hint),steps:(it.steps||[]).map(s=>typeof s=='string'?{t:T(s)}:{t:T(s.t),v:s.v?T(s.v):''}),line:T(it.line||''),exam:true,examPrompt:null};
  const mk=it.mistakes?v=>{const m=it.mistakes[String(v).toLowerCase()]??it.mistakes[String(v)];return m?T(m):null}:null;if(mk)base.mistake=mk;
  const prompt=it.prompt?T(it.prompt):null;
  if(it.type=='choice'){let opts=(it.options||[]).map(x=>typeof x=='string'?{t:x,v:x}:x);const ans=String(pkSub(it.answer,V));
    const keep=o.ez?3:it.show;if(keep&&opts.length>keep){const right=opts.find(x=>String(pkSub(x.v,V))==ans);opts=[right,...shuffle(opts.filter(x=>x!==right)).slice(0,keep-1)]}
    const H=x=>{const h=T(x.t);return {html:h,val:String(pkSub(x.v,V)),say:htmlToSpeechSafe(h),txt:true}};
    let list=opts.map(H);if(it.shuffle!==false)list=shuffle(list);
    return choice(prompt,list,ans,{...base,alts:(it.alts||[]).map(String)})}
  if(it.type=='number'){const a=it.answer!=null?pkCalc(String(pkSub(it.answer,V)).replace(/^=/,''),V):null;const ac=it.accept;
    const p=num(prompt,a??(ac&&ac.example),{...base,dec:!!it.decimal||!Number.isInteger(+a)});
    if(ac)p.accept=v=>{const x=+v,lo=pkCalc(pkSub(ac.min,V),V),hi=pkCalc(pkSub(ac.max,V),V);if(isNaN(x)||(ac.integer&&!Number.isInteger(x)))return false;return ac.exclusive?x>lo&&x<hi:x>=lo&&x<=hi};
    return p}
  if(it.type=='fraction')return fracPart(prompt,pkSub(it.answer,V),{...base,mixed:/ /.test(it.answer)});
  if(it.type=='spell')return spellPart(prompt,pkSub(it.answer,V),{...base,extraLetters:o.ez?1:2});
  throw new Error('unknown item type '+it.type)}
function pkQuestion(skill,p={}){
  const sk=PK.skills[skill],it=p.item||(p.ix!=null?(PK.pack.pools[sk.pool]||[])[p.ix]:pkItem(sk.pool,p.id));const V=pkVars(it.vars);
  const parts=it.type=='multi'?it.parts.map(x=>pkPart(x,V,p)):[pkPart(it,V,p)];
  const q={topic:sk.topic,text:pkHtml(p.paper&&it.paperText?it.paperText:(it.text||sk.text||''),V),visual:it.visual?`<div class="${it.box?'pkbox':'bigmath'} ${it.big?'bigword':''}">${pkHtml(it.visual,V)}${it.sub&&!p.paper?`<span class="tr">${pkHtml(it.sub,V)}</span>`:''}</div>`:'',
    parts,paper:(it.paper||(it.line?[it.line]:[])).map(x=>pkHtml(x,V)),rec:String(it.id||pkSub(it.visual||it.text,V)).replace(/<[^>]+>/g,'').slice(0,40),srsGen:'pk_'+skill};
  if(it.type=='multi'&&!it.guided)q.parts.forEach(x=>x.exam=true);
  else if(it.type=='multi')q.parts.forEach((x,i)=>{x.exam=i==q.parts.length-1;x.keepLine=i<q.parts.length-1;x.replaceLast=i>0});
  return q}
/* worksheets: printable layouts built from the items' answers */
function pkSheetPrint(sh){
  return `<h2>${pkHtml(sh.title||sh.name)}</h2>`+sh.sections.map(sec=>{const items=sec.items.map(r=>pkItem(r.pool||sec.pool,r.id??r));
    const ans=it=>{const a=String(it.answer);const o=(it.options||[]).map(x=>typeof x=='string'?{t:x,v:x}:x).find(x=>String(x.v)==a);return o?pkHtml(o.t):pkHtml(a)};
    const head=sec.heading?`<h3>${pkHtml(sec.heading)}</h3>`:'';
    if(sec.layout=='story')return head+`<p>${items.map(it=>pkFill(it.paperLine||it.visual,ans(it).replace(/<[^>]+>/g,''))).join(' ')}</p>`;
    if(sec.layout=='table'){const cols=sec.columns;const by=cols.map(c=>items.filter(it=>String(it.answer)==c));const rows=Math.max(...by.map(x=>x.length));
      return head+`<table><tr>${cols.map(c=>`<th>${pkHtml(c)}</th>`).join('')}</tr>${[...Array(rows).keys()].map(r=>`<tr>${by.map(c=>`<td>${c[r]?`<span class="ans" style="min-width:0;border:none">${pkHtml(c[r].word||c[r].visual)}</span>`:''}</td>`).join('')}</tr>`).join('')}</table>`}
    if(sec.layout=='row')return head+`<table ${sec.dir=='rtl'?'dir="rtl"':''}><tr>${items.map(it=>`<th>${pkHtml(it.visual)}</th>`).join('')}</tr><tr>${items.map(it=>`<td><span class="ans" style="min-width:0;border:none">${ans(it)}</span></td>`).join('')}</tr></table>`;
    return head+items.map((it,i)=>`<div>${i+1}. ${pkFill(it.paperLine||it.visual,ans(it).replace(/<[^>]+>/g,''))}</div>`).join('')}).join('')}
/* load a pack into the engine */
function pkNormalize(P){for(const [k,v] of Object.entries(P.pools||{}))if(v&&!Array.isArray(v))P.pools[k]=(v.items||[]).map(it=>({...(v.defaults||{}),...it}));return P}
function loadPack(P){
  if(!P||P.schema!='masa-pack/1')throw new Error('not a masa-pack/1');pkNormalize(P);
  PK.pack=P;PK.skills={};
  const resetO=(o,v)=>{for(const k in o)delete o[k];Object.assign(o,v||{})};
  TOPICS.splice(0,TOPICS.length,...P.topics.map(t=>({id:t.id,name:t.name,glyph:t.glyph||'★',bg:t.bg||'#e5ecf5'})));
  resetO(TNAME,Object.fromEntries(TOPICS.map(t=>[t.id,t.name])));
  const TG={},GN={},QN={},LS={};
  P.topics.forEach(t=>{TG[t.id]=[];(t.skills||[]).forEach(s=>{const g='pk_'+s.id;PK.skills[s.id]={...s,topic:t.id};TG[t.id].push(g);GN[g]=s.name;if(s.examQ)QN[g]=s.examQ;G[g]=(p={})=>pkQuestion(s.id,p)});
    LS[t.id]=(t.lessons||[]).map(l=>({title:pkHtml(l.title),t:pkHtml(l.text),v:l.visual?pkHtml(l.visual):''}))});
  resetO(TOPIC_GENS,TG);resetO(TOPIC_OF,{});for(const [t,gs] of Object.entries(TG))gs.forEach(g=>TOPIC_OF[g]=t);
  resetO(GNAME,GN);resetO(QNUM,QN);resetO(LESSONS,LS);resetO(LESSON_EXTRA,{});resetO(QCG,{});resetO(QNUM2,{});
  EXAM.splice(0,EXAM.length);EXAM_T.splice(0,EXAM_T.length);EXAM2.splice(0,EXAM2.length);
  const pts=[[840,110],[500,250],[170,390],[500,500],[840,420],[170,130],[840,270]];MAPPTS.splice(0,MAPPTS.length,...pts.slice(0,Math.max(1,TOPICS.length)));
  const ex=P.exams||[];NEXAMS=ex.length;
  examItems=function(id){const e=ex[id-1];if(!e)return [];const out=[];
    if(e.fixed)e.fixed.forEach((f,i)=>out.push({g:'pk_'+f.skill,p:{id:f.id,paper:true},lab:f.label||`שאלה ${i+1}`}));
    (e.sections||[]).forEach((s,si)=>{const pool=(PK.pack.pools[PK.skills[s.skill].pool]||[]);let t=id*7919+si*131+7;const rnd=()=>{t=(t*1103515245+12345)%2147483648;return t/2147483648};
      const idx=pool.map((_,i)=>i);for(let i=idx.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]]}
      for(let k=0;k<s.n;k++)out.push({g:'pk_'+s.skill,p:{ix:idx[k%idx.length],paper:true},seed:id*1009+si*97+k*31+1,lab:(s.label||'שאלה {n}').replace('{n}',k+1)})});
    return out};
  SHEETS.splice(0,SHEETS.length,...(P.sheets||[]).map(sh=>({id:sh.id,name:sh.name,sub:sh.sub||'',sections:sh.sections.map(sec=>({...sec,items:sec.items.map(r=>({pool:r.pool||sec.pool,id:r.id??r}))})),print(){return pkSheetPrint(sh)}})));
  G.sheetQ=(p={})=>{const sh=SHEETS.find(x=>x.id==p.s),sec=sh.sections[p.sec],r=sec.items[p.i];const sk=Object.values(PK.skills).find(k=>k.pool==r.pool);
    return pkQuestion(sk?sk.id:Object.keys(PK.skills)[0],{item:pkItem(r.pool,r.id)})};
  if(P.cfg)Object.assign(CFG,P.cfg);
  /* progress from older question names carries over (e.g. a hand-coded unit that became a pack) */
  for(const [old,sk] of Object.entries(P.legacy||{})){const g='pk_'+sk;for(const key of ['genStats','lvl','gStreak','srs']){const o=ST[key];if(o&&o[old]!=null&&o[g]==null)o[g]=o[old]}}
  if(ex[0])CFG.origName=ex[0].name;if(ex[1])CFG.variantName=ex[1].name;
}
/* validator (used by the build and, later, for AI-made packs): returns a list of problems */
function validatePack(P){pkNormalize(P);const errs=[];const E=m=>errs.push(m);
  if(P.schema!='masa-pack/1')E('schema');const pools=P.pools||{};
  (P.topics||[]).forEach(t=>(t.skills||[]).forEach(s=>{if(!pools[s.pool]||!pools[s.pool].length)E(`skill ${s.id}: empty pool ${s.pool}`)}));
  for(const [pn,items] of Object.entries(pools))items.forEach((it,i)=>{const w=`${pn}[${it.id??i}]`;
    for(let r=0;r<(it.vars?30:1);r++){let V;try{V=pkVars(it.vars)}catch(e){E(w+' vars: '+e.message);break}
      const parts=it.type=='multi'?it.parts:[it];
      for(const pt of parts){if(!['choice','number','fraction','spell'].includes(pt.type)){E(w+' type '+pt.type);continue}
        if(pt.answer==null&&!(pt.type=='number'&&pt.accept))E(w+' no answer');
        if(pt.type=='choice'){const vals=(pt.options||[]).map(x=>String(pkSub(typeof x=='string'?x:x.v,V)));const a=String(pkSub(pt.answer,V));
          if(!vals.includes(a))E(`${w}: answer "${a}" not in options`);if(new Set(vals).size!=vals.length)E(w+': duplicate options')}
        if(pt.type=='number'){try{const a=pt.answer!=null?pkCalc(String(pkSub(pt.answer,V)).replace(/^=/,''),V):null;if(a!=null&&!isFinite(a))E(w+' answer not a number')}catch(e){E(w+' answer: '+e.message)}}
        if(pt.type=='spell'&&!/^[A-Za-z]+$/.test(pkSub(pt.answer,V)))E(w+': spell answer must be letters')}}});
  (P.exams||[]).forEach((e,i)=>{(e.fixed||[]).forEach(f=>{if(!(P.topics||[]).some(t=>(t.skills||[]).some(s=>s.id==f.skill)))E(`exam ${i+1}: unknown skill ${f.skill}`)})});
  return errs}
