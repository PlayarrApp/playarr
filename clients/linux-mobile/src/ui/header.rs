//! The web's page header: round back button, title with a small tinted subtitle, and a square action button.
use super::App;
use crate::icons::{self, Tone};
use gtk4::prelude::*;
use std::rc::Rc;

pub struct Header {
    pub widget: gtk4::Box,
    pub title: gtk4::Label,
    pub subtitle: gtk4::Label,
    pub action: gtk4::Button,
    /// A second action button left of `action` (the calendar's bell); hidden until a page shows it.
    pub extra: gtk4::Button,
}

/// `action_icon` names the right-hand button's icon (for example `filters`); the button stays hidden until `action`
/// gets a handler.
pub fn build(app: &Rc<App>, title: &str, action_icon: &str) -> Header {
    let row = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Horizontal)
        .spacing(10)
        .margin_top(16)
        .margin_start(16)
        .margin_end(16)
        .margin_bottom(5)
        .build();
    let back = gtk4::Button::builder()
        .css_classes(["pa-hbtn", "round"])
        .valign(gtk4::Align::Start)
        .build();
    back.set_child(Some(
        &gtk4::Label::builder().label("←").css_classes(["pa-back-arrow"]).build(),
    ));
    {
        let app = app.clone();
        back.connect_clicked(move |_| app.go_back());
    }
    let block = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .hexpand(true)
        .spacing(0)
        .build();
    let h1 = gtk4::Label::builder()
        .label(title)
        .css_classes(["pa-h1"])
        .xalign(0.0)
        .ellipsize(gtk4::pango::EllipsizeMode::End)
        .build();
    let subtitle = gtk4::Label::builder()
        .css_classes(["pa-subtitle"])
        .xalign(0.0)
        .visible(false)
        .build();
    h1.set_height_request(44);
    subtitle.set_margin_top(6);
    block.append(&h1);
    block.append(&subtitle);
    let action = gtk4::Button::builder()
        .css_classes(["pa-hbtn", "square"])
        .valign(gtk4::Align::Start)
        .visible(false)
        .build();
    action.set_child(Some(&icons::image(action_icon, 18, Tone::Soft)));
    let extra = gtk4::Button::builder()
        .css_classes(["pa-hbtn", "square"])
        .valign(gtk4::Align::Start)
        .visible(false)
        .build();
    extra.set_child(Some(&icons::image("bell", 18, Tone::Soft)));
    row.append(&back);
    row.append(&block);
    row.append(&extra);
    row.append(&action);
    Header {
        widget: row,
        title: h1,
        subtitle,
        action,
        extra,
    }
}

impl Header {
    pub fn set_section(&self, text: &str) {
        self.title.set_label(text);
    }

    /// The web hides the header subtitle on a phone (title only, #1299), so the text is kept but never shown.
    pub fn set_subtitle(&self, text: &str) {
        self.subtitle.set_label(text);
    }
}
