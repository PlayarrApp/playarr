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

/// The web asks for 200 titles at a time.
const PAGE: usize = 200;
/// Cards drawn per step; the rest of a page waits until the list is scrolled to its end.
const CHUNK: usize = 24;

const ALPHABET: &str = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// The rail bucket of a title: its first letter without a leading article, `#` for digits and symbols.
fn letter_of(title: &str) -> char {
    let t = title.trim().to_lowercase();
    let t = ["the ", "a ", "an "]
        .iter()
        .find_map(|a| t.strip_prefix(a))
        .unwrap_or(&t);
    t.chars()
        .next()
        .map(|c| c.to_ascii_uppercase())
        .filter(|c| c.is_ascii_uppercase())
        .unwrap_or('#')
}

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

/// Sort key: lower case, leading "the/a/an" dropped, digit runs compared as numbers.
pub fn natural_key(title: &str) -> Vec<(u8, u64, String)> {
    let t = title.to_lowercase();
    let t = ["the ", "a ", "an "]
        .iter()
        .find_map(|a| t.strip_prefix(a))
        .unwrap_or(&t)
        .to_string();
    let mut out = Vec::new();
    let mut chars = t.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            let mut n = String::new();
            while let Some(&d) = chars.peek() {
                if !d.is_ascii_digit() {
                    break;
                }
                n.push(d);
                chars.next();
            }
            out.push((0, n.parse().unwrap_or(0), String::new()));
        } else {
            let mut w = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_ascii_digit() {
                    break;
                }
                w.push(d);
                chars.next();
            }
            out.push((1, 0, w));
        }
    }
    out
}

struct Lib {
    app: Rc<App>,
    client: Client,
    imgs: Images,
    flow: gtk4::Box,
    head: header::Header,
    backdrop: gtk4::Picture,
    noun: &'static str,
    status: gtk4::Label,
    query: RefCell<CatalogQuery>,
    loaded: Cell<usize>,
    total: Cell<usize>,
    busy: Cell<bool>,
    /// Bumped on every reset so a late page from the old query is dropped.
    generation: Cell<u32>,
    genres: RefCell<BTreeSet<String>>,
    /// Titles fetched but not drawn yet: pages arrive 200 at a time, cards are drawn 24 at a time.
    buffer: RefCell<std::collections::VecDeque<crate::model::Work>>,
    /// Titles the server has handed over so far (the next page's offset).
    fetched: Cell<usize>,
    /// Alphabet bucket of every title fetched so far, in list order (for the letter rail).
    letters: RefCell<Vec<char>>,
    scroll: gtk4::ScrolledWindow,
    rail: gtk4::Box,
    /// Pushes the cards down by the height of the titles a letter jump skipped.
    spacer: RefCell<Option<gtk4::Box>>,
    pending_letter: Cell<Option<char>>,
}

impl Lib {
    fn reset(self: &Rc<Self>) {
        self.generation.set(self.generation.get() + 1);
        self.loaded.set(0);
        self.fetched.set(0);
        self.buffer.borrow_mut().clear();
        self.letters.borrow_mut().clear();
        self.spacer.replace(None);
        self.total.set(usize::MAX);
        self.busy.set(false);
        while let Some(c) = self.flow.first_child() {
            self.flow.remove(&c);
        }
        self.load_more();
    }

