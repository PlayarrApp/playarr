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
    // Like the web, the field is focused when the page opens.
    {
        let entry = entry.clone();
        entry.connect_map(|e| {
            e.grab_focus();
        });
    }
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page", "pa-transparent"])
        .build();
    // The first result's art fades in behind the header, as on the library pages.
    let backdrop = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art"])
        .valign(gtk4::Align::Start)
        .build();
    backdrop.set_size_request(-1, 385);
    let wash = gtk4::Box::builder()
        .css_classes(["pa-key-wash"])
        .valign(gtk4::Align::Start)
        .build();
    wash.set_size_request(-1, 385);
    let root = gtk4::Overlay::builder().child(&backdrop).build();
    root.add_overlay(&wash);
    root.add_overlay(&scroll);

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
        let (c, seq, flow, status, imgs, app, head, backdrop) = (
            client.clone(),
            seq.clone(),
            flow.clone(),
            status.clone(),
            imgs.clone(),
            app.clone(),
            head.clone(),
            backdrop.clone(),
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
                        if let Some(k) = items.first().and_then(|w| {
                            ["backdrop", "poster"]
                                .iter()
                                .find(|k| w.has_image(k))
                                .map(|k| (w.id.clone(), *k))
                        }) {
                            imgs.load(crate::api::Client::artwork_path(&k.0, k.1, 780), &backdrop);
                        }
                        for w in items.iter() {
                            let a = app.clone();
                            let opts = CardOpts {
                                meta: Some(w.meta_line().to_uppercase()),
                                ..Default::default()
                            };
                            flow.append(&card(&imgs, w, opts, move |w| a.open_work(w)));
                        }
                    }
                }
            },
        );
    });
    root.upcast()
}
