//! Title detail for films and series: hero art, meta, resume, seasons and episodes.
use super::images::Images;
use super::{bg, header, App};
use crate::api::Client;
use crate::icons::{self, Tone};
use crate::model::{ResumeOption, SeasonDetail, WorkDetail};
use crate::ui::player::PlayRequest;
use gtk4::prelude::*;
use std::rc::Rc;

/// "2003-06-05T00:00:00Z" as "5 Jun 2003".
pub fn fmt_date(iso: &str) -> Option<String> {
    let d = crate::ui::calendar::parse(iso)?;
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
    ];
    Some(format!("{} {} {}", d.d, months.get(d.m as usize - 1)?, d.y))
}

pub fn fmt_clock(ms: i64) -> String {
    let s = (ms / 1000).max(0);
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
    } else {
        format!("{}:{:02}", s / 60, s % 60)
    }
}

pub struct Loaded {
    detail: WorkDetail,
    /// Resume target: media file, start position, label.
    resume: Option<(String, i64, String)>,
    /// Series: the next-up episode (season number, episode id) the page opens on.
    focus: Option<(i32, String)>,
    /// Series: watch progress by media file, for the episode cards' unseen dot and progress bar.
    progress: std::collections::HashMap<String, crate::model::WatchProgress>,
}

fn fetch(c: &Client, id: &str) -> Result<Loaded, crate::api::ApiError> {
    let detail = c.work(id)?;
    let mut focus = None;
    let resume = if detail.work.kind == "series" {
        c.resume_plan(id).and_then(|p| p.target).map(|t: ResumeOption| {
            focus = Some((t.season_number, t.episode_id.clone()));
            let label = format!("S{}E{}", t.season_number, t.episode_number);
            (t.media_file_id, t.position_ms, label)
        })
    } else {
        detail
            .media_file_id
            .as_deref()
            .and_then(|f| c.progress(f))
            .filter(|p| p.state == "part_watched" && p.position_ms > 0)
            .map(|p| (p.media_file_id, p.position_ms, fmt_clock(p.position_ms)))
    };
    if detail.work.kind == "series" && focus.is_none() {
        // Nothing watched: open on the first episode.
        focus = detail
            .children
            .seasons
            .iter()
            .find(|s| s.season.season_number > 0)
            .or(detail.children.seasons.first())
            .and_then(|s| {
                s.episodes
                    .first()
                    .map(|e| (s.season.season_number, e.episode.id.clone()))
            });
    }
    let progress = if detail.work.kind == "series" {
        c.all_progress()
            .unwrap_or_default()
            .into_iter()
            .map(|p| (p.media_file_id.clone(), p))
            .collect()
    } else {
        Default::default()
    };
    Ok(Loaded {
        detail,
        resume,
        focus,
        progress,
    })
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, work_id: String) -> gtk4::Widget {
    let root = gtk4::Overlay::new();
    root.add_css_class("pa-khero-root");
    // Key art behind everything, as the web phone's `.tv-key-art`: a 360 x 223 backdrop, its right edge, left edge and
    // bottom faded into the page, then a 485 px wash over the top of the page.
    let art = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art", "pa-khero"])
        .valign(gtk4::Align::Start)
        .build();
    art.set_size_request(-1, 223);
    let fade = |h: i32, class: &str| {
        let b = gtk4::Box::builder()
            .css_classes([class])
            .valign(gtk4::Align::Start)
            .build();
        b.set_size_request(-1, h);
        b
    };
    root.set_child(Some(&art));
    // The web's page scrolls under its sticky art: the top 86 px of the art is covered by the page.
    root.add_overlay(&fade(86, "pa-khero-cover"));
    root.add_overlay(&fade(223, "pa-khero-edge"));
    root.add_overlay(&fade(223, "pa-khero-fade"));
    root.add_overlay(&fade(485, "pa-khero-wash"));

    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(32);
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .margin_top(160)
        .build();
    page.append(&status);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page", "pa-transparent"])
        .build();
    root.add_overlay(&scroll);
    // The web's page scrolls over its sticky art: once scrolled, the page covers the art's top and (dark) cuts its bottom.
    {
        let root = root.clone();
        scroll.vadjustment().connect_value_changed(move |a| {
            if a.value() > 20.0 {
                root.add_css_class("scrolled");
            } else {
                root.remove_css_class("scrolled");
            }
        });
    }
    let scroll2 = scroll.clone();

    // Header: round back button, section name, the title in small caps.
    let head = header::build(&app, "", "filters");
    head.action.set_visible(false);
    // The header scrolls away with the page, as on the web.
    let top = gtk4::Box::builder().height_request(307).build();
    head.widget.set_valign(gtk4::Align::Start);
    head.widget.set_hexpand(true);
    top.append(&head.widget);
    page.prepend(&top);

    let id = work_id.clone();
    let art2 = art.clone();
    bg(
        move || fetch(&client, &id),
        move |res| {
            page.remove(&status);
            match res {
                Err(e) => page.append(
                    &gtk4::Label::builder()
                        .label(e.to_string())
                        .css_classes(["pa-error"])
                        .wrap(true)
                        .margin_top(160)
                        .margin_start(16)
                        .margin_end(16)
                        .build(),
                ),
                Ok(l) => {
                    let w = &l.detail.work;
                    if let Some(kind) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
                        imgs.load(Client::artwork_path(&w.id, kind, 780), &art2);
                    }
                    head.set_section(match w.kind.as_str() {
                        "series" => "Series",
                        "artist" => "Music",
                        _ => "Movies",
                    });
                    head.set_subtitle(&w.title);
                    fill(&app, &imgs, &page, l, &scroll2);
                }
            }
        },
    );
    root.upcast()
}

