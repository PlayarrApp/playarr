//! Library grid (movies, series, music) with infinite scroll and a filters sheet.
use super::cards::{card, CardOpts};
use super::header;
use super::images::Images;
use super::{bg, App};
use crate::api::{CatalogQuery, Client};
use gtk4::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;

/// The web asks for 200 titles at a time.
const PAGE: usize = 200;
/// Cards drawn per step; the rest of a page waits until the list is scrolled to its end.
const CHUNK: usize = 24;

/// (code, name) pairs for the audio and subtitle filters.
type Languages = Vec<Vec<(String, String)>>;

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

/// The web phone's card grid: two columns of `CARD_W` cards, `COL_GAP` apart, clear of the 52 px letter rail on the right.
pub struct CardGrid {
    pub widget: gtk4::Box,
    /// The row being filled and how many cards it holds.
    row: RefCell<Option<(gtk4::Box, usize)>>,
    /// Rows started so far, for the web's fractional row pitch.
    rows: Cell<usize>,
}

pub const COL_GAP: i32 = 12;

impl CardGrid {
    pub fn new() -> Self {
        CardGrid {
            widget: gtk4::Box::builder()
                .orientation(gtk4::Orientation::Vertical)
                .spacing(24)
                .margin_start(16)
                .margin_end(52)
                .margin_top(1)
                .build(),
            row: RefCell::default(),
            rows: Cell::new(0),
        }
    }

    pub fn append(&self, card: &impl IsA<gtk4::Widget>) {
        let mut cur = self.row.borrow_mut();
        if cur.as_ref().map_or(true, |(_, n)| *n >= super::cards::cols()) {
            // The web's rows are 0.35 css px further apart than the 24 px gap gives (measured on the music, series and
            // movies grids at 2x: rows 3 and 4 sit 2 device px lower), so every third row takes one extra px.
            let n = self.rows.replace(self.rows.get() + 1);
            let extra = |n: usize| (n as f64 * 0.35).round() as i32;
            let row = gtk4::Box::builder()
                .spacing(COL_GAP)
                .margin_top(if n == 0 { 0 } else { extra(n) - extra(n - 1) })
                .build();
            self.widget.append(&row);
            *cur = Some((row, 0));
        }
        if let Some((row, n)) = cur.as_mut() {
            row.append(card);
            *n += 1;
        }
    }

    /// A full-width child (the spacer that stands in for skipped rows); the next card starts a new row.
    pub fn append_block(&self, w: &impl IsA<gtk4::Widget>) {
        self.widget.append(w);
        self.row.replace(None);
    }

    pub fn clear(&self) {
        while let Some(c) = self.widget.first_child() {
            self.widget.remove(&c);
        }
        self.rows.set(0);
        self.row.replace(None);
    }

    pub fn is_empty(&self) -> bool {
        self.widget.first_child().is_none()
    }

    /// Height of one drawn row, if any.
    pub fn row_height(&self) -> Option<i32> {
        self.row.borrow().as_ref().map(|(r, _)| r.height()).filter(|h| *h > 0)
    }
}

