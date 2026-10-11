//! Produces converted-quality download tickets. `POST /api/v1/downloads` leaves a named-quality ticket
//! `Queued`; this worker takes them in fair per-user turns, one at a time per node, runs a single-file MP4
//! transcode (see [`playarr_transcode::TranscodeOrchestrator::start_download`]) and marks the ticket
//! `Ready` (or `Failed` with a readable reason).
//!
//! Live playback always wins. A download is admitted only while a slot stays free for viewers (a one-slot
//! node must be idle), runs under `nice`, and is paused (not killed) the moment a viewer needs its slot;
//! it resumes when a slot is spare again. The time limit counts running time only. Every status change is
//! conditional on the ticket's current state, so a cancel is never overwritten. Finished files expire after
//! a short staging time (24 hours by default) or as soon as the device confirms it has the file, and a sweep deletes them
//! (and orphans), so the download directory cannot grow without bound. The device keeps its own copy.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use playarr_model::{DownloadStatus, DownloadTicket, MediaFile};
use playarr_transcode::{DownloadTracks, TranscodeError, TranscodeTargetProfile};
use uuid::Uuid;

use crate::AppState;

const POLL: Duration = Duration::from_secs(5);
#[cfg(not(test))]
const TICK: Duration = Duration::from_secs(3);
#[cfg(test)]
const TICK: Duration = Duration::from_millis(100);
/// How long a converted file is staged on the server when the device never confirms: the device keeps
/// its own copy, so the server file is only a short-lived staging area.
const DEFAULT_STAGING_TTL: chrono::Duration = chrono::Duration::hours(24);
/// Running-time limit when the title's length is unknown.
const DEFAULT_CAP: Duration = Duration::from_secs(6 * 3600);
/// Disk that must stay free beyond the estimated output.
const FREE_SPACE_RESERVE: u64 = 2 * 1024 * 1024 * 1024;
/// Files with no ticket are kept this long before the sweep deletes them (a job may be mid-write).
const ORPHAN_AGE: Duration = Duration::from_secs(600);

/// Where finished downloads live: `PLAYARR_DOWNLOAD_DIR` (a volume separate from the database in every
/// shipped deployment), else a directory in the temp dir.
pub fn download_root() -> PathBuf {
    std::env::var_os("PLAYARR_DOWNLOAD_DIR")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::env::temp_dir().join("playarr-downloads"))
}

/// Parses `PLAYARR_DOWNLOAD_MAX_BYTES`: plain bytes, or a number with a `Ki`/`Mi`/`Gi`/`Ti` suffix.
fn parse_size(text: &str) -> Option<u64> {
    let text = text.trim();
    let split = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let number: u64 = text[..split].parse().ok()?;
    let unit: u64 = match &text[split..] {
        "" => 1,
        "Ki" => 1 << 10,
        "Mi" => 1 << 20,
        "Gi" => 1 << 30,
        "Ti" => 1 << 40,
        _ => return None,
    };
    number.checked_mul(unit)
}

/// Parses a duration such as `3600`, `90m`, `24h` or `2d` (a bare number is seconds).
fn parse_duration(text: &str) -> Option<chrono::Duration> {
    let text = text.trim();
    let split = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let number: i64 = text[..split].parse().ok()?;
    let seconds = match &text[split..] {
        "" | "s" => 1,
        "m" => 60,
        "h" => 3600,
        "d" => 86_400,
        _ => return None,
    };
    number.checked_mul(seconds).map(chrono::Duration::seconds)
}

/// How long a staged file stays: `PLAYARR_DOWNLOAD_STAGING_TTL`, default 24 hours.
pub fn staging_ttl() -> chrono::Duration {
    std::env::var("PLAYARR_DOWNLOAD_STAGING_TTL")
        .ok()
        .and_then(|v| parse_duration(&v))
        .filter(|d| *d > chrono::Duration::zero())
        .unwrap_or(DEFAULT_STAGING_TTL)
}

/// The cap on the download directory's total size, from `PLAYARR_DOWNLOAD_MAX_BYTES` (none when unset).
pub fn download_quota() -> Option<u64> {
    std::env::var("PLAYARR_DOWNLOAD_MAX_BYTES")
        .ok()
        .and_then(|v| parse_size(&v))
}

/// Total bytes of the `.mp4` files in `root`.
async fn used_bytes(root: &Path) -> u64 {
    let mut total = 0;
    if let Ok(mut dir) = tokio::fs::read_dir(root).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            if entry.path().extension().is_some_and(|e| e == "mp4") {
                total += entry.metadata().await.map_or(0, |m| m.len());
            }
        }
    }
    total
}

/// Per-worker state: round-robin memory (when each user last got a job) and the directory quota.
#[derive(Default)]
pub struct Fairness {
    served: Mutex<(u64, HashMap<Uuid, u64>)>,
    /// Cap on the download directory's total bytes, including the job being started.
    pub quota: Option<u64>,
    /// How long a finished file is staged for the device (the device keeps its own copy).
    pub staging_ttl: Option<chrono::Duration>,
}

impl Fairness {
    fn note(&self, user: Uuid) {
        if let Ok(mut state) = self.served.lock() {
            state.0 += 1;
            let tick = state.0;
            state.1.insert(user, tick);
        }
    }

    /// Queued tickets in fair order: first one ticket per user (the user served longest ago first),
    /// then the second of each, and so on. Within a user, oldest first.
    fn order(&self, mut queued: Vec<DownloadTicket>) -> Vec<DownloadTicket> {
        let served = self.served.lock().map(|s| s.1.clone()).unwrap_or_default();
        queued.sort_by_key(|t| t.requested_at);
        let mut seen: HashMap<Uuid, usize> = HashMap::new();
        let mut keyed: Vec<(usize, u64, chrono::DateTime<Utc>, DownloadTicket)> = queued
            .into_iter()
            .map(|t| {
                let round = seen.entry(t.user_id).or_insert(0);
                let key = (
                    *round,
                    served.get(&t.user_id).copied().unwrap_or(0),
                    t.requested_at,
                    t,
                );
                *round += 1;
                key
            })
            .collect();
        keyed.sort_by_key(|(round, last, at, _)| (*round, *last, *at));
        keyed.into_iter().map(|(_, _, _, t)| t).collect()
    }
}

/// Starts the worker: tickets left `Processing` by a restart go back to the queue, then the queue is
/// polled (and the download directory swept) for the life of the process.
pub fn spawn(state: AppState, root: PathBuf) {
    tokio::spawn(async move {
        match state.download_tickets.requeue_processing().await {
            Ok(0) => {}
            Ok(n) => tracing::info!(count = n, "requeued interrupted download tickets"),
            Err(error) => tracing::warn!(%error, "could not requeue interrupted downloads"),
        }
        requeue_missing_files(&state).await;
        let fairness = Fairness {
            quota: download_quota(),
            staging_ttl: Some(staging_ttl()),
            ..Fairness::default()
        };
        loop {
            sweep(&state, &root).await;
            if !process_next(&state, &root, &fairness).await {
                tokio::time::sleep(POLL).await;
            }
        }
    });
}

