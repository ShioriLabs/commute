# BRT tap-target plotting — session handoff

**Task:** finish plotting the remaining ~221 TransJakarta **BRT** haltes as
tap-targets in `apps/web/public/maps/fdtj/points.json`, reading positions off the
**schematic** map (TfL-style, not geo-accurate). Koridor 1 (23 haltes) is **done
and verified**. Nothing here is committed (branch `development`).

## Read first
- **`docs/fdtj-map-points.md`** — the full method: point shape, `id` contract, the
  2 px/world-unit transform, and the shape convention. Everything below assumes it.

## Current state
- `points.json`: 149 points, 23 are `TJ-` (Koridor 1). Existing rail points untouched.
- **What happened last session:** launched an 11-agent Sonnet swarm to plot the rest
  in parallel. **All 11 died instantly on the account session usage limit** — zero
  output produced. **Do NOT launch all 11 at once.** Throttle to waves of 3–4, or
  plot batches yourself.

## The work: 221 haltes, partitioned into 11 disjoint groups
One owner per halte (lowest corridor that serves it) → **no halte plotted twice**,
each group clustered along one route. Regenerate the exact lists with *Appendix B*
(it auto-excludes already-placed haltes, so re-running after a merge shrinks the
remaining work).

| Agent | Corridors | ~haltes |
|------:|-----------|--------:|
| 01 | 2 (+K1 leftovers) | 24 |
| 02 | 2A, 3, 3F | 23 |
| 03 | 4, 4D | 23 |
| 04 | 5, 5C | 23 |
| 05 | 6, 6A, 6B, 6V | 19 |
| 06 | 7, 7F, 14 | 18 |
| 07 | 8, 9N | 19 |
| 08 | 9 | 21 |
| 09 | 10 | 14 |
| 10 | 11 | 13 |
| 11 | 12, 13 | 24 |

(Lettered corridors 3H/9A/9C/10D/10H/13B/13E/L13E contribute 0 *owned* haltes — all
their stops are shared with a lower corridor and get plotted there.)

## Resume procedure (fresh session)
1. Save *Appendix A* as e.g. `scratch/fdtj_tool.py` — it composites the @2x tiles and
   draws a labelled world grid so you read halte positions in **world coords straight
   off the ruler** (no pixel math).
2. `python3 make_agent_lists.py brt_lists` (*Appendix B*) → the 11 halte lists.
3. Plot one group at a time (yourself, or Sonnet subagents in **waves of 3–4**) using
   the brief in *Appendix C*. Each writes `{"points":[...],"not_found":[...]}` to
   `brt_lists/out-NN.json`.
4. **Validate + merge** (*Appendix D*).

## Conventions already decided (Koridor 1)
- Stack of markers (○○ / ○○△▽△) → capsule spanning the two extreme marker centers,
  `r≈12`; single marker → dot; black pill/loop → `r≈14`.
- **Directional-split haltes**: two points when the map draws two distinct direction
  markers (e.g. 1-2 → ASEAN `H00265P` + Kejaksaan Agung `H00266P`); one point for a
  single ○○ marker.
- `id = "TJ-<code>"`, `<code>` = GTFS `location_type=1` parent stop_id.
- Find haltes by **name** (the corridor-number prefix on the map varies for shared
  haltes; names may differ slightly — fuzzy-match).