/// A web action pill: fixed 44 px tall, icon then label.
fn action_pill(icon: &str, label: &str, width: i32, primary: bool, small: bool) -> gtk4::Button {
    let row = gtk4::Box::builder()
        .spacing(8)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Center)
        .build();
    let tone = if primary { Tone::OnAccent } else { Tone::Brand };
    row.append(&icons::image(icon, if small { 9 } else { 12 }, tone));
    let class = if small { "pa-action-label-s" } else { "pa-action-label" };
    // The large pills wrap ("Resume / from 0:23") as the web's do; the small ones fit on one line.
    row.append(
        &gtk4::Label::builder()
            .label(label)
            .css_classes([class])
            .wrap(!small)
            .justify(gtk4::Justification::Center)
            .build(),
    );
    let b = gtk4::Button::builder()
        .child(&row)
        .css_classes(if primary {
            vec!["pa-action", "primary"]
        } else {
            vec!["pa-action"]
        })
        .valign(gtk4::Align::Start)
        .build();
    b.set_size_request(width, 44);
    b
}

fn meta_row(parts: &[(String, bool)]) -> gtk4::FlowBox {
    let f = gtk4::FlowBox::builder()
        .selection_mode(gtk4::SelectionMode::None)
        .column_spacing(10)
        .row_spacing(6)
        .css_classes(["pa-meta-flow"])
        .homogeneous(false)
        .max_children_per_line(10)
        .build();
    for (t, strong) in parts {
        f.append(
            &gtk4::Label::builder()
                .label(t)
                .css_classes(if *strong {
                    vec!["pa-meta", "strong"]
                } else {
                    vec!["pa-meta"]
                })
                .build(),
        );
    }
    f
}

