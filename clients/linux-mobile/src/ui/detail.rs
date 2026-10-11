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
    Ok(Loaded { detail, resume, focus })
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, work_id: String) -> gtk4::Widget {
    let root = gtk4::Overlay::new();
    // Key art behind everything, dimmed and washed into the page.
    let art = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art"])
        .valign(gtk4::Align::Start)
        .build();
    art.set_size_request(-1, 390);
    let wash = gtk4::Box::builder()
        .css_classes(["pa-key-wash"])
        .valign(gtk4::Align::Start)
        .build();
    wash.set_size_request(-1, 485);
    root.set_child(Some(&art));
    root.add_overlay(&wash);

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
                        imgs.load(Client::artwork_path(&w.id, kind, 1280), &art2);
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
    row.append(
        &gtk4::Label::builder()
            .label(label)
            .css_classes([class])
            .wrap(true)
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
        .row_spacing(4)
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
    gap(&body, 10);
    body.append(
        &gtk4::Label::builder()
            .label(&w.title)
            .css_classes(["pa-display"])
            .wrap(true)
            .xalign(0.0)
            .build(),
    );
    gap(&body, 11);
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
        if let Some((file, pos, label)) = &l.resume {
            let b = action_pill("play", "Resume", 32, true, false);
            let (file, pos, play, t) = (file.clone(), *pos, play.clone(), format!("{title} {label}"));
            b.connect_clicked(move |_| play(file.clone(), pos, t.clone()));
            row1.append(&b);
        } else if let Some((_, e)) = &focus_ep {
            if let Some(file) = e.media_file_id.clone() {
                let b = action_pill("play", "Play", 32, true, false);
                let (play, t) = (play.clone(), title.clone());
                b.connect_clicked(move |_| play(file.clone(), 0, t.clone()));
                row1.append(&b);
            }
        }
        let again = action_pill("back", "Ask again", 104, false, true);
        again.set_sensitive(false);
        row1.append(&again);
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
    gap(&body, 28);
    let mut focus_index = 0;
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
            play.clone(),
        ));
    }
    if series && !seasons.is_empty() {
        // Open scrolled to the next-up episode's season, as the web does.
        let adj = scroll.vadjustment();
        let target = 399.0 + 235.0 * focus_index as f64;
        gtk4::glib::timeout_add_local_once(std::time::Duration::from_millis(900), move || adj.set_value(target));
    }
}

/// "Season 1 / 24 episodes" and a rail of episode cards (16:9 thumb, number over the corner, S01 · E02 caption).
fn season_rail(
    app: &Rc<App>,
    imgs: &Images,
    series_id: &str,
    season: &SeasonDetail,
    series_title: &str,
    focus: Option<&str>,
    play: impl Fn(String, i64, String) + Clone + 'static,
) -> gtk4::Box {
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
            .build(),
    );
    col.append(
        &gtk4::Label::builder()
            .label(format!("{} episodes", season.episodes.len()))
            .css_classes(["pa-season-count"])
            .xalign(0.0)
            .margin_bottom(18)
            .build(),
    );
    let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 12);
    for e in &season.episodes {
        let pic = gtk4::Picture::builder()
            .content_fit(gtk4::ContentFit::Cover)
            .can_shrink(true)
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
        frame.add_overlay(
            &gtk4::Label::builder()
                .label(format!("{:02}", e.episode.episode_number))
                .css_classes(["pa-ep-badge"])
                .halign(gtk4::Align::End)
                .valign(gtk4::Align::End)
                .margin_end(10)
                .margin_bottom(6)
                .build(),
        );
        let card = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
        card.append(&frame);
        let cap = gtk4::Box::builder().spacing(8).margin_top(9).build();
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
            b.connect_clicked(move |_| play(file.clone(), 0, label.clone()));
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
    col.append(&rail);
    col.set_margin_bottom(37);
    col
}

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
                b.connect_clicked(move |_| play(file.clone(), 0, label.clone()));
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
