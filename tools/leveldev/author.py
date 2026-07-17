#!/usr/bin/env python3
"""Level authoring for Gravity Runner.

Chunks are specified structurally (solid ranges + orbs per lane) and the
row strings are generated, so column arithmetic can't drift. solver.py
proves every beat and composed passage is traversable before shipping.

Lanes: 0 ceiling (y 0-70) · 1 high (140-166) · 2 mid (250-276)
       3 low (360-386)    · 4 floor (470-540).  Column = 60 px.
Flight numbers at max speed 660 px/s (cols):
  rail<->rail ~5.3-6 · floor->B-under ~3.9 · B-under->ceil ~4.4
  floor->D-under ~2.2 · ceil->A-top ~1.8 · step-drop (110px) ~3.2
"""

def chunk(name, w, solids, orbs=(), zones=()):
    rows = []
    for lane in range(5):
        row = ['.'] * w
        for (s, l) in solids.get(lane, []):
            for c in range(s, s + l):
                assert 0 <= c < w, f'{name}: lane {lane} col {c} out of range'
                row[c] = '#'
        rows.append(row)
    for (lane, col) in orbs:
        assert rows[lane][col] == '.', f'{name}: orb on solid lane {lane} col {col}'
        rows[lane][col] = 'o'
    for (lane, s, l) in zones:
        assert lane in (0, 4), f'{name}: @ zone on mid lane'
        for c in range(s, s + l):
            assert rows[lane][c] == '#', f'{name}: @ zone off solid'
            rows[lane][c] = '@'
    rows = [''.join(r) for r in rows]
    for lane in (0, 4):
        r = rows[lane]
        assert all(ch in '#@' for ch in (r[0], r[1], r[-2], r[-1])), \
            f'{name}: lane {lane} boundary not solid'
    return {'name': name, 'rows': rows}

C = {}
def add(*a, **k):
    d = chunk(*a, **k)
    C[d['name']] = d
    return d

full = lambda w: [(0, w)]

# runway / breathers / connectors
add('runway', 12, {0: full(12), 4: full(12)}, zones=[(4, 3, 6)])
add('br1', 8,  {0: full(8),  4: full(8)},  zones=[(4, 2, 4)])
add('br2', 12, {0: full(12), 4: full(12)}, orbs=[(3, 4), (3, 7)], zones=[(4, 2, 8)])
add('br3', 10, {0: full(10), 4: full(10)}, zones=[(0, 2, 6)])
add('cn4', 4,  {0: full(4),  4: full(4)})
add('cn6', 6,  {0: full(6),  4: full(6)},  zones=[(4, 2, 2)])

# GAP: the forced flip, escalating width, then a double beat
add('g1', 16, {0: full(16), 4: [(0, 5), (9, 7)]},
    orbs=[(3, 4), (2, 5), (1, 6)], zones=[(0, 7, 4)])
add('g2', 20, {0: full(20), 4: [(0, 5), (12, 8)]},
    orbs=[(3, 4), (2, 5), (1, 6)], zones=[(0, 8, 7)])
add('g3', 24, {0: [(0, 14), (22, 2)], 4: [(0, 5), (9, 15)]},
    orbs=[(3, 4), (2, 5), (1, 6), (1, 15), (2, 16), (3, 17)],
    zones=[(0, 10, 4), (4, 19, 4)])

# STAIRS: teach a step, full staircase, forced staircase
add('s1', 18, {0: full(18), 1: [(4, 4)], 4: full(18)},
    orbs=[(1, 3), (3, 9)], zones=[(4, 12, 4)])
add('s2', 22, {0: full(22), 1: [(4, 4)], 2: [(7, 5)], 3: [(11, 5)], 4: full(22)},
    orbs=[(1, 3), (2, 13), (3, 17)], zones=[(4, 18, 3)])