impl Default for CardGrid {
    fn default() -> Self {
        Self::new()
    }
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

/// Sort key: lower case, leading "the/a/an" dropped, punctuation ignored ("9-1-1" is 911, "10,000 BC" is 10000), digit
/// runs compared as numbers.
pub fn natural_key(title: &str) -> Vec<(u8, u64, String)> {
    let t: String = title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
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
    flow: CardGrid,
    head: header::Header,
    backdrop: gtk4::Picture,
    noun: &'static str,
    status: gtk4::Label,
    query: RefCell<CatalogQuery>,
    loaded: Cell<usize>,
    total: Cell<usize>,
    busy: Cell<bool>,
    /// The Cover view (View > Cover in Filters): 2:3 posters at the same card width.
    cover: Cell<bool>,
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
        self.flow.clear();
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
            let first = self.flow.is_empty();
            if first {
                // The web highlights the first title's letter, not always "#".
                self.mark_letter(letter_of(&w.title));
                if let Some(k) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
                    self.imgs.load(Client::artwork_path(&w.id, k, 780), &self.backdrop);
                }
            }
            let cover = self.cover.get();
            let opts = CardOpts {
                selected: first,
                home_art: true,
                unseen: self.app.is_unseen(&w),
                art_h: cover.then(super::cards::cover_art_h),
                kinds: if cover {
                    &["poster", "backdrop", "thumb"]
                } else {
                    &["backdrop", "thumb", "poster"]
                },
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
            self.flow.clear();
            let pitch = self.pitch();
            let spacer = gtk4::Box::builder()
                .height_request((idx as f64 * pitch) as i32 - 24)
                .build();
            self.flow.append_block(&spacer);
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

    /// Height one card adds to the list: half a row plus half the gap between rows.
    fn pitch(&self) -> f64 {
        self.flow
            .row_height()
            .map(|h| (h as f64 + 24.0) / super::cards::cols() as f64)
            .unwrap_or(71.0)
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

    /// Filters panel as the web's: view, sort, order and the audio and subtitle language filters.
    fn show_filters(self: &Rc<Self>) {
        let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
        col.set_margin_start(16);
        col.set_margin_end(16);
        col.set_margin_bottom(24);
        let q = self.query.borrow().clone();

        let label = |text: &str| {
            col.append(
                &gtk4::Label::builder()
                    .label(text.to_uppercase())
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
        };
        let tiles = |names: &[&str], active: usize, glyphs: bool| -> Vec<gtk4::ToggleButton> {
            let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
            let mut group: Option<gtk4::ToggleButton> = None;
            let mut out = Vec::new();
            for (i, n) in names.iter().enumerate() {
                let t = gtk4::ToggleButton::builder()
                    .css_classes(if glyphs {
                        vec!["pa-seg-tile", "view"]
                    } else {
                        vec!["pa-seg-tile"]
                    })
                    .active(i == active)
                    .build();
                if glyphs {
                    view_tile_child(&t, i, n);
                } else {
                    t.set_label(n);
                }
                match &group {
                    Some(g) => t.set_group(Some(g)),
                    None => group = Some(t.clone()),
                }
                row.append(&t);
                out.push(t);
            }
            col.append(&row);
            out
        };
        label("View");
        // Screen and Cover are drawn here; the List view is not built yet and goes back to the current view.
        let views = tiles(&["List", "Screen", "Cover"], usize::from(self.cover.get()) + 1, true);
        for (i, v) in views.iter().enumerate() {
            let (me, back) = (self.clone(), views[usize::from(self.cover.get()) + 1].clone());
            if i == 0 {
                v.set_tooltip_text(Some("The list view is not available in this app yet."));
            }
            v.connect_toggled(move |b| {
                if !b.is_active() {
                    return;
                }
                if i == 0 {
                    back.set_active(true);
                } else if me.cover.get() != (i == 2) {
                    me.cover.set(i == 2);
                    me.reset();
                }
            });
        }
        label("Sort by");
        let sort = tiles(&["Title", "Date Added"], usize::from(q.sort == "date_added"), false);
        label("Order");
        let order = tiles(&["A-Z", "Z-A"], usize::from(q.descending), false);

        // Languages come from the server's facets for this kind.
        let langs: Rc<RefCell<Languages>> = Rc::new(RefCell::new(vec![Vec::new(), Vec::new()]));
        let ready = Rc::new(std::cell::Cell::new(false));
        let mut drops = Vec::new();
        for (i, heading) in ["Audio language", "Subtitle language"].iter().enumerate() {
            label(heading);
            let dd = gtk4::DropDown::from_strings(&["Any language"]);
            dd.add_css_class("pa-dropdown");
            dd.add_css_class("pa-filter");
            col.append(&dd);
            drops.push(dd);
            let _ = i;
        }
        {
            let (c, kind, drops, langs) = (self.client.clone(), q.kind.clone(), drops.clone(), langs.clone());
            let (cur_a, cur_s) = (q.audio_lang.clone(), q.subtitle_lang.clone());
            let ready_f = ready.clone();
            bg(
                move || c.catalog_languages(&kind),
                move |facets| {
                    ready_f.set(false);
                    for (i, (dd, cur)) in drops.iter().zip([cur_a, cur_s]).enumerate() {
                        let list = facets.get(i).cloned().unwrap_or_default();
                        let mut names = vec!["Any language".to_string()];
                        names.extend(list.iter().map(|(_, n)| n.clone()));
                        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
                        dd.set_model(Some(&gtk4::StringList::new(&refs)));
                        dd.set_selected(
                            cur.and_then(|c| list.iter().position(|(code, _)| *code == c))
                                .map(|p| p as u32 + 1)
                                .unwrap_or(0),
                        );
                        langs.borrow_mut()[i] = list;
                    }
                    ready_f.set(true);
                },
            );
        }

        // Like the web, every change applies at once.
        let commit: Rc<dyn Fn()> = {
            let (me, sort, order, drops, langs, ready) = (
                self.clone(),
                sort.clone(),
                order.clone(),
                drops.clone(),
                langs.clone(),
                ready.clone(),
            );
            Rc::new(move || {
                if !ready.get() {
                    return;
                }
                {
                    let mut q = me.query.borrow_mut();
                    q.sort = if sort[1].is_active() {
                        "date_added".into()
                    } else {
                        "title".into()
                    };
                    q.descending = order[1].is_active();
                    let pick = |i: usize| {
                        let n = drops[i].selected() as usize;
                        (n > 0)
                            .then(|| langs.borrow()[i].get(n - 1).map(|(code, _)| code.clone()))
                            .flatten()
                    };
                    q.audio_lang = pick(0);
                    q.subtitle_lang = pick(1);
                }
                me.reset();
            })
        };
        for t in sort.iter().chain(order.iter()) {
            let commit = commit.clone();
            t.connect_toggled(move |b| {
                if b.is_active() {
                    commit()
                }
            });
        }
        for d in &drops {
            let commit = commit.clone();
            d.connect_selected_notify(move |_| commit());
        }
        ready.set(true);
        self.app.present_panel("Library controls", "Filters", &col, true);
    }
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, kind: &'static str, title: &str) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(110);
    let head = header::build(&app, title, "filters");
    // The web header keeps its subtitle row on a phone even though the text is hidden (#1299): the grid starts 18 px
    // lower than the bare title row, which the hidden subtitle no longer supplies.
    head.widget.set_margin_bottom(23);
    page.append(&head.widget);
    let flow = CardGrid::new();
    page.append(&flow.widget);
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
        .width_request(44)
        .margin_end(4)
        .margin_top(88)
        .margin_bottom(82)
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
        cover: Cell::new(false),
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
            .halign(gtk4::Align::Center)
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
            "9-1-1",
            "666 Park Avenue",
            "10,000 BC",
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
                "12 Strong",
                "666 Park Avenue",
                "9-1-1",
                "10,000 BC"
            ]
        );
    }

