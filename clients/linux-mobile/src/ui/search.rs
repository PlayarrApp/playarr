//! Search tab: header with the result count, a pill search field, then the matching titles as cards.
use super::cards::{card, CardOpts};
use super::images::Images;
use super::{bg, header, library, App};
use crate::api::Client;
use crate::model::Work;
use gtk4::prelude::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(110);
    let head = Rc::new(header::build(&app, "Search", "filters"));
    page.append(&head.widget);
    // A plain entry: the web's field has no clear icon, and GtkSearchEntry's cannot be hidden by CSS.
    let entry = gtk4::Entry::builder()
        .placeholder_text("Search your libraries and playlists")
        .primary_icon_name("edit-find-symbolic")
        .css_classes(["pa-search"])
        .margin_start(16)
        .margin_end(16)
        .margin_top(7)
        .build();
    // The web's empty state: a ring with a search-minus icon, then the prompt beside it.
    let status = gtk4::Label::builder()
        .label("Start typing to search.")
        .css_classes(["pa-empty-text"])
        .xalign(0.0)
        .wrap(true)
        .hexpand(true)
        .build();
    let ring = gtk4::Box::builder()
        .css_classes(["pa-empty-ring"])
        .valign(gtk4::Align::Center)
        .build();
    ring.set_size_request(86, 86);
    let icon = crate::icons::image("search-minus", 20, crate::icons::Tone::Brand);
    icon.set_hexpand(true);
    icon.set_vexpand(true);
    ring.append(&icon);
    let empty = gtk4::Box::builder()
        .spacing(19)
        .margin_start(16)
        .margin_end(16)
        .margin_top(17)
        .build();
    empty.append(&ring);
    empty.append(&status);
    // Hide the ring with the prompt when results are shown.
    status.connect_notify_local(Some("visible"), {
        let empty = empty.clone();
        move |s, _| empty.set_visible(s.is_visible())
    });
    let flow = Rc::new(library::CardGrid::new());
    flow.widget.set_margin_top(17);
    flow.widget.set_spacing(14); // the web's search grid has a tighter row gap than the library's
    page.append(&entry);
    page.append(&empty);
    page.append(&flow.widget);
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
    // The results as the server sent them, and the Type filter ("all", "movie", "series", "artist") applied to them.
    let found: Rc<RefCell<Vec<Work>>> = Rc::default();
    let kind: Rc<RefCell<String>> = Rc::new(RefCell::new("all".into()));
    let render: Rc<dyn Fn()> = {
        let (found, kind, flow, head, imgs, app, backdrop, status) = (
            found.clone(),
            kind.clone(),
            flow.clone(),
            head.clone(),
            imgs.clone(),
            app.clone(),
            backdrop.clone(),
            status.clone(),
        );
        Rc::new(move || {
            flow.clear();
            let k = kind.borrow().clone();
            let items: Vec<Work> = found
                .borrow()
                .iter()
                .filter(|w| k == "all" || w.kind == k)
                .cloned()
                .collect();
            if found.borrow().is_empty() {
                return;
            }
            status.set_visible(items.is_empty());
            if items.is_empty() {
                status.set_label("No matches.");
                head.set_subtitle("");
                return;
            }
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
        })
    };
    // The web's Filters drawer from search: one Type choice.
    head.action.set_visible(true);
    {
        let (app, kind, render) = (app.clone(), kind.clone(), render.clone());
        head.action.connect_clicked(move |_| {
            let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
            col.set_margin_start(16);
            col.set_margin_end(16);
            col.append(
                &gtk4::Label::builder()
                    .label("TYPE")
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
            let mut group: Option<gtk4::ToggleButton> = None;
            for (code, name) in [
                ("all", "All"),
                ("movie", "Movies"),
                ("series", "Series"),
                ("artist", "Music"),
            ] {
                let t = gtk4::ToggleButton::builder()
                    .label(name)
                    .css_classes(["pa-seg-tile"])
                    .active(*kind.borrow() == code)
                    .build();
                match &group {
                    Some(g) => t.set_group(Some(g)),
                    None => group = Some(t.clone()),
                }
                let (kind, render) = (kind.clone(), render.clone());
                t.connect_toggled(move |b| {
                    if b.is_active() {
                        *kind.borrow_mut() = code.to_string();
                        render();
                    }
                });
                row.append(&t);
            }
            col.append(&row);
            app.present_panel("Search", "Filters", &col, true);
        });
    }
    entry.connect_changed(move |e| {
        let q = e.text().trim().to_string();
        let n = seq.get() + 1;
        seq.set(n);
        found.borrow_mut().clear();
        flow.clear();
        head.set_subtitle("");
        if q.chars().count() < 2 {
            status.set_label("Start typing to search.");
            status.set_visible(true);
            return;
        }
        status.set_label("Searching…");
        status.set_visible(true);
        let (c, seq, status, found, render) = (
            client.clone(),
            seq.clone(),
            status.clone(),
            found.clone(),
            render.clone(),
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
                        found.replace(items);
                        render();
                    }
                }
            },
        );
    });
    root.upcast()
}