fn fill(app: &Rc<App>, imgs: &Images, page: &gtk4::Box, l: Loaded, scroll: &gtk4::ScrolledWindow) {
    let w = &l.detail.work;
    let series = w.kind == "series";
    let body = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    body.set_margin_start(16);
    body.set_margin_end(16);
    page.append(&body);
    let gap = |b: &gtk4::Box, px: i32| b.append(&gtk4::Box::builder().height_request(px).build());
    // Focused episode for a series, the title itself for a film.
    let focus_ep = l.focus.as_ref().and_then(|(sn, id)| {
        l.detail
            .children
            .seasons
            .iter()
            .find(|s| s.season.season_number == *sn)
            .and_then(|s| s.episodes.iter().find(|e| e.episode.id == *id).map(|e| (s, e)))
    });
    let kicker = match (&focus_ep, w.genres.first()) {
        (Some((s, e)), _) if series => format!("S{:02} · E{:02}", s.season.season_number, e.episode.episode_number),
        (_, Some(g)) => g.to_uppercase(),
        _ => String::new(),
    };
    if !kicker.is_empty() {
        body.append(
            &gtk4::Label::builder()
                .label(kicker)
                .css_classes(["pa-kicker"])
                .xalign(0.0)
                .build(),
        );
    }
    // A film's title block sits 6 and 7 px (css) closer than the episode view's, as the web phone's.
    let film = focus_ep.is_none();
    gap(&body, if film { 5 } else { 10 });
    body.append(
        &gtk4::Label::builder()
            .label(&w.title)
            .css_classes(["pa-display"])
            .wrap(true)
            .xalign(0.0)
            .build(),
    );
    gap(&body, if film { 4 } else { 11 });
    if let Some((_, e)) = &focus_ep {
        body.append(
            &gtk4::Label::builder()
                .label(e.episode.title.clone().unwrap_or_default())
                .css_classes(["pa-ep-heading"])
                .xalign(0.0)
                .build(),
        );
        gap(&body, 8);
    }
    let mut meta: Vec<(String, bool)> = Vec::new();
    if let Some((s, e)) = &focus_ep {
        meta.push((format!("Season {}", s.season.season_number), true));
        meta.push((
            format!("S{:02} · E{:02}", s.season.season_number, e.episode.episode_number),
            false,
        ));
        if let Some(m) = e.episode.runtime_minutes {
            meta.push((format!("{m} min"), false));
        }
        if let Some(y) = w.year_range() {
            meta.push((y, false));
        }
        if let Some(a) = &e.episode.air_date {
            meta.push((format!("Aired {}", fmt_date(a).unwrap_or_else(|| a.clone())), false));
        }
    } else {
        meta.push((w.kind_label().to_string(), true));
        if let Some(m) = l.detail.runtime_ms.filter(|m| *m > 0) {
            let mins = (m + 30_000) / 60_000;
            meta.push((format!("{}h {:02}m", mins / 60, mins % 60), false));
        }
        if let Some(y) = w.year_range() {
            meta.push((y, false));
        }
        if let Some(d) = w.release_date.as_deref().and_then(fmt_date) {
            meta.push((format!("Released {d}"), false));
        }
    }
    meta.extend(
        w.genres
            .iter()
            .take(if series { 1 } else { 3 })
            .map(|g| (g.clone(), false)),
    );
    body.append(&meta_row(&meta));
    gap(&body, 10);
    let overview = focus_ep
        .as_ref()
        .and_then(|(_, e)| e.episode.overview.clone())
        .or_else(|| w.overview.clone());
    if let Some(o) = overview {
        let l = gtk4::Label::builder()
            .label(o)
            .css_classes(["pa-overview"])
            .wrap(true)
            .lines(3)
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .xalign(0.0)
            // The web's synopsis is 52ch wide, 17 px short of the page's right margin.
            .margin_end(17)
            .build();
        l.set_height_request(50);
        l.set_valign(gtk4::Align::Start);
        body.append(&l);
    }
    gap(&body, 14);

    let title = w.title.clone();
    let play = {
        let (app, art_id) = (app.clone(), w.id.clone());
        move |file: String, start: i64, label: String| {
            app.play(PlayRequest {
                media_file_id: file,
                start_ms: start,
                title: label,
                art_work_id: Some(art_id.clone()),
                local_file: None,
            });
        }
    };
    let row1 = gtk4::Box::builder().spacing(8).build();
    let download = action_pill("downloads", "Download", 104, false, true);
    match l.detail.media_file_id.clone().filter(|_| !series) {
        Some(file) => {
            let (app, work) = (app.clone(), w.clone());
            download.connect_clicked(move |_| {
                super::downloads::prompt(
                    &app,
                    super::downloads::Spec {
                        media_file_id: file.clone(),
                        work_id: work.id.clone(),
                        title: work.title.clone(),
                        series_title: None,
                        season: None,
                        episode: None,
                    },
                )
            });
        }
        None => download.set_sensitive(false),
    }
    if series {
        let started = l.resume.as_ref().map(|(_, pos, _)| *pos > 0).unwrap_or(false);
        if let Some((file, pos, label)) = l.resume.as_ref().filter(|_| started) {
            let b = action_pill("play", "Resume", 32, true, false);
            let (file, pos, play, t) = (file.clone(), *pos, play.clone(), format!("{title} {label}"));
            b.connect_clicked(move |_| play(file.clone(), pos, t.clone()));
            row1.append(&b);
        } else if let Some((_, e)) = &focus_ep {
            if let Some(file) = e.media_file_id.clone() {
                // Nothing watched yet: the web says Start and has no Ask again.
                let b = action_pill("play", "Start", 100, true, false);
                let (play, t) = (play.clone(), title.clone());
                b.connect_clicked(move |_| play(file.clone(), 0, t.clone()));
                row1.append(&b);
            }
        }
        if started {
            let again = action_pill("back", "Ask again", 104, false, true);
            again.set_sensitive(false);
            row1.append(&again);
        }
    } else {
        row1.append(&download);
        let playback = action_pill("list", "Playback", 104, false, false);
        playback.set_sensitive(false);
        playback.set_tooltip_text(Some("Playback options are not available yet."));
        row1.append(&playback);
        if w.kind == "movie" {
            if let Some(file) = l.detail.media_file_id.clone() {
                let (label, start) = match &l.resume {
                    Some((_, pos, label)) => (format!("Resume from {label}"), *pos),
                    None => ("Play".to_string(), 0),
                };
                let b = action_pill("play", &label, 104, true, false);
                let (play, t) = (play.clone(), title.clone());
                b.connect_clicked(move |_| play(file.clone(), start, t.clone()));
                row1.append(&b);
            }
        }
    }
    let row2 = gtk4::Box::builder().spacing(8).margin_top(12).build();
    let watch = action_pill("add", "Add to watchlist", 108, false, true);
    {
        let (app, work) = (app.clone(), w.clone());
        watch.connect_clicked(move |b| {
            let Some(client) = app.client.borrow().clone() else {
                return;
            };
            b.set_sensitive(false);
            let (work, b) = (work.clone(), b.clone());
            bg(
                move || client.add_to_watchlist(&work),
                move |r| {
                    b.set_tooltip_text(Some(if r.is_ok() {
                        "Added to your watchlist"
                    } else {
                        "Could not add"
                    }))
                },
            );
        });
    }
    let playlist = action_pill("add", "Add to Playlist", 104, false, true);
    {
        let (app, work) = (app.clone(), w.clone());
        playlist.connect_clicked(move |_| super::actions::show(&app, &work));
    }
    if series {
        // The web keeps one scrolling row on a series page.
        row1.append(&watch);
        row1.append(&playlist);
        let sw = gtk4::ScrolledWindow::builder()
            .child(&row1)
            .vscrollbar_policy(gtk4::PolicyType::Never)
            .hscrollbar_policy(gtk4::PolicyType::Automatic)
            .propagate_natural_height(true)
            .build();
        // The scroller clips its child: reserve room for the focus ring and glow, and take it back from the
        // neighbours so the layout does not move (as the episode rail does).
        row1.set_margin_start(FOCUS_ROOM);
        row1.set_margin_top(FOCUS_ROOM);
        row1.set_margin_bottom(FOCUS_ROOM);
        sw.set_margin_start(-FOCUS_ROOM);
        sw.set_margin_top(-FOCUS_ROOM);
        body.append(&sw);
    } else {
        row2.append(&watch);
        row2.append(&playlist);
        body.append(&row1);
        body.append(&row2);
    }

    if !l.detail.children.albums.is_empty() {
        body.append(&albums(&l.detail.children.albums, &title, play.clone()));
    }
    let seasons = &l.detail.children.seasons;
    // Negative margins do not take the pill scroller's focus room back, so the series gap is shortened by the
    // room kept above and below (measured against the web capture).
    gap(&body, if series { 53 - 2 * FOCUS_ROOM } else { 28 });
    let mut focus_index = 0;
    // Next and Previous (on the lock screen or a headset) walk the episodes in order.
    let queue: Vec<(String, String)> = seasons
        .iter()
        .flat_map(|s| {
            let (n, title) = (s.season.season_number, title.clone());
            s.episodes.iter().filter_map(move |e| {
                Some((
                    e.media_file_id.clone()?,
                    format!("{title} S{n}E{}", e.episode.episode_number),
                ))
            })
        })
        .collect();
    for (i, season) in seasons.iter().enumerate() {
        if focus_ep.as_ref().map(|(s, _)| s.season.season_number) == Some(season.season.season_number) {
            focus_index = i;
        }
        body.append(&season_rail(
            app,
            imgs,
            &w.id,
            season,
            &title,
            l.focus.as_ref().map(|f| f.1.as_str()),
            &l.progress,
            &queue,
            play.clone(),
        ));
    }
    if series && !seasons.is_empty() {
        // Open scrolled to the next-up episode's season, as the web does.
        let adj = scroll.vadjustment();
        let target = 415.5 + 238.0 * focus_index as f64;
        gtk4::glib::timeout_add_local_once(std::time::Duration::from_millis(900), move || adj.set_value(target));
    }
}

