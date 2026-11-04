# decode a personal save link (#save=...) of מסע הלמידה into JSON
import sys,base64,zlib,json
code=sys.argv[1].split('#save=')[-1]
k,b=code[0],code[1:]
raw=base64.urlsafe_b64decode(b+'='*(-len(b)%4))
txt=zlib.decompress(raw,-15).decode() if k=='z' else raw.decode()
print(json.dumps(json.loads(txt),ensure_ascii=False,indent=1))
