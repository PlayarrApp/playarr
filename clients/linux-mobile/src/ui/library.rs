//! Library grid (movies, series, music) with infinite scroll and a filters sheet.
use super::cards::poster_card;
use super::images::Images;
use super::{bg, App};
use crate::api::{CatalogQuery, Client};
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;

const PAGE: usize = 30;

pub fn grid() -> gtk4::FlowBox {
    gtk4::FlowBox::builder()
        .selection_mode(gtk4::SelectionMode::None)
        .min_children_per_line(2)
        .max_children_per_line(3)
        .row_spacing(14)
        .column_spacing(8)
        .homogeneous(true)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Start)
        .margin_start(12)
        .margin_end(12)
        .build()
}

struct Lib {
    app: Rc<App>,
    client: Client,
    imgs: Images,
    flow: gtk4::FlowBox,
    status: gtk4::Label,
    query: RefCell<CatalogQuery>,
    loaded: Cell<usize>,
    total: Cell<usize>,
    busy: Cell<bool>,
    /// Bumped on every reset so a late page from the old query is dropped.
    generation: Cell<u32>,
    genres: RefCell<BTreeSet<String>>,
}

impl Lib {
    fn reset(self: &Rc<Self>) {
        self.generation.set(self.generation.get() + 1);
        self.loaded.set(0);
        self.total.set(usize::MAX);
        self.busy.set(false);
        while let Some(c) = self.flow.first_child() {
            self.flow.remove(&c);
        }
        self.load_more();
    }

    fn load_more(self: &Rc<Self>) {
        if self.busy.get() || self.loaded.get() >= self.total.get() {
            return;
        }
        self.busy.set(true);
        self.status.set_label("Loading…");
        self.status.set_visible(true);
        let (me, c, q, offset, gen) = (
            self.clone(),
            self.client.clone(),
            self.query.borrow().clone(),
            self.loaded.get(),
            self.generation.get(),
        );
        bg(
            move || c.catalog_filtered(&q, offset, PAGE),
            move |res| {
                if me.generation.get() != gen {
                    return;
                }
                me.busy.set(false);
                match res {
                    Err(e) => me.status.set_label(&e.to_string()),
                    Ok(p) => {
                        let n = p.items.len();
                        me.loaded.set(offset + n);
                        me.total.set(if n == 0 {
                            offset + n
                        } else {
                            p.total.map(|t| t.max(0) as usize).unwrap_or(usize::MAX)
                        });
                        for w in &p.items {
                            me.genres.borrow_mut().extend(w.genres.iter().cloned());
                            let a = me.app.clone();
                            me.flow.append(&poster_card(&me.imgs, w, move |w| a.open_work(w)));
                        }
                        let more = me.loaded.get() < me.total.get();
                        me.status.set_label(if more {
                            "Loading more…"
                        } else if me.loaded.get() == 0 {
                            "Nothing matches these filters."
                        } else {
                            ""
                        });
                        me.status.set_visible(more || me.loaded.get() == 0);
                    }
                }
            },
        );
    }