/// "Season 1 / 24 episodes" and a rail of episode cards (16:9 thumb, number over the corner, S01 · E02 caption).
#[allow(clippy::too_many_arguments)]
fn season_rail(
    app: &Rc<App>,
    imgs: &Images,
    series_id: &str,
    season: &SeasonDetail,
    series_title: &str,
    focus: Option<&str>,
    progress: &std::collections::HashMap<String, crate::model::WatchProgress>,
    queue: &[(String, String)],
    play: impl Fn(String, i64, String) + Clone + 'static,
) -> gtk4::Box {
    let queue = queue.to_vec();
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    let n = season.season.season_number;
    col.append(
        &gtk4::Label::builder()
            .label(if n == 0 {
                "Specials".to_string()
            } else {
                format!("Season {n}")
            })
            .css_classes(["pa-season-title"])
            .xalign(0.0)
            .margin_start(FOCUS_ROOM)
            .build(),
    );
    col.append(
        &gtk4::Label::builder()
            .label(format!("{} episodes", season.episodes.len()))
            .css_classes(["pa-season-count"])
            .xalign(0.0)
            .margin_start(FOCUS_ROOM)
            .margin_top(5)
            .margin_bottom(19 - FOCUS_ROOM)
            .build(),
    );
    let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 12);
    // The rail's scroller clips its children: reserve room for the focus ring and glow on every side, and take the
    // same room back from the neighbours so the layout does not move.
    row.set_margin_start(FOCUS_ROOM);
    row.set_margin_top(FOCUS_ROOM);
    row.set_margin_bottom(FOCUS_ROOM);
    col.set_margin_start(-FOCUS_ROOM);
    // The web's rail runs to the screen edge, past the page's 16 px side margin.
    col.set_margin_end(-16);
    for e in &season.episodes {
        let pic = gtk4::Picture::builder()
            .content_fit(gtk4::ContentFit::Cover)
            .can_shrink(true)
            .css_classes(["pa-ep-pic"])
            .build();
        let frame = gtk4::Overlay::builder()
            .child(&pic)
            .overflow(gtk4::Overflow::Hidden)
            .css_classes(["pa-art"])
            .build();
        frame.set_size_request(EP_W, EP_H);
        if focus == Some(e.episode.id.as_str()) {
            frame.add_css_class("selected");
        }
        imgs.load(
            format!("/api/v1/artwork/episode/{series_id}/{}/thumb?w=540", e.episode.id),
            &pic,
        );
        // The web's `.tv-episode-art::after` shade.
        frame.add_overlay(&gtk4::Box::builder().css_classes(["pa-ep-shade"]).build());
        frame.add_overlay(
            &gtk4::Label::builder()
                .label(format!("{:02}", e.episode.episode_number))
                .css_classes(["pa-ep-badge"])
                .halign(gtk4::Align::End)
                .valign(gtk4::Align::End)
                .margin_end(10)
                .margin_bottom(10)
                .build(),
        );
        // The web's WatchStateOverlay: a progress bar for a part-watched episode, the red dot for an unseen one.
        let watch = e.media_file_id.as_ref().and_then(|f| progress.get(f));
        match watch.map(|p| p.state.as_str()) {
            Some("part_watched") => {
                let p = watch.map_or(0.0, |p| p.position_ms as f64 / p.duration_ms.max(1) as f64);
                frame.add_overlay(
                    &gtk4::ProgressBar::builder()
                        .fraction(p.clamp(0.0, 1.0))
                        .valign(gtk4::Align::End)
                        .css_classes(["pa-progress"])
                        .build(),
                );
            }
            None | Some("unseen") => frame.add_overlay(
                &gtk4::Box::builder()
                    .css_classes(["pa-unseen"])
                    .halign(gtk4::Align::End)
                    .valign(gtk4::Align::Start)
                    .margin_top(7)
                    .margin_end(7)
                    .build(),
            ),
            _ => {}
        }
        let card = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
        card.append(&frame);
        let cap = gtk4::Box::builder().spacing(8).margin_top(12).build();
        cap.append(
            &gtk4::Label::builder()
                .label(format!("S{:02} · E{:02}", n, e.episode.episode_number))
                .css_classes(["pa-ep-code"])
                .build(),
        );
        cap.append(
            &gtk4::Label::builder()
                .label(e.episode.title.clone().unwrap_or_default())
                .css_classes(["pa-ep-name"])
                .xalign(0.0)
                .ellipsize(gtk4::pango::EllipsizeMode::End)
                .max_width_chars(1)
                .hexpand(true)
                .build(),
        );
        card.append(&cap);
        card.set_size_request(EP_W, -1);
        let b = gtk4::Button::builder()
            .child(&card)
            .css_classes(["pa-card"])
            .sensitive(e.media_file_id.is_some())
            .valign(gtk4::Align::Start)
            .build();
        if let Some(file) = e.media_file_id.clone() {
            let (play, label) = (
                play.clone(),
                format!("{series_title} S{n}E{}", e.episode.episode_number),
            );
            let dl_file = file.clone();
            let queue = queue.clone();
            b.connect_clicked(move |_| {
                super::player::set_queue(queue.clone());
                play(file.clone(), 0, label.clone())
            });
            // Hold an episode to download it (the web card has no download control).
            let press = gtk4::GestureLongPress::new();
            let (app, file, ep) = (app.clone(), dl_file, e.clone());
            let (series_id, series_title) = (series_id.to_string(), series_title.to_string());
            press.connect_pressed(move |_, _, _| {
                super::downloads::prompt(
                    &app,
                    super::downloads::Spec {
                        media_file_id: file.clone(),
                        work_id: series_id.clone(),
                        title: ep.episode.title.clone().unwrap_or_default(),
                        series_title: Some(series_title.clone()),
                        season: Some(n),
                        episode: Some(ep.episode.episode_number),
                    },
                )
            });
            b.add_controller(press);
        }
        row.append(&b);
    }
    let rail = gtk4::ScrolledWindow::builder()
        .child(&row)
        .vscrollbar_policy(gtk4::PolicyType::Never)
        .propagate_natural_height(true)
        .build();
    // The rail opens with the next-up episode first, as the web does.
    if let Some(i) = season
        .episodes
        .iter()
        .position(|e| focus == Some(e.episode.id.as_str()))
    {
        let adj = rail.hadjustment();
        gtk4::glib::timeout_add_local_once(std::time::Duration::from_millis(600), move || {
            adj.set_value(i as f64 * (EP_W + 12) as f64)
        });
    }
    // The web's shared scroller edge fade: the rail dims toward its right edge.
    let fade = gtk4::Box::builder()
        .css_classes(["pa-edge-fade"])
        .halign(gtk4::Align::End)
        .can_target(false)
        .build();
    fade.set_size_request(38, -1);
    let faded = gtk4::Overlay::new();
    faded.set_child(Some(&rail));
    faded.add_overlay(&fade);
    col.append(&faded);
    col.set_margin_bottom(39 - FOCUS_ROOM);
    col
}

