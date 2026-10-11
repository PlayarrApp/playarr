//! Home: a faded key-art backdrop and horizontal rails of 328 px cards, "On deck" first, then the server's rails.
use super::cards::{card, CardOpts, RAIL_W};
use super::images::Images;
use super::{bg, App};
use crate::api::Client;
use crate::model::{Rail, Work};
use gtk4::prelude::*;
use std::rc::Rc;

struct Deck {
    work: Work,
    fraction: f64,
}

fn rail_row(children: impl IntoIterator<Item = gtk4::Button>) -> gtk4::ScrolledWindow {
    let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 12);
    row.set_margin_start(16);
    row.set_margin_end(16);
    for c in children {
        row.append(&c);
    }
    gtk4::ScrolledWindow::builder()
        .child(&row)
        .vscrollbar_policy(gtk4::PolicyType::Never)
        .hscrollbar_policy(gtk4::PolicyType::Automatic)
        .propagate_natural_height(true)
        .build()
}

fn section(title: &str, row: &gtk4::ScrolledWindow) -> gtk4::Box {
    let b = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
    b.append(
        &gtk4::Label::builder()
            .label(title)
            .css_classes(["pa-rail-title"])
            .xalign(0.0)
            .margin_start(16)
            .build(),
    );
    b.append(row);
    b
}

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 52);
    page.set_margin_top(92);
    page.set_margin_bottom(110);
    // The backdrop of the first title, dimmed and washed into the page colour, sits behind the rails.
    let backdrop = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art"])
        .valign(gtk4::Align::Start)
        .build();
    backdrop.set_size_request(-1, 340);
    let wash = gtk4::Box::builder()
        .css_classes(["pa-key-wash"])
        .valign(gtk4::Align::Start)
        .build();
    wash.set_size_request(-1, 340);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    let overlay = gtk4::Overlay::builder().child(&backdrop).build();
    overlay.add_overlay(&wash);
    overlay.add_overlay(&scroll);
    scroll.add_css_class("pa-transparent");
    let reload = Rc::new(move |app: Rc<App>| load(&page, &backdrop, app, client.clone(), imgs.clone()));
    reload(app.clone());
    // Coming back from detail or the player refreshes On deck.
    let nav = app.nav.clone();
    nav.connect_popped(move |nav, _| {
        if nav.navigation_stack().n_items() == 1 {
            reload(app.clone());
        }
    });
    overlay.upcast()
}

fn load(page: &gtk4::Box, backdrop: &gtk4::Picture, app: Rc<App>, client: Client, imgs: Images) {
    let (page, backdrop) = (page.clone(), backdrop.clone());
    if page.first_child().is_none() {
        page.append(
            &gtk4::Label::builder()
                .label("Loading…")
                .css_classes(["pa-muted"])
                .build(),
        );
    }
    let c = client.clone();
    bg(
        move || {
            let rails = c.home_rails();
            let deck: Vec<Deck> = c
                .all_progress()
                .unwrap_or_default()
                .into_iter()
                .filter(|p| p.state == "part_watched" && !p.work_id.is_empty() && p.duration_ms > 0)
                .take(8)
                .filter_map(|p| {
                    let w = c.work(&p.work_id).ok()?.work;
                    Some(Deck {
                        fraction: p.position_ms as f64 / p.duration_ms as f64,
                        work: w,
                    })
                })
                .collect();
            (rails, deck)
        },
        move |(rails, deck)| {
            while let Some(child) = page.first_child() {
                page.remove(&child);
            }
            let open = {
                let app = app.clone();
                move |w: &Work| app.open_work(w)
            };
            let mut first = true;
            let mut art_set = false;
            let mut set_art = |w: &Work| {
                if !art_set {
                    if let Some(k) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
                        imgs.load(Client::artwork_path(&w.id, k, 1280), &backdrop);
                        art_set = true;
                    }
                }
            };
            if !deck.is_empty() {
                let cards: Vec<_> = deck
                    .iter()
                    .map(|d| {
                        set_art(&d.work);
                        let opts = CardOpts {
                            width: Some(RAIL_W),
                            meta: Some(d.work.meta_line()),
                            progress: Some(d.fraction),
                            selected: std::mem::take(&mut first),
                            ..Default::default()
                        };
                        card(&imgs, &d.work, opts, open.clone())
                    })
                    .collect();
                page.append(&section("On deck", &rail_row(cards)));
            }
            match rails {
                Err(e) => page.append(
                    &gtk4::Label::builder()
                        .label(e.to_string())
                        .css_classes(["pa-error"])
                        .wrap(true)
                        .margin_start(16)
                        .margin_end(16)
                        .build(),
                ),
                Ok(rails) => {
                    for Rail { title, items, .. } in rails.into_iter().filter(|r| !r.items.is_empty()) {
                        let cards: Vec<_> = items
                            .iter()
                            .map(|w| {
                                set_art(w);
                                let opts = CardOpts {
                                    width: Some(RAIL_W),
                                    meta: Some(w.meta_line()),
                                    selected: std::mem::take(&mut first),
                                    unseen: app.is_unseen(w),
                                    ..Default::default()
                                };
                                card(&imgs, w, opts, open.clone())
                            })
                            .collect();
                        page.append(&section(&title, &rail_row(cards)));
                    }
                }
            }
        },
    );
}
