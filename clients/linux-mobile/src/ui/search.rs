//! Search tab: type to search the catalogue.
use super::cards::poster_card;
use super::images::Images;
use super::{bg, library, App};
use crate::api::Client;
use gtk4::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_top(20);
    page.set_margin_bottom(110);
    let entry = gtk4::SearchEntry::builder()
        .placeholder_text("Search titles")
        .margin_start(16)
        .margin_end(16)
        .build();
    let status = gtk4::Label::builder()
        .label("Search movies and series.")
        .css_classes(["pa-muted"])
        .build();
    let flow = library::grid();
    if let Ok(q) = std::env::var("PLAYARR_SEARCH") {
        // Capture scripts pre-fill a query.
        entry.set_text(&q);
    }
    page.append(&entry);
    page.append(&status);
    page.append(&flow);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    let seq = Rc::new(Cell::new(0u32));
    entry.connect_search_changed(move |e| {
        let q = e.text().trim().to_string();
        let n = seq.get() + 1;
        seq.set(n);
        while let Some(child) = flow.first_child() {
            flow.remove(&child);
        }
        if q.chars().count() < 2 {
            status.set_label("Search movies and series.");
            status.set_visible(true);
            return;
        }
        status.set_label("Searching…");
        status.set_visible(true);
        let (c, seq, flow, status, imgs, app) = (
            client.clone(),
            seq.clone(),
            flow.clone(),
            status.clone(),
            imgs.clone(),
            app.clone(),
        );
        bg(
            move || c.search(&q),
            move |res| {
                if seq.get() != n {
                    return; // a newer query superseded this one
                }
                match res {
                    Err(e) => status.set_label(&e.to_string()),
                    Ok(items) if items.is_empty() => status.set_label("No matches."),
                    Ok(items) => {
                        status.set_visible(false);
                        for w in &items {
                            let a = app.clone();
                            flow.append(&poster_card(&imgs, w, move |w| a.open_work(w)));
                        }
                    }
                }
            },
        );
    });
    scroll.upcast()
}
