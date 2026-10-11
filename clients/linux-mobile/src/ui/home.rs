//! Home: the server's rails, preceded by an "On deck" rail of part-watched titles.
use super::cards::{poster_card, wide_card};
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
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 22);
    page.set_margin_top(20);
    page.set_margin_bottom(110);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    let reload = Rc::new(move |app: Rc<App>| load(&page, app, client.clone(), imgs.clone()));
    reload(app.clone());
    // Coming back from detail or the player refreshes On deck.
    let nav = app.nav.clone();
    nav.connect_popped(move |nav, _| {
        if nav.navigation_stack().n_items() == 1 {
            reload(app.clone());
        }
    });
    scroll.upcast()
}

fn load(page: &gtk4::Box, app: Rc<App>, client: Client, imgs: Images) {
    let page = page.clone();
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .build();
    if page.first_child().is_none() {
        page.append(&status);
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
            if !deck.is_empty() {
                let cards = deck.iter().map(|d| {
                    wide_card(
                        &imgs,
                        &d.work,
                        &format!("{}% watched", (d.fraction * 100.0) as i32),
                        Some(d.fraction),
                        open.clone(),
                    )
                });
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
                        let cards = items.iter().map(|w| poster_card(&imgs, w, open.clone()));
                        page.append(&section(&title, &rail_row(cards)));
                    }
                }
            }
        },
    );
}
