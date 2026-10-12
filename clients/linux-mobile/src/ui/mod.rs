//! GTK/libadwaita user interface. Pages: link (sign-in), profiles, then the signed-in shell.
pub mod actions;
pub mod calendar;
pub mod cards;
pub mod detail;
pub mod downloads;
pub mod header;
pub mod home;
pub mod images;
pub mod library;
pub mod link;
pub mod player;
pub mod profiles;
pub mod search;
pub mod settings;
pub mod shell;
pub mod simple;

use crate::api::Client;
use crate::store;
use gtk4::prelude::*;
use gtk4::{gio, glib};
use libadwaita as adw;
use libadwaita::prelude::*;
use std::cell::RefCell;
use std::rc::Rc;

/// Runs `work` on a worker thread and `done` on the GTK main loop with its result.
pub fn bg<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static, done: impl FnOnce(T) + 'static) {
    glib::spawn_future_local(async move {
        if let Ok(v) = gio::spawn_blocking(work).await {
            done(v);
        }
    });
}

type TabSelector = Rc<dyn Fn(&str)>;
type Hooks = RefCell<std::collections::HashMap<&'static str, TabSelector>>;

pub struct App {
    pub window: adw::ApplicationWindow,
    pub stack: gtk4::Stack,
    pub nav: adw::NavigationView,
    pub client: RefCell<Option<Client>>,
    pub proxy: RefCell<Option<crate::proxy::Proxy>>,
    /// Switches the shell tab by name (set by the shell).
    pub select_tab: RefCell<Option<TabSelector>>,
    /// Debug hooks registered by pages (search text, calendar view, filters sheet) for the capture scripts.
    pub hooks: Hooks,
    /// The sheet currently shown, so a capture route can dismiss it.
    /// Full-window layer above the pages, where side panels (filters, actions) open.
    pub layer: gtk4::Overlay,
    pub panel: RefCell<Option<gtk4::Widget>>,
    pub nav_bar: RefCell<Option<gtk4::Widget>>,
    pub mpris: crate::mpris::Mpris,
    /// Watch state per work id (from the progress list) for the unseen dot.
    pub watch: RefCell<std::collections::HashMap<String, String>>,
}

impl App {
    pub fn show(self: &Rc<Self>, name: &str, page: &impl IsA<gtk4::Widget>) {
        if let Some(old) = self.stack.child_by_name(name) {
            self.stack.remove(&old);
        }
        self.stack.add_named(page, Some(name));
        self.stack.set_visible_child_name(name);
    }

    /// Entry after launch: a saved session goes to the profile picker, otherwise the link page.
    pub fn start(self: &Rc<Self>) {
        match store::load_session() {
            Some(s) if std::env::var("PLAYARR_ROUTE").is_ok() || std::env::var("PLAYARR_CONTROL").is_ok() => {
                self.enter(Client::new(s))
            }
            Some(s) => self.signed_in(Client::new(s)),
            None => self.show_link(),
        }
    }

    pub fn show_link(self: &Rc<Self>) {
        self.client.replace(None);
        let page = link::build(self.clone());
        self.show("link", &page);
    }

    pub fn signed_in(self: &Rc<Self>, client: Client) {
        self.client.replace(Some(client.clone()));
        let page = profiles::build(self.clone(), client, false);
        self.show("profiles", &page);
    }

