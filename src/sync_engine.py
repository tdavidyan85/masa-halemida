p='math-journey.html';s=open(p,encoding='utf8').read()
i=s.index('/* ================= CONTENT PACKS');j=s.index('\n/*SUBJECT-PACK*/')
# the engine = pack-engine.js (packs) + board-engine.js (subject-independent interaction mechanics)
s=s[:i]+open('pack-engine.js',encoding='utf8').read().rstrip('\n')+'\n'+open('board-engine.js',encoding='utf8').read().rstrip('\n')+s[j:]
open(p,'w',encoding='utf8').write(s);print('engine synced')
