#!/usr/bin/env python3
# calib.py <cand dir>: per font size, median (web top - device top) and (web h - device h) of text elements matched by text, over all screens (dark)
import json,glob,os,sys,statistics,collections
L="/home/Storage/Projects/repositories/.data/ThomasMcFarlane/playarr/scratch/20261011-parity/tizen-native/web/layout/dark/"
cand=sys.argv[1]
dt=collections.defaultdict(list); dh=collections.defaultdict(list)
for f in glob.glob(L+"*.json"):
    s=os.path.basename(f)
    c=cand+"/layout/dark/"+s
    if not os.path.exists(c): continue
    web=json.load(open(f))['elements']; dev=json.load(open(c))['elements']
    for w in web:
        if w['role'] not in('text','heading') or not w['text'] or not w.get('fontSize'): continue
        cs=[d for d in dev if d['text']==w['text'] and d['role'] in('text','heading') and abs(d['rect']['x']-w['rect']['x'])<6]
        if not cs: continue
        d=min(cs,key=lambda d:abs(d['rect']['y']-w['rect']['y']))
        if abs(d['rect']['y']-w['rect']['y'])>5: continue
        k=round(w['fontSize'],3); dt[k].append(w['rect']['y']-d['rect']['y']); dh[k].append(w['rect']['h']-d['rect']['h'])
for k in sorted(dt): print(k,len(dt[k]),'dtop med %.2f'%statistics.median(dt[k]),'sd %.2f'%(statistics.pstdev(dt[k])),'dh med %.2f'%statistics.median(dh[k]))
