//! Preferences: a numbered list of sections like the web, each opening a side panel.
use super::{bg, header, App};
use crate::api::Client;
use crate::icons::{self, Tone};
use crate::{avatar, store, theme};
use gtk4::prelude::*;
use std::rc::Rc;

const THEMES: [(&str, &str); 3] = [("dark", "Dark"), ("light", "Light"), ("system", "Follow system")];

fn section_row(n: usize, title: &str, desc: &str) -> gtk4::Button {
    let row = gtk4::Box::builder().spacing(0).build();
    row.append(
        &gtk4::Label::builder()
            .label(format!("{n:02}"))
            .css_classes(["pa-pref-num"])
            .valign(gtk4::Align::Start)
            .halign(gtk4::Align::Start)
            .width_request(44)
            .xalign(0.0)
            .margin_top(20)
            .build(),
    );
    let col = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(3)
        .valign(gtk4::Align::Center)
        .hexpand(true)
        .build();
    col.append(
        &gtk4::Label::builder()
            .label(title)
            .css_classes(["pa-pref-title"])
            .xalign(0.0)
            .build(),
    );
    col.append(
        &gtk4::Label::builder()
            .label(desc)
            .css_classes(["pa-pref-desc"])
            .xalign(0.0)
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .max_width_chars(1)
            .hexpand(true)
            .build(),
    );
    row.append(&col);
    row.append(
        &gtk4::Label::builder()
            .label("→")
            .css_classes(["pa-muted"])
            .valign(gtk4::Align::Center)
            .build(),
    );
    gtk4::Button::builder().child(&row).css_classes(["pa-pref"]).build()
}