---
## Appendix A — `fdtj_tool.py` (ruler + overlay CLI)
Edit `MAPDIR` if the repo path differs.
```python
#!/usr/bin/env python3
"""FDTJ map tap-target authoring tool. Read positions in WORLD coords straight
off a labeled grid; verify placements with an overlay. Never do pixel math.

Usage:
  python fdtj_tool.py grid   X0 Y0 X1 Y1 [up] [out.png]   # ruler crop of a world region
  python fdtj_tool.py overlay POINTS.json X0 Y0 X1 Y1 [out.png]  # draw points on region

World space is the map viewBox 0..9513 x, 0..6727 y. A good first move is a
coarse grid of your whole corridor area (e.g. grid 2300 1600 4800 5100 1.2),
then fine grids (up=4-6) on each halte cluster to read marker centers precisely.
POINTS.json = list of {"id","ax","ay","bx","by","r"} (ax==bx&ay==by => dot)."""
import sys, json, math
from PIL import Image, ImageDraw, ImageFont
MAPDIR="/home/dhikarizky/Work/commute/apps/web/public/maps/fdtj"
TW=2378.3925; TH=1681.72; PXPU=2.0
def _font(s):
    try: return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",s)
    except: return ImageFont.load_default()
def _region(x0,y0,x1,y1):
    c0=max(0,int(x0//TW)); c1=min(3,int(x1//TW)); r0=max(0,int(y0//TH)); r1=min(3,int(y1//TH))
    tw=round(TW*PXPU); th=round(TH*PXPU)
    canvas=Image.new("RGB",((c1-c0+1)*tw,(r1-r0+1)*th),"white")
    for r in range(r0,r1+1):
        for c in range(c0,c1+1):
            t=Image.open(f"{MAPDIR}/tile-{r}-{c}@2x.webp").convert("RGB")
            canvas.paste(t,((c-c0)*tw,(r-r0)*th))
    return canvas, c0*TW, r0*TH   # img px(0,0) == world(wx0,wy0), 2px/unit
def _crop(x0,y0,x1,y1):
    img,wx0,wy0=_region(x0,y0,x1,y1)
    px=lambda X:(X-wx0)*PXPU; py=lambda Y:(Y-wy0)*PXPU
    return img.crop((int(px(x0)),int(py(y0)),int(px(x1)),int(py(y1))))
def grid(x0,y0,x1,y1,up=2.0,out=None,step=25):
    c=_crop(x0,y0,x1,y1)
    c=c.resize((max(1,int(c.width*up)),max(1,int(c.height*up))),Image.LANCZOS)
    d=ImageDraw.Draw(c,"RGBA"); f=_font(20); sc=PXPU*up
    lab=100 if (x1-x0)<=700 else 500
    wx=math.ceil(x0/step)*step
    while wx<=x1:
        X=(wx-x0)*sc; mj=(wx%lab==0)
        d.line([(X,0),(X,c.height)],fill=(230,0,0,200 if mj else 55),width=2 if mj else 1)
        if mj: d.text((X+2,2),str(int(wx)),fill=(200,0,0,255),font=f); d.text((X+2,c.height-22),str(int(wx)),fill=(200,0,0,255),font=f)
        wx+=step
    wy=math.ceil(y0/step)*step
    while wy<=y1:
        Y=(wy-y0)*sc; mj=(wy%lab==0)
        d.line([(0,Y),(c.width,Y)],fill=(0,0,230,200 if mj else 55),width=2 if mj else 1)
        if mj: d.text((2,Y+1),str(int(wy)),fill=(0,0,200,255),font=f); d.text((c.width-70,Y+1),str(int(wy)),fill=(0,0,200,255),font=f)
        wy+=step
    out=out or "/tmp/fdtj_grid.png"; c.save(out); print(out, f"world x[{x0},{x1}] y[{y0},{y1}]"); return out
def overlay(pts,x0,y0,x1,y1,out=None):
    img,wx0,wy0=_region(x0,y0,x1,y1)
    d=ImageDraw.Draw(img,"RGBA"); f=_font(26)
    P=lambda X,Y:((X-wx0)*PXPU,(Y-wy0)*PXPU)
    for p in pts:
        A=P(p["ax"],p["ay"]); B=P(p["bx"],p["by"]); rr=p["r"]*PXPU
        d.line([A,B],fill=(255,0,255,110),width=int(2*rr))
        for C in (A,B): d.ellipse([C[0]-rr,C[1]-rr,C[0]+rr,C[1]+rr],fill=(255,0,255,110))
        d.line([A,B],fill=(200,0,200,255),width=3)
        nm=p.get("id","")[3:]
        d.text((max(A[0],B[0])+rr+3,(A[1]+B[1])/2-13),nm,fill=(120,0,140,255),font=f,stroke_width=4,stroke_fill=(255,255,255,255))
    px=lambda X:(X-wx0)*PXPU; py=lambda Y:(Y-wy0)*PXPU
    c=img.crop((int(px(x0)),int(py(y0)),int(px(x1)),int(py(y1))))
    out=out or "/tmp/fdtj_overlay.png"; c.save(out); print(out); return out
if __name__=="__main__":
    a=sys.argv
    if a[1]=="grid":
        args=[float(x) for x in a[2:6]]; up=float(a[6]) if len(a)>6 and a[6].replace('.','').isdigit() else 2.0
        out=a[7] if len(a)>7 else (a[6] if len(a)>6 and not a[6].replace('.','').isdigit() else None)
        grid(*args,up=up,out=out)
    elif a[1]=="overlay":
        pts=json.load(open(a[2])); args=[float(x) for x in a[3:7]]; out=a[7] if len(a)>7 else None
        overlay(pts,*args,out=out)
```

