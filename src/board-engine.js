/* ================= BOARD MECHANICS (subject-independent) =================
   The child does something with the items; the result is turned into ONE canonical string, so hints, mistakes,
   step-by-step explanations, levels and exams work exactly as for every other question type.
   Nothing here knows the subject: the content (text, numbers, words) comes from the pack.
     sort   items go into groups            { bins:["a","b"], items:[{t:"x",bin:0|"a"}] }
     match  pair left with right            { pairs:[{l:"x",r:"y"}] }
     order  put in order (listed correctly) { items:["first","second",…] }
     tap    tap the right words             { tokens:["The",{t:"cat",ok:true},"runs"] }
     cells  colour parts of a shape         { shape:"pie|bar", parts:4, wholes:1, count:3 }
   (synced into math-journey.html by sync_engine.py, together with pack-engine.js)                                  */
const BOARD_TYPES=['sort','match','order','tap','cells'];
/* the look (kids/teen) comes from the pack's class: see bdLookOf */
const BD_SAY={sort:'לחצו על פריט ואז על הקבוצה שלו.',match:'לחצו על פריט בצד אחד ואז על הפריט שמתאים לו.',order:'לחצו על הפריטים לפי הסדר.',tap:'לחצו על המילים הנכונות.',cells:'לחצו על החלקים כדי לצבוע אותם.'};
const bdMixed=n=>{const idx=[...Array(n).keys()];let d=shuffle(idx.slice());for(let k=0;k<6&&n>1&&d.every((x,i)=>x==i);k++)d=shuffle(idx.slice());return d};
/* one pack item → one engine part (kind 'board') */
function boardPart(it,V,base,prompt){
  const T=x=>pkHtml(x,V),mode=it.type;let d,answer;
  if(mode=='sort'){const bins=it.bins.map(T);
    const items=it.items.map(x=>({h:T(x.t),b:typeof x.bin=='number'?x.bin:it.bins.findIndex(b=>String(pkSub(b,V))==String(pkSub(x.bin,V)))}));
    d={bins,items,disp:bdMixed(items.length)};answer=items.map(x=>x.b).join(',')}
  else if(mode=='match'){d={L:it.pairs.map(x=>T(x.l)),R:it.pairs.map(x=>T(x.r)),disp:bdMixed(it.pairs.length)};answer=it.pairs.map((_,i)=>i).join(',')}
  else if(mode=='order'){d={items:it.items.map(T),disp:bdMixed(it.items.length)};answer=it.items.map((_,i)=>i).join(',')}
  else if(mode=='tap'){const tk=it.tokens.map(x=>typeof x=='string'?{t:x}:x);d={tokens:tk.map(x=>T(x.t)),ok:tk.map(x=>!!x.ok),ltr:!/[֐-׿]/.test(tk.map(x=>x.t).join(''))};answer=tk.map((x,i)=>x.ok?i:-1).filter(i=>i>=0).join(',')}
  else{const parts=+pkSub(it.parts,V),wholes=+pkSub(it.wholes??1,V),count=+pkSub(it.count,V);d={shape:it.shape||'pie',parts,wholes,count};answer=String(count)}
  return {...base,kind:'board',mode,prompt,d,answer:String(answer)}}
function boardState(pt){const d=pt.d;
  if(pt.mode=='sort')return {place:d.items.map(()=>-1),sel:null};
  if(pt.mode=='match')return {pair:d.L.map(()=>-1),selL:null,selR:null};
  if(pt.mode=='order')return {seq:[]};
  if(pt.mode=='tap')return {on:d.tokens.map(()=>false)};
  return {on:[...Array(d.parts*d.wholes)].map(()=>false)}}
function boardHtml(pt){return `<div class="bd bd-${pt.mode}" id="bdZone"></div><div class="actions" style="justify-content:center"><button class="big" id="bdOk">בדיקה ✓</button></div>`}
function boardInit(pt){SS.bd=boardState(pt);const z=view.querySelector('#bdZone');
  const act=el=>{const b=el.closest('[data-a]');if(b&&!SS.locked&&!SS.bd.done&&!b.disabled)boardAct(pt,b.dataset.a,+b.dataset.i)};
  z.addEventListener('click',e=>act(e.target));
  z.addEventListener('keydown',e=>{if((e.key=='Enter'||e.key==' ')&&e.target.matches('svg [data-a]')){e.preventDefault();act(e.target)}});
  view.querySelector('#bdOk').onclick=()=>boardCheck(pt);boardRender()}