    /// The signed-in shell: tab pages in a navigation view that detail pages push onto.
    pub fn enter(self: &Rc<Self>, client: Client) {
        self.client.replace(Some(client.clone()));
        let app = self.clone();
        cards::set_actions_handler(move |w| actions::show(&app, w));
        downloads::init(self, client.clone());
        let imgs = images::Images::new(client.clone());
        let (me, c2) = (self.clone(), client.clone());
        bg(
            move || (c2.avatar_preset(), c2.all_progress().unwrap_or_default()),
            move |(preset, progress)| {
                me.watch
                    .replace(progress.into_iter().map(|p| (p.work_id, p.state)).collect());
                let (pages, nav_bar) = shell::build(me.clone(), client, imgs, preset);
                let root = adw::NavigationPage::builder().title("Playarr").child(&pages).build();
                me.nav.replace(&[root]);
                me.show("shell", &me.nav);
                me.layer.add_overlay(&nav_bar);
                me.nav_bar.replace(Some(nav_bar));
                // The player is full screen: hide the navigation while it is the visible page.
                let m2 = me.clone();
                me.nav.connect_visible_page_notify(move |n| {
                    let player = matches!(
                        n.visible_page().and_then(|p| p.tag()).as_deref(),
                        Some("player" | "profiles")
                    );
                    if let Some(b) = m2.nav_bar.borrow().as_ref() {
                        b.set_visible(!player);
                    }
                });
                if let Ok(route) = std::env::var("PLAYARR_ROUTE") {
                    me.route(&route);
                }
                me.watch_control();
            },
        );
    }

    /// Pushes a page under a flat header bar (libadwaita adds the back button).
    pub fn push_page(&self, title: &str, child: &impl IsA<gtk4::Widget>) {
        let bar = adw::HeaderBar::builder().css_classes(["flat", "pa-header"]).build();
        bar.set_title_widget(Some(
            &gtk4::Label::builder()
                .label(title)
                .css_classes(["pa-h2"])
                .ellipsize(gtk4::pango::EllipsizeMode::End)
                .build(),
        ));
        let view = adw::ToolbarView::new();
        view.add_top_bar(&bar);
        view.set_content(Some(child));
        self.nav
            .push(&adw::NavigationPage::builder().title(title).child(&view).build());
    }

    /// Pushes a page that draws its own chrome (the player).
    pub fn push_bare(&self, title: &str, child: &impl IsA<gtk4::Widget>) {
        self.nav
            .push(&adw::NavigationPage::builder().title(title).child(child).build());
    }

    pub fn push_profiles(self: &Rc<Self>, client: Client) {
        let page = adw::NavigationPage::builder()
            .title("Profiles")
            .tag("profiles")
            .child(&profiles::build(self.clone(), client, true))
            .build();
        self.nav.push(&page);
    }

    pub fn push_settings(self: &Rc<Self>, client: Client) {
        self.push_bare("Settings", &settings::build(self.clone(), client));
    }

