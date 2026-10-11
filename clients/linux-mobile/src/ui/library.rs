//! Library grid (movies, series, music) with infinite scroll and a filters sheet.
use super::cards::{card, CardOpts};
use super::header;
use super::images::Images;
use super::{bg, App};
use crate::api::{CatalogQuery, Client};
use gtk4::prelude::*;
use libadwaita as adw;
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;

const PAGE: usize = 30;

pub fn grid() -> gtk4::Box {
    gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(24)
        .margin_start(16)
        .margin_end(16)
        .margin_top(1)
        .build()
}

/// "1,754" style thousands grouping.
pub fn group_digits(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

struct Lib {
    app: Rc<App>,
    client: Client,
    imgs: Images,
    flow: gtk4::Box,
    head: header::Header,
    noun: &'static str,
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
                        if let Some(t) = p.total {
                            me.head.set_subtitle(&format!("{} {}", group_digits(t), me.noun));
                        }
                        for w in &p.items {
                            me.genres.borrow_mut().extend(w.genres.iter().cloned());
                            let a = me.app.clone();
                            let first = me.flow.first_child().is_none();
                            let opts = CardOpts {
                                selected: first,
                                unseen: me.app.is_unseen(w),
                                ..Default::default()
                            };
                            me.flow.append(&card(&me.imgs, w, opts, move |w| a.open_work(w)));
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

    /// Filters panel: sort, order, availability and genre.
    fn show_filters(self: &Rc<Self>) {
        let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
        col.set_margin_start(16);
        col.set_margin_end(16);
        col.set_margin_bottom(24);
        let q = self.query.borrow().clone();

        let tiles = |label: &str, a: &str, b: &str, first: bool| {
            col.append(
                &gtk4::Label::builder()
                    .label(label.to_uppercase())
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
            let t1 = gtk4::ToggleButton::builder()
                .label(a)
                .css_classes(["pa-seg-tile"])
                .active(first)
                .build();
            let t2 = gtk4::ToggleButton::builder()
                .label(b)
                .css_classes(["pa-seg-tile"])
                .group(&t1)
                .active(!first)
                .build();
            row.append(&t1);
            row.append(&t2);
            col.append(&row);
            (t1, t2)
        };
        let (_by_title, by_added) = tiles("Sort by", "Title", "Date Added", q.sort != "date_added");
        let (_asc, desc) = tiles("Order", "A-Z", "Z-A", !q.descending);

        let avail = adw::SwitchRow::builder()
            .title("Available to play only")
            .active(q.available_only)
            .build();
        let list = gtk4::ListBox::builder()
            .selection_mode(gtk4::SelectionMode::None)
            .css_classes(["boxed-list"])
            .margin_top(8)
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
                    .label("GENRE")
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            col.append(&genre_box);
        }

        let apply = gtk4::Button::builder()
            .label("Apply")
            .css_classes(["pa-primary"])
            .halign(gtk4::Align::Center)
            .margin_top(14)
            .build();
        {
            let me = self.clone();
            apply.connect_clicked(move |_| {
                {
                    let mut q = me.query.borrow_mut();
                    q.sort = if by_added.is_active() {
                        "date_added".into()
                    } else {
                        "title".into()
                    };
                    q.descending = desc.is_active();
                    q.available_only = avail.is_active();
                    q.genre = chosen.borrow().clone();
                }
                me.app.close_panel();
                me.reset();
            });
        }
        col.append(&apply);
        self.app.present_panel("Library controls", "Filters", &col);
    }
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, kind: &'static str, title: &str) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(110);
    let head = header::build(&app, title, "filters");
    page.append(&head.widget);
    let flow = grid();
    page.append(&flow);
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .margin_top(16)
        .build();
    page.append(&status);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    let noun = match kind {
        "movie" => "titles",
        "series" => "titles",
        _ => "artists",
    };
    let filters = head.action.clone();
    filters.set_visible(true);

    let lib = Rc::new(Lib {
        app,
        client,
        imgs,
        flow,
        head,
        noun,
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
