//! "Who's watching": theme control, the big title, the shared preset avatars and the settings and sign-out pills.
use super::{bg, App};
use crate::api::Client;
use crate::icons::{self, Tone};
use crate::model::Profile;
use crate::{avatar, store, theme};
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

pub fn avatar_widget(preset: &str, size: i32) -> gtk4::Image {
    let img = gtk4::Image::builder()
        .pixel_size(size)
        .css_classes(["pa-avatar"])
        .build();
    img.set_paintable(avatar::texture(preset).as_ref());
    img
}

/// The web's selector: icon, label and a thin chevron, centred in the box.
fn decorate_dropdown(d: &gtk4::DropDown, icon: &str) {
    let Some(inner) = d
        .first_child()
        .and_then(|b| b.downcast::<gtk4::Button>().ok())
        .and_then(|b| b.child())
    else {
        return;
    };
    let Ok(inner) = inner.downcast::<gtk4::Box>() else {
        return;
    };
    inner.set_halign(gtk4::Align::Center);
    inner.set_spacing(8);
    if let Some(label) = inner.first_child() {
        label.set_hexpand(false);
    }
    if let Some(arrow) = inner.last_child() {
        arrow.set_visible(false);
    }
    inner.prepend(&icons::image(icon, 14, Tone::Soft));
    inner.append(&icons::image("chevron", 11, Tone::Soft));
}

const THEMES: [(&str, &str); 3] = [("dark", "Dark"), ("light", "Light"), ("system", "Auto")];

pub fn build(app: Rc<App>, client: Client, from_shell: bool) -> gtk4::Widget {
    let root = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    root.add_css_class("pa-page");

    // Top bar: brand mark at the left, theme chooser (and the language chooser, not wired) at the right.
    let top = gtk4::Box::builder()
        .css_classes(["pa-topbar"])
        .spacing(8)
        .margin_top(14)
        .margin_start(21)
        .margin_end(14)
        .height_request(48)
        .build();
    let mark = icons::brand_mark(30);
    mark.set_hexpand(true);
    mark.set_halign(gtk4::Align::Start);
    mark.set_valign(gtk4::Align::Center);
    mark.set_margin_start(0);
    mark.set_margin_bottom(6);
    top.append(&mark);
    let names: Vec<&str> = THEMES.iter().map(|t| t.1).collect();
    let theme_pick = gtk4::DropDown::from_strings(&names);
    theme_pick.add_css_class("pa-dropdown");
    theme_pick.set_size_request(112, 48);
    let current = store::load_settings().theme;
    theme_pick.set_selected(THEMES.iter().position(|t| t.0 == current).unwrap_or(0) as u32);
    theme_pick.connect_selected_notify(|d| {
        let name = THEMES[d.selected() as usize].0;
        store::update_settings(|s| s.theme = name.into());
        theme::apply(name);
    });
    decorate_dropdown(
        &theme_pick,
        if store::load_settings().theme == "dark" {
            "moon"
        } else {
            "sun"
        },
    );
    top.append(&theme_pick);
    let lang = gtk4::DropDown::from_strings(&["Auto"]);
    lang.add_css_class("pa-dropdown");
    lang.set_size_request(112, 48);
    lang.set_tooltip_text(Some("The app follows this device's language."));
    decorate_dropdown(&lang, "globe");
    top.append(&lang);
    root.append(&top);

    let heading = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .halign(gtk4::Align::Center)
        .margin_top(9)
        .build();
    heading.append(
        &gtk4::Label::builder()
            .label("PROFILES")
            .css_classes(["pa-kicker-s"])
            .build(),
    );
    heading.append(
        &gtk4::Label::builder()
            .label("Who’s watching?")
            .css_classes(["pa-who"])
            .build(),
    );
    root.append(&heading);

    let tiles = gtk4::Box::builder()
        .spacing(22)
        .halign(gtk4::Align::Center)
        .margin_top(33)
        .build();
    root.append(&tiles);
    let status = gtk4::Label::builder()
        .label("Loading profiles…")
        .css_classes(["pa-muted"])
        .margin_top(12)
        .build();
    root.append(&status);

    // Settings and sign out sit under the current profile.
    let actions = gtk4::Box::builder()
        .spacing(9)
        .css_classes(["pa-profile-actions"])
        .halign(gtk4::Align::Start)
        .margin_start(25)
        .margin_top(22)
        .build();
    let settings = gtk4::Button::builder().css_classes(["pa-pill", "round"]).build();
    settings.set_child(Some(&icons::image("settings", 16, Tone::Brand)));
    {
        let (app, client) = (app.clone(), client.clone());
        settings.connect_clicked(move |_| app.push_settings(client.clone()));
    }
    let sign_out = gtk4::Button::builder().css_classes(["pa-pill", "small"]).build();
    let out_row = gtk4::Box::builder().spacing(6).build();
    out_row.append(&icons::image("logout", 14, Tone::Ink));
    out_row.append(&gtk4::Label::new(Some("Sign out")));
    sign_out.set_child(Some(&out_row));
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
                let switching = Rc::new(Cell::new(crate::profile_sessions::SwitchPhase::Idle));
                for p in profiles {
                    tiles.append(&tile(
                        &app,
                        &client,
                        &p,
                        my_preset.as_deref(),
                        from_shell,
                        switching.clone(),
                    ));
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

fn tile(
    app: &Rc<App>,
    client: &Client,
    p: &Profile,
    my_preset: Option<&str>,
    from_shell: bool,
    switching: Rc<Cell<crate::profile_sessions::SwitchPhase>>,
) -> gtk4::Button {
    let preset = match (p.is_current, my_preset) {
        (true, Some(m)) => m.to_string(),
        _ => avatar::default_preset(&p.id).to_string(),
    };
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 7);
    col.set_halign(gtk4::Align::Center);
    let av = avatar_widget(&preset, 156);
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
                .margin_top(5)
                .build(),
        );
    }
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-plain", "pa-profile"])
        .valign(gtk4::Align::Start)
        .build();
    let (app, client, current, user_id) = (app.clone(), client.clone(), p.is_current, p.id.clone());
    b.connect_clicked(move |_| {
        if app.is_signing_out() {
            return;
        }
        if current {
            if !crate::profile_sessions::current_profile_action_allowed(&switching) {
                return;
            }
            if from_shell {
                app.nav.pop();
            } else {
                app.enter(client.clone());
            }
        } else {
            request_switch(
                app.clone(),
                client.clone(),
                user_id.clone(),
                switching.clone(),
                None,
                false,
                app.flow_generation(),
            );
        }
    });
    b
}

