//! The one title card: 16:9 art with a caption, as the web's mobile layout draws it (140 wide on a 360 phone, two to a row in grids).
use super::images::Images;
use crate::api::Client;
use crate::model::Work;
use gtk4::prelude::*;

type ActionsHandler = Box<dyn Fn(&Work)>;

thread_local! {
    /// Set by the app: shows the actions sheet for a long-pressed card.
    static ACTIONS: std::cell::RefCell<Option<ActionsHandler>> = const { std::cell::RefCell::new(None) };
}

pub fn set_actions_handler(f: impl Fn(&Work) + 'static) {
    ACTIONS.with(|a| *a.borrow_mut() = Some(Box::new(f)));
}

thread_local! {
    /// Home artwork (covers or thumbnails) and the artwork size, from Settings > Appearance.
    static GEOM: std::cell::Cell<(bool, &'static str)> = const { std::cell::Cell::new((false, "medium")) };
}

pub fn set_geometry(home_cover: bool, size: &str) {
    let size = match size {
        "small" => "small",
        "large" => "large",
        _ => "medium",
    };
    GEOM.with(|g| g.set((home_cover, size)));
}

/// Columns beside the 52 px letter rail: the web's `--card-cols` is 2, plus 1 for small and minus 1 for large.
pub fn cols() -> usize {
    match GEOM.with(|g| g.get().1) {
        "small" => 3,
        "large" => 1,
        _ => 2,
    }
}

/// The web's one poster card width (--card-w on a 360 phone): the 292 px beside the gutters, split into `cols()` with 12 px gaps.
pub fn rail_w() -> i32 {
    let cols = cols() as i32;
    (360 - 16 - 52 - (cols - 1) * 12) / cols
}

/// Home has no letter rail, so its cards use the full 328 px between the page gutters (the web drops the rail gutter without a rail).
pub fn home_w() -> i32 {
    let cols = cols() as i32;
    (360 - 32 - (cols - 1) * 12) / cols
}

/// Art height of a 16:9 thumbnail card (79 at the default size).
pub fn art_h() -> i32 {
    (rail_w() as f64 * 9.0 / 16.0).round() as i32
}

/// Home rails honour the Covers setting: 2:3 art at the same card width.
pub fn home_cover() -> bool {
    GEOM.with(|g| g.get().0)
}

/// Art height of a 2:3 cover card.
pub fn cover_art_h() -> i32 {
    (rail_w() as f64 * 1.5).round() as i32
}

pub fn home_art_h() -> i32 {
    let ratio = if home_cover() { 1.5 } else { 9.0 / 16.0 };
    (home_w() as f64 * ratio).round() as i32
}

pub struct CardOpts<'a> {
    /// Card width; `None` fills the parent. Defaults to the web's one poster card width.
    pub width: Option<i32>,
    /// Second caption line, for example `Movie · 2008`.
    pub meta: Option<String>,
    /// Watch progress bar over the bottom edge of the art.
    pub progress: Option<f64>,
    /// Pink focus ring, as the web draws the first card of a page.
    pub selected: bool,
    /// Red "unseen" dot at the art's top-right corner.
    pub unseen: bool,
    /// Uses the Home rail's resting shadow tokens.
    pub home_art: bool,
    pub kinds: &'a [&'a str],
    /// Art height; `None` is the 16:9 thumbnail height.
    pub art_h: Option<i32>,
}

impl Default for CardOpts<'_> {
    fn default() -> Self {
        CardOpts {
            width: Some(rail_w()),
            meta: None,
            progress: None,
            selected: false,
            unseen: false,
            home_art: false,
            kinds: &["backdrop", "thumb", "poster"],
            art_h: None,
        }
    }
}

pub fn card(imgs: &Images, work: &Work, o: CardOpts, on_open: impl Fn(&Work) + 'static) -> gtk4::Button {
    let art_h = o.art_h.unwrap_or_else(art_h);
    let pic = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .can_shrink(true)
        .build();
    let overlay = gtk4::Overlay::builder()
        .overflow(gtk4::Overflow::Hidden)
        .css_classes(["pa-art"])
        .build();
    if o.home_art {
        overlay.add_css_class("pa-home-art");
    }
    if let Some(width) = o.width {
        let art_space = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
        art_space.set_size_request(width, art_h);
        overlay.set_child(Some(&art_space));
        pic.set_halign(gtk4::Align::Fill);
        pic.set_valign(gtk4::Align::Fill);
        pic.set_hexpand(true);
        pic.set_vexpand(true);
        overlay.add_overlay(&pic);
        overlay.set_measure_overlay(&pic, false);
    } else {
        overlay.set_child(Some(&pic));
    }
    match o.kinds.iter().find(|k| work.has_image(k)) {
        Some(kind) => imgs.load(Client::artwork_path(&work.id, kind, 780), &pic),
        None => overlay.add_overlay(
            &gtk4::Label::builder()
                .label(&work.title)
                .css_classes(["pa-art-title"])
                .wrap(true)
                .justify(gtk4::Justification::Center)
                .margin_start(12)
                .margin_end(12)
                .build(),
        ),
    }
    if let Some(p) = o.progress {
        overlay.add_overlay(
            &gtk4::ProgressBar::builder()
                .fraction(p.clamp(0.0, 1.0))
                .valign(gtk4::Align::End)
                .css_classes(["pa-progress"])
                .build(),
        );
    }
    if o.unseen {
        overlay.add_overlay(
            &gtk4::Box::builder()
                .css_classes(["pa-unseen"])
                .halign(gtk4::Align::End)
                .valign(gtk4::Align::Start)
                .margin_top(7)
                .margin_end(7)
                .build(),
        );
    }
    // A fixed art height (the web's 16:9 at card width); AspectFrame reported no height inside a button.
    overlay.set_size_request(-1, art_h);
    let frame = overlay.clone();
    if o.selected {
        frame.add_css_class("selected");
    }
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    col.append(&frame);
    let caption = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(3)
        .margin_top(11)
        .margin_bottom(0)
        .margin_start(2) // the web's caption sits 2 css px inside the art
        .build();
    caption.append(
        &gtk4::Label::builder()
            .label(&work.title)
            .css_classes(["pa-cap-title"])
            .xalign(0.0)
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .max_width_chars(1)
            .hexpand(true)
            .build(),
    );
    if let Some(m) = &o.meta {
        caption.append(
            &gtk4::Label::builder()
                .label(m)
                .css_classes(["pa-cap-meta"])
                .xalign(0.0)
                .ellipsize(gtk4::pango::EllipsizeMode::End)
                .max_width_chars(1)
                .build(),
        );
    }
    col.append(&caption);
    if let Some(w) = o.width {
        col.set_size_request(w, -1);
    }
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-card"])
        .halign(if o.width.is_some() {
            gtk4::Align::Start
        } else {
            gtk4::Align::Fill
        })
        .valign(gtk4::Align::Start)
        .build();
    let w = work.clone();
    b.connect_clicked(move |_| on_open(&w));
    // Long-press opens the actions sheet.
    let press = gtk4::GestureLongPress::new();
    let w = work.clone();
    press.connect_pressed(move |g, _, _| {
        g.set_state(gtk4::EventSequenceState::Claimed);
        ACTIONS.with(|a| {
            if let Some(f) = a.borrow().as_ref() {
                f(&w)
            }
        });
    });
    b.add_controller(press);
    b
}