function boardAct(pt,a,i){const st=SS.bd;st.flag=null;st.bad=false;const prev=pt.mode=='sort'?bdRects():null;
  if(a=='chip'){if(st.place[i]>=0){st.place[i]=-1;st.sel=null}else st.sel=st.sel==i?null:i}
  else if(a=='bin'){if(st.sel!=null){st.place[st.sel]=i;st.sel=null}}
  else if(a=='L'){if(st.pair[i]>=0){st.pair[i]=-1;st.selL=null}else st.selL=st.selL==i?null:i}
  else if(a=='R'){const k=st.pair.indexOf(i);if(k>=0){st.pair[k]=-1;st.selR=null}else st.selR=st.selR==i?null:i}
  else if(a=='pick')st.seq.push(i);
  else if(a=='slot')st.seq.splice(i,1);
  else if(a=='tok'||a=='cell')st.on[i]=!st.on[i];
  if(pt.mode=='match'&&st.selL!=null&&st.selR!=null){st.pair[st.selL]=st.selR;st.selL=st.selR=null}
  boardRender(prev)}
/* what the child built, as the same string as pt.answer; null while it is incomplete */
function boardCanon(pt){const st=SS.bd;
  if(pt.mode=='sort')return st.place.every(x=>x>=0)?st.place.join(','):null;
  if(pt.mode=='match')return st.pair.every(x=>x>=0)?st.pair.join(','):null;
  if(pt.mode=='order')return st.seq.length==pt.d.items.length?st.seq.join(','):null;
  if(pt.mode=='tap')return st.on.some(Boolean)?st.on.map((x,i)=>x?i:-1).filter(i=>i>=0).join(','):null;
  return st.on.some(Boolean)?String(st.on.filter(Boolean).length):null}
function boardCheck(pt){if(SS.locked||SS.bd.done)return;const v=boardCanon(pt);
  if(v==null){coach({sort:'עוד לא מיינת את כל הפריטים.',match:'עוד לא חיברת את כל הזוגות.',order:'עוד לא סידרת את כל הפריטים.',tap:'עוד לא סימנת אף מילה.',cells:'עוד לא צבעת אף חלק.'}[pt.mode],'hint','think');return}
  answer(v,null)}
function boardFlags(pt){const st=SS.bd,d=pt.d,f={};
  if(pt.mode=='sort')d.items.forEach((x,i)=>f[i]=st.place[i]==x.b?'right':'wrong');
  if(pt.mode=='match')st.pair.forEach((r,i)=>f[i]=r==i?'right':'wrong');
  if(pt.mode=='order')st.seq.forEach((x,k)=>f[k]=x==k?'right':'wrong');
  if(pt.mode=='tap')d.ok.forEach((ok,i)=>{if(st.on[i])f[i]=ok?'right':'wrong';else if(ok)f[i]='miss'});
  return f}
/* wrong answer: show what is right and what is not, then take back only the wrong pieces */
function boardWrong(pt){const st=SS.bd;st.flag=boardFlags(pt);if(pt.mode=='cells')st.bad=true;boardRender();
  setTimeout(()=>{if(SS.locked||SS.bd!==st||!view.querySelector('#bdZone'))return;const f=st.flag||{};st.flag=null;st.bad=false;
    if(pt.mode=='sort')pt.d.items.forEach((_,i)=>{if(f[i]=='wrong')st.place[i]=-1});
    if(pt.mode=='match')st.pair.forEach((_,i)=>{if(f[i]=='wrong')st.pair[i]=-1});
    if(pt.mode=='order'){const k=st.seq.findIndex((_,i)=>f[i]=='wrong');if(k>=0)st.seq.length=k}
    if(pt.mode=='tap')st.on.forEach((_,i)=>{if(f[i]=='wrong')st.on[i]=false});
    if(pt.mode=='cells')st.on=st.on.map(()=>false);
    st.sel=st.selL=st.selR=null;boardRender()},1100)}
/* right answer (or after the step-by-step explanation): show the finished board */
function boardRight(pt){const st=SS.bd,d=pt.d;if(!st)return;st.done=true;st.flag={};st.bad=false;
  if(pt.mode=='sort'){st.place=d.items.map(x=>x.b);d.items.forEach((_,i)=>st.flag[i]='right')}
  if(pt.mode=='match'){st.pair=d.L.map((_,i)=>i);d.L.forEach((_,i)=>st.flag[i]='right')}
  if(pt.mode=='order'){st.seq=d.items.map((_,i)=>i);d.items.forEach((_,i)=>st.flag[i]='right')}
  if(pt.mode=='tap'){st.on=d.ok.slice();d.ok.forEach((ok,i)=>{if(ok)st.flag[i]='right'})}
  if(pt.mode=='cells'){st.on=st.on.map((_,i)=>i<d.count);st.good=true}
  st.sel=st.selL=st.selR=null;boardRender()}
