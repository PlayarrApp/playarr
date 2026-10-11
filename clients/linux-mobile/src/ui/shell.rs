//! Signed-in shell: tab pages with the floating bottom navigation pill.
use super::images::Images;
use super::{home, library, profiles, search, App};
use crate::api::Client;
use crate::avatar;
use gtk4::prelude::*;
use std::rc::Rc;

pub fn build(app: Rc<App>, client: Client, imgs: Images, preset: Option<String>) -> gtk4::Widget {
    let pages = gtk4::Stack::builder().vexpand(true).build();
    let tabs: [(&str, &str, gtk4::Widget); 4] = [
        (
            "search",
            "system-search-symbolic",
            search::build(app.clone(), client.clone(), imgs.clone()),
        ),
        (
            "home",
            "go-home-symbolic",
            home::build(app.clone(), client.clone(), imgs.clone()),
        ),
        (
            "movies",
            "video-x-generic-symbolic",
            library::build(app.clone(), client.clone(), imgs.clone(), "movie", "Movies"),
        ),
        (
            "series",
            "video-display-symbolic",
            library::build(app.clone(), client.clone(), imgs.clone(), "series", "Series"),
        ),
    ];
    let nav = gtk4::Box::builder()
        .css_classes(["pa-nav"])
        .spacing(4)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::End)
        .margin_bottom(14)
        .build();

    // Profile avatar first, as on the web's phone navigation.
    let me = gtk4::Button::builder().tooltip_text("Profile").build();
    let preset = preset.unwrap_or_else(|| "alien".into());
    me.set_child(Some(&profiles::avatar_widget(&preset, 32)));
    {
        let (app, client) = (app.clone(), client.clone());
        me.connect_clicked(move |_| app.push_profiles(client.clone()));
    }
    nav.append(&me);

    let buttons: Rc<Vec<(String, gtk4::Button)>> = Rc::new(
        tabs.iter()
            .map(|(name, icon, page)| {
                pages.add_named(page, Some(name));
                (
                    name.to_string(),
                    gtk4::Button::builder()
                        .icon_name(*icon)
                        .tooltip_text(name.to_string())
                        .build(),
                )
            })
            .collect(),
    );
    let select = {
        let (pages, buttons) = (pages.clone(), buttons.clone());
        Rc::new(move |name: &str| {
            pages.set_visible_child_name(name);
            for (n, b) in buttons.iter() {
                if n == name {
                    b.add_css_class("active");
                } else {
                    b.remove_css_class("active");
                }
            }
        })
    };
    for (name, b) in buttons.iter() {
        nav.append(b);
        let (select, name) = (select.clone(), name.clone());
        b.connect_clicked(move |_| select(&name));
    }
    select("home");
    app.select_tab.replace(Some(select));

    let overlay = gtk4::Overlay::builder().child(&pages).build();
    overlay.add_overlay(&nav);
    let _ = avatar::PRESETS;
    overlay.upcast()
}
