//! GTK/libadwaita user interface. Pages: link (sign-in), profiles, then the signed-in shell.
pub mod cards;
pub mod detail;
pub mod home;
pub mod images;
pub mod library;
pub mod link;
pub mod player;
pub mod profiles;
pub mod search;
pub mod settings;
pub mod shell;

use crate::api::Client;
use crate::store;
use gtk4::prelude::*;
use gtk4::{gio, glib};
use libadwaita as adw;
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

pub struct App {
    pub window: adw::ApplicationWindow,
    pub stack: gtk4::Stack,
    pub nav: adw::NavigationView,
    pub client: RefCell<Option<Client>>,
    pub proxy: RefCell<Option<crate::proxy::Proxy>>,
    /// Switches the shell tab by name (set by the shell).
    pub select_tab: RefCell<Option<TabSelector>>,
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
            Some(s) if std::env::var("PLAYARR_ROUTE").is_ok() => self.enter(Client::new(s)),
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
        let imgs = images::Images::new(client.clone());
        let (me, c2) = (self.clone(), client.clone());
        bg(
            move || c2.avatar_preset(),
            move |preset| {
                let root = adw::NavigationPage::builder()
                    .title("Playarr")
                    .child(&shell::build(me.clone(), client, imgs, preset))
                    .build();
                me.nav.replace(&[root]);
                me.show("shell", &me.nav);
                if let Ok(route) = std::env::var("PLAYARR_ROUTE") {
                    me.route(&route);
                }
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
        self.push_page("Profiles", &profiles::build(self.clone(), client, true));
    }

    pub fn push_settings(self: &Rc<Self>, client: Client) {
        self.push_page("Settings", &settings::build(self.clone(), client));
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
        self.push_page(&work.title, &page);
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
        self.push_bare(&req.title.clone(), &player::build(self.clone(), client, req));
    }

    /// Opens a screen straight away: `home`, `movies`, `series`, `search`, `film`, `series-detail`, `player`,
    /// `profiles`, `settings`. Used by the parity capture scripts through `PLAYARR_ROUTE`.
    pub fn route(self: &Rc<Self>, route: &str) {
        let Some(client) = self.client.borrow().clone() else {
            return;
        };
        let select = self.select_tab.borrow().clone();
        match route {
            "home" | "movies" | "series" | "search" => {
                if let Some(f) = select {
                    f(route)
                }
            }
            "profiles" => self.push_profiles(client),
            "settings" => self.push_settings(client),
            "film" | "series-detail" | "player" => {
                let kind = if route == "series-detail" { "series" } else { "movie" };
                let (me, c) = (self.clone(), client.clone());
                let route = route.to_string();
                bg(
                    move || {
                        c.catalog(kind, 0, 1, "title")
                            .ok()
                            .and_then(|p| p.items.into_iter().next())
                    },
                    move |w| {
                        let Some(w) = w else { return };
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

    pub fn sign_out(self: &Rc<Self>) {
        store::clear_session();
        self.show_link();
    }
}

pub fn build_window(app: &adw::Application) {
    let stack = gtk4::Stack::builder().build();
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Playarr")
        .default_width(360)
        .default_height(720)
        .content(&stack)
        .build();
    let state = Rc::new(App {
        window: window.clone(),
        stack,
        nav: adw::NavigationView::new(),
        client: RefCell::new(None),
        proxy: RefCell::new(None),
        select_tab: RefCell::new(None),
    });
    state.start();
    window.present();
}
