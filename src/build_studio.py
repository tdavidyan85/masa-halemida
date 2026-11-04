# the content studio artifact = the game engine + studio.js (math content stays in the file but is never shown)
s=open('math-journey.html').read()
def rep(a,b):
    global s
    assert s.count(a)==1,a[:60];s=s.replace(a,b)
rep("const SUBJECT='math',SUBJECT_NAME='חשבון';","const SUBJECT='studio',SUBJECT_NAME='סטודיו';")
rep('<span class="subj">חשבון</span>','<span class="subj">סטודיו התוכן</span>')
css="""<style>.stuf{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:12px 0}.stuf label{display:flex;flex-direction:column;gap:4px;font-size:18px}
.stuf .wide{grid-column:1/-1}.stuf input,.stuf select,.stuf textarea{font:inherit;font-size:18px;padding:8px 10px;border:2px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)}
.stubar{position:sticky;top:0;z-index:30;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between;background:var(--hl);border:3px solid var(--ink);border-radius:16px;padding:8px 12px;margin-bottom:12px}
.stubar .big{font-size:17px;padding:6px 12px}.sturow{display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}.sturow.bad{background:var(--bad-bg)}</style>
"""
rep("\n/*SUBJECT-PACK*/\n","\nsyncOn=function(){return false};\n"+open('studio.js').read()+"\n/*SUBJECT-PACK*/\n")
s=css+s.replace("<title>מסע הלמידה</title>","<title>סטודיו התוכן</title>",1)
open('studio.html','w').write(s);print('ok',len(s.encode()))
