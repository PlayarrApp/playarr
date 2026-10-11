//! Poster and wide cards shared by Home rails, library grids and search.
use super::images::Images;
use crate::api::Client;
use crate::model::Work;
use gtk4::prelude::*;
use libadwaita as adw;

type ActionsHandler = Box<dyn Fn(&Work)>;

thread_local! {
    /// Set by the app: shows the actions sheet for a long-pressed card.
    static ACTIONS: std::cell::RefCell<Option<ActionsHandler>> = const { std::cell::RefCell::new(None) };
}

pub fn set_actions_handler(f: impl Fn(&Work) + 'static) {
    ACTIONS.with(|a| *a.borrow_mut() = Some(Box::new(f)));
}

pub const POSTER_W: i32 = 94;
pub const POSTER_H: i32 = 141;
pub const WIDE_W: i32 = 280;
pub const WIDE_H: i32 = 158;

fn art(imgs: &Images, work: &Work, kinds: &[&str], width: u32, w: i32, h: i32) -> (gtk4::Widget, gtk4::Overlay) {
    let pic = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .can_shrink(true)
        .build();
    pic.set_size_request(w, h);
    let frame = gtk4::Overlay::builder()
        .child(&pic)
        .overflow(gtk4::Overflow::Hidden)
        .css_classes(["pa-poster"])
        .build();
    frame.set_size_request(w, h);
    match kinds.iter().find(|k| work.has_image(k)) {
        Some(kind) => imgs.load(Client::artwork_path(&work.id, kind, width), &pic),
        None => {
            let initial = work
                .title
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            frame.add_overlay(
                &gtk4::Label::builder()
                    .label(&initial)
                    .css_classes(["pa-poster-initial"])
                    .build(),
            );
        }
    }
    // A picture reports its image size as natural size; clamp it so every card is exactly w by h.
    let wide = adw::Clamp::builder()
        .orientation(gtk4::Orientation::Horizontal)
        .maximum_size(w)
        .tightening_threshold(w)
        .child(&frame)
        .build();
    let both = adw::Clamp::builder()
        .orientation(gtk4::Orientation::Vertical)
        .maximum_size(h)
        .tightening_threshold(h)
        .child(&wide)
        .build();
    (both.upcast(), frame)
}

fn labels(col: &gtk4::Box, work: &Work, width: i32, extra_meta: Option<&str>) {
    let title = gtk4::Label::builder()
        .label(&work.title)
        .css_classes(["pa-card-title"])
        .xalign(0.0)
        .ellipsize(gtk4::pango::EllipsizeMode::End)
        .max_width_chars(1)
        .width_request(width)
        .build();
    let meta = extra_meta.map(str::to_string).unwrap_or_else(|| work.meta_line());
    let meta = gtk4::Label::builder()
        .label(&meta)
        .css_classes(["pa-card-meta"])
        .xalign(0.0)
        .ellipsize(gtk4::pango::EllipsizeMode::End)
        .max_width_chars(1)
        .width_request(width)
        .build();
    col.append(&title);
    col.append(&meta);
}

fn wrap(col: &gtk4::Box, work: &Work, on_open: impl Fn(&Work) + 'static) -> gtk4::Button {
    let b = gtk4::Button::builder()
        .child(col)
        .css_classes(["pa-card"])
        .halign(gtk4::Align::Start)
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

pub fn poster_card(imgs: &Images, work: &Work, on_open: impl Fn(&Work) + 'static) -> gtk4::Button {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 4);
    col.append(&art(imgs, work, &["poster", "thumb", "backdrop"], 360, POSTER_W, POSTER_H).0);
    labels(&col, work, POSTER_W, None);
    wrap(&col, work, on_open)
}

/// Landscape card (On deck): backdrop art with an optional progress bar over the bottom edge.
pub fn wide_card(
    imgs: &Images,
    work: &Work,
    meta: &str,
    progress: Option<f64>,
    on_open: impl Fn(&Work) + 'static,
) -> gtk4::Button {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 4);
    let (widget, frame) = art(imgs, work, &["backdrop", "thumb", "poster"], 780, WIDE_W, WIDE_H);
    if let Some(p) = progress {
        let bar = gtk4::ProgressBar::builder()
            .fraction(p.clamp(0.0, 1.0))
            .valign(gtk4::Align::End)
            .css_classes(["pa-progress"])
            .build();
        frame.add_overlay(&bar);
    }
    col.append(&widget);
    labels(&col, work, WIDE_W, Some(meta));
    wrap(&col, work, on_open)
}