    /// Bottom sheet: sort order, availability and genre.
    fn show_filters(self: &Rc<Self>) {
        let dialog = adw::Dialog::builder()
            .title("Filters")
            .presentation_mode(adw::DialogPresentationMode::BottomSheet)
            .build();
        let col = gtk4::Box::new(gtk4::Orientation::Vertical, 12);
        col.set_margin_start(16);
        col.set_margin_end(16);
        col.set_margin_top(8);
        col.set_margin_bottom(20);
        col.append(
            &gtk4::Label::builder()
                .label("Filters")
                .css_classes(["pa-h2"])
                .xalign(0.0)
                .build(),
        );
        let q = self.query.borrow().clone();

        let sort = gtk4::Box::builder().css_classes(["pa-seg", "linked"]).build();
        let by_title = gtk4::ToggleButton::builder()
            .label("Title")
            .active(q.sort != "date_added")
            .build();
        let by_added = gtk4::ToggleButton::builder()
            .label("Recently added")
            .group(&by_title)
            .active(q.sort == "date_added")
            .build();
        sort.append(&by_title);
        sort.append(&by_added);
        col.append(
            &gtk4::Label::builder()
                .label("Sort by")
                .css_classes(["pa-muted"])
                .xalign(0.0)
                .build(),
        );
        col.append(&sort);

        let avail = adw::SwitchRow::builder()
            .title("Available to play only")
            .active(q.available_only)
            .build();
        let list = gtk4::ListBox::builder()
            .selection_mode(gtk4::SelectionMode::None)
            .css_classes(["boxed-list"])
            .build();
        list.append(&avail);
        col.append(&list);

        let genre_box = gtk4::FlowBox::builder()
            .selection_mode(gtk4::SelectionMode::None)
            .max_children_per_line(3)
            .row_spacing(6)
            .column_spacing(6)
            .build();
        let chosen: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(q.genre.clone()));
        let chips: Rc<RefCell<Vec<(String, gtk4::ToggleButton)>>> = Rc::default();
        for g in self.genres.borrow().iter() {
            let b = gtk4::ToggleButton::builder()
                .label(g)
                .active(q.genre.as_deref() == Some(g))
                .css_classes(["pa-chip-btn"])
                .build();
            let (chosen, all_chips, name) = (chosen.clone(), chips.clone(), g.clone());
            b.connect_toggled(move |b| {
                if b.is_active() {
                    *chosen.borrow_mut() = Some(name.clone());
                    for (n, other) in all_chips.borrow().iter() {
                        if *n != name && other.is_active() {
                            other.set_active(false);
                        }
                    }
                } else if chosen.borrow().as_deref() == Some(name.as_str()) {
                    *chosen.borrow_mut() = None;
                }
            });
            chips.borrow_mut().push((g.clone(), b.clone()));
            genre_box.append(&b);
        }
        if !self.genres.borrow().is_empty() {
            col.append(
                &gtk4::Label::builder()
                    .label("Genre")
                    .css_classes(["pa-muted"])
                    .xalign(0.0)
                    .build(),
            );
            col.append(&genre_box);
        }

        let apply = gtk4::Button::builder()
            .label("Apply")
            .css_classes(["pa-primary"])
            .halign(gtk4::Align::Center)
            .margin_top(8)
            .build();
        {
            let (me, dialog) = (self.clone(), dialog.clone());
            apply.connect_clicked(move |_| {
                {
                    let mut q = me.query.borrow_mut();
                    q.sort = if by_added.is_active() {
                        "date_added".into()
                    } else {
                        "title".into()
                    };
                    q.available_only = avail.is_active();
                    q.genre = chosen.borrow().clone();
                }
                dialog.close();
                me.reset();
            });
        }
        col.append(&apply);
        dialog.set_child(Some(
            &gtk4::ScrolledWindow::builder()
                .child(&col)
                .propagate_natural_height(true)
                .hscrollbar_policy(gtk4::PolicyType::Never)
                .build(),
        ));
        dialog.present(Some(&self.app.window));
    }
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, kind: &'static str, title: &str) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_top(20);
    page.set_margin_bottom(110);
    let head = gtk4::Box::new(gtk4::Orientation::Horizontal, 8);
    head.append(
        &gtk4::Label::builder()
            .label(title)
            .css_classes(["pa-pagehead"])
            .xalign(0.0)
            .hexpand(true)
            .margin_start(16)
            .build(),
    );
    let filters = gtk4::Button::builder()
        .label("Filters")
        .css_classes(["pa-secondary"])
        .margin_end(16)
        .valign(gtk4::Align::Center)
        .build();
    head.append(&filters);
    page.append(&head);
    let flow = grid();
    page.append(&flow);
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .build();
    page.append(&status);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    let lib = Rc::new(Lib {
        app,
        client,
        imgs,
        flow,
        status,
        query: RefCell::new(CatalogQuery {
            kind: kind.into(),
            sort: "title".into(),
            ..Default::default()
        }),
        loaded: Cell::new(0),
        total: Cell::new(usize::MAX),
        busy: Cell::new(false),
        generation: Cell::new(0),
        genres: RefCell::default(),
    });
    {
        let lib = lib.clone();
        filters.connect_clicked(move |_| lib.show_filters());
    }
    {
        let lib = lib.clone();
        scroll.connect_edge_reached(move |_, pos| {
            if pos == gtk4::PositionType::Bottom {
                lib.load_more();
            }
        });
    }
    lib.reset();
    if kind == "movie" {
        // Capture hook: open the filters sheet.
        let lib = lib.clone();
        lib.app
            .clone()
            .hooks
            .borrow_mut()
            .insert("filters", Rc::new(move |_| lib.show_filters()));
    }
    scroll.upcast()
}
