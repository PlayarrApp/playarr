# Media-server bug and performance test plan

Status: researched and logged 2026-10-11; **parked** by the owner (board epic 'Performance and bug test plan (from media-server issue research) (2026-10-11)', rows 10048 to 10060). Nothing here is scheduled work until the owner un-parks it.

## Summary

- 166 concrete test cases in 13 areas, deduplicated across Plex, Jellyfin, Emby, Infuse, Kodi, Channels and Stremio reports. 79 are P1.
- Each case carries an ID, platforms, the sample media it needs (manifest below), steps and expected result, how to automate it, priority, source links and what Playarr already covers.
- Coverage notes are based on the repo at the time of writing: backend crate unit tests (`playarr-transcode`, `playarr-api` playback and routing e2e, `playarr-peer-sync`), the web behaviour scripts in `clients/tv-web/web/scripts/` (`*-e2e.mjs`, `a11y-aaa.mjs`), the native client tests under `clients/*/Tests`, `scripts/verify-backup-recovery.sh` and the pixel parity suite (`scripts/parity`, `docs/parity`). 'Gap' means no test found; 'Partial' means related but not the exact check. Verify before relying on a 'Covered' note.
- Priority: P1 data loss, wrong state, unplayable media, security; P2 degraded experience; P3 edge or polish.
- Automation key: unit (Rust/Swift/C# unit), backend integration (fixture server, scratch DB), e2e (Playwright scripts on the fixture server), device-suite (the device parity suite on real or emulated devices), manual (physical device, receiver or display needed).

### Research method and limits

- About 40 searches over Jellyfin (forum and GitHub), Plex forum, Emby community, Infuse (Firecore) forum, Kodi/OSMC/LibreELEC forums, Channels community and CVE feeds. Search summaries were read; most pages were not opened in full, so each source is cited for the symptom its summary described. Re-read the page when a case is picked up.
- Reddit (r/PleX, r/jellyfin, r/emby) and most individual GitHub issue pages were not returned by the search tool, so they are under-represented. Only the GitHub issues listed in the sources were surfaced. Stremio produced no usable tracker issue (its D-pad/keyboard case is covered through the Plex and Jellyfin keyboard reports). Release-notes mining (Plex Apple TV preview notes, Jellyfin 10.11 notes) was limited to what the searches surfaced.
- Several sources are third-party blogs or vendor support pages; they are marked in the source table and should be treated as leads.
- No real media titles appear here (repository rule). Samples are described by codec/container, or generated.

### Cases per area

| Section | Area | Board row | Cases | P1 |
|---|---|---|---|---|
| 1 | UI and UX | 1.10048 | 16 | 8 |
| 2 | Playback performance | 1.10049 | 14 | 6 |
| 3 | Recoverability | 1.10050 | 14 | 8 |
| 4 | Transcoding | 1.10051 | 15 | 9 |
| 5 | HDR and Dolby Vision | 1.10052 | 12 | 6 |
| 6 | Subtitles | 1.10053 | 16 | 8 |
| 7 | Audio | 1.10054 | 13 | 5 |
| 8 | Codecs and containers per platform | 1.10055 | 17 | 6 |
| 9 | Load balancing and multi-server | 1.10056 | 10 | 5 |
| 10 | Music | 1.10057 | 9 | 2 |
| 11 | Scanning and metadata | 1.10058 | 11 | 4 |
| 12 | Security and auth | 1.10059 | 11 | 9 |
| 13 | Accessibility | 1.10060 | 8 | 3 |
| | Total | | 166 | 79 |

## 1. UI and UX

Board row 1.10048 (parked). 16 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-UI-01 | Focus survives return from the player | TV clients | V01 | Open a title, play 10 s, press Back. Expect focus on the same Play/episode control, arrows move at once (no dead D-pad). | e2e (nav-focus/nav-player style) + device-suite | P1 | R102, R34 | Partial: nav-focus-e2e, nav-player-e2e (web only) |
| BT-UI-02 | No D-pad trap in drawers, dialogs and the player panel | TV clients | none | Open each drawer/dialog/panel, press arrows in all four directions, then Back. Expect focus never leaves the layer except by Back; Back closes exactly one layer. | e2e | P1 | R102, R117 | Covered (web): nav-layers-e2e, nav-drawer-focus-e2e, nav-panel-open-e2e |
| BT-UI-03 | Library scroll position restored on Back | All | L05 | Scroll a 5k-title library to row 200, open a title, Back. Expect same row and focus, no jump to top. | e2e | P1 | R98, R99, R101 | Covered (web): nav-restore-e2e, nav-library-paging-e2e |
| BT-UI-04 | Scroll up after deep scroll does not reset to start | All | L05 | Fling to the bottom, then scroll up slowly. Expect continuous offset, no reset. | e2e | P2 | R101 | Partial: nav-library-paging-e2e |
| BT-UI-05 | Filter or sort change keeps focus in the content area | TV clients | L05 | Change sort or filter in a library. Expect focus returns to the filter control or first item, never to the top nav. | e2e + device-suite | P2 | R100 | Gap |
| BT-UI-06 | Fast D-pad repeat on a long row does not drop or skip items | TV clients | L05 | Hold Right for 5 s on a 500-item row. Expect every item focuses in order, no skipped letters or items, no frame hang over 100 ms. | e2e (perf) + device-suite | P2 | R98 | Partial: nav-perf, nav-jump-e2e |
| BT-UI-07 | Resume point shown matches the server value | All | V01 | Play to 40 percent, stop. Expect resume badge and Resume button at 40 percent on every client within 5 s. | e2e + parity | P1 | R15, R19 | Partial: playback-e2e |
| BT-UI-08 | Stop at under 5 s or over 95 s of the end sets correct state | All | V01 | Stop at 2 s, at 50 percent, at 97 percent. Expect: not started, in progress, watched. Never watched for the middle case. | unit (progress rules) + e2e | P1 | R17, R18 | Partial: xbox ProgressRulesTests, EndOfPlayback tests (xbox, ios) |
| BT-UI-09 | Watched state toggled on one client appears on all | All | V01 | Mark watched on client A; open client B. Expect watched tick and removal from Continue Watching. | e2e multi-client | P2 | R17, R19 | Gap |
| BT-UI-10 | Series next-up and season watched ticks are consistent | All | Sample Series 1 | Watch an episode to the end; check next-up, season tick and series count. | backend unit + e2e | P2 | R18 | Partial: backend catalog tests |
| BT-UI-11 | Artwork falls back cleanly when season or episode art is missing | All | L03 | Item with no season poster and no episode still. Expect series art or placeholder, never blank or stretched. | e2e + parity | P2 | R109, R108 | Partial: placeholder artwork in parity fixtures |
| BT-UI-12 | Artwork updates after a metadata refresh (no stale cache) | All | L03 | Replace a poster on the server and refresh. Expect clients show it after cache expiry or pull-to-refresh, with no mixed old/new. | e2e | P3 | R108 | Gap |
| BT-UI-13 | Profile switch changes Continue Watching, watchlist and progress at once | All | two users | Switch from profile A to B (PIN on B). Expect rails of B only, no flash of A, writes land on B. | e2e | P1 | R95, R96, R97 | Covered (web): profile-picker-e2e, nav-profile-link-e2e; native gaps |
| BT-UI-14 | Unauthenticated or stale session never attributes playback to the admin | All | none | Play with an expired token. Expect 401 and re-login, not playback recorded for another user. | backend integration | P1 | R96 | Gap |
| BT-UI-15 | TV on-screen keyboard: open, type, close returns focus to the field | TV clients | none | Open search, type via on-screen keyboard and external keyboard, press Back. Expect focus returns, text kept, Left/Right move the caret. | e2e + device-suite | P1 | R103, R104, R105 | Partial: nav-search-e2e; AGENTS.md keyboard rule |
| BT-UI-16 | Search stays responsive and keeps focus while results update | All | L05 | Type 'a' then 'ab' quickly. Expect results for the latest query only, no focus loss, no flicker to empty. | e2e | P2 | R44, R43 | Partial: nav-search-e2e |

## 2. Playback performance

Board row 1.10049 (parked). 14 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-PERF-01 | Time to first frame, direct play, LAN | All | V01 | Press Play on 20 items. Expect p95 under 2 s on LAN; log TTFF. | device-suite + e2e perf | P1 | R115 | Partial: playback-health-e2e, nav-perf |
| BT-PERF-02 | Time to first frame, transcode start, LAN | All | V04 | Force transcode. Expect first segment within 5 s; ffmpeg start never exceeds a client wait of 15 s. | backend integration + device | P1 | R13, R28, R29 | Gap |
| BT-PERF-03 | Seek inside the buffered range is instant | All | V01 | Seek +/-30 s inside buffer. Expect under 300 ms, no rebuffer. | e2e | P2 | R25 | Partial: player-audit-e2e |
| BT-PERF-04 | Seek outside buffer on direct play and on transcode | All | V01,V04 | Seek to 25, 50, 90 percent. Expect resume within 3 s (direct) / 6 s (transcode), landing within 2 s of target. | e2e + device | P1 | R25, R26 | Gap |
| BT-PERF-05 | Two quick consecutive seeks during transcode start-up | All | V04 | Seek twice within 1 s while first segment is pending. Expect final target plays, no frozen frame. | backend integration + e2e | P1 | R26, R27 | Gap |
| BT-PERF-06 | Seek spam (20 seeks in 5 s) leaves exactly one ffmpeg | All | V04 | Hold Right on the scrubber. Expect one live ffmpeg process and playback from the last target. | backend integration | P2 | R26, R27 | Partial: playarr-transcode session tests |
| BT-PERF-07 | Bitrate adaptation steps down on a throttled link and recovers | All | V04 | Throttle to 3 Mbps, then restore. Expect lower quality within 10 s and return within 30 s without a stall loop. | e2e with tc/proxy throttle | P1 | R65, R68 | Gap |
| BT-PERF-08 | Remote (WAN) connection is classified correctly | All | none | Reach the server by LAN address and by public address. Expect LAN-local limits on LAN, remote limits on WAN, no relay-style 1 to 2 Mbps cap on LAN. | backend unit + e2e | P1 | R65, R66, R67 | Gap |
| BT-PERF-09 | Peak-bitrate spikes on a constrained link | All | V16 | VBR clip with 3x peaks on 35 Mbps link. Expect no stall; read-ahead sized to peak. | device-suite | P3 | R68 | Gap |
| BT-PERF-10 | Subtitle toggle during playback does not stall | All | V04,S04 | Turn subtitles on and off five times. Expect no rebuffer, no black frame beyond 500 ms. | e2e + device | P2 | R08, R09 | Gap |
| BT-PERF-11 | High-bitrate direct play on weak Wi-Fi shows a health warning, not silent buffering | All | V04 | Throttle below source bitrate. Expect Playback health panel shows the shortfall. | e2e | P2 | R68, R115 | Covered: playback-health-e2e |
| BT-PERF-12 | Cold app start to interactive home | All | none | Cold start 10 times. Expect home visible with skeletons under 1.5 s, interactive under 3 s on target TVs. | e2e perf + device | P2 | R101 | Covered (web): nav-cold-start-e2e, nav-home-speed-e2e |
| BT-PERF-13 | Large rail or library page load does not exceed memory budget | TV clients | L05 | Scroll 5k titles. Expect no OOM, heap flat after 60 s idle. | device-suite | P2 | R98 | Partial: nav-remount-audit |
| BT-PERF-14 | Connection test endpoint measures throughput without starving playback | All | none | Run connection test during playback. Expect bounded bytes and slot released. | backend unit | P3 | R65 | Covered: playback_health.rs tests |

## 3. Recoverability

Board row 1.10050 (parked). 14 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-REC-01 | Network drop of 10 s mid-playback resumes automatically | All | V01 | Cut network 10 s then restore. Expect buffering message, auto-resume from the same position, no error dialog. | e2e with proxy cut + device | P1 | R114, R113 | Gap |
| BT-REC-02 | Network drop of 2 min shows a clear retry state | All | V01 | Cut 2 min. Expect error with Retry, Retry resumes within 1 s of old position. | e2e | P1 | R114, R113 | Partial: player-audit-e2e (error retry) |
| BT-REC-03 | Wi-Fi to cellular switch keeps playback or recovers | iOS, Android | V01 | Switch network during play. Expect resume without re-login. | manual device | P2 | R91, R92 | Gap |
| BT-REC-04 | Server restart while clients are playing | All | V01,V04 | Restart server mid-play (direct and transcode). Expect client retries with back-off and resumes, transcode session recreated, no permanent spinner. | backend integration + e2e | P1 | R114, R113 | Gap |
| BT-REC-05 | Server restart while a client sits on a list | All | none | Restart server, interact. Expect silent reconnect, no logout, lists refresh. | e2e | P1 | R31, R32 | Gap |
| BT-REC-06 | Device sleep and wake returns to a working app | tvOS, Android TV, Fire TV, Roku | none | Sleep the device 30 min, wake. Expect connected within 5 s, last page, no missing menus, no need to kill the app. | device-suite | P1 | R82, R84 | Gap |
| BT-REC-07 | Server host sleep/wake or IP change | All | none | Change server address or sleep the host. Expect client re-discovers or shows clear unreachable state with retry. | manual + e2e | P2 | R84, R60 | Partial: discovery tests (backend/api discovery.rs) |
| BT-REC-08 | Token expiry mid-session | All | none | Expire the token while browsing and while playing. Expect silent refresh or one re-login prompt, playback continues, no loop of 401s. | backend integration + e2e | P1 | R31 | Gap |
| BT-REC-09 | Token revoked by admin | All | none | Revoke the device. Expect the client returns to login, clears the local session, keeps no cached private data visible. | e2e | P2 | R31 | Gap |
| BT-REC-10 | Download interrupted by network loss resumes with range request | Mobile, TV | V01 | Kill network at 40 percent. Expect resume from offset, final hash matches. | e2e + backend range tests | P1 | R92, R94, R91 | Partial: download-flow-e2e (UI), backend range tests |
| BT-REC-11 | Download pauses for Wi-Fi-only policy with honest message | Mobile | V01 | Start on cellular with Wi-Fi-only. Expect queued with a reason, no silent failure. | e2e | P3 | R93 | Gap |
| BT-REC-12 | Corrupt or truncated file fails with a clear error and playable alternatives still work | All | V20 | Play a truncated MKV. Expect a specific error within 10 s, no hang, server stays healthy, next item plays. | backend integration + e2e | P1 | R28, R115 | Gap |
| BT-REC-13 | MP4 with moov atom at the end (no faststart) | All | V21 | Direct play over HTTP. Expect start works (range) or server remuxes; no full download wait. | backend integration | P2 | R28 | Gap |
| BT-REC-14 | Backup and restore keeps sessions valid or clearly re-auth | Server | none | Restore from backup. Expect users and libraries intact; clients re-login cleanly. | script | P2 | R62 | Covered: scripts/verify-backup-recovery.sh |

## 4. Transcoding

Board row 1.10051 (parked). 15 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-TRX-01 | Direct play decision matches client capabilities | All | V01..V13 | Matrix of source vs client profile. Expect direct play only when container, video, audio and bitrate fit. | backend unit | P1 | R11, R54 | Covered: playarr-transcode can_direct_play tests |
| BT-TRX-02 | Subtitle format does not force a needless video transcode | All | V01,S01,S03 | Select SRT, ASS, PGS. Expect SRT/WebVTT delivered as text, ASS converted or styled client-side where supported; burn-in only when unavoidable, with the reason shown. | backend unit + e2e | P1 | R11, R14, R117 | Gap |
| BT-TRX-03 | Burn-in of PGS at 4K: CPU and latency budget | Server | V04,S04 | Burn PGS into a 4K HDR transcode. Expect speed >= 1.0x on target hardware or a warning before play. | perf test on target host | P1 | R07, R08, R09 | Gap |
| BT-TRX-04 | Burn-in start-up exceeds first-segment wait | All | V01,S01 | Slow burn-in start. Expect the server waits for a configured budget and returns a usable stream or a clear 5xx reason, not a hard kill that the client sees as a generic 500. | backend integration | P1 | R13 | Gap |
| BT-TRX-05 | Hardware acceleration failure falls back to software | Server | V09 | Break the GPU device. Expect transcode retries in software with a log reason, playback proceeds. | backend integration | P1 | R54, R10, R88 | Gap |
| BT-TRX-06 | Hardware path does not silently run on CPU for some files | Server | V03,V09 | Hi10P H.264 and 10-bit HEVC on older GPUs. Expect per-file note 'software' in the session info. | backend unit | P2 | R87, R88, R56 | Gap |
| BT-TRX-07 | Concurrent transcodes respect the admission limit | Server | V04 | Start N+1 transcodes. Expect N run, extra rejected with a 'server busy' reason, permit released on failure. | backend unit | P1 | R87 | Covered: playarr-transcode (no_capacity, concurrent_admission tests) |
| BT-TRX-08 | CPU cap and thread count keep the host responsive | Server | V04 | Run N transcodes with the thread limit set. Expect host load below configured ceiling; web UI responsive. | perf test | P2 | R87 | Partial: ffmpeg thread default test |
| BT-TRX-09 | Throttle: transcode pauses when far ahead, resumes on seek | Server | V04 | Let the buffer fill, pause 2 min, resume. Expect low CPU while paused, instant resume. | backend integration | P2 | R87 | Partial: check_and_apply_throttle |
| BT-TRX-10 | Transcode temp directory cleaned after stop, crash and restart | Server | V04 | Stop, kill client, kill server. Expect segments removed within the cleanup window; disk quota alarm. | backend integration | P1 | R85, R86, R28 | Partial: session expiry/reaper tests |
| BT-TRX-11 | Live or seeked transcode with source seek is frame-accurate | Server | V04 | Start at 12 m 34.567 s. Expect output start within 1 s of target. | backend unit | P2 | R25 | Covered: source_seek_is_applied_before_input test |
| BT-TRX-12 | Selected quality caps real height and never upscales | Server | V01 | Select 480p on a 720p source. Expect <=480p output; never above source. | backend unit | P2 | R65 | Covered: selected_quality_caps test |
| BT-TRX-13 | Audio-only transcode keeps video copy when allowed | Server | V04 | Client lacks EAC3 only. Expect video copy, audio transcode, no needless video re-encode. | backend unit | P1 | R56 | Covered: video_copy tests |
| BT-TRX-14 | Transcode of file with timestamp discontinuity (TS) | Server | V23 | Play a TS with a PTS gap. Expect continuous output, no A/V drift. | backend integration | P2 | R50 | Gap |
| BT-TRX-15 | Ffmpeg process leak after client disappears | Server | V04 | Kill the client mid-play 20 times. Expect zero orphan ffmpeg processes after TTL. | backend integration | P1 | R26, R28 | Covered: reaper tests |

## 5. HDR and Dolby Vision

Board row 1.10052 (parked). 12 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-HDR-01 | HDR10 to SDR tone mapping looks right (not washed out) | Server, web | V04 | Transcode HDR10 to SDR. Expect luminance within tolerance of a reference tone-mapped frame (SSIM >= 0.9). | backend integration + image diff | P1 | R03 | Gap |
| BT-HDR-02 | HDR10 direct play to an HDR display keeps HDR signalling | TV clients | V04 | Play on HDR TV. Expect HDR badge, correct transfer function. | device-suite | P1 | R03 | Gap |
| BT-HDR-03 | HLG direct play and transcode | TV clients, server | V05 | Play HLG. Expect no wrong gamma, tone-mapped when SDR sink. | device + backend | P2 | R03 | Gap |
| BT-HDR-04 | DV profile 5 on a non-DV client | All | V06 | Play P5. Expect tone-mapped transcode with correct colours (no purple/green), never raw direct play. | backend integration + device | P1 | R01, R02, R04 | Gap |
| BT-HDR-05 | DV profile 5 on a DV client direct plays | DV TVs, tvOS | V06 | Play P5. Expect DV badge and correct colours. | device-suite | P2 | R01 | Gap |
| BT-HDR-06 | DV profile 7 (MEL and FEL) falls back to HDR10 when unsupported | tvOS, Android TV | V08 | Play P7 on a device without P7. Expect HDR10 base layer, no flicker, no black frames. | device-suite | P1 | R05, R58, R59 | Gap |
| BT-HDR-07 | DV profile 8.1 plays as DV or as HDR10 | All | V07 | Play P8.1. Expect DV where supported else HDR10, no tint. | device-suite | P1 | R04, R05 | Gap |
| BT-HDR-08 | DV file with a TrueHD track does not flicker | tvOS | V08 | Play with and without the TrueHD track. Expect same stability. | device manual | P3 | R58 | Gap |
| BT-HDR-09 | Muxer difference: MKV remuxed by two tools both play | tvOS, Android TV | V07 | Two remuxes of the same stream. Expect both play with DV. | device manual | P3 | R58 | Gap |
| BT-HDR-10 | Tone mapping with hardware acceleration enabled and disabled | Server | V04 | Transcode with HW and SW tone map. Expect both pass the colour check; SW path is not selected silently on 4K without a speed warning. | backend integration | P1 | R06, R07, R10 | Gap |
| BT-HDR-11 | SDR display of an HDR title does not crush blacks or clip highlights | Web | V04 | Compare histogram on test pattern. | image diff | P2 | R03 | Gap |
| BT-HDR-12 | 10-bit 4:2:0 H.264 (Hi10P) handled | All | V03 | Play Hi10P. Expect transcode (no client decodes it) with correct colours. | backend integration | P2 | R54, R56 | Gap |

## 6. Subtitles

Board row 1.10053 (parked). 16 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-SUB-01 | Preferred language picks the right track among many | All | A09,S08 | 6 subtitle tracks, preference English. Expect English full track, not another language. | backend unit + e2e | P1 | R35 | Gap |
| BT-SUB-02 | Forced vs default flags: mode Default picks the default full track | All | S08 | File has forced and default tracks. Expect per-mode result (None, Default, Smart, Always) as specified in the settings help text. | backend unit | P1 | R33, R37 | Gap |
| BT-SUB-03 | Forced track shown only for foreign-language scenes (Smart mode) | All | S08 | Audio language equals preference. Expect forced track only. | e2e | P2 | R37 | Gap |
| BT-SUB-04 | Subtitle choice persists across episodes (autoplay and Next) | All | Sample Series 1 | Pick a track in ep 1, autoplay ep 2. Expect same language selected, not 'None'. | e2e | P1 | R34 | Gap |
| BT-SUB-05 | External sidecar names recognised (.en.srt, .eng.forced.srt, .en.sdh.srt) | Server | S09 | Scan sidecars. Expect language, forced, SDH flags parsed. | backend unit | P1 | R46 | Gap |
| BT-SUB-06 | SRT in non-UTF-8 encodings render correctly | All | S02 | Windows-1252, ISO-8859-1, GBK, Shift-JIS SRT. Expect correct glyphs, not mojibake. | backend unit (detect) + e2e | P1 | R14 | Gap |
| BT-SUB-07 | ASS/SSA styling preserved or degraded predictably | All | S03 | Styled ASS with fonts. Expect styling where the player supports it; otherwise plain text with position kept; burn-in keeps style. | e2e + device | P2 | R11, R12, R14 | Gap |
| BT-SUB-08 | PGS and VobSub image subtitles selectable with honest transcode warning | All | S04,S05 | Select PGS on a client that cannot render it. Expect message that video will be transcoded. | e2e | P1 | R117, R07 | Gap |
| BT-SUB-09 | Subtitles stay in sync after seek on transcoded streams | All | V04,S01 | Start transcode mid-file and after a seek. Expect cue timing within 200 ms. | e2e | P1 | R38, R39 | Gap |
| BT-SUB-10 | Subtitles in sync in remux and direct stream, not only direct play | All | V01,S01 | Compare timing in all three modes. | e2e | P1 | R39 | Gap |
| BT-SUB-11 | Subtitle toggle off works and persists | All | S01 | Turn off mid-play. Expect immediately gone and not re-enabled by next episode. | e2e | P2 | R34 | Gap |
| BT-SUB-12 | Subtitle size, colour and position settings apply to every format | All | S01,S03 | Change style. Expect all text formats follow; burn-in documented as exempt. | e2e | P2 | R14 | Partial: subtitle-style-e2e (header subtitles, not cues) |
| BT-SUB-13 | Overlapping cues, RTL text, emoji and very long lines | All | S11 | Render. Expect no overlap clip, correct RTL order. | e2e image check | P3 | R14 | Gap |
| BT-SUB-14 | Closed captions (CEA-608/708) in TS | TV | V11 | Enable CC. Expect captions or an honest 'not supported'. | device manual | P3 | R116 | Gap |
| BT-SUB-15 | Subtitle-heavy file (dozens of tracks) opens the menu without delay or crash | All | A09 | 50 tracks. Expect menu in under 500 ms, scrollable, no crash on enable. | e2e | P2 | R12 | Gap |
| BT-SUB-16 | Audio transcode plus subtitles does not force a needless video transcode | Smart TVs | V04,S01 | Subtitle on with EAC3 to AAC. Expect video stays direct where the client can. | backend unit | P2 | R117, R09 | Gap |

## 7. Audio

Board row 1.10054 (parked). 13 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-AUD-01 | Preferred audio language and default flag respected | All | A09 | Preference English, default German. Expect English unless 'play default regardless' is on. | backend unit | P1 | R36 | Gap |
| BT-AUD-02 | Selected audio track is the one that plays | All | A09 | Pick track 4 of 6. Expect track 4 (check ffmpeg map or decoder track id). | e2e + backend unit | P1 | R36 | Covered: maps_the_selected_global_source_audio_stream test |
| BT-AUD-03 | TrueHD passthrough to a capable receiver | Android TV, tvOS | A04 | Enable passthrough. Expect bitstream, not PCM, and no transcode. | device manual | P2 | R21, R23 | Gap |
| BT-AUD-04 | TrueHD/DTS-HD on a client without support falls to a compatible track or transcode, not silence | All | A04,A05 | Expect audio plays (AC3/EAC3 core or transcode); no silent video. | backend unit + device | P1 | R21, R22, R23 | Gap |
| BT-AUD-05 | Atmos (EAC3 JOC) keeps 5.1 beds when atmos not possible | All | A03 | Expect 5.1, not stereo. | device manual | P2 | R22 | Gap |
| BT-AUD-06 | Surround to stereo downmix keeps dialogue level | Server | A02,A10 | Downmix 5.1 to 2.0. Expect integrated loudness within 3 LU of the source dialogue, no clipping. | backend integration (loudness) | P1 | R24 | Gap |
| BT-AUD-07 | Odd channel layouts (2.1, 3.0, 5.0, 6.1, 7.1) map correctly | Server, clients | A10 | Play each. Expect all channels present, no swapped L/R or centre. | backend integration | P2 | R24 | Gap |
| BT-AUD-08 | Audio delay or edit-list offset honoured | All | A11 | File with +200 ms audio offset. Expect lip sync. | device manual | P2 | R50 | Gap |
| BT-AUD-09 | Audio track switch mid-play does not restart from zero | All | A09 | Switch track. Expect continue at current position within 2 s. | e2e | P1 | R36 | Gap |
| BT-AUD-10 | DTS core and FLAC multichannel | Android TV, tvOS | A06,A07 | Play. Expect direct or clean transcode. | device | P3 | R22 | Gap |
| BT-AUD-11 | Opus in MKV on clients without Opus | Safari, Apple TV | A08 | Expect transcode of audio only. | backend unit | P3 | R56 | Gap |
| BT-AUD-12 | Audio-only transcode keeps A/V sync across seek | Server | V04,A03 | Seek 10 times, check sync. | backend integration | P2 | R25 | Gap |
| BT-AUD-13 | Volume normalisation toggled does not reset on episode change | All | A02 | Set normalise; next episode. Expect setting kept. | e2e | P3 | R24 | Gap |

## 8. Codecs and containers per platform

Board row 1.10055 (parked). 17 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-CODEC-01 | Platform capability matrix is declared and honest | All | V01..V16 | Each client posts codec, container, profile, level, HDR, max resolution and fps. Expect server decisions use them. | backend unit + contract | P1 | R54, R55, R57 | Partial: sample_capabilities tests, Roku test_contract |
| BT-CODEC-02 | MKV direct play per platform | All | V01,V04 | Play MKV on each platform. Expect direct play where native, remux otherwise. | device-suite | P1 | R59 | Gap |
| BT-CODEC-03 | MP4, fMP4 and TS containers per platform | All | V02 | As above. | device-suite | P1 | R29, R30 | Gap |
| BT-CODEC-04 | M2TS (Blu-ray) containers | All | V12 | Play. Expect remux or transcode with no audio drop. | device-suite | P2 | R51 | Gap |
| BT-CODEC-05 | AVI (XviD, MP3) | All | V13 | Play. Expect transcode with correct duration and seek. | backend integration | P3 | R50 | Gap |
| BT-CODEC-06 | Interlaced MPEG-2 1080i TS | All | V11 | Play on each platform. Expect deinterlaced picture, no combing, no up-down jump. | device + backend | P1 | R50, R51, R52, R53 | Gap |
| BT-CODEC-07 | Interlaced H.264 1080i M2TS | All | V12 | Same. | device + backend | P2 | R53, R116 | Gap |
| BT-CODEC-08 | Variable frame rate screen recording | All | V15 | Play. Expect smooth playback, no audio drift, correct duration. | device | P2 | R78 | Gap |
| BT-CODEC-09 | Refresh-rate matching: 23.976 vs 24.000, 25, 29.97, 50, 59.94 | TV clients | V17 | Play each. Expect display mode matches or an honest frame-doubling; no judder at 23.976. | device-suite | P2 | R78, R79, R80, R81 | Gap |
| BT-CODEC-10 | 4K 120 fps and 1080p 120 fps HEVC | TV clients | V16 | Play. Expect direct play on capable HDMI 2.1 or clean transcode to 60. | device | P3 | R78 | Gap |
| BT-CODEC-11 | Anamorphic (SAR 32:27) shows the right aspect | All | V14 | Play. Expect 16:9 display; Tizen/webOS pre-scale if the player ignores DAR. | device + image diff | P2 | R106, R107 | Gap |
| BT-CODEC-12 | HEVC Main10 on platforms without 10-bit | All | V04 | Expect transcode to 8-bit with tone mapping if HDR. | backend unit | P1 | R56 | Gap |
| BT-CODEC-13 | AV1 on clients without AV1 decode and servers without AV1 encode | All | V09 | Expect H.264/HEVC transcode; no fatal error from an unsupported encoder. | backend integration | P1 | R55, R57 | Gap |
| BT-CODEC-14 | VP9 profile 2 in WebM | Web, TV | V10 | Play. Expect direct play where supported else transcode. | device | P3 | R54 | Gap |
| BT-CODEC-15 | Mid-stream codec parameter change | All | V22 | Resolution/SPS change mid-file. Expect continued playback. | device manual | P3 | R50 | Gap |
| BT-CODEC-16 | Very long file (4 h+) seeks and duration | All | V19 | Seek to the end and back. Expect correct duration and no 32-bit overflow. | backend integration | P2 | R28 | Gap |
| BT-CODEC-17 | Profile and level exceeded (H.264 level 5.2, 4K H.264) | TV | V01 | Expect transcode if the client level is lower. | backend unit | P2 | R54 | Gap |

## 9. Load balancing and multi-server

Board row 1.10056 (parked). 10 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-LB-01 | Client falls back to the second server when the first is down | All | none | Two servers in a group. Stop A. Expect library from B within 10 s, no logout. | backend integration + e2e | P1 | R60, R61, R64 | Partial: peer_group_e2e_test, routing_e2e_test |
| BT-LB-02 | Session handoff: playback continues when the owning peer disappears | All | V01 | Stop the owner mid-play. Expect client retries via a peer that holds the file, or a clear error. | backend integration | P1 | R64 | Partial: routing_e2e_test (proxy) |
| BT-LB-03 | Stale peer is dropped from routing after a timeout | Server | none | Kill a peer. Expect marked unavailable within the heartbeat window, not selected for new sessions. | backend integration | P1 | R64, R60 | Gap |
| BT-LB-04 | Peer returns after outage and is re-admitted | Server | none | Restart the peer. Expect re-sync and routing resumes without manual steps. | backend integration | P2 | R62 | Gap |
| BT-LB-05 | Saved server address changes (IP or name) | All | none | Server changes address. Expect rediscovery by server id, not a dead saved address. | e2e | P1 | R60, R61, R63 | Partial: discovery tests |
| BT-LB-06 | Multiple advertised addresses: client picks a reachable one | All | none | Server advertises LAN and WAN. Expect the reachable one wins, LAN preferred. | e2e | P2 | R63 | Gap |
| BT-LB-07 | Server reinstall or restore keeps the server id so clients stay signed in | All | none | Restore from backup. Expect clients continue; otherwise explicit re-login. | script | P2 | R62 | Partial: verify-backup-recovery.sh |
| BT-LB-08 | Range request and HLS proxy via peer preserve auth and 206 | All | V01 | Covered by existing e2e; add a long-running and abort case. | backend integration | P2 | R64 | Covered: routing_e2e_test (range, HLS) |
| BT-LB-09 | Watch state converges between peers | Server | V01 | Update on A. Expect B within the sync interval, no lost write. | backend integration | P1 | R19, R64 | Partial: peer sync tests |
| BT-LB-10 | Single-writer database is never opened by two instances | Server | none | Start a second instance on the same data. Expect refusal with a clear message. | backend integration | P2 | R64 | Gap |

## 10. Music

Board row 1.10057 (parked). 9 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-MUS-01 | Gapless album playback (lossless, same format) | All | MU01,MU02 | Play a continuous-mix album. Expect no audible gap (gap < 20 ms) at track boundaries. | device + audio analysis | P1 | R40, R41 | Gap |
| BT-MUS-02 | Encoder delay and padding (LAME header) honoured | All | MU02 | MP3 gapless. Expect no click. | audio analysis | P2 | R40 | Gap |
| BT-MUS-03 | Mixed formats in one album: transition is acceptable | All | MU03 | FLAC then transcoded track. Expect short gap documented, no stall. | device | P3 | R41 | Gap |
| BT-MUS-04 | Next track is prefetched; no long pause on transcoded audio | All | MU03 | Expect next track ready before the end (pause < 1 s). | e2e | P2 | R42 | Gap |
| BT-MUS-05 | Large library (100k tracks) browse and search latency | All | MU04 | Search an artist. Expect under 1 s and server CPU bounded. | backend perf | P1 | R43, R44 | Gap |
| BT-MUS-06 | Large playlist (1.5k tracks) loads and plays | All | MU04 | Load a 1.6k-track playlist. Expect list in under 3 s, paged. | backend perf + e2e | P2 | R45 | Gap |
| BT-MUS-07 | Library scan time of music does not regress | Server | MU04 | Scan 100k tracks twice. Expect incremental rescan under 10 percent of full. | backend perf | P2 | R45 | Gap |
| BT-MUS-08 | Multi-disc, ReplayGain, and Unicode tags | All | MU05,MU06 | Expect disc order, gain applied, correct text. | backend unit | P3 | R43 | Gap |
| BT-MUS-09 | Background playback survives screen off and app switch | Mobile | MU01 | Expect continued play, lock-screen controls. | device manual | P2 | R42 | Gap |

## 11. Scanning and metadata

Board row 1.10058 (parked). 11 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-SCAN-01 | Characters in file names (en dash, ampersand, colon-like, quotes) | Server | L01 | Scan a tree with these. Expect all items present. | backend unit/integration | P1 | R46, R47 | Gap |
| BT-SCAN-02 | Globalization/locale env does not hide non-ASCII names | Server | L01 | Run with invariant culture. Expect names still scanned. | backend integration | P2 | R47 | Gap |
| BT-SCAN-03 | Multi-part movies (cd1/cd2, part1/part2) | Server | L04 | Expect one title with parts or documented behaviour. | backend unit | P2 | R46 | Gap |
| BT-SCAN-04 | Multiple versions of one movie | Server | L02 | Expect one title, selectable versions. | backend unit | P2 | R46 | Gap |
| BT-SCAN-05 | Extras: suffixes and extras folders | Server | L03 | Expect extras attach to the title; renaming does not lose them. | backend unit | P2 | R48, R49 | Gap |
| BT-SCAN-06 | Rename by an *arr tool does not create duplicates | Server | L01 | Rename, rescan. Expect no duplicate art, no orphan item. | backend integration | P1 | R108 | Partial: arr-sync tests |
| BT-SCAN-07 | Huge library scan (50k files) memory and time | Server | L05 | Scan. Expect bounded RSS and progress visible. | backend perf | P1 | R45 | Gap |
| BT-SCAN-08 | Unreadable folder (permissions) reported, not an empty library | Server | L01 | chmod a folder. Expect a visible warning. | backend integration | P1 | R46 | Gap |
| BT-SCAN-09 | DVD/BD folder structures flagged as limited | Server | L02 | Expect single-version note. | backend unit | P3 | R46 | Gap |
| BT-SCAN-10 | Episode naming errors (S01E01, 1x01, absolute) | Server | L01 | Expect correct season/episode, or listed as unmatched. | backend unit | P2 | R46 | Partial: catalog tests |
| BT-SCAN-11 | Images saved next to media do not reappear stale after refresh | Server | L03 | Replace-all-metadata. Expect new images. | backend integration | P3 | R108 | Gap |

## 12. Security and auth

Board row 1.10059 (parked). 11 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-SEC-01 | Unauthenticated endpoints list is minimal and tested | Server | none | Crawl every route without a token. Expect 401 except the public set. | backend integration (route table test) | P1 | R69, R71 | Partial: auth_extractor tests |
| BT-SEC-02 | Path traversal on every file-reading route (stream, subtitle, image, logs) | Server | none | Send ../ and encoded variants. Expect 400/404. | backend unit/fuzz | P1 | R69, R72, R73 | Gap |
| BT-SEC-03 | Stream route parameters cannot inject ffmpeg arguments | Server | V01 | Fuzz container/codec/audio params with option-like strings. Expect validation errors. | backend unit/fuzz | P1 | R71 | Partial: build_hls_args tests (add hostile inputs) |
| BT-SEC-04 | Image URL parameters cannot cause SSRF | Server | none | Pass internal addresses. Expect refused. | backend unit | P1 | R70 | Gap |
| BT-SEC-05 | Subtitle upload restricted to the item and an allowed type | Server | S01 | Upload with traversal name. Expect rejected. | backend unit | P1 | R72 | Gap |
| BT-SEC-06 | Account endpoints never return admin or other users' tokens | Server | two users | Call as a low-privilege user. Expect own data only. | backend integration | P1 | R74, R75, R76 | Gap |
| BT-SEC-07 | Temporary and device tokens cannot be upgraded to permanent | Server | none | Expect denied. | backend integration | P1 | R75 | Gap |
| BT-SEC-08 | Shared tokens visible only to the owner | Server | two users | Expect no leaking via device lists. | backend integration | P2 | R75 | Gap |
| BT-SEC-09 | Third-party tool cannot expose tokens (logs, URLs) | Server | none | Grep logs and URLs. Expect tokens never in query strings or logs. | backend integration | P1 | R77 | Gap |
| BT-SEC-10 | Token revocation takes effect for open streams | Server | V01 | Revoke, expect the stream stops within the segment TTL. | backend integration | P2 | R31 | Gap |
| BT-SEC-11 | Reverse-proxy restarts or header loss do not downgrade auth | Server | none | Drop forwarded headers. Expect no local-network trust from spoofed headers. | backend integration | P1 | R32 | Gap |

## 13. Accessibility

Board row 1.10060 (parked). 8 cases.

| ID | Case | Platforms | Media | Steps and expected result | Automation | Pri | Sources | Existing coverage |
|---|---|---|---|---|---|---|---|---|
| BT-A11Y-01 | Screen reader labels on every player control | iOS, Android, tvOS | V01 | VoiceOver/TalkBack on controls. Expect each is labelled and focus lands on the player, not a secondary control. | device manual + automated lint | P1 | R89, R90 | Partial: a11y-aaa (web) |
| BT-A11Y-02 | Titles and rows are announced on TV focus | tvOS, Android TV | none | Move focus. Expect title, year, state spoken. | device manual | P1 | R89 | Gap |
| BT-A11Y-03 | Focus order and visible focus ring everywhere | All | none | Tab/arrow through each page. Expect logical order and 3:1 ring. | e2e | P1 | R90 | Covered (web): focus-style-e2e, a11y-aaa |
| BT-A11Y-04 | Controls remain reachable after auto-hide | All | V01 | Expect any key reveals controls and reaches the first control. | e2e | P2 | R89 | Covered (web): player-audit-e2e |
| BT-A11Y-05 | Contrast AAA on both themes | All | none | Run axe. | e2e | P2 | R90 | Covered (web): a11y-aaa |
| BT-A11Y-06 | Subtitle readability settings (size, edge, background) | All | S01 | Expect available and persisted. | e2e | P2 | R14 | Partial: subtitle-style-e2e |
| BT-A11Y-07 | Reduced motion respected | All | none | Enable reduced motion. Expect no large animations. | e2e | P3 | R90 | Covered (web): motion-e2e |
| BT-A11Y-08 | Large text and zoom do not clip controls | All | none | 200 percent text. Expect no cut-off. | e2e | P3 | R90 | Partial: layout-parity |

## Sample-media manifest

Rule: no copyrighted media in the repository or in tests. Generate synthetic clips with ffmpeg (`testsrc2`, `smptehdbars`, `sine`, `anullsrc`), or use openly licensed material: the Blender Foundation open movies (Creative Commons; credited in the README 'Third-party media' section), the Jellyfin project's published test-video collection (check the current location before use), and the Kodi wiki 'Samples' page. Dolby Vision profiles 5, 7 and 8.1 can be produced from a synthetic HEVC stream with `dovi_tool` plus `mkvmerge`/`ffmpeg`; keep generated files out of git and under the fixture data directory.

Example generators (illustrative; tune per case):

```sh
# V01: 1080p24 H.264 SDR, AAC stereo, 60 s
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 60 -c:v libx264 -pix_fmt yuv420p -c:a aac V01.mkv
# V11: interlaced MPEG-2 1080i in TS
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=25 -t 30 -vf interlace -flags +ildct+ilme -c:v mpeg2video -f mpegts V11.ts
# V15: variable frame rate (drop every third frame by timestamp)
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 30 -vf "select='mod(n,3)',setpts=N/(20*TB)" -fps_mode vfr -c:v libx264 V15.mkv
```

| ID | Video / container | Used by | Source |
|---|---|---|---|
| V01 | H.264 8-bit SDR 1080p24, AAC 2.0, MKV (and MP4 faststart as V02) | most playback cases | generate |
| V03 | H.264 High 10 (Hi10P) MKV | TRX, HDR, CODEC | generate |
| V04 | HEVC Main10 HDR10 4K24 MKV, EAC3 5.1 | HDR, TRX, PERF, SUB | generate (mastering metadata via x265) or open clip |
| V05 | HEVC Main10 HLG 4K | HDR | generate |
| V06 | HEVC Dolby Vision profile 5 (MP4) | HDR | generate with dovi_tool |
| V07 | HEVC Dolby Vision profile 8.1 with HDR10 base (MKV) | HDR | generate with dovi_tool |
| V08 | HEVC Dolby Vision profile 7 MEL and FEL (MKV) | HDR | generate or discuss with owner; FEL needs a dual-layer source |
| V09 | AV1 10-bit 1080p MP4 | CODEC, TRX | generate (libsvtav1) |
| V10 | VP9 profile 2 WebM | CODEC | generate (libvpx-vp9) |
| V11 | MPEG-2 1080i TFF, MPEG-TS | CODEC, SUB | generate |
| V12 | H.264 1080i M2TS | CODEC | generate (tsMuxer or ffmpeg -f mpegts) |
| V13 | XviD + MP3 AVI | CODEC | generate |
| V14 | 720x480 anamorphic, SAR 32:27, DAR 16:9, MKV | CODEC | generate (setsar) |
| V15 | Variable frame rate H.264 | CODEC | generate |
| V16 | HEVC 4K120 and H.264 1080p120 | CODEC, PERF | generate (short, 5 s) |
| V17 | Frame-rate set: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 | CODEC | generate |
| V19 | 4 hour synthetic file (low bitrate) | CODEC | generate |
| V20 | Truncated MKV (cut at 40 percent) | REC | derive with head -c |
| V21 | MP4 with moov at the end | REC | generate without faststart |
| V22 | Concatenation with a resolution/SPS change | CODEC | generate (concat of two encodes) |
| V23 | MPEG-TS with a PTS discontinuity | TRX | generate (concat and mux) |
| A02-A11 | AC3 5.1; EAC3 5.1 and EAC3 JOC (Atmos); TrueHD 7.1; DTS-HD MA 7.1; DTS core; FLAC 5.1; Opus; six-language multi-track with default/forced flags; layouts 2.1/3.0/5.0/6.1; audio with +200 ms edit-list offset | AUD | generate tones per channel (ffmpeg -af pan); TrueHD/DTS-HD need a licensed encoder: use ffmpeg's truehd encoder, and DTS-HD only if a legal encoder is available, otherwise keep these as manual device cases |
| S01-S11 | SRT UTF-8; SRT in Windows-1252, ISO-8859-1, GBK, Shift-JIS; ASS with styles and embedded fonts; PGS; VobSub; WebVTT; TTML/SSA; forced plus full tracks; sidecar names (.en.srt, .eng.forced.srt, .en.sdh.srt); CEA-608/708 in TS; overlapping cues, RTL text, emoji | SUB | write text subtitles by hand; PGS/VobSub via an open-source OCR-free converter or subtitle-edit style tooling on text cues |
| MU01-MU06 | Gapless FLAC album (continuous mix); MP3 with LAME gapless header; mixed-format album; synthetic 100k-track library (1 s tones, generated tags); multi-disc with ReplayGain; Unicode tags | MUS | generate |
| L01-L05 | Library trees: special-character names; multi-version movies; extras folders and suffixes; cd1/cd2 parts; 50k tiny files | SCAN | generate with a script (tiny placeholder files) |

## Source index

| Key | Finding | URL |
|---|---|---|
| R01 | Jellyfin forum: DV profile 5 forces transcode in web/MPV, HDR tone mapping needed | https://forum.jellyfin.org/t-solved-dv-file-hdr-issues-on-supported-device?pid=27458 |
| R02 | Jellyfin forum: purple/green picture when transcoding Dolby Vision | https://forum.jellyfin.org/t-purple-green-transcoding-dovi?pid=41800 |
| R03 | Jellyfin forum: washed-out HDR when tone mapping is off or unsupported | https://forum.jellyfin.org/t-solved-tonemapping?pid=11478 |
| R04 | Emby community: Dolby Vision purple hue | https://emby.media/community/topic/103171-dolby-vision-has-a-purple-hue-to-it |
| R05 | Emby community: DV profile 7/6 not falling back to HDR10 | https://emby.media/community/topic/138679-dv-profile-76-not-falling-back-to-hdr10 |
| R06 | Emby community: Dolby Vision tone mapping request | https://emby.media/community/topic/116103-dolby-vision-tonemapping-for-emby |
| R07 | Plex forum: hardware transcoding with burned-in subtitles | https://forums.plex.tv/t/plex-hw-transcoding-with-subtitles/866371 |
| R08 | Plex forum: subtitles cause buffering for 4K content | https://forums.plex.tv/discussion/313784/subtitles-cause-buffering-for-4k-content |
| R09 | Plex forum: subtitles causing buffering | https://forums.plex.tv/t/subtitles-causing-buffering/771520 |
| R10 | Plex forum: hardware transcoding broken | https://forums.plex.tv/t/hw-transcoding-broken/881998 |
| R11 | Emby community: ASS subtitles cause video transcode | https://emby.media/community/topic/39618-ass-subtitles-causing-video-to-be-transcoded/ |
| R12 | Emby community: issues burning in ASS subtitles | https://emby.media/community/topic/137215-issues-burning-in-ass-subtitles |
| R13 | Infuse forum: embedded SRT burn-in exceeds the server first-segment wait, HTTP 500 | https://community.firecore.com/t/infuse-8-5-emby/60466 |
| R14 | Emby community: ASS subtitles not played | https://emby.media/community/topic/149276-emby-does-not-play-subtitles-ass/ |
| R15 | Jellyfin forum: playback position not saved (stop reported at wrong time) | https://forum.jellyfin.org/t-playback-position-not-saved |
| R17 | Infuse forum: Jellyfin sync, stop reported at 0 ms, item shows unwatched | https://community.firecore.com/t/infuse-and-jellyfin-not-syncing-properly/43030 |
| R18 | Yatse forum: partially played item reported as watched | https://community.yatse.tv/t/media-streamed-from-jellyfin-are-marked-as-watched-even-if-they-were-only-partially-played/3718 |
| R19 | Symfonium forum: resume position saved locally but item marked played on server | https://support.symfonium.app/t/sync-progress-on-jellyfin/3396 |
| R21 | jellyfin-androidtv#5595: TrueHD sent as PCM instead of bitstream | https://github.com/jellyfin/jellyfin-androidtv/issues/5595 |
| R22 | Jellyfin forum: DTS:X and Atmos passthrough not functioning | https://forum.jellyfin.org/t-dts-x-and-atmos-passthrough-not-functioning-correctly |
| R23 | Plex forum: TrueHD no longer works | https://forums.plex.tv/t/truehd-no-longer-works/764814 |
| R24 | Third-party guide: low Jellyfin volume is usually a surround-to-stereo downmix | https://lumadock.com/tutorials/jellyfin-low-audio-fix |
| R25 | Jellyfin forum: seek jumps to wrong time, long buffering | https://forum.jellyfin.org/t-solved-seeking-jumpts-to-wrong-time-causes-long-buffering |
| R26 | Third-party tracker: seek during transcode start-up kills and restarts ffmpeg, permanent freeze (race) | https://jellywatch.app/support/tickets/1457d406-990d-42a0-b57d-5d8f9e231020 |
| R27 | Jellyfin forum: second consecutive seek ffmpeg killed after 3 s | https://forum.jellyfin.org/t-consecutives-seek-not-playing-back-on-ffmpeg-to-gstreamer-wrapper-script |
| R28 | TrueNAS forum: transcoded playback never starts, transcode dir fills with segments | https://forums.truenas.com/t/jellyfin-hangs-during-transcoding-on-truenas-scale-25-04-2-6/66784 |
| R29 | Mozilla bug 2026875: HLS playback starts only after manual seek (transcoder start delay) | https://bugzilla.mozilla.org/show_bug.cgi?id=2026875 |
| R30 | Jellyfin forum: webOS with hls.js, seek keeps loading | https://forum.jellyfin.org/t-webos-with-hls-js?page=2 |
| R31 | Jellyfin forum: invalid token after device token expiry / revoke | https://forum.jellyfin.org/printthread.php?tid=6302 |
| R32 | Third-party: login fails after reverse-proxy restart | https://shop.zimaspace.com/blogs/support-tips/why-jellyfin-login-fails-after-reverse-proxy-restart |
| R33 | Jellyfin forum: Default subtitle mode picks forced track over default track | https://forum.jellyfin.org/t-default-subtitle-mode-chooses-forced-subtitle-track-over-default-track |
| R34 | jellyfin-androidtv#5509: subtitle selection reset on every new episode | https://github.com/jellyfin/jellyfin-androidtv/issues/5509 |
| R35 | Jellyfin forum: default subtitle language not respected | https://forum.jellyfin.org/t-default-subtitle-language-is-not-respected |
| R36 | Jellyfin forum: different audio track plays than selected | https://forum.jellyfin.org/t-different-audio-track-playing-than-selected?pid=67732 |
| R37 | Jellyfin forum: forced subtitles not working as expected | https://forum.jellyfin.org/t-forced-subtitles-not-working-as-expected |
| R38 | Jellyfin forum: subtitles out of sync when transcoding | https://forum.jellyfin.org/t-solved-subtitles-out-of-sync-when-transcoding |
| R39 | Jellyfin forum: subtitles out of sync | https://forum.jellyfin.org/t-subtitles-out-of-sync |
| R40 | jellyfin-media-player issue feed: gapless playback request (encoder delay and padding) | https://openrss.org/feed/github.com/jellyfin/jellyfin-media-player/issues |
| R41 | Symfonium forum: gap between tracks of different format or quality | https://support.symfonium.app/t/gapless-playback-has-a-gap-sometimes-while-switching-songs/5350 |
| R42 | Jellyfin forum: long buffering pause for the next audio track | https://forum.jellyfin.org/t-buffering-for-next-audio-track |
| R43 | Jellyfin forum: search takes 6 to 7 s on a 150k-track library | https://forum.jellyfin.org/t-any-ways-to-optimize-search-speed-for-large-libraries |
| R44 | Jellyfin forum: search has become extremely slow | https://forum.jellyfin.org/t-search-has-become-extremely-slow |
| R45 | Jellyfin forum: 10.11.6 scan and music sync slowdown | https://forum.jellyfin.org/t-new-jellyfin-server-web-release-10-11-6 |
| R46 | Jellyfin docs: characters that break file names; DVD/BD folders and multi-part limits | https://jellyfin.org/docs/general/server/media/shows |
| R47 | Jellyfin forum: files with en dash or ampersand skipped after update | https://forum.jellyfin.org/t-solved-issues-with-special-charakters-since-update |
| R48 | Jellyfin forum: extras in some folders not detected | https://forum.jellyfin.org/t-extras-in-some-folders-not-detected?pid=18540 |
| R49 | Jellyfin forum: extras suffix naming inconsistently picked up | https://forum.jellyfin.org/t-not-picking-the-extras-for-only-this-movie?pid=59671 |
| R50 | Plex forum: transcoded video jumps up and down when originally interlaced | https://forums.plex.tv/t/transcoded-video-jumps-up-and-down-when-originally-interlaced/878239 |
| R51 | Plex forum: 1080i MPEG-2 will not direct play on Fire TV | https://forums.plex.tv/t/firestick-4k-wont-direct-play-mpeg2-codec/547755 |
| R52 | Plex forum: 1080i content not compatible with client, server cannot keep up | https://forums.plex.tv/t/1080i-non-compatible/203744 |
| R53 | Plex forum: do TVs not deinterlace media | https://forums.plex.tv/t/do-tvs-not-deinterlace-media/765236 |
| R54 | Jellyfin forum: media will not play after enabling hardware acceleration | https://forum.jellyfin.org/t-media-won-t-play-since-enabling-hardware-acceleration |
| R55 | jellyfin-androidtv#5392 (surfaced for AV1 plus audio transcode failing under one HLS container choice; page not opened) | https://github.com/jellyfin/jellyfin-androidtv/issues/5392 |
| R56 | Jellyfin forum: HEVC 10-bit with EAC3 transcoding issues | https://forum.jellyfin.org/t-solved-transcoding-issues-with-hevc-10-bits-eac3 |
| R57 | Third-party: H.264 hardware transcode works but AV1 does not (decode vs encode, profile, level) | https://shop.zimaspace.com/blogs/support-tips/h264-hardware-transcodes-but-av1-does-not |
| R58 | Infuse forum: random black flicker with Dolby Vision (muxer and TrueHD dependent) | https://community.firecore.com/t/random-black-flicker-with-dolby-vision-video-playback/37738 |
| R59 | Infuse forum: Dolby Vision profile 7 and 8 support (FEL vs MEL) | https://community.firecore.com/t/dolby-vision-profile-7-8-support-ts-mkv-files/19713 |
| R60 | Jellyfin forum: connection issues, stale or wrong saved address | https://forum.jellyfin.org/t-connection-issues--10169?pid=48960 |
| R61 | Jellyfin forum: client resets configured servers | https://forum.jellyfin.org/t-jellyfin-client-resetting-configured-servers |
| R62 | Jellyfin forum: clients cannot auto-login after server reinstall (missing keys, server id) | https://forum.jellyfin.org/t-possible-to-keep-auto-logging-in-from-clients-after-full-server-reinstall |
| R63 | Infuse forum: connection error after server update, multiple advertised addresses | https://community.firecore.com/t/connection-error-with-jellyfin-10-9-2/49181 |
| R64 | Third-party: multi-server, failover, SQLite single-writer constraint | https://jellywatch.app/blog/jellyfin-multi-server-load-balancing-failover-2026 |
| R65 | Plex forum: remote stream capped at 2 to 3 Mbps | https://forums.plex.tv/t/remote-stream-capped-at-2-3-mbps-causing-buffering/943326 |
| R66 | Plex forum: why is playback via relay | https://forums.plex.tv/t/why-is-plex-playing-via-relay/764012 |
| R67 | Plex forum: remote bandwidth below 2 Mbps on direct play | https://forums.plex.tv/t/remote-bandwidth-below-2mbps-in-direct-play/862514 |
| R68 | Plex forum: consistently buffering remotely | https://forums.plex.tv/t/consistently-buffering-remotely/899424 |
| R69 | CVE-2021-21402: unauthenticated arbitrary file read (Jellyfin before 10.7.1) | https://vulnerability.circl.lu/vuln/CVE-2021-21402 |
| R70 | CVE-2021-29490: unauthenticated SSRF via image URL parameter | https://db.gcve.eu/vuln/CVE-2021-29490 |
| R71 | Jellyfin CVE aggregator (stream endpoint argument injection CVE-2025-31499 and others) | https://releasealert.dev/npmjs/_/jellyfin/cves |
| R72 | CVE-2026-35031: path traversal in subtitle upload (authenticated) | https://github.com/keraattin/CVE-2026-35031 |
| R73 | CVE-2026-49247: path traversal in client log endpoint | https://osv.dev/vulnerability/CVE-2026-49247 |
| R74 | heise: Plex account endpoint leaked the admin token to any authenticated user | https://heise.de/-11128661 |
| R75 | Plex forum: information related to security vulnerabilities | https://forums.plex.tv/t/information-related-to-security-vulnerabilities/935164 |
| R76 | Tenable: multiple vulnerabilities in Plex Media Server | https://es-la.tenable.com/blog/tenable-research-discloses-multiple-vulnerabilities-in-plex-media-server |
| R77 | Plex forum: CVE-2018-21031, token retrievable through a third-party tool | https://forums.plex.tv/t/cve-2018-21031-bypass-access-control/493192 |
| R78 | Kodi forum: refresh rate matching picks 23.98 not 23.976 | https://forum.kodi.tv/showthread.php?tid=350416 |
| R79 | Kodi forum: 24 Hz file falls back to UI refresh rate | https://forum.kodi.tv/showthread.php?tid=357092 |
| R80 | OSMC forum: adjust frame rate for SD MPEG-2 | https://discourse.osmc.tv/t/adjust-frame-rate-for-sd-mpeg2-videos/74232 |
| R81 | LibreELEC forum: 25 Hz stutter with hardware decoding | https://forum.libreelec.tv/thread/14614-video-stutter-25hz-videoplayback-with-hardwaredecoding-libreelec-9-0/ |
| R82 | Channels forum: client cannot connect to DVR after Apple TV wake | https://community.getchannels.com/t/client-wont-connect-to-dvr-initially-after-wake-up-then-goes-to-on-now-section-instead-of-recordings/38393 |
| R84 | Channels forum: server computer sleeping while watching DVR | https://community.getchannels.com/t/at-wits-end-with-computer-going-to-sleep-while-watching-dvr/10589 |
| R85 | Jellyfin forum: disk full because of the transcode directory | https://forum.jellyfin.org/t-solved-disk-full-because-of-transcode-directory |
| R86 | Jellyfin forum: Live TV transcodes not deleted | https://forum.jellyfin.org/t-live-tv-transcodes-not-deleting |
| R87 | Jellyfin forum: CPU maxed out transcoding some files despite GPU | https://forum.jellyfin.org/t-help-understanding-why-cpu-is-being-maxed-out-to-transcode-some-files |
| R88 | Jellyfin forum: Intel GPU transcodes, some files fall back to CPU and fail | https://forum.jellyfin.org/t-intel-a380-hwa-other-general-questions-regaridng-jellyfin |
| R89 | Jellyfin forum: accessibility (VoiceOver focuses Sync Play instead of player; titles not read) | https://forum.jellyfin.org/t-accessibility-with-jellyfin |
| R90 | Android developers: TalkBack evaluation for TV apps | https://developer.android.com/training/tv/accessibility/talkback |
| R91 | Jellyfin forum: in-app download on Android fails partway | https://forum.jellyfin.org/t-in-app-download-android |
| R92 | Emby community: offline downloads restart from the beginning after any interruption | https://emby.media/community/topic/60100-issues-with-offline-playback |
| R93 | Jellyfin forum: downloads wait for Wi-Fi by design | https://forum.jellyfin.org/t-trying-to-download-shows-over-mobile-data-on-android-cant-waiting-for-wifi |
| R94 | Yatse forum: download aborts on a bad connection and never resumes | https://community.yatse.tv/t/download-manager-requeue-movies-upon-connection-restoration-for-offline/4602 |
| R95 | Plex forum: profile switch does not update Continue Watching | https://forums.plex.tv/t/user-profile-switch-doesnt-update-continued-watching/940082/11 |
| R96 | Plex forum: Continue Watching shows another user's viewing | https://forums.plex.tv/t/continue-watching-bug/860142 |
| R97 | Infuse forum: Plex Home user switching does not retain home layout / wrong profile | https://community.firecore.com/t/retain-home-screen-customizations-when-switching-plex-home-users/59343 |
| R98 | Plex forum: scrolling through movies jumps to top | https://forums.plex.tv/t/scrolling-thru-movies-jumps-to-top/653614 |
| R99 | Plex forum: library returns to the top on Back, anchor point request | https://forums.plex.tv/t/android-add-anchor-point-when-navigating-libraries/810271 |
| R100 | Plex Apple TV preview notes: focus jumps to top nav on filter/sort change | https://forums.plex.tv/t/release-notes-for-plex-experience-preview-apple-tv/903004/22 |
| R101 | Plex forum: summer 2026 server update bugs (browse position resets when scrolling up) | https://forums.plex.tv/t/summer-2026-server-update-bugs/943116 |
| R102 | Emby community: arrow keys dead after returning from playback on Android TV | https://emby.media/community/topic/65793-sony-android-tv-losing-naviagation-focus |
| R103 | Plex forum: search with keyboard on Android TV | https://forums.plex.tv/t/search-using-keyboard-on-android-tv/818707 |
| R104 | Plex forum: external keyboard in search | https://forums.plex.tv/t/search-typing-with-external-keyboard/821086 |
| R105 | Jellyfin forum: no on-screen keyboard on Android TV (Leanback vs Gboard) | https://forum.jellyfin.org/printthread.php?tid=6774 |
| R106 | Jellyfin forum: anamorphic DVD rip shown at wrong aspect on Tizen | https://forum.jellyfin.org/printthread.php?tid=13165 |
| R107 | Plex forum: aspect ratio questions (SAR 32:27) | https://forums.plex.tv/t/another-question-on-aspect-ratio/216225 |
| R108 | Jellyfin forum: primary image in movie folder not displayed correctly | https://forum.jellyfin.org/t-solved-primary-image-in-movie-folder-not-dsiplaying-correctly |
| R109 | Infuse forum: series poster not used when season poster is missing | https://community.firecore.com/t/jellyfin-series-posters-not-used-if-when-season-poster-is-missing/55602 |
| R113 | Plex forum: Roku playback error | https://forums.plex.tv/t/roku-playback-error/920035 |
| R114 | Plex forum: failed playback on Roku and Android | https://forums.plex.tv/t/failed-playback-roku-and-android/920575 |
| R115 | Jellyfin forum: weird unexplained buffering | https://forum.jellyfin.org/t-weird-unexplained-buffering?pid=12996 |
| R116 | Plex forum: Fire TV Live TV interlacing | https://forums.plex.tv/t/firetv-live-tv-interlacing/224764 |
| R117 | Plex forum: LG app, PGS forces a video transcode and buffers | https://forums.plex.tv/t/lg-nano79-smart-4k-lg-um7340/706769 |