/* the answer as text (used by the explanation) */
function boardAns(pt){const d=pt.d;
  if(pt.mode=='sort')return d.bins.map((b,bi)=>`<b>${b}</b>: ${d.items.filter(x=>x.b==bi).map(x=>x.h).join(', ')}`).join('<br>');
  if(pt.mode=='match')return d.L.map((l,i)=>`${l} ↔ ${d.R[i]}`).join('<br>');
  if(pt.mode=='order')return d.items.join(' ← ');
  if(pt.mode=='tap')return d.tokens.filter((_,i)=>d.ok[i]).join(', ');
  return `${d.count} מתוך ${d.parts*d.wholes} חלקים`}
/* look: "kids" (default) or "teen", from the pack's class (subject.grade) or cfg.look. Colour keeps ONE meaning: the colour of a group. */
function bdLookOf(P){const c=P&&P.cfg&&P.cfg.look;if(c=='kids'||c=='teen')return c;
  const g=String((P&&P.subject&&P.subject.grade)||'').replace(/[׳'"״\s]/g,'');
  const n=parseInt(g,10);if(!isNaN(n))return n<=6?'kids':'teen';
  return ['א','ב','ג','ד','ה','ו'].includes(g)||!g?'kids':'teen'}
function setLook(P){document.documentElement.dataset.look=bdLookOf(P)}
/* shapes for 'cells' (pie or bar, one per whole). Kids get a cookie, teens a flat colour. */
function bdShape(d,on,bad,locked,w0){const W=120,bar=d.shape=='bar';let out='';
  for(let w=0;w<d.wholes;w++){let s=`<svg class="bd-shape" viewBox="0 0 ${bar?W*1.6:W} ${bar?44:W}" role="group" aria-label="שלם ${w+1} מתוך ${d.wholes}, מחולק ל-${d.parts} חלקים שווים">`;
    if(w==0)s+=`<defs><radialGradient id="bdck" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#f0bd78"/><stop offset=".7" stop-color="#d9984f"/><stop offset="1" stop-color="#b9743a"/></radialGradient>
      <pattern id="bdchips" width="120" height="120" patternUnits="userSpaceOnUse">${[[30,24,4],[78,18,3.5],[96,50,4],[58,44,3],[22,68,3.5],[70,76,4],[102,92,3.5],[40,100,4],[14,100,3],[150,20,4],[170,30,3.5]].map(([x,y,r])=>`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r*.8}" fill="#4a2a1a" transform="rotate(${x*3} ${x} ${y})"/>`).join('')}</pattern></defs>`;
    for(let k=0;k<d.parts;k++){const i=w*d.parts+k;
      const attr=`class="bd-cell${on[i]?' on':''}" data-a="cell" data-i="${i}" ${locked?'':'tabindex="0"'} role="button" aria-pressed="${!!on[i]}" aria-label="חלק ${k+1}"`;
      let geo;
      if(bar){const cw=W*1.6/d.parts;geo=(extra)=>`<rect ${extra} x="${k*cw+1}" y="2" width="${cw-2}" height="40" rx="4"/>`}
      else{const a=k*2*Math.PI/d.parts-Math.PI/2,b=(k+1)*2*Math.PI/d.parts-Math.PI/2,r=56,dd=`M60 60 L${(60+r*Math.cos(a)).toFixed(2)} ${(60+r*Math.sin(a)).toFixed(2)} A${r} ${r} 0 0 1 ${(60+r*Math.cos(b)).toFixed(2)} ${(60+r*Math.sin(b)).toFixed(2)} Z`;geo=(extra)=>`<path ${extra} d="${dd}"/>`}
      s+=`<g ${attr}>${geo('class="base"')}${geo('class="tex" fill="url(#bdchips)"')}</g>`}
    out+=s+'</svg>'}
  return out}
const bdReduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const bdRects=()=>{const m={};document.querySelectorAll('#bdZone .bd-chip[data-i]').forEach(c=>m[c.dataset.i]=c.getBoundingClientRect());return m};
function bdFlip(prev){if(!prev||bdReduce())return;const teen=document.documentElement.dataset.look=='teen';
  document.querySelectorAll('#bdZone .bd-chip[data-i]').forEach(c=>{const a=prev[c.dataset.i];if(!a)return;const b=c.getBoundingClientRect(),dx=a.left-b.left,dy=a.top-b.top;
    if(Math.abs(dx)+Math.abs(dy)>2)c.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:teen?180:300,easing:teen?'ease-out':'cubic-bezier(.2,.9,.3,1.2)'})})}
