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

pub struct PlayRequest {
    pub media_file_id: String,
    pub start_ms: i64,
    pub title: String,
    /// Work whose poster shows in the system's media controls.
    pub art_work_id: Option<String>,
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
    back.set_child(Some(&crate::icons::image("close", 20, crate::icons::Tone::Ink)));
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
    bg(
        move || c.playback(&file, start),
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
    let port = proxy_port.ok_or("Playback proxy is not running.")?;
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
    let local = crate::proxy::local_url(port, &info.url);
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

    // Controls as the web's phone player: scrubber, time, then skip back, play/pause and skip forward.
    let toggle = gtk4::Button::builder()
        .icon_name("media-playback-pause-symbolic")
        .css_classes(["pa-round", "big"])
        .build();
    let skip_back = gtk4::Button::builder()
        .icon_name("media-seek-backward-symbolic")
        .css_classes(["pa-round"])
        .build();
    let skip_fwd = gtk4::Button::builder()
        .icon_name("media-seek-forward-symbolic")
        .css_classes(["pa-round"])
        .build();
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
    let buttons = gtk4::Box::builder().spacing(18).halign(gtk4::Align::Center).build();
    buttons.append(&skip_back);
    buttons.append(&toggle);
    buttons.append(&skip_fwd);
    let bottom = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(10)
        .valign(gtk4::Align::End)
        .css_classes(["pa-player-scrim"])
        .build();
    bottom.append(&scale);
    bottom.append(&times);
    bottom.append(&buttons);
    root.add_overlay(&bottom);
    for (b, delta) in [(&skip_back, -10_000i64), (&skip_fwd, 10_000)] {
        let player = player.clone();
        b.connect_clicked(move |_| {
            let target = (player.position_ms() + delta - player.offset_ms).max(0);
            let _ = player.pipeline.seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                gst::ClockTime::from_mseconds(target as u64),
            );
        });
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
            toggle2.set_icon_name(if now_playing {
                "media-playback-pause-symbolic"
            } else {
                "media-playback-start-symbolic"
            });
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
        app.mpris.set_playing(
            &req.title,
            None,
            info.duration_ms * 1000,
            control,
            Rc::new(move || pos_player.position_ms() * 1000),
        );
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
                    toggle.set_icon_name("media-playback-start-symbolic");
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