## Appendix B — `make_agent_lists.py` (regenerate the 11 disjoint lists)
Run from repo root.
```python
#!/usr/bin/env python3
"""Regenerate the 11 disjoint BRT agent halte-lists from repo data.
Run from repo root: python3 make_agent_lists.py [OUTDIR]  (default ./brt_lists)
Deterministic: reads topology.tj.ts + file_gtfs.zip/stops.txt + points.json,
excludes already-placed TJ haltes, assigns each remaining halte to its lowest
corridor (one owner => no duplicates), and buckets owners into 11 agents."""
import re, json, zipfile, csv, io, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else "brt_lists"
os.makedirs(OUT, exist_ok=True)
ts = open("apps/api/src/db/data/topology.tj.ts").read()
blocks = re.split(r"\{\s*\n\s*operator: 'TJ',", ts)[1:]
rows = {r["stop_id"]: r for r in csv.DictReader(io.StringIO(
    zipfile.ZipFile("file_gtfs.zip").read("stops.txt").decode("utf-8-sig")))}
corr = {}
for b in blocks:
    lc = re.search(r"lineCode: '([^']+)'", b)
    if not lc: continue
    codes = re.findall(r"station: '([^']+)'", b)
    seen = []; [seen.append(c) for c in codes if c not in seen]
    corr[lc.group(1)] = seen
key = lambda lc: (int(re.search(r"\d+", lc).group()),
                  lc[:re.search(r"\d+", lc).start()], lc[re.search(r"\d+", lc).end():])
placed = set(p["id"][3:] for p in json.load(open(
    "apps/web/public/maps/fdtj/points.json"))["points"] if p["id"].startswith("TJ-"))
home = {}
for lc in sorted(corr, key=key):
    for i, c in enumerate(corr[lc]):
        if c not in placed and c not in home: home[c] = (lc, i + 1)
groups = {}
for c, (lc, n) in home.items():
    groups.setdefault(lc, []).append({"code": c, "name": rows[c]["stop_name"], "map_hint": f"{lc}-{n}"})
def take(*lcs):
    o = []; [o.extend(sorted(groups.get(lc, []), key=lambda h: h["map_hint"])) for lc in lcs]; return o
AG = {
 1:(["2","1"],"K2: Pulogadung(E)↔Monas/Harmoni(C) via Senen,Kwitang,Pasar Baru,Juanda. +2 leftover K1 (central).",[3000,1800,7200,3600]),
 2:(["2A","3","3F"],"K2A: Pulogadung↔Kalideres/Rawa Buaya(far W). K3: Kalideres↔Monas/Harmoni(W). K3F: Kalideres↔GBK Senayan.",[0,2200,5000,4700]),
 3:(["4","4D"],"K4: Pulogadung↔Dukuh Atas/Galunggung via Matraman,Manggarai,Rasuna Said. K4D: branch to Kuningan.",[3500,3000,7500,4700]),
 4:(["5","5C"],"K5: Kampung Melayu(E)↔Ancol(N) via Jatinegara,Senen. K5C: Kampung Melayu↔Juanda/Harmoni.",[3500,1500,7000,4500]),
 5:(["6","6A","6B","6V"],"K6 family: Ragunan(deep S)↔Dukuh Atas(C) via Mampang,Kuningan,Rasuna Said.",[3200,3800,6200,6700]),
 6:(["7","7F","14"],"K7: Kampung Rambutan(SE)↔Kampung Melayu via UKI,Cawang,Cililitan. K7F:↔Juanda. K14 small.",[4500,3500,9500,5200]),
 7:(["8","9N"],"K8: Lebak Bulus(SW)↔Grogol/Petojo via Pondok Indah,Kebayoran,Tanah Abang,Tomang.",[1500,2800,4200,6100]),
 8:(["9"],"K9: Pinang Ranti(SE)↔Pluit(NW) long orbital via Cawang,Semanggi,Slipi,Grogol,Jelambar. Wide x-range.",[1000,3000,7500,4800]),
 9:(["10"],"K10: Tanjung Priok(N)↔PGC Cililitan(SE) via Sunter,Kelapa Gading,Pulomas,Pemuda,Cawang.",[4500,1500,7800,4800]),
 10:(["11"],"K11: Kampung Melayu↔Pulo Gebang(far E) via Jatinegara,Duren Sawit,Buaran,Klender.",[5500,3000,9500,4600]),
 11:(["12","13"],"K12: Tanjung Priok↔Pluit/Sunter(N coast). K13: Ciledug(SW)↔Tendean/CSW/Blok M elevated via Cipulir,Kebayoran Lama,Mayestik.",[1500,1500,6500,5400]),
}
for n,(lcs,hint,bbox) in AG.items():
    haltes = take(*[l for l in lcs if l in groups])
    json.dump({"corridors":lcs,"hint":hint,"bbox":bbox,"haltes":haltes},
              open(f"{OUT}/agent-{n:02d}.json","w"), ensure_ascii=False, indent=1)
    print(f"agent-{n:02d}: {lcs} -> {len(haltes)} haltes")
print("total:", sum(len(json.load(open(f'{OUT}/agent-{n:02d}.json'))['haltes']) for n in AG))
```

