//! The calendar feed panel the web opens from the bell: the viewer's private iCal link with Copy, a QR code and the
//! steps for adding it to a calendar app.
use super::{bg, App};
use crate::api::Client;
use crate::qr;
use gtk4::prelude::*;
use std::rc::Rc;

const STEPS: [&str; 3] = [
    "Google Calendar: Other calendars (+) > From URL, then paste the link.",
    "Apple Calendar: File > New Calendar Subscription, then paste the link.",
    "Outlook: Add calendar > Subscribe from web, then paste the link.",
];

fn text(label: &str, class: &str) -> gtk4::Label {
    // The web sets this copy at a line height of 1.5 (14.88 px).
    let attrs = gtk4::pango::AttrList::new();
    attrs.insert(gtk4::pango::AttrInt::new_line_height_absolute(
        (14.88 * gtk4::pango::SCALE as f64) as i32,
    ));
    gtk4::Label::builder()
        .label(label)
        .css_classes([class])
        .xalign(0.0)
        .wrap(true)
        .wrap_mode(gtk4::pango::WrapMode::WordChar)
        .attributes(&attrs)
        .build()
}

/// Opens the panel, then asks the server for the link: one status call and at most one create that never replaces a link.
pub fn show(app: &Rc<App>, client: &Client) {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    let intro = text(
        "Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.",
        "pa-cl-text",
    );
    intro.set_margin_top(2);
    col.append(&intro);
    let entry = gtk4::Entry::builder()
        .editable(false)
        .css_classes(["pa-cl-url"])
        .visible(false)
        .build();
    crate::layout::name(&entry, "Subscription link");
    let copy = gtk4::Button::builder()
        .label("Copy link")
        .halign(gtk4::Align::Start)
        .css_classes(["pa-cl-copy"])
        .visible(false)
        .build();
    let plate = gtk4::Box::builder()
        .accessible_role(gtk4::AccessibleRole::Img)
        .halign(gtk4::Align::Start)
        .css_classes(["pa-cl-qr"])
        .visible(false)
        .build();
    let pic = gtk4::Image::builder()
        .pixel_size(216)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Center)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();
    plate.append(&pic);
    let status = text("Getting your link…", "pa-cl-text");
    col.append(&status);
    col.append(&entry);
    col.append(&copy);
    col.append(&plate);
    let h = gtk4::Label::builder()
        .label("ADD IT TO YOUR CALENDAR APP")
        .accessible_role(gtk4::AccessibleRole::Heading)
        .css_classes(["pa-section-label", "pa-heading"])
        .xalign(0.0)
        .build();
    col.append(&h);
    for (i, s) in STEPS.iter().enumerate() {
        let row = gtk4::Box::builder()
            .css_classes(["pa-cl-step"])
            .margin_top(if i == 0 { 10 } else { 8 })
            .build();
        let dot = gtk4::Label::builder()
            .label("\u{2022}")
            .css_classes(["pa-cl-text"])
            .valign(gtk4::Align::Start)
            .width_request(14)
            .xalign(0.0)
            .build();
        crate::layout::decorative(&dot);
        row.append(&dot);
        let t = text(s, "pa-cl-text");
        t.set_hexpand(true);
        row.append(&t);
        col.append(&row);
    }
    app.present_panel("Calendar", "Calendar link", &col, false);

    {
        let entry = entry.clone();
        copy.connect_clicked(move |b| {
            entry.display().clipboard().set_text(&entry.text());
            b.set_label("Copied");
        });
    }
    let c = client.clone();
    bg(
        move || c.calendar_feed_url(),
        move |res| match res {
            Ok(url) => {
                status.set_visible(false);
                entry.set_text(&url);
                pic.set_paintable(qr::texture(&url, 6).as_ref());
                entry.set_visible(true);
                copy.set_visible(true);
                plate.set_visible(true);
            }
            Err(e) => status.set_label(&format!("Something went wrong getting your calendar link ({e}).")),
        },
    );
}
