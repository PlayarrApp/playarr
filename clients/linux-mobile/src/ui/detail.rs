//! Title detail for films and series: hero art, meta, resume, seasons and episodes.
use super::images::Images;
use super::{bg, App};
use crate::api::Client;
use crate::model::{ResumeOption, SeasonDetail, WorkDetail};
use crate::ui::player::PlayRequest;
use gtk4::prelude::*;
use std::rc::Rc;

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
}

fn fetch(c: &Client, id: &str) -> Result<Loaded, crate::api::ApiError> {
    let detail = c.work(id)?;
    let resume = if detail.work.kind == "series" {
        c.resume_plan(id).and_then(|p| p.target).map(|t: ResumeOption| {
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
    Ok(Loaded { detail, resume })
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, work_id: String) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_bottom(32);
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .margin_top(40)
        .build();
    page.append(&status);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    let id = work_id.clone();
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
                        .margin_top(40)
                        .margin_start(16)
                        .margin_end(16)
                        .build(),
                ),
                Ok(l) => fill(&app, &imgs, &page, l),
            }
        },
    );
    scroll.upcast()
}

fn fill(app: &Rc<App>, imgs: &Images, page: &gtk4::Box, l: Loaded) {
    let w = &l.detail.work;
    // Hero: backdrop with a fade into the page.
    let hero = gtk4::Overlay::builder()
        .css_classes(["pa-hero"])
        .overflow(gtk4::Overflow::Hidden)
        .build();
    hero.set_size_request(-1, 210);
    let pic = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .can_shrink(true)
        .build();
    if let Some(kind) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
        imgs.load(Client::artwork_path(&w.id, kind, 780), &pic);
    }
    hero.set_child(Some(&pic));
    hero.add_overlay(&gtk4::Box::builder().css_classes(["pa-hero-fade"]).build());
    page.append(&hero);

    let body = gtk4::Box::new(gtk4::Orientation::Vertical, 12);
    body.set_margin_start(16);
    body.set_margin_end(16);
    page.append(&body);
    body.append(
        &gtk4::Label::builder()
            .label(&w.title)
            .css_classes(["pa-detail-title"])
            .wrap(true)
            .xalign(0.0)
            .build(),
    );
    let mut meta = vec![w.kind_label().to_string()];
    if let Some(y) = w.year() {
        meta.push(y.to_string());
    }
    if let Some(m) = l.detail.runtime_ms.filter(|m| *m > 0) {
        meta.push(format!("{} min", m / 60000));
    }
    body.append(
        &gtk4::Label::builder()
            .label(meta.join(" · "))
            .css_classes(["pa-muted"])
            .xalign(0.0)
            .build(),
    );
    if !w.genres.is_empty() {
        let chips = gtk4::Box::new(gtk4::Orientation::Horizontal, 6);
        for g in w.genres.iter().take(4) {
            chips.append(&gtk4::Label::builder().label(g).css_classes(["pa-chip"]).build());
        }
        body.append(&chips);
    }

    let title = w.title.clone();
    let play = {
        let app = app.clone();
        move |file: String, start: i64, label: String| {
            app.play(PlayRequest {
                media_file_id: file,
                start_ms: start,
                title: label,
            });
        }
    };
    let buttons = gtk4::Box::new(gtk4::Orientation::Horizontal, 10);
    if let Some((file, pos, label)) = &l.resume {
        let b = gtk4::Button::builder()
            .label(format!("Resume {label}"))
            .css_classes(["pa-primary"])
            .build();
        let (file, pos, play, t) = (file.clone(), *pos, play.clone(), title.clone());
        b.connect_clicked(move |_| play(file.clone(), pos, t.clone()));
        buttons.append(&b);
    }
    if l.detail.work.kind == "movie" {
        if let Some(file) = l.detail.media_file_id.clone() {
            let label = if l.resume.is_some() { "Start over" } else { "Play" };
            let class = if l.resume.is_some() {
                "pa-secondary"
            } else {
                "pa-primary"
            };
            let b = gtk4::Button::builder().label(label).css_classes([class]).build();
            let (play, t) = (play.clone(), title.clone());
            b.connect_clicked(move |_| play(file.clone(), 0, t.clone()));
            buttons.append(&b);
        } else {
            body.append(
                &gtk4::Label::builder()
                    .label("Not available to play yet.")
                    .css_classes(["pa-muted"])
                    .xalign(0.0)
                    .build(),
            );
        }
    }
    body.append(&buttons);
    if let Some(o) = &w.overview {
        body.append(
            &gtk4::Label::builder()
                .label(o)
                .css_classes(["pa-overview"])
                .wrap(true)
                .xalign(0.0)
                .build(),
        );
    }

    if !l.detail.children.albums.is_empty() {
        body.append(&albums(&l.detail.children.albums, &title, play.clone()));
    }
    let seasons = &l.detail.children.seasons;
    if !seasons.is_empty() {
        body.append(&episodes(seasons, &title, play));
    }
}

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

