p='math-journey.html';s=open(p).read()
i=s.index('/* ================= CONTENT PACKS');j=s.index('\n/*SUBJECT-PACK*/')
s=s[:i]+open('pack-engine.js').read().rstrip('\n')+s[j:]
open(p,'w').write(s);print('engine synced')
