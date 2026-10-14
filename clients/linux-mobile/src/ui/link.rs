//! QR / device-code sign-in through the hosted link broker.
use super::{bg, App};
use crate::link::{self, Poll};
use crate::model::DeviceCode;
use crate::store::{self, Session};
use crate::{api, qr};
use gtk4::prelude::*;
use gtk4::{gio, glib};
use std::cell::Cell;
use std::rc::Rc;

pub fn build(app: Rc<App>) -> gtk4::Widget {
    let flow_generation = app.flow_generation();
    let root = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    root.add_css_class("pa-page");
    root.set_halign(gtk4::Align::Fill);
    root.set_margin_top(28);
    root.set_margin_bottom(28);
    root.set_margin_start(24);
    root.set_margin_end(24);

    let brand = gtk4::Label::builder()
        .label("PLAYARR")
        .css_classes(["pa-brand"])
        .xalign(0.5)
        .build();
    let title = gtk4::Label::builder()
        .label("Link this phone")
        .css_classes(["pa-title"])
        .xalign(0.5)
        .build();
    let hint = gtk4::Label::builder()
        .label("On another device, or in a browser here, open the link page and enter this code, or scan the QR.")
        .css_classes(["pa-body"])
        .wrap(true)
        .justify(gtk4::Justification::Center)
        .build();
    let qr_pic = gtk4::Picture::builder()
        .css_classes(["pa-qr"])
        .halign(gtk4::Align::Center)
        .width_request(216)
        .height_request(216)
        .build();
    qr_pic.set_content_fit(gtk4::ContentFit::Fill);
    let code_label = gtk4::Label::builder()
        .label("········")
        .css_classes(["pa-code"])
        .selectable(true)
        .build();
    let status = gtk4::Label::builder()
        .label("Getting a code…")
        .css_classes(["pa-muted"])
        .wrap(true)
        .build();
    let open = gtk4::Button::builder()
        .label("Open the link page")
        .css_classes(["pa-secondary"])
        .halign(gtk4::Align::Center)
        .sensitive(false)
        .build();
    let spinner = gtk4::Spinner::builder()
        .spinning(true)
        .halign(gtk4::Align::Center)
        .build();

    for w in [
        brand.upcast_ref::<gtk4::Widget>(),
        title.upcast_ref(),
        hint.upcast_ref(),
        qr_pic.upcast_ref(),
        code_label.upcast_ref(),
        spinner.upcast_ref(),
        status.upcast_ref(),
        open.upcast_ref(),
    ] {
        root.append(w);
    }
    let scroll = gtk4::ScrolledWindow::builder()
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .child(&root)
        .build();
    scroll.add_css_class("pa-page");

    let generation = Rc::new(Cell::new(0u32));
    let uri: Rc<std::cell::RefCell<String>> = Rc::default();
    {
        let uri = uri.clone();
        open.connect_clicked(move |_| {
            let _ = gio::AppInfo::launch_default_for_uri(&uri.borrow(), None::<&gio::AppLaunchContext>);
        });
    }

    struct Ui {
        app: Rc<App>,
        flow_generation: u64,
        generation: Rc<Cell<u32>>,
        qr_pic: gtk4::Picture,
        code_label: gtk4::Label,
        status: gtk4::Label,
        open: gtk4::Button,
        uri: Rc<std::cell::RefCell<String>>,
    }
    let ui = Rc::new(Ui {
        app,
        flow_generation,
        generation: generation.clone(),
        qr_pic,
        code_label,
        status,
        open,
        uri,
    });

    fn start(ui: Rc<Ui>) {
        if ui.app.flow_generation() != ui.flow_generation {
            return;
        }
        let gen = ui.generation.get() + 1;
        ui.generation.set(gen);
        let origin = link::broker_origin();
        let o2 = origin.clone();
        bg(
            move || link::request_code(&o2),
            move |res| match res {
                _ if ui.app.flow_generation() != ui.flow_generation => {}
                Ok(code) => show_code(ui, origin, code, gen),
                Err(e) => {
                    ui.status.set_label(&format!("{e} Retrying…"));
                    glib::timeout_add_local_once(std::time::Duration::from_secs(5), move || {
                        if ui.generation.get() == gen && ui.qr_pic.is_mapped() {
                            start(ui.clone());
                        }
                    });
                }
            },
        );
    }

    fn show_code(ui: Rc<Ui>, origin: String, code: DeviceCode, gen: u32) {
        ui.code_label.set_label(&code.user_code);
        ui.qr_pic
            .set_paintable(qr::texture(&code.verification_uri_complete, 6).as_ref());
        ui.uri.replace(code.verification_uri_complete.clone());
        ui.open.set_sensitive(true);
        ui.status.set_label("Waiting for approval…");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(code.expires_in + 30);
        let interval = std::time::Duration::from_secs(code.interval.max(2));
        tick(ui, origin, code.device_code, gen, deadline, interval);
    }

    fn tick(
        ui: Rc<Ui>,
        origin: String,
        device_code: String,
        gen: u32,
        deadline: std::time::Instant,
        interval: std::time::Duration,
    ) {
        glib::timeout_add_local_once(interval, move || {
            if ui.generation.get() != gen || ui.app.flow_generation() != ui.flow_generation {
                return;
            }
            if std::time::Instant::now() >= deadline {
                return start(ui);
            }
            let (o, d) = (origin.clone(), device_code.clone());
            bg(
                move || link::poll(&o, &d),
                move |res| {
                    if ui.generation.get() != gen || ui.app.flow_generation() != ui.flow_generation {
                        return;
                    }
                    match res {
                        Ok(Poll::Pending) => tick(ui, origin, device_code, gen, deadline, interval),
                        Ok(Poll::Expired) => start(ui),
                        Ok(Poll::Claimed(claim)) => {
                            ui.status.set_label("Approved. Signing in…");
                            let c2 = claim.clone();
                            bg(
                                move || link::exchange(&c2),
                                move |tok| match tok {
                                    Ok(t) => {
                                        if ui.app.flow_generation() != ui.flow_generation {
                                            return;
                                        }
                                        let device_id = store::jwt_claim(&t.access_token, "device_id")
                                            .unwrap_or_else(store::new_device_id);
                                        let session = Session {
                                            server_url: claim.server_url,
                                            access_token: t.access_token,
                                            refresh_token: t.refresh_token,
                                            device_id,
                                        };
                                        ui.status.set_label("Saving profile session…");
                                        let flow = ui.app.flow_generation.clone();
                                        let expected = ui.flow_generation;
                                        let session_to_save = session.clone();
                                        let ui_after_save = ui.clone();
                                        bg(
                                            move || {
                                                crate::profile_sessions::save_link_session(
                                                    &session_to_save,
                                                    flow,
                                                    expected,
                                                )
                                                .map_err(|error| error.to_string())
                                            },
                                            move |saved| {
                                                if ui_after_save.app.flow_generation() != ui_after_save.flow_generation
                                                {
                                                    return;
                                                }
                                                match saved {
                                                    Ok(()) => {
                                                        ui_after_save
                                                            .generation
                                                            .set(ui_after_save.generation.get() + 1);
                                                        ui_after_save.app.signed_in(api::Client::new(session));
                                                    }
                                                    Err(error) => ui_after_save.status.set_label(&format!(
                                                        "Could not save this profile safely: {error}"
                                                    )),
                                                }
                                            },
                                        );
                                    }
                                    Err(e) => {
                                        ui.status.set_label(&format!("{e} Getting a new code…"));
                                        start(ui);
                                    }
                                },
                            );
                        }
                        Err(_) => tick(ui, origin, device_code, gen, deadline, interval),
                    }
                },
            );
        });
    }

    start(ui);
    scroll.upcast()
}