function boardRender(prev){const pt=SS.q.parts[SS.part],z=view.querySelector('#bdZone');if(!z)return;
  const st=SS.bd,d=pt.d,f=st.flag||{},lock=st.done?' disabled':'';
  const chip=(a,i,h,extra='',k)=>`<button class="opt txt bd-chip ${extra} ${f[i]||''}" data-a="${a}" data-i="${i}" data-k="${k==null||k<0?'':k%6}"${lock}>${h}</button>`;
  let h='';
  if(pt.mode=='sort')
    h=`<div class="bd-bins">${d.bins.map((b,bi)=>`<div class="bd-bin" data-k="${bi%6}"><button class="bd-binh" data-a="bin" data-i="${bi}"${lock}>${b}</button><div class="bd-chips">${d.items.map((x,i)=>st.place[i]==bi?chip('chip',i,x.h,'',bi):'').join('')}</div></div>`).join('')}</div>
      <div class="bd-tray">${d.disp.filter(i=>st.place[i]<0).map(i=>chip('chip',i,d.items[i].h,st.sel==i?'sel':'')).join('')}</div>`;
  if(pt.mode=='match'){const used=j=>st.pair.indexOf(j);
    h=`<div class="bd-cols"><div class="bd-col">${d.L.map((x,i)=>chip('L',i,x,st.selL==i?'sel':'',st.pair[i]>=0?i:-1)).join('')}</div>
      <div class="bd-col">${d.disp.map(j=>chip('R',j,d.R[j],st.selR==j?'sel':'',used(j)>=0?used(j):-1)).join('')}</div></div>`}
  if(pt.mode=='order')
    h=`<div class="bd-row">${d.items.map((_,k)=>st.seq[k]!=null?chip('slot',k,d.items[st.seq[k]],'bd-slot'):`<span class="opt txt bd-chip bd-slot bd-empty">${k+1}</span>`).join('')}</div>
      <div class="bd-tray">${d.disp.filter(i=>!st.seq.includes(i)).map(i=>chip('pick',i,d.items[i])).join('')}</div>`;
  if(pt.mode=='tap')
    h=`<div class="bd-row bd-text" dir="${d.ltr?'ltr':'rtl'}">${d.tokens.map((t,i)=>`<button class="bd-tok ${st.on[i]?'on':''} ${f[i]||''}" data-a="tok" data-i="${i}" aria-pressed="${!!st.on[i]}"${lock}>${t}</button>`).join(' ')}</div>`;
  if(pt.mode=='cells')
    h=`<div class="bd-row bd-shapes ${st.bad?'bad':''} ${st.good?'good':''}">${bdShape(d,st.on,st.bad,st.done)}</div><div class="flabels" style="text-align:center">${st.on.filter(Boolean).length} חלקים צבועים</div>`;
  z.innerHTML=h;bdFlip(prev)}
/* validator part (called from validatePack for every board item, once per random draw of its variables) */
function boardValidate(pt,V,w,E){const sub=x=>pkSub(x,V);const uniq=a=>new Set(a.map(x=>String(sub(x)))).size==a.length;
  if(pt.type=='sort'){if(!Array.isArray(pt.bins)||pt.bins.length<2||!Array.isArray(pt.items)||pt.items.length<2)return E(w+': sort needs 2+ bins and 2+ items');
    if(!uniq(pt.bins))E(w+': duplicate bins');
    pt.items.forEach(x=>{const b=typeof x.bin=='number'?x.bin:pt.bins.findIndex(y=>String(sub(y))==String(sub(x.bin)));if(!(b>=0&&b<pt.bins.length))E(`${w}: item "${x.t}" has no valid bin`)});
    if(!uniq(pt.items.map(x=>x.t)))E(w+': duplicate items')}
  if(pt.type=='match'){if(!Array.isArray(pt.pairs)||pt.pairs.length<2)return E(w+': match needs 2+ pairs');
    if(!uniq(pt.pairs.map(x=>x.l))||!uniq(pt.pairs.map(x=>x.r)))E(w+': duplicate side in pairs')}
  if(pt.type=='order'){if(!Array.isArray(pt.items)||pt.items.length<2)return E(w+': order needs 2+ items');if(!uniq(pt.items))E(w+': duplicate items')}
  if(pt.type=='tap'){if(!Array.isArray(pt.tokens)||pt.tokens.length<2)return E(w+': tap needs tokens');if(!pt.tokens.some(x=>x&&x.ok))E(w+': tap needs at least one {ok:true} token')}
  if(pt.type=='cells'){const p=+sub(pt.parts),wh=+sub(pt.wholes??1),c=+sub(pt.count);
    if(!Number.isInteger(p)||p<2||p>12)E(w+': cells parts must be 2..12');
    if(!Number.isInteger(wh)||wh<1||wh>6)E(w+': cells wholes must be 1..6');
    if(!Number.isInteger(c)||c<1||c>p*wh)E(w+': cells count must be 1..parts*wholes (got '+sub(pt.count)+')');
    if(pt.shape&&!['pie','bar'].includes(pt.shape))E(w+': cells shape must be pie or bar')}}
