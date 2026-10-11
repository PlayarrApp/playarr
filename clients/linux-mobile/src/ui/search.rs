//! Search tab: header with the result count, a pill search field, then the matching titles as cards.
use super::cards::{card, CardOpts};
use super::images::Images;
use super::{bg, header, library, App};
use crate::api::Client;
use gtk4::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_bottom(110);
    let head = Rc::new(header::build(&app, "Search", "filters"));
    page.append(&head.widget);
    let entry = gtk4::SearchEntry::builder()
        .placeholder_text("Search")
        .css_classes(["pa-search"])
        .margin_start(16)
        .margin_end(16)
        .build();
    let status = gtk4::Label::builder()
        .label("Search movies, series and music.")
        .css_classes(["pa-muted"])
        .margin_start(16)
        .xalign(0.0)
        .build();
    let flow = library::grid();
    page.append(&entry);
    page.append(&status);
    page.append(&flow);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    {
        // Capture hook: pre-fill a query.
        let entry = entry.clone();
        app.hooks
            .borrow_mut()
            .insert("search", Rc::new(move |q: &str| entry.set_text(q)));
    }
    let seq = Rc::new(Cell::new(0u32));
    entry.connect_search_changed(move |e| {
        let q = e.text().trim().to_string();
        let n = seq.get() + 1;
        seq.set(n);
        while let Some(child) = flow.first_child() {
            flow.remove(&child);
        }
        head.set_subtitle("");
        if q.chars().count() < 2 {
            status.set_label("Search movies, series and music.");
            status.set_visible(true);
            return;
        }
        status.set_label("Searching…");
        status.set_visible(true);
        let (c, seq, flow, status, imgs, app, head) = (
            client.clone(),
            seq.clone(),
            flow.clone(),
            status.clone(),
            imgs.clone(),
            app.clone(),
            head.clone(),
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
                        head.set_subtitle(&format!("{} results", library::group_digits(items.len() as i64)));
                        for (i, w) in items.iter().enumerate() {
                            let a = app.clone();
                            let opts = CardOpts {
                                meta: Some(w.meta_line().to_uppercase()),
                                selected: i == 0,
                                ..Default::default()
                            };
                            flow.append(&card(&imgs, w, opts, move |w| a.open_work(w)));
                        }
                    }
                }
            },
        );
    });
    scroll.upcast()
}
