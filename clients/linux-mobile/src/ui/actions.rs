//! Title actions sheet (long-press a card): play, open details, add to a playlist.
use super::{bg, App};
use crate::model::Work;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;
use std::rc::Rc;

fn row(icon: &str, label: &str) -> gtk4::Button {
    let content = gtk4::Box::new(gtk4::Orientation::Horizontal, 14);
    content.append(&gtk4::Image::from_icon_name(icon));
    content.append(&gtk4::Label::builder().label(label).xalign(0.0).hexpand(true).build());
    gtk4::Button::builder()
        .child(&content)
        .css_classes(["pa-sheet-row"])
        .build()
}

pub fn show(app: &Rc<App>, work: &Work) {
    let Some(client) = app.client.borrow().clone() else {
        return;
    };
    let dialog = adw::Dialog::builder()
        .title(&work.title)
        .presentation_mode(adw::DialogPresentationMode::BottomSheet)
        .build();
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    col.set_margin_start(16);
    col.set_margin_end(16);
    col.set_margin_top(8);
    col.set_margin_bottom(20);
    col.append(
        &gtk4::Label::builder()
            .label(&work.title)
            .css_classes(["pa-h2"])
            .xalign(0.0)
            .wrap(true)
            .build(),
    );
    col.append(
        &gtk4::Label::builder()
            .label(work.meta_line())
            .css_classes(["pa-muted"])
            .xalign(0.0)
            .build(),
    );

    let play = row("media-playback-start-symbolic", "Play");
    {
        let (app, dialog, id, title, kind, client) = (
            app.clone(),
            dialog.clone(),
            work.id.clone(),
            work.title.clone(),
            work.kind.clone(),
            client.clone(),
        );
        play.connect_clicked(move |_| {
            dialog.close();
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
                        });
                    }
                },
            );
        });
    }
    col.append(&play);

    let details = row("view-more-symbolic", "Open details");
    {
        let (app, dialog, work) = (app.clone(), dialog.clone(), work.clone());
        details.connect_clicked(move |_| {
            dialog.close();
            app.open_work(&work);
        });
    }
    col.append(&details);

    let add = row("list-add-symbolic", "Add to playlist");
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

    // Offline downloads need a storage and licence story first; say so rather than pretend.
    let dl = row("folder-download-symbolic", "Download (not yet available)");
    dl.set_sensitive(false);
    col.append(&dl);

    dialog.set_child(Some(&col));
    dialog.present(Some(&app.window));
}
