# Android phone and tablet determinism log (2026-10-24)

Two back-to-back full runs per device with `scripts/parity/android-mobile/run.sh`, no app install and no emulator restart by hand during either run (the run script recycles the emulator unit between chunks).

```
### Android phone: two back-to-back full runs on the static server, no installs during either (pinned clock 2026-10-07T12:00:00Z); pixel parity % dark/light
actions            A 99.874/99.500  B 99.874/99.500  identical
calendar-agenda    A 98.043/97.939  B 98.043/97.939  identical
calendar-month     A 98.804/98.402  B 98.804/98.402  identical
calendar-week      A 99.062/98.374  B 99.062/98.374  identical
film-detail        A 98.882/98.833  B 98.882/98.833  identical
filters            A 98.847/98.759  B 98.847/98.759  identical
home               A 98.212/97.604  B 98.212/97.604  identical
movies             A 97.974/96.915  B 97.974/96.915  identical
music              A 98.335/98.287  B 98.335/98.287  identical
player-controls    A 99.712/99.756  B 99.712/99.756  identical
profiles           A 98.577/98.518  B 98.577/98.518  identical
search             A 99.666/99.652  B 99.666/99.652  identical
series             A 98.071/97.386  B 98.071/97.386  identical
series-detail      A 99.136/98.537  B 99.136/98.537  identical
settings           A 98.805/98.773  B 98.805/98.773  identical
pixel scores identical: 30/30; layout scores identical: 30/30; means A 98.8/98.482
layout (dark): actions:85.71 calendar-agenda:65.75 calendar-month:27.45 calendar-week:72.34 film-detail:71.43 filters:50 home:76.62 movies:98.5 music:100 player-controls:90.32 profiles:24.14 search:81.25 series:98.5 series-detail:58.93 settings:72.73

### Android tablet: two back-to-back full runs on the static server, no installs during either (pinned clock 2026-10-07T12:00:00Z); pixel parity % dark/light
actions            A 98.208/97.777  B 98.209/97.777  DIFFERENT
calendar-agenda    A 97.571/97.244  B 97.571/97.244  identical
calendar-month     A 99.142/98.994  B 99.142/98.994  identical
calendar-week      A 98.653/98.151  B 98.653/98.151  identical
film-detail        A 98.269/97.894  B 98.269/97.894  identical
filters            A 98.249/98.140  B 98.248/98.140  DIFFERENT
home               A 98.309/97.955  B 98.309/97.955  identical
movies             A 98.093/97.753  B 98.093/97.753  identical
music              A 98.036/97.771  B 98.036/97.771  identical
player-controls    A 99.468/99.479  B 99.468/99.479  identical
profiles           A 98.994/98.906  B 98.994/98.906  identical
search             A 99.481/99.374  B 99.481/99.374  identical
series             A 98.047/97.786  B 98.047/97.786  identical
series-detail      A 98.470/97.784  B 98.470/97.784  identical
settings           A 98.551/98.199  B 98.551/98.199  identical
pixel scores identical: 28/30; layout scores identical: 30/30; means A 98.503/98.214
layout (dark): actions:38.66 calendar-agenda:23.36 calendar-month:13.71 calendar-week:26.44 film-detail:25.53 filters:33.82 home:33.33 movies:46.15 music:44.74 player-controls:53.57 profiles:7.14 search:38.98 series:45.81 series-detail:25.96 settings:21.9
```

Phone: every pixel score and every layout score is identical between the two runs (30 of 30 each). Tablet: layout scores identical (30 of 30); pixel scores identical on 28 of 30, the two exceptions (actions and filters, tablet drawer) differ by 0.001 percentage points (a few pixels of the blurred drawer backdrop). These sets are from the build before the later layout-export fixes; the phone and tablet layout scores of the current build are in the PR description.