## Appendix C — subagent brief template (Sonnet)
Substitute NN / corridors / count / paths. Launch in waves of 3–4, never all at once.
```
You are plotting TransJakarta BRT halte tap-targets onto a SCHEMATIC map (TfL-style,
NOT geo-accurate). Read positions OFF THE DRAWING with the tool — never from lat-lon.
STEP 0: read docs/fdtj-map-points.md in full and follow it.
ASSIGNMENT: <path>/brt_lists/agent-NN.json (corridors, geographic hint, rough bbox,
and haltes = the exact list to plot). Plot ONLY these.
TOOL (Bash): python3 <path>/fdtj_tool.py
  grid X0 Y0 X1 Y1 UP OUT.png    -> region + labelled world grid (red=x, blue=y);
                                    UP~1 to scout, 4-6 to read a halte. Read OUT.png,
                                    read marker centers in WORLD coords off the ruler.
  overlay POINTS.json X0 Y0 X1 Y1 OUT.png -> draws your points (magenta) to verify.
  Always pass a UNIQUE OUT.png (parallel agents share the filesystem).
WORKFLOW: coarse-grid bbox -> locate corridor line + halte NAME labels -> fine-grid
each halte -> read center -> build point (STACK = capsule of the two extreme marker
centers r12; SINGLE = dot r12; pill/loop r14; id="TJ-<code>") -> overlay to self-
verify, fix any miss -> write {"points":[...],"not_found":[undrawn codes]} to
<path>/brt_lists/out-NN.json.
RULES: don't edit points.json; only your haltes; undrawn -> not_found (no guessing);
verify before finishing. End with a 3-line summary.
```

## Appendix D — validate + merge (do this yourself / Opus)
Once `brt_lists/out-*.json` exist:
1. **Overlay-verify** each out file: run `fdtj_tool.py overlay out-NN.json <bbox>`
   over that corridor's region and Read it — confirm every point sits on its marker;
   fix misses. This is the validation pass; don't trust unseen coordinates.
2. **Merge** into `points.json`: load it, append each new point (dedupe by `id` — the
   lists are disjoint so none expected). Append at the **end of the `points` array**,
   matching the existing indentation (4-space `{`, 6-space fields). Do **not** reformat
   existing lines or bump `version`/`manifest.json`. (Same append pattern used for
   Koridor 1 — see `docs/fdtj-map-points.md`.)
3. **Check:** JSON parses; `len(points)` grew by N; ids unique; every `<code>` is a
   real `location_type=1` halte in `file_gtfs.zip`/`stops.txt`.
4. **Eyeball:** `/map?author=1` (dev) renders all hitboxes. Author mode hydrates from
   `localStorage['fdtj-author-points-v1']` first — clear that key to see file edits.

## Notes / gotchas
- The map is **authoritative** over the feed for placement (e.g. it draws Monas on K1
  where the feed routes via Petojo). Follow the drawing.
- Some GTFS haltes aren't drawn on the map → legit `not_found`; don't invent a spot.
- The dense interchanges (Dukuh Atas, Semanggi, Harmoni, Kuningan) pack many markers —
  fine-grid hard there and read each corridor's marker by its name label.
