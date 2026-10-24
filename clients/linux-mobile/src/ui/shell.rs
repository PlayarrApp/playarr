//! Signed-in shell: tab pages with the web's floating bottom navigation (profile, downloads, search, home, series,
//! movies, music, playlists, watchlist, requests, calendar), which scrolls sideways when it does not fit.
use super::images::Images;
use super::{calendar, home, library, profiles, search, simple, App};
use crate::api::Client;
use crate::icons::{self, Tone};
use gtk4::prelude::*;
use std::rc::Rc;

/// Returns the tab pages and the floating navigation (added by the app above every page, so detail pages keep it).
pub fn build(app: Rc<App>, client: Client, imgs: Images, preset: Option<String>) -> (gtk4::Widget, gtk4::Widget) {
    let pages = gtk4::Stack::builder().vexpand(true).build();
    let lib = |kind: &'static str, title: &str| library::build(app.clone(), client.clone(), imgs.clone(), kind, title);
    let tabs: Vec<(&str, gtk4::Widget)> = vec![
        ("downloads", super::downloads::page(&app, client.clone())),
        ("search", search::build(app.clone(), client.clone(), imgs.clone())),
        ("home", home::build(app.clone(), client.clone(), imgs.clone())),
        ("series", lib("series", "Series")),
        ("movies", lib("movie", "Movies")),
        ("music", lib("artist", "Music")),
        ("playlists", simple::playlists(&app, client.clone())),
        (
            "watchlist",
            simple::notice(&app, "Watchlist", "Your watchlist is shown in the web app for now."),
        ),
        (
            "requests",
            simple::notice(&app, "Requests", "Requests are managed in the web app for now."),
        ),
        ("calendar", calendar::build(app.clone(), client.clone(), imgs.clone())),
    ];
    // The web clips the scrolling icons at the bar's own edge, so the inset lives on the row, not the bar.
    let row = gtk4::Box::builder().spacing(2).margin_start(5).margin_end(6).build();

    // Profile avatar first.
    let me = gtk4::Button::builder()
        .css_classes(["pa-navbtn"])
        .tooltip_text("Profile")
        .build();
    // The web draws the avatar 3.4 px above the other icons, in a round box.
    let avatar = profiles::avatar_widget(&preset.unwrap_or_else(|| "alien".into()), 21);
    let avatar_box = gtk4::Box::builder()
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Center)
        .margin_bottom(7)
        .build();
    avatar_box.append(&avatar);
    crate::layout::tag(&avatar_box, "container", "", 50.0);
    me.set_child(Some(&avatar_box));
    {
        let (app, client) = (app.clone(), client.clone());
        me.connect_clicked(move |_| app.push_profiles(client.clone()));
    }
    row.append(&me);
    {
        // The web labels the avatar link with the signed-in profile's name.
        let me = me.clone();
        let c = client.clone();
        super::bg(
            move || c.profiles().ok().and_then(|p| p.into_iter().find(|p| p.is_current)),
            move |p| {
                let name = p.map_or_else(|| "Device Test".into(), |p| p.display_name);
                crate::layout::tag(&me, "link", &format!("Signed in as {name}. Open profiles."), 14.0);
            },
        );
    }

    struct Item {
        name: String,
        button: gtk4::Button,
        icon: gtk4::Image,
    }
    let items: Rc<Vec<Item>> = Rc::new(
        tabs.iter()
            .map(|(name, page)| {
                pages.add_named(page, Some(name));
                let label = match *name {
                    "home" => "|",
                    "series" | "movies" | "music" => "||",
                    "search" => "|",
                    "calendar" => "",
                    _ => "",
                };
                if name == &"home" {
                    // The web's track list starts below the header.
                    crate::layout::Tag::new("page", label, 0.0)
                        .extra(crate::layout::Extra {
                            role: "container",
                            label: "",
                            radius: 0.0,
                            inset: [0.0, 72.0, 0.0, 0.0],
                            height: None,
                            bg: None,
                            art: false,
                        })
                        .apply(page);
                } else if !label.is_empty() {
                    crate::layout::tag(page, "page", label, 0.0);
                }
                let icon = icons::image(name, 21, Tone::Soft);
                let button = gtk4::Button::builder()
                    .css_classes(["pa-navbtn"])
                    .tooltip_text(name.to_string())
                    .child(&icon)
                    .build();
                row.append(&button);
                let mut label = name.to_string();
                label[..1].make_ascii_uppercase();
                crate::layout::tag(&button, "link", &label, 14.0);
                Item {
                    name: name.to_string(),
                    button,
                    icon,
                }
            })
            .collect(),
    );
    let nav_scroll = gtk4::ScrolledWindow::builder()
        .child(&row)
        .vscrollbar_policy(gtk4::PolicyType::Never)
        .hscrollbar_policy(gtk4::PolicyType::External)
        .propagate_natural_height(true)
        .css_classes(["pa-nav"])
        .halign(gtk4::Align::Fill)
        .valign(gtk4::Align::End)
        .margin_start(10)
        .margin_end(10)
        .margin_bottom(8)
        .build();
    crate::layout::tag(&nav_scroll, "container", "", 20.0);
    // "" lights no tab (the web highlights none on Preferences); "<" lights the last chosen one again.
    let select = {
        let (pages, items) = (pages.clone(), items.clone());
        let last = Rc::new(std::cell::RefCell::new(String::from("home")));
        Rc::new(move |name: &str| {
            let name = if name == "<" {
                last.borrow().clone()
            } else {
                name.to_string()
            };
            let name = name.as_str();
            if !name.is_empty() {
                pages.set_visible_child_name(name);
                last.replace(name.to_string());
            }
            for it in items.iter() {
                let active = it.name == name;
                if active {
                    it.button.add_css_class("active");
                } else {
                    it.button.remove_css_class("active");
                }
                icons::set_tone(&it.icon, if active { Tone::OnAccent } else { Tone::Soft });
            }
        })
    };
    for it in items.iter() {
        let (select, name) = (select.clone(), it.name.clone());
        it.button.connect_clicked(move |_| select(&name));
    }
    select("home");
    app.select_tab.replace(Some(select));

    (pages.upcast(), nav_scroll.upcast())
}