add('s3', 24, {0: [(0, 8), (22, 2)], 1: [(4, 4)], 2: [(7, 5)], 3: [(11, 5)],
               4: [(0, 6), (16, 8)]},
    orbs=[(1, 3), (3, 4), (2, 13), (3, 17)], zones=[(4, 19, 4)])

# RIDE: underside rides across pits
add('ri1', 18, {0: full(18), 2: [(5, 6)], 4: [(0, 6), (14, 4)]},
    orbs=[(3, 4), (2, 12), (3, 14)], zones=[(4, 15, 2)])
add('ri2', 24, {0: full(24), 2: [(5, 12)], 3: [(17, 5)], 4: [(0, 6), (20, 4)]},
    orbs=[(3, 4), (3, 16), (2, 18)], zones=[(4, 21, 2)])
add('ri3', 28, {0: full(28), 2: [(5, 8), (20, 6)], 3: [(13, 7)],
                4: [(0, 6), (26, 2)]},
    orbs=[(3, 4), (2, 13), (2, 19), (3, 26)])

# TUNNEL: commitment corridors
add('tn1', 18, {0: full(18), 3: [(4, 10)], 4: full(18)},
    zones=[(4, 5, 8)])
add('tn2', 22, {0: full(22), 1: [(6, 10)], 3: [(6, 10)], 4: full(22)},
    orbs=[(2, 3), (2, 18)], zones=[(4, 8, 6), (0, 8, 6)])
add('tn3', 26, {0: full(26), 3: [(4, 12)], 4: [(0, 16), (22, 4)]},
    orbs=[(3, 2), (3, 17), (2, 18), (1, 19)], zones=[(4, 6, 8), (0, 20, 4)])

# RHYTHM: alternating forced flips on a beat
add('r1', 24, {0: [(0, 14), (18, 6)], 4: [(0, 4), (8, 16)]},
    orbs=[(3, 3), (2, 4), (1, 5), (1, 13), (2, 14), (3, 15)],
    zones=[(0, 9, 4), (4, 19, 4)])
add('r2', 30, {0: [(0, 14), (18, 12)], 4: [(0, 4), (8, 16), (28, 2)]},
    orbs=[(3, 3), (2, 4), (1, 5), (1, 13), (2, 14), (3, 15),
          (3, 23), (2, 24), (1, 25)],
    zones=[(0, 9, 4), (4, 19, 4)])
add('r3', 30, {0: [(0, 13), (16, 14)], 4: [(0, 4), (7, 15), (25, 5)]},
    orbs=[(3, 3), (2, 4), (1, 5), (1, 12), (2, 13), (3, 14),
          (3, 21), (2, 22), (1, 23)],
    zones=[(0, 8, 4), (4, 17, 4)])

# CHOICE: open fields, every route orb-priced
add('ch1', 24, {0: full(24), 2: [(5, 5)], 3: [(12, 5)], 4: full(24)},
    orbs=[(2, 3), (2, 11), (3, 10), (3, 18)],
    zones=[(4, 6, 5), (0, 13, 5)])
add('ch2', 28, {0: full(28), 1: [(4, 6), (16, 6)], 3: [(4, 6), (16, 6)],
                2: [(11, 4)], 4: full(28)},
    orbs=[(2, 9), (2, 16), (1, 23), (3, 23)],
    zones=[(4, 5, 4), (0, 17, 4)])

FAMILIES = [
    ('gap',    [('g1', 1), ('g2', 2), ('g3', 3)]),
    ('stairs', [('s1', 1), ('s2', 2), ('s3', 3)]),
    ('ride',   [('ri1', 2), ('ri2', 3), ('ri3', 4)]),
    ('tunnel', [('tn1', 2), ('tn2', 3), ('tn3', 4)]),
    ('rhythm', [('r1', 2), ('r2', 3), ('r3', 4)]),
    ('choice', [('ch1', 3), ('ch2', 4)]),
]

if __name__ == '__main__':
    import json
    print(json.dumps({'chunks': C, 'families': FAMILIES}, indent=1))