    #[test]
    fn digit_grouping() {
        assert_eq!(group_digits(1754), "1,754");
        assert_eq!(group_digits(35), "35");
    }
}

/// The web's view-switch glyphs (list, screen, cover), as css px (width, height).
const VIEW_GLYPHS: [(i32, i32); 3] = [(20, 10), (21, 5), (17, 13)];

/// Glyph over label, the glyph following the tile's checked colour.
fn view_tile_child(tile: &gtk4::ToggleButton, i: usize, name: &str) {
    let (w, h) = VIEW_GLYPHS[i];
    let weak = tile.downgrade();
    let area = gtk4::DrawingArea::builder()
        .content_width(w)
        .content_height(h)
        .halign(gtk4::Align::Center)
        .build();
    area.set_draw_func(move |_, cr, w, h| {
        let on = weak.upgrade().is_some_and(|t| t.is_active());
        let c = gtk4::gdk::RGBA::parse(crate::icons::color(if on {
            crate::icons::Tone::OnAccent
        } else {
            crate::icons::Tone::Ink
        }))
        .unwrap();
        cr.set_source_rgba(c.red().into(), c.green().into(), c.blue().into(), 1.0);
        let (w, h) = (f64::from(w), f64::from(h));
        match i {
            0 => {
                cr.set_line_width(2.0);
                cr.set_line_cap(gtk4::cairo::LineCap::Round);
                for y in [1.0, h / 2.0, h - 1.0] {
                    cr.move_to(1.0, y);
                    cr.line_to(w - 1.0, y);
                }
            }
            _ => {
                // Three outlined bars: wide and short (screen) or narrow and tall (cover).
                let (bw, gap) = if i == 1 { (6.0, 1.25) } else { (5.0, 1.0) };
                cr.set_line_width(1.6);
                for k in 0..3 {
                    let (x, r) = (0.8 + f64::from(k) * (bw + gap), if i == 1 { 1.2 } else { 1.5 });
                    let (x2, y2) = (x + bw - 1.6, h - 0.8);
                    cr.new_sub_path();
                    cr.arc(x2 - r, 0.8 + r, r, -std::f64::consts::FRAC_PI_2, 0.0);
                    cr.arc(x2 - r, y2 - r, r, 0.0, std::f64::consts::FRAC_PI_2);
                    cr.arc(x + r, y2 - r, r, std::f64::consts::FRAC_PI_2, std::f64::consts::PI);
                    cr.arc(
                        x + r,
                        0.8 + r,
                        r,
                        std::f64::consts::PI,
                        3.0 * std::f64::consts::FRAC_PI_2,
                    );
                    cr.close_path();
                }
            }
        }
        let _ = cr.stroke();
    });
    tile.connect_toggled({
        let area = area.clone();
        move |_| area.queue_draw()
    });
    let col = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(8)
        .valign(gtk4::Align::Center)
        .build();
    col.append(&area);
    col.append(&gtk4::Label::new(Some(name)));
    tile.set_child(Some(&col));
}
