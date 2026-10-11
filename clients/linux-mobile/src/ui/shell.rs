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
    let row = gtk4::Box::builder().spacing(2).build();

    // Profile avatar first.
    let me = gtk4::Button::builder()
        .css_classes(["pa-navbtn"])
        .tooltip_text("Profile")
        .build();
    me.set_child(Some(&profiles::avatar_widget(
        &preset.unwrap_or_else(|| "alien".into()),
        28,
    )));
    {
        let (app, client) = (app.clone(), client.clone());
        me.connect_clicked(move |_| app.push_profiles(client.clone()));
    }
    row.append(&me);

    struct Item {
        name: String,
        button: gtk4::Button,
        icon: gtk4::Image,
    }
    let items: Rc<Vec<Item>> = Rc::new(
        tabs.iter()
            .map(|(name, page)| {
                pages.add_named(page, Some(name));
                let icon = icons::image(name, 22, Tone::Soft);
                let button = gtk4::Button::builder()
                    .css_classes(["pa-navbtn"])
                    .tooltip_text(name.to_string())
                    .child(&icon)
                    .build();
                row.append(&button);
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
    let select = {
        let (pages, items, nav_scroll) = (pages.clone(), items.clone(), nav_scroll.clone());
        Rc::new(move |name: &str| {
            pages.set_visible_child_name(name);
            for it in items.iter() {
                let active = it.name == name;
                if active {
                    it.button.add_css_class("active");
                    // Keep the active tile in view when the strip is wider than the screen.
                    let adj = nav_scroll.hadjustment();
                    let idx = items.iter().position(|i| i.name == name).unwrap_or(0) as f64;
                    let (page, tile) = (adj.page_size(), 44.0);
                    let (left, right) = ((idx + 1.0) * tile, (idx + 2.0) * tile);
                    // Before the first layout the page size is 0; leave the strip at its start.
                    if page > 0.0 {
                        if right <= page {
                            adj.set_value(0.0);
                        } else if left < adj.value() {
                            adj.set_value(left - 8.0);
                        } else if right > adj.value() + page {
                            adj.set_value((right - page + 8.0).clamp(0.0, (adj.upper() - page).max(0.0)));
                        }
                    }
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
