//! Title actions panel (long-press a card): play, download (not yet), add to playlist, mark watched or unwatched.
use super::{bg, App};
use crate::icons::Tone;
use crate::model::Work;
use gtk4::prelude::*;
use std::rc::Rc;

/// The web draws these rows' icons as brand-red text glyphs.
fn glyph(icon: &str) -> &'static str {
    match icon {
        "play" => "▶",
        "downloads" => "⇩",
        "add" => "+",
        "check" => "✓",
        _ => "○",
    }
}

fn row(icon: &str, label: &str, _tone: Tone) -> gtk4::Button {
    let content = gtk4::Box::new(gtk4::Orientation::Horizontal, 20);
    content.append(
        &gtk4::Label::builder()
            .label(glyph(icon))
            .css_classes(["pa-row-glyph"])
            .build(),
    );
    content.append(&gtk4::Label::builder().label(label).xalign(0.0).hexpand(true).build());
    gtk4::Button::builder().child(&content).css_classes(["pa-row"]).build()
}

pub fn show(app: &Rc<App>, work: &Work) {
    let Some(client) = app.client.borrow().clone() else {
        return;
    };
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    col.set_margin_start(16);
    col.set_margin_end(16);
    // The web's rows start 2 px lower under the heading.
    col.set_margin_top(2);
    col.set_margin_bottom(24);

    let play = row("play", "Play", Tone::Brand);
    play.add_css_class("focus");
    {
        let (app, id, title, kind, client) = (
            app.clone(),
            work.id.clone(),
            work.title.clone(),
            work.kind.clone(),
            client.clone(),
        );
        play.connect_clicked(move |_| {
            app.close_panel();
            let art_id = id.clone();
            let (app, client, id, title) = (app.clone(), client.clone(), id.clone(), title.clone());
            let is_series = kind == "series";
            bg(
                move || {
                    if is_series {
                        client
                            .resume_plan(&id)
                            .and_then(|p| p.target)
                            .map(|t| (t.media_file_id, t.position_ms))
                    } else {
                        client.work(&id).ok().and_then(|d| d.media_file_id).map(|f| (f, 0))
                    }
                },
                move |target| {
                    if let Some((file, start)) = target {
                        app.play(super::player::PlayRequest {
                            media_file_id: file,
                            start_ms: start,
                            title,
                            art_work_id: Some(art_id),
                            local_file: None,
                        });
                    }
                },
            );
        });
    }
    col.append(&play);

    let dl = row("downloads", "Download", Tone::Brand);
    if work.kind == "movie" {
        let (app, client, work) = (app.clone(), client.clone(), work.clone());
        dl.connect_clicked(move |_| {
            app.close_panel();
            let (app, work, c) = (app.clone(), work.clone(), client.clone());
            let id = work.id.clone();
            bg(
                move || c.work(&id).ok().and_then(|d| d.media_file_id),
                move |file| {
                    if let Some(f) = file {
                        super::downloads::prompt(
                            &app,
                            super::downloads::Spec {
                                media_file_id: f,
                                work_id: work.id.clone(),
                                title: work.title.clone(),
                                series_title: None,
                                season: None,
                                episode: None,
                            },
                        );
                    }
                },
            );
        });
    } else {
        dl.set_sensitive(false);
        dl.set_tooltip_text(Some("Hold an episode on the series page to download it."));
    }
    col.append(&dl);

    let add = row("add", "Add to Playlist", Tone::Brand);
    let lists = gtk4::Box::new(gtk4::Orientation::Vertical, 6);
    lists.set_visible(false);
    {
        let (lists, client, work_id) = (lists.clone(), client.clone(), work.id.clone());
        add.connect_clicked(move |b| {
            b.set_sensitive(false);
            lists.set_visible(true);
            let c = client.clone();
            let (lists, client, work_id) = (lists.clone(), client.clone(), work_id.clone());
            bg(
                move || c.playlists(),
                move |res| match res {
                    Err(e) => lists.append(
                        &gtk4::Label::builder()
                            .label(e.to_string())
                            .css_classes(["pa-error"])
                            .build(),
                    ),
                    Ok(pls) => {
                        for p in pls.into_iter().filter(|p| !p.is_system) {
                            let b = gtk4::Button::builder()
                                .label(&p.name)
                                .css_classes(["pa-secondary"])
                                .build();
                            let (client, work_id, pid) = (client.clone(), work_id.clone(), p.id.clone());
                            b.connect_clicked(move |b| {
                                b.set_sensitive(false);
                                let (c, w, p) = (client.clone(), work_id.clone(), pid.clone());
                                let b = b.clone();
                                bg(
                                    move || c.add_to_playlist(&p, &w),
                                    move |r| b.set_label(if r.is_ok() { "Added" } else { "Could not add" }),
                                );
                            });
                            lists.append(&b);
                        }
                        if lists.first_child().is_none() {
                            lists.append(
                                &gtk4::Label::builder()
                                    .label("No playlists yet.")
                                    .css_classes(["pa-muted"])
                                    .build(),
                            );
                        }
                    }
                },
            );
        });
    }
    col.append(&add);
    col.append(&lists);

    if work.kind == "movie" {
        for (label, icon, watched) in [
            ("Mark as Watched", "check", true),
            ("Mark as Unwatched", "circle", false),
        ] {
            let b = row(icon, label, Tone::Brand);
            let (app, client, id) = (app.clone(), client.clone(), work.id.clone());
            b.connect_clicked(move |_| {
                app.close_panel();
                let (c, id) = (client.clone(), id.clone());
                bg(
                    move || {
                        let d = c.work(&id).ok()?;
                        let file = d.media_file_id?;
                        let dur = d.runtime_ms.unwrap_or(0).max(1);
                        c.report_progress(&file, if watched { dur } else { 0 }, dur, watched)
                            .ok()
                    },
                    |_| {},
                );
            });
            col.append(&b);
        }
    }
    app.present_panel("Title actions", &work.title, &col, false);
    app.cover_nav();
}
