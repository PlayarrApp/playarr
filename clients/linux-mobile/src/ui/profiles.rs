//! "Who's watching": theme control, the big title, the shared preset avatars and the settings and sign-out pills.
use super::{bg, App};
use crate::api::Client;
use crate::icons::{self, Tone};
use crate::model::Profile;
use crate::{avatar, store, theme};
use gtk4::prelude::*;
use std::rc::Rc;

pub fn avatar_widget(preset: &str, size: i32) -> gtk4::Image {
    let img = gtk4::Image::builder()
        .pixel_size(size)
        .css_classes(["pa-avatar"])
        .build();
    img.set_paintable(avatar::texture(preset).as_ref());
    img
}

const THEMES: [(&str, &str); 3] = [("dark", "Dark"), ("light", "Light"), ("system", "Auto")];

pub fn build(app: Rc<App>, client: Client, from_shell: bool) -> gtk4::Widget {
    let root = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    root.add_css_class("pa-page");

    // Top bar: brand mark, theme chooser.
    let top = gtk4::Box::builder()
        .spacing(10)
        .margin_top(14)
        .margin_start(16)
        .margin_end(16)
        .build();
    let mark = gtk4::Box::builder()
        .css_classes(["pa-mark"])
        .hexpand(true)
        .halign(gtk4::Align::Start)
        .build();
    mark.append(&icons::image("play", 18, Tone::OnAccent));
    top.append(&mark);
    let names: Vec<&str> = THEMES.iter().map(|t| t.1).collect();
    let theme_pick = gtk4::DropDown::from_strings(&names);
    theme_pick.add_css_class("pa-dropdown");
    let current = store::load_settings().theme;
    theme_pick.set_selected(THEMES.iter().position(|t| t.0 == current).unwrap_or(0) as u32);
    theme_pick.connect_selected_notify(|d| {
        let name = THEMES[d.selected() as usize].0;
        store::save_settings(&store::Settings { theme: name.into() });
        theme::apply(name);
    });
    top.append(&theme_pick);
    root.append(&top);

    root.append(
        &gtk4::Label::builder()
            .label("PROFILES")
            .css_classes(["pa-kicker"])
            .margin_top(26)
            .margin_start(16)
            .xalign(0.0)
            .build(),
    );
    root.append(
        &gtk4::Label::builder()
            .label("Who’s watching?")
            .css_classes(["pa-display"])
            .margin_start(16)
            .xalign(0.0)
            .build(),
    );

    let tiles = gtk4::Box::builder()
        .spacing(16)
        .margin_start(16)
        .margin_end(16)
        .margin_top(26)
        .build();
    root.append(&tiles);
    let status = gtk4::Label::builder()
        .label("Loading profiles…")
        .css_classes(["pa-muted"])
        .margin_start(16)
        .xalign(0.0)
        .margin_top(12)
        .build();
    root.append(&status);

    let actions = gtk4::Box::builder().spacing(10).margin_start(16).margin_top(24).build();
    let settings = gtk4::Button::builder().css_classes(["pa-pill", "round"]).build();
    settings.set_child(Some(&icons::image("settings", 18, Tone::Brand)));
    {
        let (app, client) = (app.clone(), client.clone());
        settings.connect_clicked(move |_| app.push_settings(client.clone()));
    }
    let sign_out = gtk4::Button::builder()
        .css_classes(["pa-pill"])
        .label("Sign out")
        .build();
    {
        let app = app.clone();
        sign_out.connect_clicked(move |_| app.sign_out());
    }
    actions.append(&settings);
    actions.append(&sign_out);
    root.append(&actions);

    let c = client.clone();
    bg(
        move || (c.profiles(), c.avatar_preset()),
        move |(profiles, my_preset)| match profiles {
            Err(e) => status.set_label(&e.to_string()),
            Ok(profiles) => {
                status.set_visible(false);
                for p in profiles {
                    tiles.append(&tile(&app, &client, &p, my_preset.as_deref(), from_shell));
                }
                tiles.append(&add_tile(&app));
            }
        },
    );
    gtk4::ScrolledWindow::builder()
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .child(&root)
        .css_classes(["pa-page"])
        .build()
        .upcast()
}

fn tile(app: &Rc<App>, client: &Client, p: &Profile, my_preset: Option<&str>, from_shell: bool) -> gtk4::Button {
    let preset = match (p.is_current, my_preset) {
        (true, Some(m)) => m.to_string(),
        _ => avatar::default_preset(&p.id).to_string(),
    };
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    col.set_halign(gtk4::Align::Center);
    let av = avatar_widget(&preset, 150);
    if p.is_current {
        av.add_css_class("current");
    }
    col.append(&av);
    col.append(
        &gtk4::Label::builder()
            .label(&p.display_name)
            .css_classes(["pa-profile-name"])
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .max_width_chars(14)
            .build(),
    );
    if p.is_current {
        col.append(
            &gtk4::Label::builder()
                .label("WATCHING NOW")
                .css_classes(["pa-tiny"])
                .build(),
        );
    }
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-plain", "pa-profile"])
        .valign(gtk4::Align::Start)
        .build();
    let (app, client, current) = (app.clone(), client.clone(), p.is_current);
    b.connect_clicked(move |_| {
        if current && from_shell {
            app.nav.pop();
        } else if current {
            app.enter(client.clone());
        } else {
            // shortcut: another profile needs its own device link, there is no saved-session switcher yet.
            app.show_link();
        }
    });
    b
}

fn add_tile(app: &Rc<App>) -> gtk4::Button {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    let circle = gtk4::Box::builder()
        .css_classes(["pa-add-circle"])
        .halign(gtk4::Align::Center)
        .build();
    circle.set_size_request(132, 132);
    circle.append(&icons::image("add", 28, Tone::Ink));
    col.append(&circle);
    col.append(
        &gtk4::Label::builder()
            .label("Sign in")
            .css_classes(["pa-profile-name"])
            .build(),
    );
    col.append(
        &gtk4::Label::builder()
            .label("ADD ANOTHER PROFILE")
            .css_classes(["pa-tiny"])
            .build(),
    );
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-plain", "pa-profile"])
        .valign(gtk4::Align::Start)
        .build();
    let app = app.clone();
    b.connect_clicked(move |_| app.show_link());
    b
}
