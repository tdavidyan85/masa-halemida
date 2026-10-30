// Checks a content pack against the real game engine.
// usage: node tools/validate-pack.js packs/english-pronouns.json   (needs Playwright + Chromium)
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{const file=process.argv[2];const pack=JSON.parse(fs.readFileSync(file,'utf8'));
  const b=await chromium.launch();const p=await b.newPage();
  await p.goto('file://'+path.resolve(__dirname,'../math/index.html'));await p.waitForTimeout(500);
  const res=await p.evaluate(P=>{const errs=validatePack(JSON.parse(JSON.stringify(P)));if(errs.length)return errs;
    try{loadPack(P)}catch(e){return ['load: '+e.message]}
    const out=[];for(const g of Object.keys(TOPIC_OF))for(let i=0;i<100;i++){try{const q=makeQ(g,i%3?{}:{ez:true});
      if(/undefined|NaN/.test(JSON.stringify(q).replace(/"mistake"|"accept"/g,''))){out.push(g+': undefined/NaN in a question');break}}catch(e){out.push(g+': '+e.message);break}}
    for(let id=1;id<=NEXAMS;id++)examItems(id).forEach(it=>{try{makeQ(it.g,it.p,it.seed)}catch(e){out.push(`exam ${id}: `+e.message)}});
    SHEETS.forEach(s=>{try{s.print()}catch(e){out.push('sheet '+s.id+': '+e.message)}});return out},pack);
  console.log(res.length?res.join('\n'):'✓ the pack is valid');await b.close();process.exit(res.length?1:0)})();