/// Room kept around a focus ring (3 px) and its glow (about 11 px more) inside clipping scrollers.
const FOCUS_ROOM: i32 = 14;
const EP_W: i32 = 187;
const EP_H: i32 = 105;

fn albums(
    albums: &[crate::model::AlbumDetail],
    artist: &str,
    play: impl Fn(String, i64, String) + Clone + 'static,
) -> gtk4::Box {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
    col.set_margin_top(8);
    for a in albums {
        let year = a
            .album
            .release_date
            .as_deref()
            .and_then(|d| d.get(..4))
            .map(|y| format!(" ({y})"))
            .unwrap_or_default();
        col.append(
            &gtk4::Label::builder()
                .label(format!("{}{year}", a.album.title))
                .css_classes(["pa-h2"])
                .xalign(0.0)
                .wrap(true)
                .margin_top(8)
                .build(),
        );
        let queue: Vec<(String, String)> = a
            .tracks
            .iter()
            .filter_map(|t| Some((t.media_file_id.clone()?, format!("{} - {}", artist, t.track.title))))
            .collect();
        for t in &a.tracks {
            let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 10);
            row.append(
                &gtk4::Label::builder()
                    .label(t.track.track_number.to_string())
                    .css_classes(["pa-ep-num"])
                    .build(),
            );
            row.append(
                &gtk4::Label::builder()
                    .label(&t.track.title)
                    .css_classes(["pa-card-title"])
                    .xalign(0.0)
                    .hexpand(true)
                    .wrap(true)
                    .build(),
            );
            if let Some(sec) = t.track.duration_seconds {
                row.append(
                    &gtk4::Label::builder()
                        .label(fmt_clock(sec as i64 * 1000))
                        .css_classes(["pa-card-meta"])
                        .build(),
                );
            }
            let b = gtk4::Button::builder()
                .child(&row)
                .css_classes(["pa-episode"])
                .sensitive(t.media_file_id.is_some())
                .build();
            if let Some(file) = t.media_file_id.clone() {
                let (play, label) = (play.clone(), format!("{} - {}", artist, t.track.title));
                let queue = queue.clone();
                b.connect_clicked(move |_| {
                    super::player::set_queue(queue.clone());
                    play(file.clone(), 0, label.clone())
                });
            }
            col.append(&b);
        }
    }
    col
}

#[cfg(test)]
mod tests {
    #[test]
    fn released_date_format() {
        assert_eq!(super::fmt_date("2003-06-05T00:00:00Z").as_deref(), Some("5 Jun 2003"));
        assert_eq!(super::fmt_date("nope"), None);
    }

    #[test]
    fn clock_format() {
        assert_eq!(super::fmt_clock(65_000), "1:05");
        assert_eq!(super::fmt_clock(3_725_000), "1:02:05");
        assert_eq!(super::fmt_clock(-5), "0:00");
    }
}