/// A `Ready` ticket whose file is missing (a wiped volume) goes back to the queue.
pub async fn requeue_missing_files(state: &AppState) {
    let Ok(ready) = state.download_tickets.list_ready_with_files().await else {
        return;
    };
    let now = Utc::now();
    for ticket in ready {
        // An expired ticket is the sweep's to expire, not ours to produce again.
        if ticket.expires_at.is_some_and(|at| at <= now) {
            continue;
        }
        let missing = match &ticket.output_path {
            Some(path) => tokio::fs::metadata(path).await.is_err(),
            None => false,
        };
        if missing
            && matches!(
                state.download_tickets.requeue_missing_file(ticket.id).await,
                Ok(true)
            )
        {
            tracing::info!(ticket_id = %ticket.id, "download file missing, ticket requeued");
        }
    }
}

/// Expires tickets past `expires_at`, deletes the files of expired, canceled and failed tickets, and
/// removes files that belong to no ticket (for example after a backup restore).
pub async fn sweep(state: &AppState, root: &Path) {
    if let Ok(expired) = state.download_tickets.list_expired(Utc::now()).await {
        for ticket in expired {
            crate::downloads::remove_staged(&ticket).await;
            let _ = state
                .download_tickets
                .mark_status(ticket.id, DownloadStatus::Expired, None)
                .await;
        }
    }
    let Ok(mut dir) = tokio::fs::read_dir(root).await else {
        return;
    };
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        let Some(id) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| Uuid::parse_str(stem).ok())
        else {
            continue;
        };
        let stale = match state.download_tickets.get(id).await {
            Ok(Some(ticket)) => matches!(
                ticket.status,
                DownloadStatus::Expired | DownloadStatus::Canceled | DownloadStatus::Failed
            ),
            Ok(None) => entry
                .metadata()
                .await
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > ORPHAN_AGE),
            Err(_) => false,
        };
        if stale {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
}

/// Runs the next startable queued ticket to completion. `false` when there was nothing to do (an empty
/// queue, no spare capacity, or the database is failing), so the caller waits before polling again.
pub async fn process_next(state: &AppState, root: &Path, fairness: &Fairness) -> bool {
    let queued = match state.download_tickets.list_queued().await {
        Ok(queued) => queued,
        Err(error) => {
            tracing::warn!(%error, "download queue read failed");
            return false;
        }
    };
    for ticket in fairness.order(queued) {
        match run_ticket(state, root, &ticket, fairness).await {
            Outcome::Done => return true,
            // The node is busy or a write failed: the others would meet the same, so wait.
            Outcome::Wait => return false,
            Outcome::Skipped => continue,
        }
    }
    false
}

enum Outcome {
    Done,
    Wait,
    Skipped,
}

/// Fails a ticket that is still in `from`; `false` when the write itself failed or lost a race.
async fn fail(
    state: &AppState,
    ticket: &DownloadTicket,
    from: DownloadStatus,
    message: &str,
) -> bool {
    match state
        .download_tickets
        .transition(ticket.id, from, DownloadStatus::Failed, Some(message))
        .await
    {
        Ok(_) => true,
        Err(error) => {
            tracing::warn!(ticket_id = %ticket.id, %error, "could not record a failed download");
            false
        }
    }
}

/// The audio track playback would pick for this viewer (their saved choice for the title, then their
/// preferred language, then the file's default) and the embedded text subtitles.
async fn choose_tracks(
    state: &AppState,
    ticket: &DownloadTicket,
    media: &MediaFile,
) -> DownloadTracks {
    let path = playarr_model::resolve_media_path(&media.path);
    let audio = crate::media::probe_media_audio_tracks(&path)
        .await
        .unwrap_or_default();
    let saved = state
        .user_repo
        .get_media_playback_preferences(ticket.user_id, media.id)
        .await
        .ok()
        .flatten()
        .and_then(|p| p.audio_track_id);
    let preferred = state
        .user_repo
        .find_by_id(ticket.user_id)
        .await
        .ok()
        .flatten()
        .map(|user| user.preferred_audio_language);
    let choices: Vec<(u32, Option<String>, bool)> = audio
        .iter()
        .map(|t| (t.stream_index, t.language.clone(), t.is_default))
        .collect();
    let subtitles = crate::media::probe_all_subtitle_tracks(&path)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.sidecar_path.is_none())
        .map(|t| (t.stream_index, t.language))
        .collect();
    DownloadTracks {
        audio_stream_index: choose_audio(&choices, saved.as_deref(), preferred.as_deref()),
        subtitles,
    }
}

/// `(stream_index, language, is_default)` choices to one stream index, in playback's order: the viewer's
/// saved track for the title, their preferred language, the file's default, the first track.
fn choose_audio(
    tracks: &[(u32, Option<String>, bool)],
    saved_track_id: Option<&str>,
    preferred_language: Option<&str>,
) -> Option<u32> {
    saved_track_id
        .and_then(|id| {
            tracks
                .iter()
                .find(|t| format!("source-audio-{}", t.0) == id)
        })
        .or_else(|| {
            preferred_language.and_then(|preferred| {
                tracks
                    .iter()
                    .find(|t| crate::playback::audio_language_matches(t.1.as_deref(), preferred))
            })
        })
        .or_else(|| tracks.iter().find(|t| t.2))
        .or_else(|| tracks.first())
        .map(|t| t.0)
}

/// Bytes free on the filesystem holding `path` (from `df`); `None` when it cannot be read.
async fn free_bytes(path: &Path) -> Option<u64> {
    let out = tokio::process::Command::new("df")
        .args(["-Pk"])
        .arg(path)
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let kib: u64 = text
        .lines()
        .nth(1)?
        .split_whitespace()
        .nth(3)?
        .parse()
        .ok()?;
    Some(kib * 1024)
}

/// Rough output size: the profile's bitrates over the title's length, with 20 % headroom.
fn estimated_bytes(profile: &str, duration_ms: Option<u64>) -> u64 {
    let duration_ms = duration_ms.filter(|d| *d > 0);
    let profile = TranscodeTargetProfile::resolve(profile);
    let kbps = u64::from(profile.video_bitrate_kbps.unwrap_or(4000))
        + u64::from(profile.audio_bitrate_kbps.unwrap_or(128));
    let seconds = duration_ms.map_or(3 * 3600, |ms| ms / 1000);
    seconds * kbps * 1000 / 8 * 12 / 10
}

/// Running-time limit: about three times the title's length, between one and 24 hours.
fn running_cap(duration_ms: Option<u64>) -> Duration {
    let duration_ms = duration_ms.filter(|d| *d > 0);
    duration_ms.map_or(DEFAULT_CAP, |ms| {
        Duration::from_millis(ms.saturating_mul(3))
            .clamp(Duration::from_secs(3600), Duration::from_secs(24 * 3600))
    })
}

