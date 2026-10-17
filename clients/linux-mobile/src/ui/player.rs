//! Playback page: GStreamer `playbin3` rendering into a GTK paintable, with resume and progress reporting.
use super::{bg, App};
use crate::api::Client;
use gstreamer as gst;
use gstreamer::prelude::*;
use gtk4::prelude::*;
use gtk4::{gdk, glib};
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

thread_local! {
    /// What plays after and before the current title: the episodes of a series or the tracks of an album.
    static QUEUE: std::cell::RefCell<Vec<(String, String)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Sets the play queue as (media file id, title) pairs, in order.
pub fn set_queue(items: Vec<(String, String)>) {
    QUEUE.with(|q| *q.borrow_mut() = items);
}

/// The queue entry `step` away from `file`, if there is one.
fn queue_step(file: &str, step: i64) -> Option<(String, String)> {
    QUEUE.with(|q| {
        let q = q.borrow();
        let i = q.iter().position(|(f, _)| f == file)? as i64 + step;
        usize::try_from(i).ok().and_then(|i| q.get(i).cloned())
    })
}

/// A 44 px icon button of the web's phone player; `primary` gives it the soft disc.
fn ctl(icon: &str, primary: bool) -> gtk4::Button {
    let b = gtk4::Button::builder().css_classes(["pa-ctl"]).build();
    if primary {
        b.add_css_class("primary");
    }
    set_icon(&b, icon);
    b
}

fn set_icon(b: &gtk4::Button, icon: &str) {
    b.set_child(Some(&crate::icons::image(icon, 20, crate::icons::Tone::White)));
}

/// Leaves the page for the queue entry `step` away from `file`, if there is one.
fn go_step(app: &Rc<App>, file: &str, step: i64, art_work_id: Option<String>) {
    if let Some((file, title)) = queue_step(file, step) {
        app.nav.pop();
        app.play(PlayRequest {
            media_file_id: file,
            start_ms: 0,
            title,
            art_work_id,
            local_file: None,
        });
    }
}

pub struct PlayRequest {
    pub media_file_id: String,
    pub start_ms: i64,
    pub title: String,
    /// Work whose poster shows in the system's media controls.
    pub art_work_id: Option<String>,
    /// A downloaded file to play instead of streaming from the server.
    pub local_file: Option<std::path::PathBuf>,
}

/// Report progress at most this often while playing.
const REPORT_EVERY: Duration = Duration::from_secs(10);
/// Past this fraction of the runtime the title counts as watched.
const WATCHED_FRACTION: f64 = 0.92;

pub fn completed(position_ms: i64, duration_ms: i64) -> bool {
    duration_ms > 0 && position_ms as f64 >= duration_ms as f64 * WATCHED_FRACTION
}

struct Player {
    pipeline: gst::Element,
    client: Client,
    file: String,
    /// Source timestamp of playback time 0 (non-zero for a transcode started part-way through).
    offset_ms: i64,
    duration_ms: Cell<i64>,
    last_report: Cell<Instant>,
    closed: Cell<bool>,
    mpris: crate::mpris::Mpris,
}

impl Player {
    fn position_ms(&self) -> i64 {
        let p = self
            .pipeline
            .query_position::<gst::ClockTime>()
            .map(|t| t.mseconds() as i64)
            .unwrap_or(0);
        p + self.offset_ms
    }

    fn report(&self, finished: bool) {
        let (pos, dur) = (self.position_ms(), self.duration_ms.get());
        if dur <= 0 || pos <= 0 {
            return;
        }
        self.last_report.set(Instant::now());
        let (c, f, done) = (self.client.clone(), self.file.clone(), finished || completed(pos, dur));
        std::thread::spawn(move || {
            let _ = c.report_progress(&f, if done { dur } else { pos }, dur, done);
        });
    }

    fn close(&self) {
        if self.closed.replace(true) {
            return;
        }
        self.report(false);
        self.mpris.clear();
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

pub fn build(app: Rc<App>, client: Client, req: PlayRequest) -> gtk4::Widget {
    let root = gtk4::Overlay::builder().css_classes(["pa-player"]).build();
    let status = gtk4::Label::builder()
        .label("Starting…")
        .css_classes(["pa-muted"])
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Center)
        .build();
    root.set_child(Some(&status));

    let back = gtk4::Button::builder()
        .css_classes(["pa-round"])
        .halign(gtk4::Align::End)
        .build();
    back.set_child(Some(&crate::icons::image("close", 22, crate::icons::Tone::White)));
    let top = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Horizontal)
        .spacing(10)
        .valign(gtk4::Align::Start)
        .halign(gtk4::Align::End)
        .css_classes(["pa-player-top"])
        .build();
    top.append(&back);
    root.add_overlay(&top);
    let top_bar = top.clone();
    {
        let app = app.clone();
        back.connect_clicked(move |_| {
            app.nav.pop();
        });
    }

    let (file, start) = (req.media_file_id.clone(), req.start_ms);
    let c = client.clone();
    let proxy_port = app.proxy_port();
    let weak = root_weak(&root);
    let offline = req.local_file.is_some();
    bg(
        move || {
            if offline {
                // Offline: no server call; the pipeline reads the file itself.
                Ok(crate::model::PlaybackInfo {
                    url: String::new(),
                    mode: "direct".into(),
                    duration_ms: 0,
                    source_offset_ms: 0,
                })
            } else {
                c.playback(&file, start)
            }
        },
        move |res| match res {
            Err(e) => status.set_label(&e.to_string()),
            Ok(info) => match start_pipeline(&weak, &top_bar, &app, client, &req, info, proxy_port) {
                Ok(()) => status.set_visible(false),
                Err(m) => status.set_label(&m),
            },
        },
    );
    root.upcast()
}

fn root_weak(root: &gtk4::Overlay) -> glib::WeakRef<gtk4::Overlay> {
    root.downgrade()
}

fn start_pipeline(
    root: &glib::WeakRef<gtk4::Overlay>,
    top: &gtk4::Box,
    app: &Rc<App>,
    client: Client,
    req: &PlayRequest,
    info: crate::model::PlaybackInfo,
    proxy_port: Option<u16>,
) -> Result<(), String> {
    let root = root.upgrade().ok_or("closed")?;
    let port = match (&req.local_file, proxy_port) {
        (Some(_), p) => p.unwrap_or(0),
        (None, p) => p.ok_or("Playback proxy is not running.")?,
    };
    let sink = gst::ElementFactory::make("gtk4paintablesink")
        .build()
        .map_err(|_| "Video output missing: install the GStreamer GTK4 plugin (gst-plugins-rs-gtk4).".to_string())?;
    let paintable = sink.property::<gdk::Paintable>("paintable");
    let pipeline = gst::ElementFactory::make("playbin3")
        .build()
        .map_err(|_| "GStreamer playbin3 is missing.".to_string())?;
    pipeline.set_property("video-sink", &sink);
    if let Ok(name) = std::env::var("PLAYARR_AUDIO_SINK") {
        // For machines without a sound device, for example `fakesink`.
        if let Ok(s) = gst::ElementFactory::make(&name).build() {
            pipeline.set_property("audio-sink", &s);
        }
    }
    let local = match &req.local_file {
        Some(f) => glib::filename_to_uri(f, None).map_err(|e| e.to_string())?.to_string(),
        None => crate::proxy::local_url(port, &info.url),
    };
    pipeline.set_property("uri", &local);

    let direct = info.mode == "direct";
    let player = Rc::new(Player {
        pipeline: pipeline.clone(),
        client,
        file: req.media_file_id.clone(),
        offset_ms: if direct { 0 } else { info.source_offset_ms },
        duration_ms: Cell::new(info.duration_ms),
        last_report: Cell::new(Instant::now()),
        closed: Cell::new(false),
        mpris: app.mpris.clone(),
    });

    let picture = gtk4::Picture::builder()
        .paintable(&paintable)
        .content_fit(gtk4::ContentFit::Contain)
        .hexpand(true)
        .vexpand(true)
        .build();
    root.set_child(Some(&picture));

    // Controls as the web's phone player: scrubber, time, then two rows of icon buttons.
    let toggle = ctl("p-pause", true);
    let skip_back = ctl("p-prev", false);
    let skip_fwd = ctl("p-next", false);
    let mute = ctl("p-volume", false);
    let fullscreen = ctl("p-fullscreen", false);
    // shortcut: audio and subtitle track, queue, quality, health and play-on buttons are shown disabled (the web
    // disables them too without data); wire each when the native player gains that feature.
    let idle = |icon: &str| {
        let b = ctl(icon, false);
        b.set_sensitive(false);
        b
    };
    let scale = gtk4::Scale::with_range(gtk4::Orientation::Horizontal, 0.0, 1.0, 0.001);
    scale.set_hexpand(true);
    let pos_label = gtk4::Label::builder()
        .label("0:00")
        .css_classes(["pa-player-time"])
        .build();
    let dur_label = gtk4::Label::builder()
        .label("0:00")
        .css_classes(["pa-player-time"])
        .build();
    let times = gtk4::Box::builder().spacing(6).halign(gtk4::Align::Center).build();
    times.append(&pos_label);
    times.append(
        &gtk4::Label::builder()
            .label("/")
            .css_classes(["pa-player-time"])
            .build(),
    );
    times.append(&dur_label);
    let row = || gtk4::Box::builder().spacing(1).halign(gtk4::Align::Center).build();
    let (row1, row2) = (row(), row());
    for b in [&skip_back, &toggle, &skip_fwd, &mute] {
        row1.append(b);
    }
    for icon in ["p-audio", "p-subtitles", "p-queue"] {
        row1.append(&idle(icon));
    }
    let quality = gtk4::Button::builder()
        .css_classes(["pa-ctl", "pa-quality"])
        .label(if direct { "Original" } else { "Transcoded" })
        .sensitive(false)
        .build();
    row2.append(&quality);
    row2.append(&idle("p-info"));
    row2.append(&idle("p-devices"));
    row2.append(&fullscreen);
    let bottom = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(4)
        .valign(gtk4::Align::End)
        .css_classes(["pa-player-scrim"])
        .build();
    bottom.append(&scale);
    bottom.append(&times);
    bottom.append(&row1);
    bottom.append(&row2);
    root.add_overlay(&bottom);
    skip_back.set_sensitive(queue_step(&req.media_file_id, -1).is_some());
    skip_fwd.set_sensitive(queue_step(&req.media_file_id, 1).is_some());
    {
        let (pipeline, mute2) = (pipeline.clone(), mute.clone());
        mute.connect_clicked(move |_| {
            let muted = !pipeline.property::<bool>("mute");
            pipeline.set_property("mute", muted);
            set_icon(&mute2, if muted { "p-muted" } else { "p-volume" });
        });
    }
    {
        let (app, fullscreen2) = (app.clone(), fullscreen.clone());
        fullscreen.connect_clicked(move |_| {
            let on = !app.window.is_fullscreen();
            app.window.set_fullscreened(on);
            set_icon(&fullscreen2, if on { "p-fullscreen-exit" } else { "p-fullscreen" });
        });
    }
    for (b, step) in [(&skip_back, -1i64), (&skip_fwd, 1)] {
        let (app, file, art) = (app.clone(), req.media_file_id.clone(), req.art_work_id.clone());
        b.connect_clicked(move |_| go_step(&app, &file, step, art.clone()));
    }
    // Tap the picture to show or hide the controls.
    let controls: Vec<gtk4::Widget> = vec![bottom.clone().upcast(), top.clone().upcast()];
    let shown_until = Rc::new(Cell::new(Instant::now() + Duration::from_secs(4)));
    let tap = gtk4::GestureClick::new();
    {
        let (controls, shown_until) = (controls.clone(), shown_until.clone());
        tap.connect_released(move |_, _, _, _| {
            let visible = controls[0].is_visible();
            shown_until.set(
                Instant::now()
                    + if visible {
                        Duration::ZERO
                    } else {
                        Duration::from_secs(4)
                    },
            );
        });
    }
    picture.add_controller(tap);

    let pin_controls = std::env::var("PLAYARR_KEEP_CONTROLS").is_ok();
    let playing = Rc::new(Cell::new(true));
    {
        let (player, playing, toggle2) = (player.clone(), playing.clone(), toggle.clone());
        let shown_until = shown_until.clone();
        toggle.connect_clicked(move |_| {
            let now_playing = !playing.get();
            playing.set(now_playing);
            let _ = player.pipeline.set_state(if now_playing {
                gst::State::Playing
            } else {
                gst::State::Paused
            });
            set_icon(&toggle2, if now_playing { "p-pause" } else { "p-play" });
            player.mpris.set_status(if now_playing { "Playing" } else { "Paused" });
            if !now_playing {
                player.report(false);
            }
            shown_until.set(Instant::now() + Duration::from_secs(4));
        });
    }

    // System media controls (MPRIS): title, poster, position and play, pause and seek from outside the app.
    {
        let control: crate::mpris::Control = {
            let art_id = req.art_work_id.clone();
            let (toggle, playing, player, app) = (toggle.clone(), playing.clone(), player.clone(), app.clone());
            Rc::new(move |c| {
                use crate::mpris::Cmd;
                match c {
                    Cmd::Play if !playing.get() => toggle.emit_clicked(),
                    Cmd::Pause if playing.get() => toggle.emit_clicked(),
                    Cmd::PlayPause => toggle.emit_clicked(),
                    Cmd::Stop => {
                        app.nav.pop();
                    }
                    Cmd::Next | Cmd::Previous => {
                        go_step(&app, &player.file, if c == Cmd::Next { 1 } else { -1 }, art_id.clone())
                    }
                    Cmd::Seek(us) => {
                        let target = (player.position_ms() + us / 1000 - player.offset_ms).max(0);
                        let _ = player.pipeline.seek_simple(
                            gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                            gst::ClockTime::from_mseconds(target as u64),
                        );
                    }
                    Cmd::SetPosition(us) => {
                        let target = (us / 1000 - player.offset_ms).max(0);
                        let _ = player.pipeline.seek_simple(
                            gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                            gst::ClockTime::from_mseconds(target as u64),
                        );
                    }
                    _ => {}
                }
            })
        };
        let pos_player = player.clone();
        let (next, previous) = (
            queue_step(&req.media_file_id, 1).is_some(),
            queue_step(&req.media_file_id, -1).is_some(),
        );
        app.mpris.set_playing(
            &req.title,
            None,
            info.duration_ms * 1000,
            control,
            Rc::new(move || pos_player.position_ms() * 1000),
        );
        app.mpris.set_queue_nav(next, previous);
        if let Some(id) = req.art_work_id.clone() {
            let (mpris, c) = (app.mpris.clone(), player.client.clone());
            bg(
                move || {
                    let bytes = c.bytes(&crate::api::Client::artwork_path(&id, "poster", 360)).ok()?;
                    let dir = crate::store::cache_dir();
                    std::fs::create_dir_all(&dir).ok()?;
                    let path = dir.join(format!("art-{id}.img"));
                    std::fs::write(&path, bytes).ok()?;
                    Some(format!("file://{}", path.display()))
                },
                move |url| mpris.set_art(url),
            );
        }
    }

    let updating = Rc::new(Cell::new(false));
    {
        let (player, updating, shown_until) = (player.clone(), updating.clone(), shown_until.clone());
        scale.connect_value_changed(move |s| {
            if updating.get() {
                return;
            }
            let target = (s.value() * player.duration_ms.get() as f64) as i64 - player.offset_ms;
            let _ = player.pipeline.seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                gst::ClockTime::from_mseconds(target.max(0) as u64),
            );
            shown_until.set(Instant::now() + Duration::from_secs(4));
        });
    }

    let _ = pipeline.set_state(gst::State::Playing);
    let need_start_seek = Cell::new(direct && req.start_ms > 0);
    let start_ms = req.start_ms;
    let bus = pipeline.bus().ok_or("no bus")?;
    let (p2, status_root) = (player.clone(), root.downgrade());
    glib::timeout_add_local(Duration::from_millis(250), move |/* tick */| {
        let (player, root) = (&p2, &status_root);
        if player.closed.get() {
            return glib::ControlFlow::Break;
        }
        while let Some(msg) = bus.pop() {
            use gst::MessageView as V;
            match msg.view() {
                V::Error(e) => {
                    let text = format!("Playback failed: {}", e.error());
                    if let Some(r) = root.upgrade() {
                        r.add_overlay(&gtk4::Label::builder().label(&text).css_classes(["pa-error"]).wrap(true).margin_start(24).margin_end(24).halign(gtk4::Align::Center).valign(gtk4::Align::Center).build());
                    }
                    player.close();
                    return glib::ControlFlow::Break;
                }
                V::Eos(_) => {
                    player.report(true);
                    let _ = player.pipeline.set_state(gst::State::Paused);
                    playing.set(false);
                    player.mpris.set_status("Paused");
                    set_icon(&toggle, "p-play");
                }
                V::Buffering(b) => {
                    // Hold playback while the buffer refills, resume when it is full.
                    if playing.get() {
                        let _ = player.pipeline.set_state(if b.percent() < 100 { gst::State::Paused } else { gst::State::Playing });
                    }
                }
                V::DurationChanged(_) | V::AsyncDone(_) => {}
                _ => {}
            }
        }
        if player.duration_ms.get() <= 0 {
            if let Some(d) = player.pipeline.query_duration::<gst::ClockTime>() {
                player.duration_ms.set(d.mseconds() as i64 + player.offset_ms);
            }
        }
        let dur = player.duration_ms.get();
        if need_start_seek.get() && player.pipeline.query_duration::<gst::ClockTime>().is_some() {
            need_start_seek.set(false);
            let _ = player.pipeline.seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT, gst::ClockTime::from_mseconds(start_ms as u64));
        }
        let pos = player.position_ms();
        pos_label.set_label(&super::detail::fmt_clock(pos));
        dur_label.set_label(&super::detail::fmt_clock(dur));
        if dur > 0 {
            updating.set(true);
            scale.set_value((pos as f64 / dur as f64).clamp(0.0, 1.0));
            updating.set(false);
        }
        let show = Instant::now() < shown_until.get() || !playing.get() || pin_controls;
        for c in &controls {
            c.set_visible(show);
        }
        if playing.get() && player.last_report.get().elapsed() >= REPORT_EVERY {
            player.report(false);
        }
        glib::ControlFlow::Continue
    });

    // Leaving the page stops playback and sends the final position.
    let page_player = player.clone();
    app.nav.connect_popped(move |_, _| page_player.close());
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn watched_after_92_percent() {
        assert!(!super::completed(91_000, 100_000));
        assert!(super::completed(92_000, 100_000));
        assert!(!super::completed(5, 0));
    }
}
