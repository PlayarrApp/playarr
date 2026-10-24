# Android phone and tablet determinism log (2026-10-25)

Two back-to-back full runs per device with `scripts/parity/android-mobile/run.sh` on the final build of this branch (no wrapper-fill table, real accessible names), no app install during either run.

```
### Android phone: two back-to-back full runs on the static server, no installs during either (pinned clock 2026-10-07T12:00:00Z); pixel parity % dark/light
actions            A 99.874/99.500  B 99.874/99.500  identical
calendar-agenda    A 98.043/97.939  B 98.043/97.939  identical
calendar-month     A 98.937/98.535  B 98.937/98.535  identical
calendar-week      A 99.062/98.374  B 99.062/98.374  identical
film-detail        A 98.883/98.833  B 98.883/98.833  identical
filters            A 98.822/98.732  B 98.822/98.732  identical
home               A 98.212/97.604  B 98.212/97.604  identical
movies             A 97.974/96.915  B 97.974/96.915  identical
music              A 98.335/98.287  B 98.335/98.287  identical
player-controls    A 99.715/99.760  B 99.715/99.760  identical
profiles           A 98.640/98.602  B 98.640/98.602  identical
search             A 99.666/99.652  B 99.666/99.652  identical
series             A 98.071/97.386  B 98.071/97.386  identical
series-detail      A 99.098/98.496  B 99.098/98.496  identical
settings           A 98.805/98.773  B 98.805/98.773  identical
pixel scores identical: 30/30; layout scores identical: 30/30; means A 98.809/98.493
layout (dark): actions:76.19 calendar-agenda:67.12 calendar-month:63.37 calendar-week:71.74 film-detail:76.79 filters:60.34 home:68.83 movies:97.74 music:99.1 player-controls:87.1 profiles:55.17 search:78.13 series:95.49 series-detail:67.86 settings:65.15
layout (light): actions:76.19 calendar-agenda:69.44 calendar-month:63.37 calendar-week:71.74 film-detail:76.79 filters:60.34 home:67.53 movies:97.73 music:99.09 player-controls:87.1 profiles:55.17 search:78.13 series:95.45 series-detail:67.86 settings:65.15

### Android tablet: two back-to-back full runs on the static server, no installs during either (pinned clock 2026-10-07T12:00:00Z); pixel parity % dark/light
actions            A 98.210/97.310  B 98.209/97.777  DIFFERENT
calendar-agenda    A 97.571/97.244  B 97.571/97.244  identical
calendar-month     A 99.157/99.009  B 99.157/99.009  identical
calendar-week      A 98.653/98.151  B 98.653/98.151  identical
film-detail        A 98.269/97.894  B 98.269/97.894  identical
filters            A 98.249/98.140  B 98.248/98.140  DIFFERENT
home               A 98.309/97.955  B 98.309/97.955  identical
movies             A 98.093/97.753  B 98.093/97.753  identical
music              A 98.036/97.771  B 98.036/97.771  identical
player-controls    A 99.468/99.479  B 99.468/99.479  identical
profiles           A 99.059/98.972  B 99.059/98.972  identical
search             A 99.481/99.374  B 99.481/99.374  identical
series             A 98.047/97.786  B 98.047/97.786  identical
series-detail      A 98.470/97.784  B 98.470/97.784  identical
settings           A 98.551/98.199  B 98.551/98.199  identical
pixel scores identical: 27/30; layout scores identical: 30/30; means A 98.508/98.188
layout (dark): actions:39.5 calendar-agenda:20.75 calendar-month:34.48 calendar-week:26.74 film-detail:24.47 filters:34.56 home:28.28 movies:49.36 music:46.49 player-controls:50 profiles:7.14 search:35.59 series:49.68 series-detail:21.15 settings:20
layout (light): actions:39.5 calendar-agenda:20.75 calendar-month:34.48 calendar-week:26.74 film-detail:24.47 filters:34.56 home:28.28 movies:49.36 music:46.49 player-controls:50 profiles:7.14 search:35.59 series:49.68 series-detail:21.15 settings:20
```

Phone: 30 of 30 pixel and 30 of 30 layout scores identical. Tablet: layout 30 of 30 identical; pixel 27 of 30: filters differs by 0.001 points and the tablet Actions drawer (light) differed once by about 0.5 points (the blurred drawer backdrop is not frame-stable on the tablet emulator).