fn episodes(
    seasons: &[SeasonDetail],
    series_title: &str,
    play: impl Fn(String, i64, String) + Clone + 'static,
) -> gtk4::Box {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
    col.set_margin_top(8);
    let names: Vec<String> = seasons
        .iter()
        .map(|s| {
            if s.season.season_number == 0 {
                "Specials".into()
            } else {
                format!("Season {}", s.season.season_number)
            }
        })
        .collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let pick = gtk4::DropDown::from_strings(&refs);
    // Open on the first season that has something playable.
    pick.set_selected(
        seasons
            .iter()
            .position(|s| s.episodes.iter().any(|e| e.media_file_id.is_some()))
            .unwrap_or(0) as u32,
    );
    col.append(&pick);
    let list = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    col.append(&list);
    let seasons: Rc<Vec<SeasonDetail>> = Rc::new(seasons.to_vec());
    let series_title = series_title.to_string();
    let render = {
        let (list, seasons) = (list.clone(), seasons.clone());
        move |idx: usize| {
            while let Some(c) = list.first_child() {
                list.remove(&c);
            }
            let Some(season) = seasons.get(idx) else { return };
            for e in &season.episodes {
                let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 10);
                row.append(
                    &gtk4::Label::builder()
                        .label(e.episode.episode_number.to_string())
                        .css_classes(["pa-ep-num"])
                        .build(),
                );
                let text = gtk4::Box::new(gtk4::Orientation::Vertical, 2);
                text.set_hexpand(true);
                text.append(
                    &gtk4::Label::builder()
                        .label(
                            e.episode
                                .title
                                .clone()
                                .unwrap_or_else(|| format!("Episode {}", e.episode.episode_number)),
                        )
                        .css_classes(["pa-card-title"])
                        .xalign(0.0)
                        .wrap(true)
                        .build(),
                );
                let sub = match (e.episode.runtime_minutes, e.media_file_id.is_some()) {
                    (_, false) => "Not available yet".to_string(),
                    (Some(m), true) => format!("{m} min"),
                    (None, true) => "Play".to_string(),
                };
                text.append(
                    &gtk4::Label::builder()
                        .label(sub)
                        .css_classes(["pa-card-meta"])
                        .xalign(0.0)
                        .build(),
                );
                row.append(&text);
                row.append(&gtk4::Image::from_icon_name("media-playback-start-symbolic"));
                let b = gtk4::Button::builder()
                    .child(&row)
                    .css_classes(["pa-episode"])
                    .sensitive(e.media_file_id.is_some())
                    .build();
                if let Some(file) = e.media_file_id.clone() {
                    let (play, label) = (
                        play.clone(),
                        format!(
                            "{series_title} S{}E{}",
                            season.season.season_number, e.episode.episode_number
                        ),
                    );
                    b.connect_clicked(move |_| play(file.clone(), 0, label.clone()));
                }
                list.append(&b);
            }
        }
    };
    render(pick.selected() as usize);
    pick.connect_selected_notify(move |p| render(p.selected() as usize));
    col
}

#[cfg(test)]
mod tests {
    #[test]
    fn clock_format() {
        assert_eq!(super::fmt_clock(65_000), "1:05");
        assert_eq!(super::fmt_clock(3_725_000), "1:02:05");
        assert_eq!(super::fmt_clock(-5), "0:00");
    }
}
