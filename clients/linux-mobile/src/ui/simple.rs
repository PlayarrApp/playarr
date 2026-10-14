//! Small tab pages: downloads, requests, watchlist (honest notices) and playlists (a list).
use super::{bg, header, App};
use crate::api::Client;
use gtk4::prelude::*;
use std::rc::Rc;

fn frame(app: &Rc<App>, title: &str) -> (gtk4::Box, header::Header, gtk4::Widget) {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_bottom(110);
    let head = header::build(app, title, "filters");
    page.append(&head.widget);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    (page, head, scroll.upcast())
}

/// A page that only explains why a feature is not here yet.
pub fn notice(app: &Rc<App>, title: &str, text: &str) -> gtk4::Widget {
    let (page, _head, widget) = frame(app, title);
    page.append(
        &gtk4::Label::builder()
            .label(text)
            .css_classes(["pa-body"])
            .wrap(true)
            .xalign(0.0)
            .margin_start(16)
            .margin_end(16)
            .margin_top(8)
            .build(),
    );
    widget
}

pub fn playlists(app: &Rc<App>, client: Client) -> gtk4::Widget {
    let (page, head, widget) = frame(app, "Playlists");
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .margin_start(16)
        .xalign(0.0)
        .build();
    page.append(&status);
    bg(
        move || client.playlists(),
        move |res| match res {
            Err(e) => status.set_label(&e.to_string()),
            Ok(lists) => {
                status.set_visible(false);
                head.set_subtitle(&format!("{} playlists", lists.len()));
                for p in lists {
                    let row = gtk4::Box::builder()
                        .css_classes(["pa-entry", "have"])
                        .margin_start(16)
                        .margin_end(16)
                        .orientation(gtk4::Orientation::Vertical)
                        .build();
                    row.append(
                        &gtk4::Label::builder()
                            .label(&p.name)
                            .css_classes(["pa-cap-title"])
                            .xalign(0.0)
                            // A long name must not widen the whole window (every tab shares its width).
                            .ellipsize(gtk4::pango::EllipsizeMode::End)
                            .max_width_chars(1)
                            .build(),
                    );
                    row.append(
                        &gtk4::Label::builder()
                            .label(if p.media_type.is_empty() {
                                "Playlist".into()
                            } else {
                                p.media_type.clone()
                            })
                            .css_classes(["pa-cap-meta"])
                            .xalign(0.0)
                            .build(),
                    );
                    page.append(&row);
                }
            }
        },
    );
    widget
}
