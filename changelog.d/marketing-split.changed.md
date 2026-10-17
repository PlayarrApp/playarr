- The marketing site moved to its own repository and Worker (`PlayarrApp/playarr-site`). `playarr.app` now serves it on `/`
  for signed-out visitors and on the Clients, docs and legal routes through a `SITE` service binding; the web app, the
  duplicate React legal and Clients pages and `site/` are gone from this repository. The app sets a `playarr_signed_in`
  routing-hint cookie so signed-in users keep landing in the app. Deploy `playarr-site` before `playarr-web`.