    /// Draws up to `CHUNK` buffered titles.
    fn render_chunk(self: &Rc<Self>) {
        for _ in 0..CHUNK {
            let Some(w) = self.buffer.borrow_mut().pop_front() else {
                break;
            };
            self.genres.borrow_mut().extend(w.genres.iter().cloned());
            let a = self.app.clone();
            let first = self.flow.first_child().is_none();
            if first {
                if let Some(k) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
                    self.imgs.load(Client::artwork_path(&w.id, k, 780), &self.backdrop);
                }
            }
            let opts = CardOpts {
                selected: first,
                unseen: self.app.is_unseen(&w),
                ..Default::default()
            };
            self.loaded.set(self.loaded.get() + 1);
            self.flow.append(&card(&self.imgs, &w, opts, move |w| a.open_work(w)));
        }
        let more = !self.buffer.borrow().is_empty() || self.fetched.get() < self.total.get();
        self.status.set_label(if more {
            "Loading more…"
        } else if self.loaded.get() == 0 {
            "Nothing matches these filters."
        } else {
            ""
        });
        self.status.set_visible(more || self.loaded.get() == 0);
    }

    fn load_more(self: &Rc<Self>) {
        if self.busy.get() {
            return;
        }
        if !self.buffer.borrow().is_empty() {
            return self.render_chunk();
        }
        self.fetch_page();
    }

    fn fetch_page(self: &Rc<Self>) {
        if self.busy.get() || self.fetched.get() >= self.total.get() {
            return;
        }
        self.busy.set(true);
        self.status.set_label("Loading…");
        self.status.set_visible(true);
        let (me, c, q, offset, gen) = (
            self.clone(),
            self.client.clone(),
            self.query.borrow().clone(),
            self.fetched.get(),
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
                    Ok(mut p) => {
                        let n = p.items.len();
                        if me.query.borrow().sort != "date_added" {
                            // Like the web: numbers sort by value ("9 Bullets" before "10 Cloverfield Lane"), articles ignored.
                            p.items.sort_by_key(|w| natural_key(&w.title));
                            if me.query.borrow().descending {
                                p.items.reverse();
                            }
                        }
                        me.fetched.set(offset + n);
                        me.total.set(if n == 0 {
                            offset
                        } else {
                            p.total.map(|t| t.max(0) as usize).unwrap_or(usize::MAX)
                        });
                        if let Some(t) = p.total {
                            me.head.set_subtitle(&format!("{} {}", group_digits(t), me.noun));
                        }
                        me.letters
                            .borrow_mut()
                            .extend(p.items.iter().map(|w| letter_of(&w.title)));
                        me.buffer.borrow_mut().extend(p.items);
                        match me.pending_letter.take() {
                            Some(l) => me.jump(l),
                            None => me.render_chunk(),
                        }
                    }
                }
            },
        );
    }

    fn rank(&self, c: char) -> usize {
        let i = ALPHABET.find(c).unwrap_or(0);
        if self.query.borrow().descending {
            ALPHABET.len() - 1 - i
        } else {
            i
        }
    }

    /// Scrolls to the first title at or after `letter`, fetching pages until one is found. Titles skipped on the
    /// way are not drawn: a spacer stands in for them.
    fn jump(self: &Rc<Self>, letter: char) {
        let target = self.rank(letter);
        let found = self.letters.borrow().iter().position(|c| self.rank(*c) >= target);
        let Some(idx) = found else {
            if self.fetched.get() < self.total.get() {
                self.pending_letter.set(Some(letter));
                self.fetch_page();
                return;
            }
            return;
        };
        let drawn = self.loaded.get();
        let y = if idx < drawn {
            let skipped = self.spacer.borrow().as_ref().map(|s| s.height_request()).unwrap_or(0);
            let pitch = self.pitch();
            skipped + ((idx - self.skipped_cards()) as f64 * pitch) as i32
        } else {
            while let Some(c) = self.flow.first_child() {
                self.flow.remove(&c);
            }
            let pitch = self.pitch();
            let spacer = gtk4::Box::builder()
                .height_request((idx as f64 * pitch) as i32 - 24)
                .build();
            self.flow.append(&spacer);
            self.spacer.replace(Some(spacer));
            for _ in drawn..idx {
                self.buffer.borrow_mut().pop_front();
            }
            self.loaded.set(idx);
            self.render_chunk();
            (idx as f64 * pitch) as i32
        };
        self.scroll.vadjustment().set_value((y + 100) as f64);
        self.mark_letter(letter);
    }

    fn skipped_cards(&self) -> usize {
        0
    }

    /// Card height plus the gap between cards.
    fn pitch(&self) -> f64 {
        let h = self
            .flow
            .first_child()
            .filter(|c| c.height() > 0 && c.is::<gtk4::Button>())
            .map(|c| c.height());
        h.map(|h| h as f64 + 24.0).unwrap_or(257.0)
    }

    fn mark_letter(&self, letter: char) {
        let mut child = self.rail.first_child();
        while let Some(c) = child {
            if let Some(l) = c.downcast_ref::<gtk4::Button>() {
                if l.label().and_then(|t| t.chars().next()) == Some(letter) {
                    l.add_css_class("active");
                } else {
                    l.remove_css_class("active");
                }
            }
            child = c.next_sibling();
        }
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
        self.app.present_panel("Library controls", "Filters", &col, true);
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
    let backdrop = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art", "soft"])
        .valign(gtk4::Align::Start)
        .build();
    backdrop.set_size_request(-1, 385);
    let wash = gtk4::Box::builder()
        .css_classes(["pa-key-wash"])
        .valign(gtk4::Align::Start)
        .build();
    wash.set_size_request(-1, 385);
    scroll.add_css_class("pa-transparent");
    let filters = head.action.clone();
    filters.set_visible(true);

    let rail = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .homogeneous(true)
        .halign(gtk4::Align::End)
        .valign(gtk4::Align::Fill)
        .width_request(16)
        .margin_top(87)
        .margin_bottom(88)
        .build();
    let lib = Rc::new(Lib {
        scroll: scroll.clone(),
        rail: rail.clone(),
        spacer: RefCell::new(None),
        letters: RefCell::default(),
        pending_letter: Cell::new(None),
        app,
        client,
        imgs,
        flow,
        head,
        backdrop: backdrop.clone(),
        noun,
        status,
        query: RefCell::new(CatalogQuery {
            kind: kind.into(),
            sort: "title".into(),
            // The web lists what can be played by default.
            available_only: true,
            ..Default::default()
        }),
        loaded: Cell::new(0),
        total: Cell::new(usize::MAX),
        busy: Cell::new(false),
        generation: Cell::new(0),
        genres: RefCell::default(),
        buffer: RefCell::default(),
        fetched: Cell::new(0),
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
    for c in ALPHABET.chars() {
        let b = gtk4::Button::builder()
            .label(c.to_string())
            .css_classes(["pa-letter"])
            .build();
        let lib = lib.clone();
        b.connect_clicked(move |_| lib.jump(c));
        rail.append(&b);
    }
    lib.mark_letter('#');
    {
        // The highlighted letter follows the list.
        let lib = lib.clone();
        scroll.vadjustment().connect_value_changed(move |a| {
            let idx = (((a.value() - 100.0).max(0.0)) / lib.pitch()) as usize;
            if let Some(c) = lib.letters.borrow().get(idx) {
                lib.mark_letter(*c);
            }
        });
    }
    lib.reset();
    let root = gtk4::Overlay::builder().child(&backdrop).build();
    root.add_overlay(&wash);
    root.add_overlay(&scroll);
    root.add_overlay(&rail);
    if kind == "movie" {
        // Capture hook: open the filters sheet.
        let lib = lib.clone();
        lib.app
            .clone()
            .hooks
            .borrow_mut()
            .insert("filters", Rc::new(move |_| lib.show_filters()));
    }
    root.upcast()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order_matches_the_web() {
        let mut v = vec![
            "10 Cloverfield Lane",
            "The 5th Wave",
            "2 Fast 2 Furious",
            "9 Bullets",
            "6 Underground",
            "12 Strong",
        ];
        v.sort_by_key(|t| natural_key(t));
        assert_eq!(
            v,
            [
                "2 Fast 2 Furious",
                "The 5th Wave",
                "6 Underground",
                "9 Bullets",
                "10 Cloverfield Lane",
                "12 Strong"
            ]
        );
    }

    #[test]
    fn digit_grouping() {
        assert_eq!(group_digits(1754), "1,754");
        assert_eq!(group_digits(35), "35");
    }
}
