//! GTK/libadwaita user interface. Pages: link (sign-in), profiles, then the signed-in shell.
pub mod link;
pub mod profiles;

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

pub struct App {
    pub window: adw::ApplicationWindow,
    pub stack: gtk4::Stack,
    pub client: RefCell<Option<Client>>,
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
        let page = profiles::build(self.clone(), client);
        self.show("profiles", &page);
    }

    /// The signed-in shell (replaced by the tabbed shell in the next change).
    pub fn enter(self: &Rc<Self>, _client: Client) {
        let page = gtk4::Box::new(gtk4::Orientation::Vertical, 12);
        page.add_css_class("pa-page");
        page.set_valign(gtk4::Align::Center);
        page.append(
            &gtk4::Label::builder()
                .label("Signed in")
                .css_classes(["pa-title"])
                .build(),
        );
        self.show("shell", &page);
    }

    pub fn sign_out(self: &Rc<Self>) {
        store::clear_session();
        self.show_link();
    }
}

pub fn build_window(app: &adw::Application) {
    let stack = gtk4::Stack::builder()
        .transition_type(gtk4::StackTransitionType::Crossfade)
        .build();
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
        client: RefCell::new(None),
    });
    state.start();
    window.present();
}