async fn run_ticket(
    state: &AppState,
    root: &Path,
    ticket: &DownloadTicket,
    fairness: &Fairness,
) -> Outcome {
    let queued = DownloadStatus::Queued;
    let Some(profile) = ticket.profile.as_deref() else {
        return finish_failed(
            state,
            ticket,
            queued,
            "this ticket has no conversion profile",
        )
        .await;
    };
    let Some(media_file) = state.media_files.get(ticket.media_file_id).await else {
        return finish_failed(state, ticket, queued, "the title is no longer available").await;
    };
    // Admission first, claim second: a busy node leaves the ticket untouched (no status flapping).
    let reservation = match state.transcode.reserve_download() {
        Ok(reservation) => reservation,
        Err(_) => return Outcome::Wait,
    };
    // A zero or missing duration is unknown: ask ffprobe, else assume a long film (never "free").
    let duration_ms = match media_file.duration_ms.filter(|d| *d > 0) {
        Some(d) => Some(d),
        None => crate::media::probe_media_duration_ms(&playarr_model::resolve_media_path(
            &media_file.path,
        ))
        .await
        .ok(),
    };
    let needed = estimated_bytes(profile, duration_ms);
    if let Some(quota) = fairness.quota {
        if used_bytes(root).await + needed > quota {
            return finish_failed(
                state,
                ticket,
                queued,
                "the server's download storage is full",
            )
            .await;
        }
    }
    if let Some(free) = {
        let _ = tokio::fs::create_dir_all(root).await;
        free_bytes(root).await
    } {
        if free < needed + FREE_SPACE_RESERVE {
            return finish_failed(
                state,
                ticket,
                queued,
                "there is not enough free space on the server",
            )
            .await;
        }
    }
    if !matches!(state.download_tickets.claim(ticket.id).await, Ok(true)) {
        return Outcome::Skipped;
    }
    fairness.note(ticket.user_id);
    let processing = DownloadStatus::Processing;
    let output = root.join(format!("{}.mp4", ticket.id));
    let tracks = choose_tracks(state, ticket, &media_file).await;
    let mut job = match state
        .transcode
        .start_download(reservation, &media_file, profile, &output, &tracks)
        .await
    {
        Ok(job) => job,
        Err(TranscodeError::UnsupportedColour) => {
            return finish_failed(
                state,
                ticket,
                processing,
                "This title's colour format can't be converted for this device.",
            )
            .await;
        }
        Err(error) => {
            tracing::warn!(ticket_id = %ticket.id, %error, "download transcode did not start");
            return finish_failed(
                state,
                ticket,
                processing,
                "the conversion could not be started",
            )
            .await;
        }
    };

    let cap = running_cap(duration_ms);
    let handle = job.handle();
    let mut running = Duration::ZERO;
    let end = {
        let mut waiting = Box::pin(job.wait());
        loop {
            tokio::select! {
                ok = &mut waiting => break End::Exited(ok),
                () = tokio::time::sleep(TICK) => {
                    if is_canceled(state, ticket).await {
                        break End::Canceled;
                    }
                    // The staging directory (this job's growing file included) must stay under the quota.
                    if let Some(quota) = fairness.quota {
                        if used_bytes(root).await > quota {
                            break End::StorageFull;
                        }
                    }
                    if handle.is_paused() {
                        // Paused for live playback: it does not age, and it resumes when a slot is spare.
                        handle.try_resume().await;
                    } else {
                        running += TICK;
                        if running >= cap {
                            break End::TimedOut;
                        }
                    }
                }
            }
        }
    };
    let staging = fairness.staging_ttl.unwrap_or(DEFAULT_STAGING_TTL);
    finish(state, ticket, &output, end, &mut job, staging).await
}

enum End {
    Exited(bool),
    Canceled,
    TimedOut,
    StorageFull,
}

async fn finish_failed(
    state: &AppState,
    ticket: &DownloadTicket,
    from: DownloadStatus,
    message: &str,
) -> Outcome {
    if fail(state, ticket, from, message).await {
        Outcome::Done
    } else {
        // The failure could not be written (for example a full disk): wait instead of spinning.
        Outcome::Wait
    }
}

/// Records how a job ended. Every write is conditional on the ticket still being `Processing`, so a
/// cancel that arrived meanwhile is never overwritten, and the output file never outlives a ticket
/// that is not `Ready`.
async fn finish(
    state: &AppState,
    ticket: &DownloadTicket,
    output: &Path,
    end: End,
    job: &mut playarr_transcode::DownloadJob,
    staging: chrono::Duration,
) -> Outcome {
    let processing = DownloadStatus::Processing;
    match end {
        End::Exited(true) => {
            let size = tokio::fs::metadata(output)
                .await
                .ok()
                .map(|m| m.len())
                .unwrap_or(0);
            if size == 0 {
                let _ = tokio::fs::remove_file(output).await;
                return finish_failed(state, ticket, processing, "the conversion produced no file")
                    .await;
            }
            let now = Utc::now();
            match state
                .download_tickets
                .finish_ready(ticket.id, output, size, now, now + staging)
                .await
            {
                Ok(true) => {}
                // Canceled just before it finished: no ticket wants the file.
                Ok(false) => {
                    let _ = tokio::fs::remove_file(output).await;
                }
                Err(error) => {
                    tracing::warn!(ticket_id = %ticket.id, %error, "could not record a ready download");
                    let _ = tokio::fs::remove_file(output).await;
                    return Outcome::Wait;
                }
            }
            Outcome::Done
        }
        End::Exited(false) => {
            let _ = tokio::fs::remove_file(output).await;
            finish_failed(state, ticket, processing, "the conversion failed").await
        }
        End::Canceled => {
            job.kill().await;
            let _ = tokio::fs::remove_file(output).await;
            Outcome::Done
        }
        End::StorageFull => {
            job.kill().await;
            let _ = tokio::fs::remove_file(output).await;
            finish_failed(
                state,
                ticket,
                processing,
                "the server's download storage is full",
            )
            .await
        }
        End::TimedOut => {
            job.kill().await;
            let _ = tokio::fs::remove_file(output).await;
            finish_failed(state, ticket, processing, "the conversion took too long").await
        }
    }
}

