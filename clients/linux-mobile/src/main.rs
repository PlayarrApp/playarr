#![allow(dead_code)] // client surface lands over several changes; remove once every API call is used
mod api;
mod avatar;
mod caps;
mod downloads;
mod icons;
mod layout;
mod link;
mod model;
mod mpris;
mod profile_sessions;
mod proxy;
mod qr;
mod store;
mod theme;
mod ui;

use gtk4::prelude::*;
use libadwaita as adw;

const APP_ID: &str = "app.playarr.Mobile";

fn main() -> gtk4::glib::ExitCode {
    // Parity captures only: PLAYARR_PARITY_CLOCK pins "today" and the suite's timezone is UTC.
    // `PLAYARR_PARITY_NOW` and `--parity-now=<ISO>` are aliases of PLAYARR_PARITY_CLOCK; the control route `parityNow=<ISO>` sets it later.
    let arg_now = std::env::args().find_map(|a| a.strip_prefix("--parity-now=").map(str::to_owned));
    if let Some(now) = arg_now.or_else(|| std::env::var("PLAYARR_PARITY_NOW").ok()) {
        std::env::set_var("PLAYARR_PARITY_CLOCK", now);
    }
    if std::env::var_os("PLAYARR_PARITY_CLOCK").is_some() {
        std::env::set_var("TZ", "UTC");
    }
    if let Err(e) = gstreamer::init() {
        eprintln!("GStreamer failed to start: {e}");
    }
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_startup(|_| theme::apply(&store::load_settings().theme));
    app.connect_activate(ui::build_window);
    app.run()
}