pub fn build(app: Rc<App>, client: Client) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(110);
    let head = header::build(&app, "Preferences", "filters");
    head.action.set_visible(false);
    // The web focuses the back button when the page opens, which draws its ring.
    if let Some(back) = head.widget.first_child() {
        back.add_css_class("ring");
    }
    page.append(&head.widget);
    let list = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .margin_top(19)
        .margin_start(16)
        .margin_end(16)
        .build();
    page.append(&list);

    let appearance = section_row(1, "Appearance", "Choose this device's theme and home screen layout");
    {
        let app = app.clone();
        appearance.connect_clicked(move |_| {
            let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
            col.set_margin_start(16);
            col.set_margin_end(16);
            col.append(
                &gtk4::Label::builder()
                    .label("THEME")
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
            let current = store::load_settings().theme;
            let mut group: Option<gtk4::ToggleButton> = None;
            for (id, label) in THEMES {
                let b = gtk4::ToggleButton::builder()
                    .label(label)
                    .css_classes(["pa-seg-tile"])
                    .active(id == current)
                    .build();
                if let Some(g) = &group {
                    b.set_group(Some(g));
                } else {
                    group = Some(b.clone());
                }
                b.connect_toggled(move |b| {
                    if b.is_active() {
                        store::update_settings(|s| s.theme = id.into());
                        theme::apply(id);
                    }
                });
                row.append(&b);
            }
            col.append(&row);
            app.present_panel("Preferences", "Appearance", &col, true);
        });
    }
    list.append(&appearance);

    let avatar_row = section_row(2, "Profile avatar", "Choose how your profile appears on this device");
    {
        let (app, client) = (app.clone(), client.clone());
        avatar_row.connect_clicked(move |_| {
            let grid = gtk4::FlowBox::builder()
                .selection_mode(gtk4::SelectionMode::None)
                .max_children_per_line(3)
                .min_children_per_line(3)
                .row_spacing(12)
                .column_spacing(12)
                .margin_start(16)
                .margin_end(16)
                .build();
            for id in avatar::PRESETS {
                let b = gtk4::Button::builder()
                    .css_classes(["pa-plain"])
                    .child(&super::profiles::avatar_widget(id, 88))
                    .build();
                let (client, app) = (client.clone(), app.clone());
                b.connect_clicked(move |_| {
                    let c = client.clone();
                    app.close_panel();
                    bg(move || c.set_avatar_preset(id), |_| {});
                });
                grid.append(&b);
            }
            app.present_panel("Preferences", "Profile avatar", &grid, true);
        });
    }
    list.append(&avatar_row);

    list.append(&section_row(
        3,
        "Language",
        "Follow this device or keep a language fixed",
    ));
    let player = section_row(
        4,
        "Player",
        "Choose how Playarr should start quality, subtitles and audio",
    );
    {
        let app = app.clone();
        player.connect_clicked(move |_| {
            let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
            col.append(
                &gtk4::Label::builder()
                    .label("ADVANCED")
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            let current = store::load_settings();
            for (label, on, set) in [
                (
                    "Force direct video",
                    current.force_direct_video,
                    (|s: &mut store::Settings, v: bool| s.force_direct_video = v) as fn(&mut store::Settings, bool),
                ),
                (
                    "Force direct audio",
                    current.force_direct_audio,
                    (|s: &mut store::Settings, v: bool| s.force_direct_audio = v) as fn(&mut store::Settings, bool),
                ),
            ] {
                col.append(
                    &gtk4::Label::builder()
                        .label(label)
                        .css_classes(["pa-pref-title"])
                        .xalign(0.0)
                        .margin_top(8)
                        .build(),
                );
                let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
                let off = gtk4::ToggleButton::builder()
                    .label("Off")
                    .css_classes(["pa-seg-tile"])
                    .active(!on)
                    .build();
                let on_btn = gtk4::ToggleButton::builder()
                    .label("On")
                    .css_classes(["pa-seg-tile"])
                    .group(&off)
                    .active(on)
                    .build();
                on_btn.connect_toggled(move |b| store::update_settings(|s| set(s, b.is_active())));
                row.append(&off);
                row.append(&on_btn);
                col.append(&row);
            }
            col.append(
                &gtk4::Label::builder()
                    .label("Skip transcoding of that stream even when the device may not decode it. Off by default.")
                    .css_classes(["pa-pref-desc"])
                    .wrap(true)
                    .xalign(0.0)
                    .margin_top(8)
                    .build(),
            );
            app.present_panel("Preferences", "Player", &col, true);
        });
    }
    {
        // Capture hook: open the Player section.
        let player = player.clone();
        app.hooks
            .borrow_mut()
            .insert("settings-player", Rc::new(move |_| player.emit_clicked()));
    }
    list.append(&player);

    let server = section_row(
        5,
        "Server connection",
        "Combine libraries from multiple servers in one view",
    );
    {
        let (app, client) = (app.clone(), client.clone());
        server.connect_clicked(move |_| {
            let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
            col.set_margin_start(16);
            col.set_margin_end(16);
            col.append(
                &gtk4::Label::builder()
                    .label("SERVER")
                    .css_classes(["pa-section-label"])
                    .xalign(0.0)
                    .build(),
            );
            col.append(
                &gtk4::Label::builder()
                    .label(client.base())
                    .css_classes(["pa-body"])
                    .selectable(true)
                    .wrap(true)
                    .xalign(0.0)
                    .build(),
            );
            let out = gtk4::Button::builder()
                .label("Sign out")
                .css_classes(["pa-secondary"])
                .halign(gtk4::Align::Start)
                .margin_top(12)
                .build();
            let app2 = app.clone();
            out.connect_clicked(move |_| {
                app2.close_panel();
                app2.sign_out();
            });
            col.append(&out);
            app.present_panel("Preferences", "Server connection", &col, true);
        });
    }
    list.append(&server);
    list.append(&section_row(
        6,
        "About",
        &format!("Playarr for Linux phones {}", env!("CARGO_PKG_VERSION")),
    ));
    let _ = (icons::markup("home"), Tone::Soft);
    gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build()
        .upcast()
}