async fn is_canceled(state: &AppState, ticket: &DownloadTicket) -> bool {
    match state.download_tickets.get(ticket.id).await {
        Ok(Some(t)) => t.status == DownloadStatus::Canceled,
        Ok(None) => true,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{
        bearer_header, dv5_hevc_ffprobe_stub, mint_access_token, sdr_hevc_ffprobe_stub,
        seed_downloadable_media_file, seed_movie, seed_streaming_user,
        seed_streaming_user_with_library_allow, test_state_with_probe, TestState,
    };
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use tower::ServiceExt;

    fn script(name: &str, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("playarr-dl-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// ffmpeg stand-in: a download (an `.mp4` output argument) writes a few bytes to it; anything else
    /// (live playback's HLS) runs until killed, so it holds its slot. Nothing else is touched.
    fn stub_ffmpeg() -> String {
        script(
            "ffmpeg",
            "for a; do last=$a; done\ncase \"$last\" in\n*.mp4) head -c 4096 /dev/zero > \"$last\";;\n*.m3u8) exec sleep 30;;\nesac",
        )
    }

    async fn state_with(ffmpeg: &str, probe: &str) -> (axum::Router, TestState) {
        test_state_with_probe(ffmpeg, 1, probe).await
    }

    async fn queued_ticket_for(state: &TestState, user_id: Uuid, quality: &str) -> DownloadTicket {
        let work_id = seed_movie(state, "Test Movie").await;
        let file = seed_downloadable_media_file(state, work_id, Uuid::new_v4()).await;
        insert_ticket(state, user_id, file.id, quality, DownloadStatus::Queued).await
    }

    async fn insert_ticket(
        state: &TestState,
        user_id: Uuid,
        media_file_id: Uuid,
        quality: &str,
        status: DownloadStatus,
    ) -> DownloadTicket {
        let now = Utc::now();
        let ticket = DownloadTicket {
            id: Uuid::new_v4(),
            user_id,
            media_file_id,
            device_id: None,
            quality_id: quality.to_string(),
            profile: Some(quality.to_string()),
            container: "mp4".to_string(),
            status,
            output_path: None,
            size_bytes: None,
            error_message: None,
            requested_at: now,
            ready_at: None,
            expires_at: None,
        };
        state.app.download_tickets.insert(&ticket).await.unwrap();
        ticket
    }

    async fn queued_ticket(state: &TestState, quality: &str) -> DownloadTicket {
        let user_id = Uuid::new_v4();
        seed_streaming_user(state, user_id).await;
        queued_ticket_for(state, user_id, quality).await
    }

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("playarr-dl-out-{}", Uuid::new_v4()))
    }

    async fn status_of(state: &TestState, id: Uuid) -> DownloadTicket {
        state.app.download_tickets.get(id).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn a_queued_converted_ticket_becomes_ready_with_its_file() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        let root = root();

        assert!(process_next(&state.app, &root, &Fairness::default()).await);

        let done = status_of(&state, ticket.id).await;
        assert_eq!(done.status, DownloadStatus::Ready);
        assert_eq!(done.size_bytes, Some(4096));
        assert!(done.expires_at.is_some() && done.ready_at.is_some());
        let path = done.output_path.expect("output path recorded");
        assert_eq!(path, root.join(format!("{}.mp4", ticket.id)));
        assert!(path.exists());
        assert!(!process_next(&state.app, &root, &Fairness::default()).await);
    }

    #[tokio::test]
    async fn a_failing_conversion_marks_the_ticket_failed_and_leaves_no_file() {
        let ffmpeg = script(
            "ffmpeg",
            "for a; do last=$a; done\nhead -c 10 /dev/zero > \"$last\"\nexit 1",
        );
        let (_router, state) = state_with(&ffmpeg, &sdr_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        let root = root();

        assert!(process_next(&state.app, &root, &Fairness::default()).await);

        let done = status_of(&state, ticket.id).await;
        assert_eq!(done.status, DownloadStatus::Failed);
        assert!(done.error_message.is_some());
        assert!(!root.join(format!("{}.mp4", ticket.id)).exists());
    }

    /// A busy node leaves the ticket untouched: it is not claimed and requeued every poll.
    #[tokio::test]
    async fn a_busy_node_leaves_the_ticket_queued_and_unclaimed() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        // A live viewer holds the node's only slot.
        let live_file = {
            let work_id = seed_movie(&state, "Live Movie").await;
            seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await
        };
        let _live = state
            .app
            .transcode
            .spawn_on_demand_transcode(&live_file, "h264-720p-4mbps", "node")
            .await
            .expect("live playback starts");

        assert!(!process_next(&state.app, &root(), &Fairness::default()).await);
        let waiting = status_of(&state, ticket.id).await;
        assert_eq!(waiting.status, DownloadStatus::Queued);
    }

    #[tokio::test]
    async fn a_profile_5_title_without_an_rpu_path_fails_with_the_plain_message() {
        let (_router, state) = state_with(&stub_ffmpeg(), &dv5_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;

        assert!(process_next(&state.app, &root(), &Fairness::default()).await);

        let done = status_of(&state, ticket.id).await;
        assert_eq!(done.status, DownloadStatus::Failed);
        assert_eq!(
            done.error_message.as_deref(),
            Some("This title's colour format can't be converted for this device.")
        );
    }

    #[tokio::test]
    async fn a_canceled_ticket_is_never_started_or_overwritten() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        state
            .app
            .download_tickets
            .mark_status(ticket.id, DownloadStatus::Canceled, None)
            .await
            .unwrap();

        assert!(!process_next(&state.app, &root(), &Fairness::default()).await);
        assert_eq!(
            status_of(&state, ticket.id).await.status,
            DownloadStatus::Canceled
        );
        // Late writes from a worker that raced the cancel change nothing.
        let repo = &state.app.download_tickets;
        assert!(!repo
            .transition(
                ticket.id,
                DownloadStatus::Processing,
                DownloadStatus::Failed,
                Some("x")
            )
            .await
            .unwrap());
        assert!(!repo
            .finish_ready(ticket.id, Path::new("/x.mp4"), 1, Utc::now(), Utc::now())
            .await
            .unwrap());
        assert_eq!(
            status_of(&state, ticket.id).await.status,
            DownloadStatus::Canceled
        );
    }

    #[tokio::test]
    async fn interrupted_tickets_are_requeued_and_claim_is_exclusive() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        let repo = &state.app.download_tickets;
        assert!(repo.claim(ticket.id).await.unwrap());
        assert!(!repo.claim(ticket.id).await.unwrap(), "already taken");
        assert_eq!(repo.requeue_processing().await.unwrap(), 1);
        assert_eq!(repo.list_queued().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn too_little_free_space_fails_the_ticket_before_any_work() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let work_id = seed_movie(&state, "Huge Movie").await;
        let mut file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        // A title far longer than any disk could hold at this quality.
        file.duration_ms = Some(10_000_000_000_000);
        state.media_files.insert(file.clone());
        let ticket = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();

        assert!(process_next(&state.app, &root, &Fairness::default()).await);

        let failed = status_of(&state, ticket.id).await;
        assert_eq!(failed.status, DownloadStatus::Failed);
        assert_eq!(
            failed.error_message.as_deref(),
            Some("there is not enough free space on the server")
        );
        assert!(!root.join(format!("{}.mp4", ticket.id)).exists());
    }

    #[tokio::test]
    async fn the_sweep_expires_tickets_and_deletes_files_that_nothing_wants() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let root = root();
        tokio::fs::create_dir_all(&root).await.unwrap();
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let work_id = seed_movie(&state, "Sweep Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;

        // A ready ticket past its expiry: file deleted, ticket Expired.
        let expired = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let expired_path = root.join(format!("{}.mp4", expired.id));
        tokio::fs::write(&expired_path, b"x").await.unwrap();
        state.app.download_tickets.claim(expired.id).await.unwrap();
        state
            .app
            .download_tickets
            .finish_ready(
                expired.id,
                &expired_path,
                1,
                Utc::now(),
                Utc::now() - chrono::Duration::hours(1),
            )
            .await
            .unwrap();
        // A canceled ticket's file, a fresh orphan (kept: a job may be writing it) and an old orphan.
        let canceled = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Canceled,
        )
        .await;
        let canceled_path = root.join(format!("{}.mp4", canceled.id));
        tokio::fs::write(&canceled_path, b"x").await.unwrap();
        let fresh = root.join(format!("{}.mp4", Uuid::new_v4()));
        tokio::fs::write(&fresh, b"x").await.unwrap();
        let old = root.join(format!("{}.mp4", Uuid::new_v4()));
        tokio::fs::write(&old, b"x").await.unwrap();
        let long_ago = std::time::SystemTime::now() - Duration::from_secs(3600);
        std::fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();

        sweep(&state.app, &root).await;

        assert_eq!(
            status_of(&state, expired.id).await.status,
            DownloadStatus::Expired
        );
        assert!(!expired_path.exists() && !canceled_path.exists() && !old.exists());
        assert!(fresh.exists(), "a recent unknown file may be mid-write");
    }

    #[tokio::test]
    async fn canceling_a_ready_download_deletes_its_file_and_an_expired_one_is_gone() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Cancel Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);
        let root = root();
        tokio::fs::create_dir_all(&root).await.unwrap();

        let make_ready = |expires: chrono::DateTime<Utc>| {
            let state = &state;
            let root = &root;
            let file_id = file.id;
            async move {
                let t = insert_ticket(
                    state,
                    user_id,
                    file_id,
                    "h264-480p-2mbps",
                    DownloadStatus::Queued,
                )
                .await;
                let path = root.join(format!("{}.mp4", t.id));
                tokio::fs::write(&path, b"data").await.unwrap();
                state.app.download_tickets.claim(t.id).await.unwrap();
                state
                    .app
                    .download_tickets
                    .finish_ready(t.id, &path, 4, Utc::now(), expires)
                    .await
                    .unwrap();
                (t, path)
            }
        };
        let request = |method: &str, uri: String| {
            HttpRequest::builder()
                .method(method)
                .uri(uri)
                .header("Authorization", bearer_header(&token))
                .body(Body::empty())
                .unwrap()
        };

        let (live, live_path) = make_ready(Utc::now() + chrono::Duration::days(1)).await;
        let response = router
            .clone()
            .oneshot(request("DELETE", format!("/api/v1/downloads/{}", live.id)))
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
        assert!(
            !live_path.exists(),
            "the file goes with the canceled ticket"
        );

        let (stale, _) = make_ready(Utc::now() - chrono::Duration::minutes(1)).await;
        let response = router
            .oneshot(request(
                "GET",
                format!("/api/v1/downloads/{}/file", stale.id),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::GONE);
    }

    /// A repository whose conditional status writes fail (a full disk, a lost race).
    struct FailingWrites(std::sync::Arc<dyn playarr_db::DownloadTicketRepo>);
    #[async_trait::async_trait]
    impl playarr_db::DownloadTicketRepo for FailingWrites {
        async fn get(&self, id: Uuid) -> Result<Option<DownloadTicket>, playarr_db::DbError> {
            self.0.get(id).await
        }
        async fn list_for_user(&self, u: Uuid) -> Result<Vec<DownloadTicket>, playarr_db::DbError> {
            self.0.list_for_user(u).await
        }
        async fn find_active(
            &self,
            u: Uuid,
            m: Uuid,
            q: &str,
            d: Option<Uuid>,
        ) -> Result<Option<DownloadTicket>, playarr_db::DbError> {
            self.0.find_active(u, m, q, d).await
        }
        async fn insert(&self, t: &DownloadTicket) -> Result<(), playarr_db::DbError> {
            self.0.insert(t).await
        }
        async fn mark_status(
            &self,
            id: Uuid,
            s: DownloadStatus,
            e: Option<&str>,
        ) -> Result<(), playarr_db::DbError> {
            self.0.mark_status(id, s, e).await
        }
        async fn mark_ready(
            &self,
            id: Uuid,
            p: Option<&Path>,
            s: Option<u64>,
            r: chrono::DateTime<Utc>,
            x: Option<chrono::DateTime<Utc>>,
        ) -> Result<(), playarr_db::DbError> {
            self.0.mark_ready(id, p, s, r, x).await
        }
        async fn delete(&self, id: Uuid) -> Result<(), playarr_db::DbError> {
            self.0.delete(id).await
        }
        async fn list_expired(
            &self,
            n: chrono::DateTime<Utc>,
        ) -> Result<Vec<DownloadTicket>, playarr_db::DbError> {
            self.0.list_expired(n).await
        }
        async fn list_queued(&self) -> Result<Vec<DownloadTicket>, playarr_db::DbError> {
            self.0.list_queued().await
        }
        async fn claim(&self, id: Uuid) -> Result<bool, playarr_db::DbError> {
            self.0.claim(id).await
        }
        async fn transition(
            &self,
            _: Uuid,
            _: DownloadStatus,
            _: DownloadStatus,
            _: Option<&str>,
        ) -> Result<bool, playarr_db::DbError> {
            Err(playarr_db::DbError::NotFound)
        }
        async fn finish_ready(
            &self,
            id: Uuid,
            p: &Path,
            s: u64,
            r: chrono::DateTime<Utc>,
            x: chrono::DateTime<Utc>,
        ) -> Result<bool, playarr_db::DbError> {
            self.0.finish_ready(id, p, s, r, x).await
        }
        async fn list_ready_with_files(&self) -> Result<Vec<DownloadTicket>, playarr_db::DbError> {
            self.0.list_ready_with_files().await
        }
        async fn requeue_missing_file(&self, id: Uuid) -> Result<bool, playarr_db::DbError> {
            self.0.requeue_missing_file(id).await
        }
        async fn requeue_processing(&self) -> Result<u64, playarr_db::DbError> {
            self.0.requeue_processing().await
        }
    }

    #[tokio::test]
    async fn a_failing_status_write_makes_the_worker_wait_instead_of_spinning() {
        // Writes fail (as on a full disk): the ticket cannot be marked failed, so the worker must
        // report "wait" and not "done" (which would re-list at once, forever).
        let (_router, state) = state_with(&stub_ffmpeg(), &dv5_hevc_ffprobe_stub()).await;
        let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
        let mut app = state.app.clone();
        app.download_tickets =
            std::sync::Arc::new(FailingWrites(state.app.download_tickets.clone()));
        // A DV5 title fails after the claim; the failure write errors.
        assert!(!process_next(&app, &root(), &Fairness::default()).await);
        let _ = ticket;
    }

    /// A converted file that vanished: the file handler and the boot check both send the ticket back to
    /// the queue (cleared of its output and dates) instead of leaving a Ready ticket that cannot be served.
    #[tokio::test]
    async fn a_ready_ticket_whose_file_is_missing_is_requeued() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Missing Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);
        let make_ready = || async {
            let t = insert_ticket(
                &state,
                user_id,
                file.id,
                "h264-480p-2mbps",
                DownloadStatus::Queued,
            )
            .await;
            state.app.download_tickets.claim(t.id).await.unwrap();
            let gone = std::env::temp_dir().join(format!("gone-{}.mp4", Uuid::new_v4()));
            state
                .app
                .download_tickets
                .finish_ready(
                    t.id,
                    &gone,
                    10,
                    Utc::now(),
                    Utc::now() + chrono::Duration::days(1),
                )
                .await
                .unwrap();
            t
        };

        // 1. The file handler notices.
        let t = make_ready().await;
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .uri(format!("/api/v1/downloads/{}/file", t.id))
                    .header("Authorization", bearer_header(&token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
        let after = status_of(&state, t.id).await;
        assert_eq!(after.status, DownloadStatus::Queued);
        assert!(
            after.output_path.is_none() && after.ready_at.is_none() && after.expires_at.is_none()
        );

        // 2. The boot check notices, too.
        let t2 = make_ready().await;
        requeue_missing_files(&state.app).await;
        assert_eq!(
            status_of(&state, t2.id).await.status,
            DownloadStatus::Queued
        );
    }

    #[tokio::test]
    async fn an_expired_ticket_is_not_returned_as_the_active_one_and_a_quota_stops_new_work() {
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let work_id = seed_movie(&state, "Quota Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        let old = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        state.app.download_tickets.claim(old.id).await.unwrap();
        state
            .app
            .download_tickets
            .finish_ready(
                old.id,
                Path::new("/x.mp4"),
                1,
                Utc::now(),
                Utc::now() - chrono::Duration::minutes(5),
            )
            .await
            .unwrap();
        let active = state
            .app
            .download_tickets
            .find_active(user_id, file.id, "h264-480p-2mbps", None)
            .await
            .unwrap();
        assert!(
            active.is_none(),
            "an expired ready ticket must not be handed out again"
        );

        // The directory quota: existing files plus the estimate must fit.
        let queued = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(
            root.join(format!("{}.mp4", Uuid::new_v4())),
            vec![0u8; 1000],
        )
        .await
        .unwrap();
        let fairness = Fairness {
            quota: Some(1500),
            ..Fairness::default()
        };
        assert!(process_next(&state.app, &root, &fairness).await);
        let failed = status_of(&state, queued.id).await;
        assert_eq!(failed.status, DownloadStatus::Failed);
        assert_eq!(
            failed.error_message.as_deref(),
            Some("the server's download storage is full")
        );
    }

    #[test]
    fn download_sizes_parse_with_binary_suffixes() {
        assert_eq!(parse_size("1000"), Some(1000));
        assert_eq!(parse_size("20Gi"), Some(20 << 30));
        assert_eq!(parse_size(" 5Mi "), Some(5 << 20));
        assert_eq!(parse_size("2Ti"), Some(2 << 40));
        assert_eq!(parse_size("12 parsecs"), None);
        assert_eq!(parse_size(""), None);
    }

    /// Cancelling while ffmpeg runs, and while live playback has it paused: the process is killed, the
    /// file removed, and the ticket stays Canceled.
    #[tokio::test]
    async fn canceling_a_running_or_paused_download_kills_it_and_removes_its_file() {
        for pause_first in [false, true] {
            let ffmpeg = script(
                "ffmpeg",
                "for a; do last=$a; done\ncase \"$last\" in\n*.mp4) head -c 100 /dev/zero > \"$last\"; exec sleep 30;;\n*.m3u8) exec sleep 30;;\nesac",
            );
            let (_router, state) = state_with(&ffmpeg, &sdr_hevc_ffprobe_stub()).await;
            let ticket = queued_ticket(&state, "h264-480p-2mbps").await;
            let root = root();
            let app = state.app.clone();
            let worker_root = root.clone();
            let worker = tokio::spawn(async move {
                process_next(&app, &worker_root, &Fairness::default()).await
            });
            // Wait until the job is running (the ticket is Processing and the file exists).
            let output = root.join(format!("{}.mp4", ticket.id));
            for _ in 0..100 {
                if output.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(output.exists(), "the download is running");
            if pause_first {
                // A viewer arrives: the download is paused and yields its slot.
                let live_file = {
                    let work_id = seed_movie(&state, "Live Movie").await;
                    seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await
                };
                state
                    .app
                    .transcode
                    .spawn_on_demand_transcode(&live_file, "h264-720p-4mbps", "node")
                    .await
                    .expect("live playback takes the slot");
            }
            state
                .app
                .download_tickets
                .mark_status(ticket.id, DownloadStatus::Canceled, None)
                .await
                .unwrap();

            assert!(
                tokio::time::timeout(Duration::from_secs(10), worker)
                    .await
                    .is_ok(),
                "the worker ends"
            );
            assert_eq!(
                status_of(&state, ticket.id).await.status,
                DownloadStatus::Canceled
            );
            assert!(
                !output.exists(),
                "pause_first={pause_first}: the file is removed"
            );
        }
    }

    fn request(token: &str, method: &str, uri: String) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", bearer_header(token))
            .header("Content-Type", "application/json")
            .body(Body::from("{}"))
            .unwrap()
    }

    /// The device confirms it has the file: the staged copy is deleted at once and the ticket reads
    /// expired; a second ack is harmless; an Original ticket's ack never touches the source file.
    #[tokio::test]
    async fn the_device_ack_deletes_the_staged_file_at_once() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Ack Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);
        let root = root();

        // A converted ticket, produced by the worker.
        let ticket = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        assert!(process_next(&state.app, &root, &Fairness::default()).await);
        let staged = status_of(&state, ticket.id)
            .await
            .output_path
            .expect("staged file");
        assert!(staged.exists());

        // Not ready tickets cannot be acked.
        let waiting = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-720p-4mbps",
            DownloadStatus::Queued,
        )
        .await;
        let early = router
            .clone()
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", waiting.id),
            ))
            .await
            .unwrap();
        assert_eq!(early.status(), axum::http::StatusCode::CONFLICT);

        let ack = router
            .clone()
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", ticket.id),
            ))
            .await
            .unwrap();
        assert_eq!(ack.status(), axum::http::StatusCode::NO_CONTENT);
        assert!(!staged.exists(), "the staged copy is gone");
        assert_eq!(
            status_of(&state, ticket.id).await.status,
            DownloadStatus::Expired
        );
        // Idempotent.
        let again = router
            .clone()
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", ticket.id),
            ))
            .await
            .unwrap();
        assert_eq!(again.status(), axum::http::StatusCode::NO_CONTENT);

        // An Original ticket serves the source file itself: its ack must never delete anything.
        let source = std::env::temp_dir().join(format!("source-{}.mkv", Uuid::new_v4()));
        tokio::fs::write(&source, b"library file").await.unwrap();
        let original =
            insert_ticket(&state, user_id, file.id, "original", DownloadStatus::Queued).await;
        state.app.download_tickets.claim(original.id).await.unwrap();
        state
            .app
            .download_tickets
            .finish_ready(
                original.id,
                &source,
                12,
                Utc::now(),
                Utc::now() + chrono::Duration::days(1),
            )
            .await
            .unwrap();
        let ack = router
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", original.id),
            ))
            .await
            .unwrap();
        assert_eq!(ack.status(), axum::http::StatusCode::NO_CONTENT);
        assert!(
            source.exists(),
            "a path that is not <ticket id>.mp4 is never deleted"
        );
    }

    /// Without an ack the staged file still goes after the staging time, and the ticket can be asked
    /// for again (a new ticket, not the expired one).
    #[tokio::test]
    async fn staged_files_expire_after_the_staging_time_and_can_be_requested_again() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Ttl Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let token = mint_access_token(&state, user_id);
        let ticket = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();
        let fairness = Fairness {
            staging_ttl: Some(chrono::Duration::seconds(1)),
            ..Fairness::default()
        };

        assert!(process_next(&state.app, &root, &fairness).await);
        let ready = status_of(&state, ticket.id).await;
        let staged = ready.output_path.clone().expect("staged file");
        let expires = ready.expires_at.expect("an expiry");
        assert!(
            expires - Utc::now() <= chrono::Duration::seconds(1),
            "the TTL, not days"
        );
        sweep(&state.app, &root).await;
        assert!(staged.exists(), "still staged before the TTL passes");

        tokio::time::sleep(Duration::from_millis(1300)).await;
        sweep(&state.app, &root).await;
        assert!(!staged.exists(), "the sweep deleted the staged file");
        assert_eq!(
            status_of(&state, ticket.id).await.status,
            DownloadStatus::Expired
        );
        let body = serde_json::json!({ "media_file_id": file.id, "quality_id": "h264-480p-2mbps" });
        let response = router
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/api/v1/downloads")
                    .header("Authorization", bearer_header(&token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::CREATED,
            "a new ticket, not the expired one"
        );
    }

    #[test]
    fn staging_times_parse_with_units() {
        assert_eq!(
            parse_duration("3600"),
            Some(chrono::Duration::seconds(3600))
        );
        assert_eq!(parse_duration("90m"), Some(chrono::Duration::minutes(90)));
        assert_eq!(parse_duration("24h"), Some(chrono::Duration::hours(24)));
        assert_eq!(parse_duration("2d"), Some(chrono::Duration::days(2)));
        assert_eq!(parse_duration("soon"), None);
        std::env::remove_var("PLAYARR_DOWNLOAD_STAGING_TTL");
        assert_eq!(staging_ttl(), chrono::Duration::hours(24));
    }

    /// A zero duration is unknown, not free: the estimate and the cap treat it as a long film, so a
    /// tiny quota fails the ticket before any work.
    #[tokio::test]
    async fn a_zero_duration_is_unknown_and_a_tiny_quota_fails_the_ticket() {
        assert!(estimated_bytes("h264-480p-2mbps", Some(0)) > 500_000_000);
        assert_eq!(running_cap(Some(0)), DEFAULT_CAP);
        let (_router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let work_id = seed_movie(&state, "Zero Movie").await;
        let mut file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        file.duration_ms = Some(0);
        state.media_files.insert(file.clone());
        let ticket = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();
        let fairness = Fairness {
            quota: Some(10_000),
            ..Fairness::default()
        };

        assert!(process_next(&state.app, &root, &fairness).await);
        let failed = status_of(&state, ticket.id).await;
        assert_eq!(failed.status, DownloadStatus::Failed);
        assert_eq!(
            failed.error_message.as_deref(),
            Some("the server's download storage is full")
        );
    }

    /// The quota is enforced while the job runs: a file that grows past it is killed and deleted.
    #[tokio::test]
    async fn a_job_that_outgrows_the_quota_is_killed_and_its_file_deleted() {
        // The stub writes 600 kB and then keeps running; the quota (500 kB) is passed at once.
        let ffmpeg = script(
            "ffmpeg",
            "for a; do last=$a; done\ncase \"$last\" in\n*.mp4) head -c 600000 /dev/zero > \"$last\"; exec sleep 30;;\nesac",
        );
        let (_router, state) = state_with(&ffmpeg, &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        seed_streaming_user(&state, user_id).await;
        let work_id = seed_movie(&state, "Grow Movie").await;
        let mut file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        // A short title, so the up-front estimate fits the quota and only the live guard can stop it.
        file.duration_ms = Some(1000);
        state.media_files.insert(file.clone());
        let ticket = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();
        let fairness = Fairness {
            quota: Some(500_000),
            ..Fairness::default()
        };
        assert!(estimated_bytes("h264-480p-2mbps", Some(1000)) < 500_000);

        assert!(tokio::time::timeout(
            Duration::from_secs(10),
            process_next(&state.app, &root, &fairness)
        )
        .await
        .is_ok());
        let failed = status_of(&state, ticket.id).await;
        assert_eq!(failed.status, DownloadStatus::Failed);
        assert_eq!(
            failed.error_message.as_deref(),
            Some("the server's download storage is full")
        );
        assert!(!root.join(format!("{}.mp4", ticket.id)).exists());
    }

    /// The ack moves the ticket first and deletes the file only if it won: a lost race leaves the file.
    #[tokio::test]
    async fn the_ack_deletes_the_file_only_after_the_ticket_moved() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Order Movie").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let device = Uuid::new_v4();
        let token = state
            .app
            .jwt
            .issue_access_token(user_id, device, Uuid::new_v4())
            .unwrap();
        let t = insert_ticket(
            &state,
            user_id,
            file.id,
            "h264-480p-2mbps",
            DownloadStatus::Queued,
        )
        .await;
        let root = root();
        tokio::fs::create_dir_all(&root).await.unwrap();
        let path = root.join(format!("{}.mp4", t.id));
        tokio::fs::write(&path, b"data").await.unwrap();
        state.app.download_tickets.claim(t.id).await.unwrap();
        state
            .app
            .download_tickets
            .finish_ready(
                t.id,
                &path,
                4,
                Utc::now(),
                Utc::now() + chrono::Duration::days(1),
            )
            .await
            .unwrap();

        // The repository refuses the transition (a lost race, a failing disk): the file must stay.
        let mut app = state.app.clone();
        app.download_tickets =
            std::sync::Arc::new(FailingWrites(state.app.download_tickets.clone()));
        let racing = crate::test_support::router_for_test(app);
        let response = racing
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", t.id),
            ))
            .await
            .unwrap();
        assert!(!response.status().is_success());
        assert!(
            path.exists(),
            "a failed transition must not delete the file"
        );

        // The normal ack moves it and then deletes.
        let response = router
            .oneshot(request(
                &token,
                "POST",
                format!("/api/v1/downloads/{}/complete", t.id),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
        assert!(!path.exists());
    }

    /// Two devices of one account: converted tickets are per device, one device's ack never touches the
    /// other's staged copy, and an Original ack changes nothing.
    #[tokio::test]
    async fn converted_tickets_are_per_device_and_an_original_ack_is_a_no_op() {
        let (router, state) = state_with(&stub_ffmpeg(), &sdr_hevc_ffprobe_stub()).await;
        let user_id = Uuid::new_v4();
        let work_id = seed_movie(&state, "Two Devices").await;
        let file = seed_downloadable_media_file(&state, work_id, Uuid::new_v4()).await;
        seed_streaming_user_with_library_allow(&state, user_id, vec![file.source_instance_id])
            .await;
        let (dev_a, dev_b) = (Uuid::new_v4(), Uuid::new_v4());
        let token_a = state
            .app
            .jwt
            .issue_access_token(user_id, dev_a, Uuid::new_v4())
            .unwrap();
        let token_b = state
            .app
            .jwt
            .issue_access_token(user_id, dev_b, Uuid::new_v4())
            .unwrap();
        let create = |token: &str, quality: &str| {
            HttpRequest::builder()
                .method("POST")
                .uri("/api/v1/downloads")
                .header("Authorization", bearer_header(token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "media_file_id": file.id, "quality_id": quality })
                        .to_string(),
                ))
                .unwrap()
        };
        let id_of = |response: axum::response::Response| async move {
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            Uuid::parse_str(v["id"].as_str().unwrap()).unwrap()
        };

        // Each device gets its own converted ticket (201 twice, different ids); repeats are idempotent per device.
        let a = router
            .clone()
            .oneshot(create(&token_a, "h264-480p-2mbps"))
            .await
            .unwrap();
        assert_eq!(a.status(), axum::http::StatusCode::CREATED);
        let a_id = id_of(a).await;
        let b = router
            .clone()
            .oneshot(create(&token_b, "h264-480p-2mbps"))
            .await
            .unwrap();
        assert_eq!(
            b.status(),
            axum::http::StatusCode::CREATED,
            "device B is not handed device A's ticket"
        );
        let b_id = id_of(b).await;
        assert_ne!(a_id, b_id);
        let again = router
            .clone()
            .oneshot(create(&token_a, "h264-480p-2mbps"))
            .await
            .unwrap();
        assert_eq!(again.status(), axum::http::StatusCode::OK);
        assert_eq!(id_of(again).await, a_id);

        // Device B cannot acknowledge device A's ticket.
        let root = root();
        tokio::fs::create_dir_all(&root).await.unwrap();
        let a_path = root.join(format!("{a_id}.mp4"));
        tokio::fs::write(&a_path, b"data").await.unwrap();
        state.app.download_tickets.claim(a_id).await.unwrap();
        state
            .app
            .download_tickets
            .finish_ready(
                a_id,
                &a_path,
                4,
                Utc::now(),
                Utc::now() + chrono::Duration::days(1),
            )
            .await
            .unwrap();
        let wrong = router
            .clone()
            .oneshot(request(
                &token_b,
                "POST",
                format!("/api/v1/downloads/{a_id}/complete"),
            ))
            .await
            .unwrap();
        assert_eq!(wrong.status(), axum::http::StatusCode::NOT_FOUND);
        assert!(a_path.exists());

        // Original tickets are shared and an ack on them is a no-op (the ticket stays Ready).
        let o = router
            .clone()
            .oneshot(create(&token_a, "original"))
            .await
            .unwrap();
        let o_id = id_of(o).await;
        let ack = router
            .oneshot(request(
                &token_b,
                "POST",
                format!("/api/v1/downloads/{o_id}/complete"),
            ))
            .await
            .unwrap();
        assert_eq!(ack.status(), axum::http::StatusCode::NO_CONTENT);
        assert_eq!(status_of(&state, o_id).await.status, DownloadStatus::Ready);
    }

    #[test]
    fn the_queue_is_served_in_fair_turns_per_user() {
        let user = |n: u8| Uuid::from_bytes([n; 16]);
        let at = |sec: i64| Utc::now() - chrono::Duration::seconds(1000 - sec);
        let ticket = |u: u8, sec: i64| DownloadTicket {
            id: Uuid::new_v4(),
            user_id: user(u),
            media_file_id: Uuid::new_v4(),
            device_id: None,
            quality_id: "q".into(),
            profile: Some("q".into()),
            container: "mp4".into(),
            status: DownloadStatus::Queued,
            output_path: None,
            size_bytes: None,
            error_message: None,
            requested_at: at(sec),
            ready_at: None,
            expires_at: None,
        };
        // User 1 queued three titles first, user 2 one afterwards.
        let queued = vec![ticket(1, 1), ticket(1, 2), ticket(1, 3), ticket(2, 4)];
        let fairness = Fairness::default();
        let order: Vec<u8> = fairness
            .order(queued.clone())
            .iter()
            .map(|t| t.user_id.as_bytes()[0])
            .collect();
        assert_eq!(
            order,
            vec![1, 2, 1, 1],
            "user 2 waits behind one of user 1's titles, not all three"
        );
        // After user 1 was just served, user 2 goes first.
        fairness.note(user(1));
        let order: Vec<u8> = fairness
            .order(queued)
            .iter()
            .map(|t| t.user_id.as_bytes()[0])
            .collect();
        assert_eq!(order[0], 2);
    }

    #[test]
    fn audio_follows_playback_saved_then_language_then_default() {
        let tracks = vec![
            (1, Some("en".to_string()), false),
            (2, Some("fr".to_string()), true),
            (3, Some("ja".to_string()), false),
        ];
        assert_eq!(
            choose_audio(&tracks, Some("source-audio-3"), Some("fr")),
            Some(3)
        );
        assert_eq!(choose_audio(&tracks, None, Some("ja")), Some(3));
        assert_eq!(
            choose_audio(&tracks, None, Some("de")),
            Some(2),
            "no match: the file's default"
        );
        assert_eq!(
            choose_audio(&tracks[..1], None, None),
            Some(1),
            "no default: the first track"
        );
        assert_eq!(choose_audio(&[], None, Some("en")), None);
    }

    #[test]
    fn the_time_limit_scales_with_the_title_and_the_root_never_falls_back_to_the_filesystem_root() {
        assert_eq!(
            running_cap(Some(2 * 3600 * 1000)),
            Duration::from_secs(6 * 3600)
        );
        assert_eq!(running_cap(Some(60_000)), Duration::from_secs(3600));
        assert_eq!(running_cap(Some(u64::MAX)), Duration::from_secs(24 * 3600));
        assert_eq!(running_cap(None), DEFAULT_CAP);
        std::env::set_var("PLAYARR_DOWNLOAD_DIR", "/data/dl");
        assert_eq!(download_root(), PathBuf::from("/data/dl"));
        std::env::set_var("PLAYARR_DOWNLOAD_DIR", "");
        assert_eq!(
            download_root(),
            std::env::temp_dir().join("playarr-downloads")
        );
        std::env::remove_var("PLAYARR_DOWNLOAD_DIR");
        assert_eq!(
            download_root(),
            std::env::temp_dir().join("playarr-downloads")
        );
        assert!(estimated_bytes("h264-480p-2mbps", Some(3_600_000)) > 500_000_000);
    }
}
