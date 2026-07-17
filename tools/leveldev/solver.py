#!/usr/bin/env python3
"""Route solver: proves each beat and each composed passage is traversable.

Simulates the game's exact physics (GRAV 2600, flip kick 170, vy max 1050,
player 26x34) for a player moving at constant world speed. Search: from any
grounded position the player either keeps running or flips; flight is
deterministic, so the level is a graph over (surface, x) states. A layout
passes only if the search reaches its far boundary, for both entry rails,
both orientations, at both test speeds. Wall contact = failure (stricter
than the game, which only knocks back).

Run: python3 solver.py   (reads levels.json next to this file)
"""
import json, os, sys

LANES = [(0, 70), (140, 26), (250, 26), (360, 26), (470, 70)]
H = 540
GRAV, KICK, VYMAX = 2600.0, 170.0, 1050.0
PW, PH = 26.0, 34.0
COL = 60.0
DT = 1 / 240.0

def build(rows_list):
    rects, gx = [], 0.0
    for rows in rows_list:
        w = len(rows[0])
        for lane in range(5):
            y, h = LANES[lane]
            run = None
            for c in range(w + 1):
                solid = c < w and rows[lane][c] in '#@'
                if solid and run is None: run = c
                elif not solid and run is not None:
                    rects.append((gx + run * COL, gx + c * COL, float(y), float(y + h)))
                    run = None
        gx += w * COL
    return rects, gx

def mirror(rows): return rows[::-1]

def surfaces(rects):
    tops = [(x0, x1, y0) for (x0, x1, y0, y1) in rects]
    bots = [(x0, x1, y1) for (x0, x1, y0, y1) in rects]
    return tops, bots

def fly(rects, tops, bots, x, feet, dir_, speed):
    ndir = -dir_
    vy = KICK * ndir
    top = feet - PH if dir_ > 0 else feet
    t = 0.0
    while t < 1.2:
        vy = max(-VYMAX, min(VYMAX, vy + GRAV * ndir * DT))
        py = top + vy * DT
        px = x + speed * DT
        if ndir > 0:
            for i, (x0, x1, sy) in enumerate(tops):
                if px + PW > x0 + 2 and px < x1 - 2:
                    if top + PH <= sy + 6 and py + PH >= sy:
                        return ('t', i, px, sy)
        else:
            for i, (x0, x1, sy) in enumerate(bots):
                if px + PW > x0 + 2 and px < x1 - 2:
                    if top >= sy - 6 and py <= sy:
                        return ('b', i, px, sy)
        top, x, t = py, px, t + DT
        if top + PH < -60 or top > H + 60: return None
        for (x0, x1, y0, y1) in rects:
            if x + PW > x0 and x < x1 and top + PH > y0 + 1 and top < y1 - 1:
                return None
    return None

def solve(rows_list, speed, entry):
    rects, total = build(rows_list)
    tops, bots = surfaces(rects)
    goal = total - 14 * COL
    start_y = LANES[4][0] if entry == 'floor' else float(LANES[0][1])
    kind = 't' if entry == 'floor' else 'b'
    surfs = tops if entry == 'floor' else bots
    si = next(i for i, (x0, x1, sy) in enumerate(surfs)
              if x0 <= 30 < x1 and abs(sy - start_y) < 1)
    seen, stack = set(), [(kind, si, 30.0)]
    STEP = COL / 3
    while stack:
        k, i, x = stack.pop()
        x0, x1, sy = (tops if k == 't' else bots)[i]
        key = (k, i, int(x // STEP))
        if key in seen: continue
        seen.add(key)
        if x >= goal: return True
        cx = x
        while cx < x1 - 2:
            if cx >= goal: return True
            dir_ = 1 if k == 't' else -1
            r = fly(rects, tops, bots, cx, sy, dir_, speed)
            if r: stack.append((r[0], r[1], r[2]))
            cx += STEP
        dir_ = 1 if k == 't' else -1
        vy, x_, t = 0.0, x1 - 2, 0.0
        top = (sy - PH) if k == 't' else sy
        landed = False
        while t < 1.2 and not landed:
            vy = max(-VYMAX, min(VYMAX, vy + GRAV * dir_ * DT))
            py, px = top + vy * DT, x_ + speed * DT
            arr = tops if dir_ > 0 else bots
            for j, (a0, a1, ay) in enumerate(arr):
                if dir_ > 0:
                    if px + PW > a0 + 2 and px < a1 - 2 and top + PH <= ay + 6 and py + PH >= ay:
                        stack.append(('t', j, px)); landed = True; break
                else:
                    if px + PW > a0 + 2 and px < a1 - 2 and top >= ay - 6 and py <= ay:
                        stack.append(('b', j, px)); landed = True; break
            top, x_, t = py, px, t + DT
            if top + PH < -60 or top > H + 60: break
            hit = any(x_ + PW > a0 and x_ < a1 and top + PH > b0 + 1 and top < b1 - 1
                      for (a0, a1, b0, b1) in rects)
            if hit: break
    return False

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    data = json.load(open(os.path.join(here, 'levels.json')))
    chunks = data['chunks']
    run = chunks['runway']['rows']
    fails = []

    beats = [n for n in chunks if n != 'runway']
    for name in beats:
        rows = chunks[name]['rows']
        for orient, rfn in (('norm', lambda r: r), ('mir', mirror)):
            seq = [rfn(run), rfn(run), rfn(rows), rfn(run), rfn(run)]
            for speed in (450.0, 660.0):
                for entry in ('floor', 'ceil'):
                    if not solve(seq, speed, entry):
                        fails.append(f'{name}/{orient}/{int(speed)}/{entry}')
    if fails:
        print('UNSOLVABLE ROUTES:'); [print(' ', f) for f in fails]; sys.exit(1)
    print(f'all {len(beats)} beats solvable: both orientations, 450 & 660 px/s, floor & ceiling entry')

    MAXB = {1: 1, 2: 2, 3: 2, 4: 3}
    for fam, beats_ in data['families']:
        names = [b for b, t in beats_]
        tiers = [t for b, t in beats_]
        for tier in range(1, 5):
            avail = [n for n, t in zip(names, tiers) if t <= tier]
            if not avail: continue
            sel = avail[-min(len(avail), MAXB[tier]):]
            seq_rows = [run]
            for i, n in enumerate(sel):
                seq_rows.append(chunks[n]['rows'])
                if i < len(sel) - 1: seq_rows.append(chunks['cn4']['rows'])
            seq_rows += [chunks['br1']['rows'], run]
            for orient, rfn in (('norm', lambda r: r), ('mir', mirror)):
                rows_seq = [rfn(r) for r in seq_rows]
                for speed in (450.0, 660.0):
                    for entry in ('floor', 'ceil'):
                        if not solve(rows_seq, speed, entry):
                            fails.append(f'{fam}/t{tier}/{orient}/{int(speed)}/{entry}')
    if fails:
        print('UNSOLVABLE PASSAGES:'); [print(' ', f) for f in fails]; sys.exit(1)
    print('all composed passages solvable (tiers 1-4, both orientations, both speeds, both entries)')

if __name__ == '__main__':
    main()
