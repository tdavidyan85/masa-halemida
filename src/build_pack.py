# a subject page driven by a JSON content pack:  python3 build_pack.py packs/english-pronouns.json english
import sys,json
pack_path,folder=sys.argv[1],sys.argv[2]
P=json.load(open(pack_path));subj=P['subject']
s=open('deploy/index.html').read()
def rep(a,b):
    global s
    assert s.count(a)>=1,a[:60];s=s.replace(a,b)
rep("const SUBJECT='math',SUBJECT_NAME='חשבון';",f"const SUBJECT='{subj['id']}',SUBJECT_NAME='{subj['name']}';")
rep('<span class="subj">חשבון</span>',f'<span class="subj">{subj["name"]}</span>')
rep('משחק תרגול בחשבון לכיתה ה׳',f'משחק תרגול ב{subj["name"]} לכיתה {subj.get("grade","ה")}׳'+(f' – {subj["unit"]}' if subj.get('unit') else ''))
rep('masa-halemida/math/',f'masa-halemida/{folder}/')
js=json.dumps(P,ensure_ascii=False).replace('</','<\\/')
rep('/*SUBJECT-PACK*/',f'loadPack({js});')
open(f'deploy/{folder}.html','w').write(s);print('ok',len(s.encode()))
