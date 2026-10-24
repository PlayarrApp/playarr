# Android phone determinism log (2026-10-24)

```
Android phone, two back-to-back full runs on the static server (build before the TV registry merge), pixel parity % dark/light
actions            A 99.811/99.303  B 99.811/99.303  identical
calendar-agenda    A 98.043/97.939  B 98.043/97.939  identical
calendar-month     A 98.547/98.159  B 98.547/98.159  identical
calendar-week      A 99.062/98.374  B 99.062/98.374  identical
film-detail        A 98.882/98.833  B 98.882/98.833  identical
filters            A 98.847/98.759  B 98.847/98.759  identical
home               A 98.157/97.546  B 98.157/97.546  identical
movies             A 97.974/96.915  B 97.974/96.915  identical
music              A 98.335/98.287  B 98.335/98.287  identical
player-controls    A 98.029/98.073  B 99.647/98.073  DIFFERENT
profiles           A 98.577/98.518  B 98.577/98.518  identical
search             A 99.666/99.652  B 99.666/99.652  identical
series             A 98.071/97.386  B 98.071/97.386  identical
series-detail      A 99.136/98.537  B 99.136/98.537  identical
settings           A 98.392/98.367  B 98.392/98.367  identical
pixel scores identical: 29/30; layout scores identical: 27/30
```

The one pixel difference is player-controls: the paused video frame lands on frame 30 or 31 of the clip (platform decode timing). Layout scores differ on 3 of 30 screen/theme pairs because the app was reinstalled while run B was starting; a clean pair is to be re-recorded after the next full run.
