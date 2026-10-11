//! "Who's watching" picker with the shared preset avatars.
use super::{bg, App};
use crate::api::Client;
use crate::avatar;
use crate::model::Profile;
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

pub fn build(app: Rc<App>, client: Client, from_shell: bool) -> gtk4::Widget {
    let root = gtk4::Box::new(gtk4::Orientation::Vertical, 18);
    root.add_css_class("pa-page");
    root.set_margin_top(36);
    root.set_margin_start(24);
    root.set_margin_end(24);
    root.set_margin_bottom(24);
    root.append(
        &gtk4::Label::builder()
            .label("Who’s watching?")
            .css_classes(["pa-title"])
            .build(),
    );
    let grid = gtk4::FlowBox::builder()
        .selection_mode(gtk4::SelectionMode::None)
        .max_children_per_line(3)
        .min_children_per_line(1)
        .row_spacing(18)
        .column_spacing(18)
        .homogeneous(true)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Start)
        .build();
    root.append(&grid);
    let status = gtk4::Label::builder()
        .label("Loading profiles…")
        .css_classes(["pa-muted"])
        .build();
    root.append(&status);
    let sign_out = gtk4::Button::builder()
        .label("Sign out")
        .css_classes(["pa-secondary"])
        .halign(gtk4::Align::Center)
        .margin_top(12)
        .build();
    {
        let app = app.clone();
        sign_out.connect_clicked(move |_| app.sign_out());
    }
    if from_shell {
        let settings = gtk4::Button::builder()
            .label("Settings")
            .css_classes(["pa-secondary"])
            .halign(gtk4::Align::Center)
            .build();
        let (app, client) = (app.clone(), client.clone());
        settings.connect_clicked(move |_| app.push_settings(client.clone()));
        root.append(&settings);
    }
    root.append(&sign_out);

    let c = client.clone();
    bg(
        move || {
            let profiles = c.profiles();
            (profiles, c.avatar_preset())
        },
        move |(profiles, my_preset)| match profiles {
            Err(e) => status.set_label(&e.to_string()),
            Ok(profiles) => {
                status.set_visible(false);
                for p in profiles {
                    grid.append(&tile(&app, &client, &p, my_preset.as_deref(), from_shell));
                }
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
    col.append(&avatar_widget(&preset, 104));
    col.append(
        &gtk4::Label::builder()
            .label(&p.display_name)
            .css_classes(["pa-profile-name"])
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .max_width_chars(14)
            .build(),
    );
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-plain", "pa-profile"])
        .build();
    if p.is_current {
        b.add_css_class("selected");
    }
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