fn request_switch(
    app: Rc<App>,
    client: Client,
    user_id: String,
    switching: Rc<Cell<crate::profile_sessions::SwitchPhase>>,
    pin: Option<String>,
    from_pin_dialog: bool,
    flow_generation: u64,
) {
    if !crate::profile_sessions::begin_switch(&switching, from_pin_dialog) {
        return;
    }
    if flow_generation != app.flow_generation() {
        switching.set(crate::profile_sessions::SwitchPhase::Idle);
        return;
    }
    let active = client.session();
    let requested_pin = pin.clone();
    let id_for_work = user_id.clone();
    let flow = app.flow_generation.clone();
    super::bg(
        move || {
            crate::profile_sessions::switch_saved_profile(
                &active,
                &id_for_work,
                requested_pin.as_deref(),
                flow,
                flow_generation,
            )
        },
        move |result| match result {
            _ if app.flow_generation() != flow_generation => {
                switching.set(crate::profile_sessions::SwitchPhase::Idle);
            }
            Ok(session) => app.enter(Client::new(session)),
            Err(crate::profile_sessions::SwitchError::PinRequired) if pin.is_none() => {
                switching.set(crate::profile_sessions::SwitchPhase::AwaitingPin);
                ask_for_pin(app, client, user_id, switching, flow_generation);
            }
            Err(crate::profile_sessions::SwitchError::NotSaved) => {
                switching.set(crate::profile_sessions::SwitchPhase::Idle);
                app.show_link();
            }
            Err(error) => {
                switching.set(crate::profile_sessions::SwitchPhase::Idle);
                app.show_error(&error.to_string());
            }
        },
    );
}

fn ask_for_pin(
    app: Rc<App>,
    client: Client,
    user_id: String,
    switching: Rc<Cell<crate::profile_sessions::SwitchPhase>>,
    flow_generation: u64,
) {
    let dialog = adw::AlertDialog::new(Some("Unlock profile"), Some("Enter this profile’s PIN to switch."));
    dialog.add_responses(&[("cancel", "Cancel"), ("unlock", "Unlock")]);
    dialog.set_response_appearance("unlock", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("unlock"));
    dialog.set_close_response("cancel");
    let entry = gtk4::Entry::new();
    entry.set_visibility(false);
    entry.set_input_purpose(gtk4::InputPurpose::Password);
    entry.set_activates_default(true);
    let content = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    content.append(&entry);
    dialog.set_extra_child(Some(&content));
    app.pin_dialog.replace(Some(dialog.clone()));
    let app_for_response = app.clone();
    let client_for_response = client.clone();
    let id_for_response = user_id.clone();
    let switching_for_response = switching.clone();
    dialog.connect_response(None, move |dialog, response| {
        let pin = entry.text().to_string();
        dialog.force_close();
        app_for_response.pin_dialog.borrow_mut().take();
        if app_for_response.flow_generation() != flow_generation {
            switching_for_response.set(crate::profile_sessions::SwitchPhase::Idle);
            return;
        }
        if response == "unlock" && !pin.is_empty() {
            request_switch(
                app_for_response.clone(),
                client_for_response.clone(),
                id_for_response.clone(),
                switching_for_response.clone(),
                Some(pin),
                true,
                flow_generation,
            );
        } else {
            if switching_for_response.get() == crate::profile_sessions::SwitchPhase::AwaitingPin {
                switching_for_response.set(crate::profile_sessions::SwitchPhase::Idle);
            }
        }
    });
    dialog.present(Some(&app.window));
}

fn add_tile(app: &Rc<App>) -> gtk4::Button {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    let circle = gtk4::Box::builder()
        .css_classes(["pa-add-circle"])
        .halign(gtk4::Align::Center)
        // Bottom-aligned with the 162 px current avatar, as on the web.
        .margin_top(14)
        .build();
    circle.set_size_request(144, 144);
    let plus = icons::image("add", 28, Tone::Ink);
    // No vexpand: it would stretch the whole row and push Sign out to the page bottom.
    plus.set_hexpand(true);
    plus.set_valign(gtk4::Align::Center);
    circle.append(&plus);
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
            .margin_top(3)
            .build(),
    );
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-plain", "pa-profile"])
        .valign(gtk4::Align::Start)
        .build();
    let app = app.clone();
    b.connect_clicked(move |_| {
        if !app.is_signing_out() {
            app.show_link();
        }
    });
    b
}