    pub fn open_work(self: &Rc<Self>, work: &crate::model::Work) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let page = detail::build(
            self.clone(),
            client.clone(),
            images::Images::new(client),
            work.id.clone(),
        );
        self.push_bare(&work.title, &page);
    }

    pub fn proxy_port(&self) -> Option<u16> {
        self.proxy.borrow().as_ref().map(|p| p.port)
    }

    pub fn play(self: &Rc<Self>, req: player::PlayRequest) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        if self.proxy.borrow().is_none() {
            self.proxy.replace(crate::proxy::Proxy::start(client.clone()).ok());
        }
        let page = adw::NavigationPage::builder()
            .title(&req.title)
            .tag("player")
            .child(&player::build(self.clone(), client, req))
            .build();
        self.nav.push(&page);
    }

    /// Opens a full-window side panel like the web's drawers: small kicker, title, round close button, then `body`.
    /// `close_primary` draws the close button white (Filters) instead of soft (title actions).
    pub fn present_panel(
        self: &Rc<Self>,
        kicker: &str,
        title: &str,
        body: &impl IsA<gtk4::Widget>,
        close_primary: bool,
    ) {
        self.close_panel();
        let panel = gtk4::Box::builder()
            .orientation(gtk4::Orientation::Vertical)
            .css_classes(["pa-panel"])
            .build();
        let head = gtk4::Box::builder()
            .spacing(10)
            .margin_top(20)
            .margin_start(20)
            .margin_end(20)
            .margin_bottom(25)
            .build();
        let block = gtk4::Box::builder()
            .orientation(gtk4::Orientation::Vertical)
            .hexpand(true)
            .spacing(5)
            .valign(gtk4::Align::Start)
            .build();
        block.append(
            &gtk4::Label::builder()
                .label(kicker.to_uppercase())
                .css_classes(["pa-panel-kicker"])
                .xalign(0.0)
                .build(),
        );
        block.append(
            &gtk4::Label::builder()
                .label(title)
                .css_classes(["pa-panel-title"])
                .xalign(0.0)
                .ellipsize(gtk4::pango::EllipsizeMode::End)
                .build(),
        );
        let close = gtk4::Button::builder()
            .css_classes(if close_primary {
                vec!["pa-close"]
            } else {
                vec!["pa-close", "soft"]
            })
            .valign(gtk4::Align::Start)
            .build();
        close.set_child(Some(&crate::icons::image(
            "close",
            14,
            if close_primary {
                crate::icons::Tone::OnAccent
            } else {
                crate::icons::Tone::Ink
            },
        )));
        let me = self.clone();
        close.connect_clicked(move |_| me.close_panel());
        head.append(&block);
        head.append(&close);
        panel.append(&head);
        body.set_margin_start(20);
        body.set_margin_end(20);
        panel.append(
            &gtk4::ScrolledWindow::builder()
                .child(body)
                .vexpand(true)
                .hscrollbar_policy(gtk4::PolicyType::Never)
                .build(),
        );
        self.layer.add_overlay(&panel);
        // The navigation stays on top of the panel, as on the web (the title actions sheet covers it: `cover_nav`).
        if let Some(nb) = self.nav_bar.borrow().as_ref() {
            self.layer.remove_overlay(nb);
            self.layer.add_overlay(nb);
        }
        self.panel.replace(Some(panel.upcast()));
    }

    /// Lifts the open panel above the navigation.
    pub fn cover_nav(&self) {
        if let Some(p) = self.panel.borrow().as_ref() {
            self.layer.remove_overlay(p);
            self.layer.add_overlay(p);
        }
    }

    pub fn close_panel(&self) {
        if let Some(p) = self.panel.take() {
            self.layer.remove_overlay(&p);
        }
    }

    fn hook(&self, name: &str, arg: &str) {
        let f = self.hooks.borrow().get(name).cloned();
        if let Some(f) = f {
            f(arg);
        }
    }

    /// Opens a screen straight away (`name` or `name:argument`): `home`, `movies`, `series`, `music`,
    /// `search:<text>`, `calendar-agenda|week|month`, `film`, `series-detail`, `player`, `profiles`, `settings`,
    /// `filters`, `actions`, `play:<media file id>`, `theme:dark|light|system`. Used by the parity capture scripts through `PLAYARR_ROUTE` and `PLAYARR_CONTROL`.
    pub fn route(self: &Rc<Self>, route: &str) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        self.close_panel();
        while self.nav.navigation_stack().n_items() > 1 {
            self.nav.pop();
        }
        let (name, arg) = route.split_once(':').unwrap_or((route, ""));
        let select = |tab: &str| {
            if let Some(f) = self.select_tab.borrow().clone() {
                f(tab)
            }
        };
        match name {
            "home" | "movies" | "series" | "music" => select(name),
            "search" => {
                select("search");
                self.hook("search", arg);
            }
            "calendar-agenda" | "calendar-week" | "calendar-month" => {
                select("calendar");
                self.hook("calendar-view", name.trim_start_matches("calendar-"));
            }
            "filters" => {
                select("movies");
                self.hook("filters", "");
            }
            "actions" => {
                let (me, c) = (self.clone(), client.clone());
                bg(
                    move || {
                        c.catalog("movie", 0, 200, "title")
                            .ok()
                            .and_then(|p| p.items.into_iter().min_by_key(|w| library::natural_key(&w.title)))
                    },
                    move |w| {
                        if let Some(w) = w {
                            actions::show(&me, &w);
                        }
                    },
                );
            }
            "theme" => {
                store::update_settings(|s| s.theme = arg.into());
                crate::theme::apply(arg);
            }
            "dl" => downloads::control(self, arg),
            "play" if !arg.is_empty() => self.play(player::PlayRequest {
                media_file_id: arg.into(),
                start_ms: 0,
                title: String::new(),
                art_work_id: None,
                local_file: None,
            }),
            "profiles" => self.push_profiles(client),
            "settings" => self.push_settings(client),
            "settings-player" => {
                self.push_settings(client);
                self.hook("settings-player", "");
            }
            "film" | "series-detail" | "player" => {
                let kind = if name == "series-detail" { "series" } else { "movie" };
                let (me, c) = (self.clone(), client.clone());
                let route = name.to_string();
                let pinned = arg.to_string();
                bg(
                    move || {
                        // `film:<work id>` opens that title directly (one request); without an id, the first title by name.
                        if !pinned.is_empty() {
                            return c.work(&pinned).ok().map(|d| d.work);
                        }
                        c.catalog(kind, 0, 200, "title")
                            .ok()
                            .and_then(|p| p.items.into_iter().min_by_key(|w| library::natural_key(&w.title)))
                    },
                    move |w| {
                        let Some(w) = w else { return };
                        if let Some(f) = me.select_tab.borrow().clone() {
                            f(if route == "series-detail" { "series" } else { "movies" })
                        }
                        if route == "player" {
                            let c = client.clone();
                            let (me2, id, title) = (me.clone(), w.id.clone(), w.title.clone());
                            bg(
                                move || c.work(&id).ok().and_then(|d| d.media_file_id),
                                move |file| {
                                    if let Some(f) = file {
                                        me2.play(player::PlayRequest {
                                            media_file_id: f,
                                            start_ms: 0,
                                            title,
                                            art_work_id: None,
                                            local_file: None,
                                        });
                                    }
                                },
                            );
                        } else {
                            me.open_work(&w);
                        }
                    },
                );
            }
            _ => {}
        }
    }

    /// With `PLAYARR_CONTROL=<file>`, a route written to the file is opened and the file removed.
    fn watch_control(self: &Rc<Self>) {
        let Ok(path) = std::env::var("PLAYARR_CONTROL") else {
            return;
        };
        let me = self.clone();
        glib::timeout_add_local(std::time::Duration::from_secs(1), move || {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let _ = std::fs::remove_file(&path);
                me.route(text.trim());
            }
            glib::ControlFlow::Continue
        });
    }

    /// The web's red dot: a title with no watch progress yet.
    pub fn is_unseen(&self, w: &crate::model::Work) -> bool {
        matches!(w.kind.as_str(), "movie" | "series")
            && self.watch.borrow().get(&w.id).map(|s| s == "unseen").unwrap_or(true)
    }

    /// Header back control: pop a pushed page, otherwise return to Home.
    pub fn go_back(self: &Rc<Self>) {
        if self.nav.navigation_stack().n_items() > 1 {
            self.nav.pop();
        } else if let Some(f) = self.select_tab.borrow().clone() {
            f("home");
        }
    }

    pub fn sign_out(self: &Rc<Self>) {
        store::clear_session();
        self.show_link();
    }
}

pub fn build_window(app: &adw::Application) {
    let stack = gtk4::Stack::builder().build();
    let layer = gtk4::Overlay::builder().child(&stack).build();
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Playarr")
        .default_width(360)
        .default_height(720)
        .content(&layer)
        .build();
    let state = Rc::new(App {
        window: window.clone(),
        stack,
        nav: adw::NavigationView::new(),
        client: RefCell::new(None),
        proxy: RefCell::new(None),
        select_tab: RefCell::new(None),
        hooks: RefCell::default(),
        layer,
        panel: RefCell::new(None),
        nav_bar: RefCell::new(None),
        mpris: crate::mpris::Mpris::start(),
        watch: RefCell::default(),
    });
    state.start();
    window.present();
}
