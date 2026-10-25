#!/usr/bin/env python3
# inkdy.py <cand> <theme> : per font size, median ink top/left offset (dev - web) of matched single-line text, from the PNGs
import json,sys,collections,statistics,glob,os
import numpy as np
from PIL import Image
cand,theme=sys.argv[1:3]
B="/home/Storage/Projects/repositories/.data/ThomasMcFarlane/playarr/scratch/20261011-parity/tizen-native/web/"
def ink(im,r,pad=3,th=70):
    x0=max(int(r['x'])-pad,0);y0=max(int(r['y'])-pad,0);x1=min(int(r['x']+r['w'])+pad+1,im.shape[1]);y1=min(int(r['y']+r['h'])+pad+1,im.shape[0])
    c=im[y0:y1,x0:x1]; bg=c[0,0]; m=np.abs(c-bg).sum(2)>th; ys,xs=np.where(m)
    return None if not len(xs) else (x0+xs.min(),y0+ys.min(),x0+xs.max()+1,y0+ys.max()+1)
by=collections.defaultdict(list)
for f in sorted(glob.glob(B+f"layout/{theme}/*.json")):
    s=os.path.basename(f)[:-5]; dv=f"{cand}/layout/{theme}/{s}.json"
    if not os.path.exists(dv): continue
    wp=B+(f"{s}.png" if theme=="dark" else f"light/{s}.png"); dp=f"{cand}/{theme}/{s}.png"
    wi=np.asarray(Image.open(wp).convert("RGB")).astype(int); di=np.asarray(Image.open(dp).convert("RGB")).astype(int)
    W=json.load(open(f))['elements']; D=json.load(open(dv))['elements']
    for a in W:
        if a['role'] not in('text','heading','button','link') or not a.get('fontSize') or a['rect']['h']>30: continue
        b=[d for d in D if d['text']==a['text'] and abs(d['rect']['x']-a['rect']['x'])<3 and abs(d['rect']['y']-a['rect']['y'])<4 and d.get('fontSize')]
        if not b: continue
        iw=ink(wi,a['rect']); idv=ink(di,a['rect'])
        if iw and idv: by[round(a['fontSize'],2)].append((idv[1]-iw[1],idv[3]-iw[3],idv[0]-iw[0]))
for k in sorted(by):
    v=by[k]; print(k,len(v),'dtop',statistics.median(x[0] for x in v),'dbot',statistics.median(x[1] for x in v),'dleft',statistics.median(x[2] for x in v))
