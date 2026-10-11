#![allow(dead_code)] // client surface lands over several changes; remove once every API call is used
mod api;
mod avatar;
mod icons;
mod link;
mod model;
mod mpris;
mod proxy;
mod qr;
mod store;
mod theme;
mod ui;

use gtk4::prelude::*;
use libadwaita as adw;

const APP_ID: &str = "app.playarr.Mobile";

fn main() -> gtk4::glib::ExitCode {
    if let Err(e) = gstreamer::init() {
        eprintln!("GStreamer failed to start: {e}");
    }
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_startup(|_| theme::apply(&store::load_settings().theme));
    app.connect_activate(ui::build_window);
    app.run()
}
