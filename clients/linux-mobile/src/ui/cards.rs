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

/// The web's one poster card width (--card-w on a 360 phone) and its 16:9 art height.
pub const ART_H: i32 = 79;
pub const RAIL_W: i32 = 140;

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
    pub kinds: &'a [&'a str],
}

impl Default for CardOpts<'_> {
    fn default() -> Self {
        CardOpts {
            width: Some(RAIL_W),
            meta: None,
            progress: None,
            selected: false,
            unseen: false,
            kinds: &["backdrop", "thumb", "poster"],
        }
    }
}

pub fn card(imgs: &Images, work: &Work, o: CardOpts, on_open: impl Fn(&Work) + 'static) -> gtk4::Button {
    let pic = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .can_shrink(true)
        .build();
    let overlay = gtk4::Overlay::builder()
        .child(&pic)
        .overflow(gtk4::Overflow::Hidden)
        .css_classes(["pa-art"])
        .build();
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
    overlay.set_size_request(-1, ART_H);
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
