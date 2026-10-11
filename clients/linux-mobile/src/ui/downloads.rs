//! Downloads: the manager that runs the transfers and keeps the freedesktop notifications, and the Downloads tab.
use super::{bg, header, App};
use crate::api::Client;
use crate::downloads::{self as core, Control, Item, Outcome, State};
use gtk4::prelude::*;
use gtk4::{gio, glib};
use libadwaita as adw;
use libadwaita::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// Device storage the downloads may use, as the web shows it.
const QUOTA: u64 = 10_000_000_000;

/// What the user asked to download.
pub struct Spec {
    pub media_file_id: String,
    pub work_id: String,
    pub title: String,
    pub series_title: Option<String>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
}

/// Keep-until choices in days; `None` keeps the file until it is deleted.
const KEEP: [(&str, Option<i64>); 4] = [
    ("Until I delete it", None),
    ("1 day", Some(1)),
    ("7 days", Some(7)),
    ("30 days", Some(30)),
];

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

type ViewFn = Rc<dyn Fn(bool)>;

#[derive(Default)]
struct Manager {
    items: RefCell<Vec<Item>>,
    ctl: RefCell<HashMap<String, Arc<Control>>>,
    /// Items waiting for their worker to stop before they restart at another quality.
    restart: RefCell<HashMap<String, (String, String)>>,
    /// Last text sent per notification id, so an unchanged one is not sent again.
    sent: RefCell<HashMap<String, String>>,
    client: RefCell<Option<Client>>,
    app: RefCell<Weak<App>>,
    /// Redraws the Downloads tab; called with `true` when the list structure changed.
    view: RefCell<Option<ViewFn>>,
    last_sig: RefCell<String>,
}

thread_local! {
    static MGR: Rc<Manager> = Rc::new(Manager::default());
}

fn mgr() -> Rc<Manager> {
    MGR.with(|m| m.clone())
}

/// Called once after sign-in: loads the saved list, registers the notification actions and starts the 1 s tick.
pub fn init(app: &Rc<App>, client: Client) {
    let m = mgr();
    let first = m.client.replace(Some(client)).is_none();
    m.app.replace(Rc::downgrade(app));
    if !first {
        return;
    }
    m.items.replace(core::load());
    if let Some(a) = app.window.application() {
        for (name, f) in [
            ("dl-pause", Manager::pause as fn(&Rc<Manager>, &str)),
            ("dl-resume", Manager::resume),
            ("dl-cancel", Manager::cancel),
        ] {
            let act = gio::SimpleAction::new(name, Some(&String::static_variant_type()));
            let m = m.clone();
            act.connect_activate(move |_, p| {
                if let Some(id) = p.and_then(|p| p.get::<String>()) {
                    let ids: Vec<String> = if id == "*" {
                        m.items.borrow().iter().map(|i| i.id.clone()).collect()
                    } else {
                        vec![id]
                    };
                    for id in ids {
                        f(&m, &id);
                    }
                }
            });
            a.add_action(&act);
        }
        let open = gio::SimpleAction::new("dl-open", None);
        let app = app.clone();
        open.connect_activate(move |_, _| {
            app.window.present();
            if let Some(f) = app.select_tab.borrow().clone() {
                f("downloads")
            }
        });
        a.add_action(&open);
    }
    let m2 = m.clone();
    glib::timeout_add_seconds_local(1, move || {
        m2.tick();
        glib::ControlFlow::Continue
    });
}

impl Manager {
    fn find(&self, id: &str) -> Option<Item> {
        self.items.borrow().iter().find(|i| i.id == id).cloned()
    }

    fn edit(&self, id: &str, f: impl FnOnce(&mut Item)) {
        if let Some(i) = self.items.borrow_mut().iter_mut().find(|i| i.id == id) {
            f(i);
        }
    }

    fn changed(&self) {
        core::save(&self.items.borrow());
        self.redraw(true);
    }

    fn redraw(&self, structure: bool) {
        let v = self.view.borrow().clone();
        if let Some(v) = v {
            v(structure);
        }
    }

    fn add(self: &Rc<Self>, spec: Spec, quality: (String, String), container: String, keep: Option<i64>) {
        if self
            .items
            .borrow()
            .iter()
            .any(|i| i.media_file_id == spec.media_file_id)
        {
            return;
        }
        let item = Item {
            id: format!(
                "{:x}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ),
            media_file_id: spec.media_file_id,
            work_id: spec.work_id,
            title: spec.title,
            series_title: spec.series_title,
            season: spec.season,
            episode: spec.episode,
            quality_id: quality.0,
            quality_label: quality.1,
            ticket_id: None,
            state: State::Preparing,
            bytes_done: 0,
            bytes_total: 0,
            container,
            keep_until: keep.map(|d| now() + d * 86400),
            error: None,
        };
        let id = item.id.clone();
        self.items.borrow_mut().push(item);
        self.changed();
        self.spawn(&id);
    }

    /// Starts the worker thread of an item; `finished` runs on the main loop when it stops.
    fn spawn(self: &Rc<Self>, id: &str) {
        let (Some(client), Some(mut item)) = (self.client.borrow().clone(), self.find(id)) else {
            return;
        };
        if self.ctl.borrow().contains_key(id) {
            return;
        }
        let ctl = Arc::new(Control::default());
        ctl.done.store(item.bytes_done, Ordering::SeqCst);
        ctl.total.store(item.bytes_total, Ordering::SeqCst);
        self.ctl.borrow_mut().insert(id.to_string(), ctl.clone());
        item.state = State::Preparing;
        self.edit(id, |i| {
            i.state = State::Preparing;
            i.error = None;
        });
        self.changed();
        let (me, id) = (self.clone(), id.to_string());
        glib::spawn_future_local(async move {
            let r = gio::spawn_blocking(move || {
                let o = core::run(&client, &mut item, &ctl);
                (item, o)
            })
            .await;
            match r {
                Ok((it, o)) => me.finished(&id, it, o),
                Err(_) => me.finished(
                    &id,
                    me.find(&id).unwrap_or_else(|| unreachable_item(&id)),
                    Outcome::Failed("The download stopped unexpectedly.".into()),
                ),
            }
        });
    }

    fn finished(self: &Rc<Self>, id: &str, it: Item, outcome: Outcome) {
        self.ctl.borrow_mut().remove(id);
        let part = it.path().with_extension("part");
        self.edit(id, |i| {
            i.ticket_id = it.ticket_id.clone();
            i.bytes_total = it.bytes_total;
        });
        match outcome {
            Outcome::Completed { total } => {
                if let (Some(c), Some(t)) = (self.client.borrow().clone(), it.ticket_id.clone()) {
                    std::thread::spawn(move || {
                        let _ = c.complete_download_ticket(&t);
                    });
                }
                self.edit(id, |i| {
                    i.state = State::Completed;
                    i.bytes_done = total;
                    i.bytes_total = total;
                })
            }
            Outcome::Paused => {
                let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
                self.edit(id, |i| {
                    i.state = State::Paused;
                    i.bytes_done = have;
                });
            }
            Outcome::Failed(e) => self.edit(id, |i| {
                i.state = State::Failed;
                i.error = Some(e);
            }),
            Outcome::Canceled => {
                let again = self.restart.borrow_mut().remove(id);
                match again {
                    Some((q, label)) => {
                        self.reset(id, &q, &label);
                        self.spawn(id);
                    }
                    None => self.remove_item(id),
                }
            }
        }
        self.changed();
    }

    /// Throws away what was downloaded and sets the quality for a fresh start.
    fn reset(&self, id: &str, quality: &str, label: &str) {
        if let Some(it) = self.find(id) {
            core::remove_files(&it);
            self.drop_ticket(&it);
        }
        self.edit(id, |i| {
            i.quality_id = quality.into();
            i.quality_label = label.into();
            i.ticket_id = None;
            i.bytes_done = 0;
            i.bytes_total = 0;
            i.error = None;
            i.state = State::Preparing;
        });
    }

    fn drop_ticket(&self, it: &Item) {
        if let (Some(c), Some(t)) = (self.client.borrow().clone(), it.ticket_id.clone()) {
            std::thread::spawn(move || {
                let _ = c.delete_download_ticket(&t);
            });
        }
    }

    fn remove_item(&self, id: &str) {
        if let Some(it) = self.find(id) {
            core::remove_files(&it);
            self.drop_ticket(&it);
        }
        self.items.borrow_mut().retain(|i| i.id != id);
        self.withdraw(&format!("dl-{id}"));
        self.changed();
    }

    fn pause(self: &Rc<Self>, id: &str) {
        if let Some(c) = self.ctl.borrow().get(id) {
            c.want.store(core::PAUSE, Ordering::SeqCst);
        }
        self.edit(id, |i| {
            if matches!(i.state, State::Preparing | State::Downloading) {
                i.state = State::Paused
            }
        });
        self.changed();
    }

    fn resume(self: &Rc<Self>, id: &str) {
        let Some(it) = self.find(id) else { return };
        if !matches!(it.state, State::Paused | State::Failed) {
            return;
        }
        if it.state == State::Failed {
            // A failed ticket is not reusable: start again from a new one.
            self.reset(id, &it.quality_id, &it.quality_label);
        }
        // shortcut: if the old worker has not noticed the pause yet this is ignored; the user taps again.
        self.spawn(id);
    }

    /// Cancels a transfer that is running, or deletes a paused, failed or finished item.
    fn cancel(self: &Rc<Self>, id: &str) {
        let running = self.ctl.borrow().get(id).cloned();
        match running {
            Some(c) => {
                c.want.store(core::CANCEL, Ordering::SeqCst);
                self.restart.borrow_mut().remove(id);
            }
            None => self.remove_item(id),
        }
    }

    fn requality(self: &Rc<Self>, id: &str, quality: &str, label: &str) {
        let running = self.ctl.borrow().get(id).cloned();
        match running {
            Some(c) => {
                self.restart
                    .borrow_mut()
                    .insert(id.into(), (quality.into(), label.into()));
                c.want.store(core::CANCEL, Ordering::SeqCst);
            }
            None => {
                self.reset(id, quality, label);
                self.spawn(id);
            }
        }
    }

    fn tick(self: &Rc<Self>) {
        let t = now();
        let expired: Vec<String> = self
            .items
            .borrow()
            .iter()
            .filter(|i| i.expired(t))
            .map(|i| i.id.clone())
            .collect();
        for id in expired {
            self.remove_item(&id);
        }
        {
            let ctl = self.ctl.borrow();
            for i in self.items.borrow_mut().iter_mut() {
                if let (Some(c), State::Preparing | State::Downloading) = (ctl.get(&i.id), i.state) {
                    i.bytes_done = c.done.load(Ordering::SeqCst);
                    let total = c.total.load(Ordering::SeqCst);
                    if total > 0 {
                        i.bytes_total = total;
                    }
                    if i.bytes_done > 0 {
                        i.state = State::Downloading;
                    }
                }
            }
        }
        let sig = self.signature();
        let structural = *self.last_sig.borrow() != sig;
        if structural {
            self.last_sig.replace(sig);
            core::save(&self.items.borrow());
        }
        self.redraw(structural);
        self.notify();
    }

    fn signature(&self) -> String {
        self.items
            .borrow()
            .iter()
            .map(|i| format!("{}:{:?}:{:?};", i.id, i.state, i.keep_until))
            .collect()
    }

    fn app_handle(&self) -> Option<gio::Application> {
        gio::Application::default()
    }

    fn withdraw(&self, id: &str) {
        self.sent.borrow_mut().remove(id);
        if let Some(a) = self.app_handle() {
            a.withdraw_notification(id);
        }
    }

    /// One notification per download, or a single summary while several are active. Progress, paused, finished and
    /// failed states each update it; the buttons call the same actions as the page.
    fn notify(&self) {
        let Some(a) = self.app_handle() else { return };
        let items = self.items.borrow().clone();
        let active: Vec<&Item> = items
            .iter()
            .filter(|i| matches!(i.state, State::Preparing | State::Downloading | State::Paused))
            .collect();
        let summary = active.len() >= 2;
        let send = |id: &str, title: &str, body: String, buttons: &[(&str, &str, &str)]| {
            if self.sent.borrow().get(id) == Some(&body) {
                return;
            }
            self.sent.borrow_mut().insert(id.into(), body.clone());
            let n = gio::Notification::new(title);
            n.set_body(Some(&body));
            n.set_priority(gio::NotificationPriority::Low);
            n.set_default_action("app.dl-open");
            for (label, action, target) in buttons {
                n.add_button_with_target_value(label, action, Some(&target.to_variant()));
            }
            a.send_notification(Some(id), &n);
        };
        if summary {
            let (done, total) = active
                .iter()
                .fold((0u64, 0u64), |(d, t), i| (d + i.bytes_done, t + i.bytes_total));
            let pct = (done * 100).checked_div(total).unwrap_or(0);
            let paused = active.iter().all(|i| i.state == State::Paused);
            send(
                "dl-summary",
                &format!("{} downloads", active.len()),
                format!(
                    "{}{pct}% · {}",
                    if paused { "Paused at " } else { "" },
                    core::human_size(total)
                ),
                &[
                    if paused {
                        ("Resume all", "app.dl-resume", "*")
                    } else {
                        ("Pause all", "app.dl-pause", "*")
                    },
                    ("Cancel all", "app.dl-cancel", "*"),
                ],
            );
        } else {
            self.withdraw("dl-summary");
        }
        for i in &items {
            let id = format!("dl-{}", i.id);
            let name = display_title(i);
            match i.state {
                State::Preparing | State::Downloading | State::Paused => {
                    if summary {
                        if self.sent.borrow().contains_key(&id) {
                            self.withdraw(&id);
                        }
                        continue;
                    }
                    let first = if i.state == State::Paused {
                        ("Resume", "app.dl-resume", i.id.as_str())
                    } else {
                        ("Pause", "app.dl-pause", i.id.as_str())
                    };
                    send(
                        &id,
                        &name,
                        i.status_line(),
                        &[first, ("Cancel", "app.dl-cancel", i.id.as_str())],
                    );
                }
                State::Completed => send(&id, &name, i.status_line(), &[]),
                State::Failed => send(
                    &id,
                    &name,
                    i.status_line(),
                    &[
                        ("Retry", "app.dl-resume", i.id.as_str()),
                        ("Cancel", "app.dl-cancel", i.id.as_str()),
                    ],
                ),
            }
        }
    }
}

fn unreachable_item(id: &str) -> Item {
    Item {
        id: id.into(),
        media_file_id: String::new(),
        work_id: String::new(),
        title: String::new(),
        series_title: None,
        season: None,
        episode: None,
        quality_id: String::new(),
        quality_label: String::new(),
        ticket_id: None,
        state: State::Failed,
        bytes_done: 0,
        bytes_total: 0,
        container: String::new(),
        keep_until: None,
        error: None,
    }
}

fn display_title(i: &Item) -> String {
    match (&i.series_title, i.season, i.episode) {
        (Some(s), Some(n), Some(e)) => format!("{s} S{n}E{e}"),
        _ => i.title.clone(),
    }
}

struct Options {
    container: String,
    list: Vec<(String, String)>,
}

fn parse_options(v: &serde_json::Value) -> Options {
    let list = v
        .get("options")
        .and_then(|o| o.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|o| {
                    let id = o.get("id")?.as_str()?.to_string();
                    let label = o.get("label").and_then(|l| l.as_str()).unwrap_or(&id).to_string();
                    let size = o
                        .get("estimated_size_bytes")
                        .and_then(|s| s.as_u64())
                        .map(|s| {
                            format!(
                                " · {}{}",
                                if o.get("size_is_estimate").and_then(|e| e.as_bool()).unwrap_or(false) {
                                    "about "
                                } else {
                                    ""
                                },
                                core::human_size(s)
                            )
                        })
                        .unwrap_or_default();
                    Some((id, format!("{label}{size}")))
                })
                .collect()
        })
        .unwrap_or_default();
    Options {
        container: v.get("container").and_then(|c| c.as_str()).unwrap_or("mp4").to_string(),
        list,
    }
}

/// Dialog with a quality list and a keep-until list; `on_ok` gets the chosen quality id, its label and keep days.
fn choose(
    app: &Rc<App>,
    heading: &str,
    ok: &str,
    opts: &Options,
    cur_q: Option<&str>,
    cur_keep: Option<i64>,
    on_ok: impl Fn(String, String, Option<i64>) + 'static,
) {
    let dialog = adw::AlertDialog::new(Some(heading), None);
    dialog.add_responses(&[("cancel", "Cancel"), ("ok", ok)]);
    dialog.set_response_appearance("ok", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("ok"));
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    let labels: Vec<&str> = opts.list.iter().map(|(_, l)| l.as_str()).collect();
    let quality = gtk4::DropDown::from_strings(&labels);
    quality.set_selected(
        cur_q
            .and_then(|q| opts.list.iter().position(|(id, _)| id == q))
            .unwrap_or(0) as u32,
    );
    let keep = gtk4::DropDown::from_strings(&KEEP.map(|k| k.0));
    let days = cur_keep.map(|t| ((t - now()).max(0) + 86399) / 86400);
    keep.set_selected(match days {
        None => 0,
        Some(d) if d <= 1 => 1,
        Some(d) if d <= 7 => 2,
        _ => 3,
    });
    col.append(
        &gtk4::Label::builder()
            .label("Quality")
            .xalign(0.0)
            .css_classes(["pa-section-label"])
            .build(),
    );
    col.append(&quality);
    col.append(
        &gtk4::Label::builder()
            .label("Keep for")
            .xalign(0.0)
            .css_classes(["pa-section-label"])
            .build(),
    );
    col.append(&keep);
    dialog.set_extra_child(Some(&col));
    let list = opts.list.clone();
    dialog.connect_response(None, move |_, r| {
        if r == "ok" {
            if let Some((id, label)) = list.get(quality.selected() as usize) {
                on_ok(id.clone(), label.clone(), KEEP[keep.selected() as usize].1);
            }
        }
    });
    dialog.present(Some(&app.window));
}

/// Asks for quality and keep-until, then starts the download (the Download buttons call this).
pub fn prompt(app: &Rc<App>, spec: Spec) {
    let Some(client) = app.client.borrow().clone() else {
        return;
    };
    init(app, client.clone());
    let (app, file) = (app.clone(), spec.media_file_id.clone());
    bg(
        move || client.download_options(&file),
        move |res| match res {
            Err(e) => toast(&app, &format!("Could not load the download options: {e}")),
            Ok(v) => {
                let opts = parse_options(&v);
                if opts.list.is_empty() {
                    return toast(&app, "This title has no download options.");
                }
                let container = opts.container.clone();
                let spec = RefCell::new(Some(spec));
                choose(
                    &app,
                    &format!(
                        "Download {}",
                        spec.borrow().as_ref().map(|s| s.title.clone()).unwrap_or_default()
                    ),
                    "Download",
                    &opts,
                    Some("original"),
                    None,
                    move |q, label, keep| {
                        if let Some(s) = spec.borrow_mut().take() {
                            mgr().add(s, (q, label), container.clone(), keep);
                        }
                    },
                );
            }
        },
    );
}

fn toast(app: &Rc<App>, text: &str) {
    let d = adw::AlertDialog::new(Some(text), None);
    d.add_response("ok", "OK");
    d.present(Some(&app.window));
}

/// Quality and keep-until for one or several items (a series or season passes all its episodes).
fn edit(app: &Rc<App>, ids: Vec<String>) {
    let m = mgr();
    let (Some(client), Some(first)) = (app.client.borrow().clone(), ids.first().and_then(|i| m.find(i))) else {
        return;
    };
    let app = app.clone();
    bg(
        move || client.download_options(&first.media_file_id).map(|v| (v, first)),
        move |res| match res {
            Err(e) => toast(&app, &format!("Could not load the download options: {e}")),
            Ok((v, first)) => {
                let opts = parse_options(&v);
                choose(
                    &app,
                    "Edit download",
                    "Save",
                    &opts,
                    Some(&first.quality_id),
                    first.keep_until,
                    move |q, label, keep| {
                        let m = mgr();
                        for id in &ids {
                            let Some(it) = m.find(id) else { continue };
                            m.edit(id, |i| i.keep_until = keep.map(|d| now() + d * 86400));
                            if it.quality_id != q {
                                m.requality(id, &q, &label);
                            }
                        }
                        m.changed();
                    },
                );
            }
        },
    );
}

fn play(app: &Rc<App>, it: &Item) {
    app.play(super::player::PlayRequest {
        media_file_id: it.media_file_id.clone(),
        start_ms: 0,
        title: display_title(it),
        art_work_id: Some(it.work_id.clone()),
        local_file: Some(it.path()),
    });
}

fn button(label: &str) -> gtk4::Button {
    gtk4::Button::builder()
        .label(label)
        .css_classes(["pa-chip-btn"])
        .build()
}

/// Pause/Resume, Cancel or Delete, Edit over a set of items: used by every row and group header.
fn actions(app: &Rc<App>, ids: Vec<String>, play_one: Option<Item>) -> gtk4::Box {
    let m = mgr();
    let row = gtk4::Box::builder().spacing(6).margin_top(6).build();
    let items: Vec<Item> = ids.iter().filter_map(|i| m.find(i)).collect();
    let running = items
        .iter()
        .any(|i| matches!(i.state, State::Preparing | State::Downloading));
    let paused = items.iter().any(|i| matches!(i.state, State::Paused | State::Failed));
    let all_done = items.iter().all(|i| i.state == State::Completed);
    if let Some(it) = play_one.filter(|i| i.state == State::Completed) {
        let b = button("Play");
        let app = app.clone();
        b.connect_clicked(move |_| play(&app, &it));
        row.append(&b);
    }
    if running {
        let b = button("Pause");
        let ids = ids.clone();
        b.connect_clicked(move |_| ids.iter().for_each(|i| mgr().pause(i)));
        row.append(&b);
    }
    if paused {
        let b = button("Resume");
        let ids = ids.clone();
        b.connect_clicked(move |_| ids.iter().for_each(|i| mgr().resume(i)));
        row.append(&b);
    }
    let b = button(if all_done { "Delete" } else { "Cancel" });
    {
        let ids = ids.clone();
        b.connect_clicked(move |_| ids.iter().for_each(|i| mgr().cancel(i)));
    }
    row.append(&b);
    let b = button("Edit");
    let app = app.clone();
    b.connect_clicked(move |_| edit(&app, ids.clone()));
    row.append(&b);
    row
}

/// The Downloads tab: movies, then series, season and episode with the same buttons at each level.
pub fn page(app: &Rc<App>, client: Client) -> gtk4::Widget {
    init(app, client);
    let m = mgr();
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_bottom(110);
    let head = header::build(app, "Downloads", "filters");
    page.append(&head.widget);
    // Storage line and bar, as the web's Downloads page: what the downloads use of the device quota.
    let used = gtk4::Label::builder()
        .css_classes(["pa-body"])
        .xalign(0.0)
        .margin_start(16)
        .margin_top(10)
        .build();
    let bar = gtk4::ProgressBar::builder()
        .css_classes(["pa-progress"])
        .margin_start(16)
        .margin_end(16)
        .build();
    page.append(&used);
    page.append(&bar);
    let list = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(10)
        .margin_start(16)
        .margin_end(16)
        .build();
    page.append(&list);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    // Progress labels and bars by item id, updated in place so a button press is never lost to a redraw.
    let live: Rc<RefCell<HashMap<String, (gtk4::Label, gtk4::ProgressBar)>>> = Rc::default();
    let (app2, list2, live2, used2, bar2) = (app.clone(), list.clone(), live.clone(), used.clone(), bar.clone());
    let redraw = move |structure: bool| {
        let m = mgr();
        if structure {
            while let Some(c) = list2.first_child() {
                list2.remove(&c);
            }
            live2.borrow_mut().clear();
            head.set_subtitle(&match m.items.borrow().len() {
                0 => String::new(),
                n => format!("{n} downloads"),
            });
            build_list(&app2, &list2, &m.items.borrow(), &live2);
        }
        let bytes: u64 = m.items.borrow().iter().map(|i| i.bytes_done).sum();
        used2.set_label(&format!(
            "{} of {} used on this device",
            core::human_size(bytes),
            core::human_size(QUOTA)
        ));
        bar2.set_fraction((bytes as f64 / QUOTA as f64).min(1.0));
        for i in m.items.borrow().iter() {
            if let Some((label, bar)) = live2.borrow().get(&i.id) {
                label.set_label(&i.status_line());
                bar.set_fraction(i.percent() as f64 / 100.0);
            }
        }
    };
    redraw(true);
    m.view.replace(Some(Rc::new(redraw)));
    scroll.upcast()
}

fn build_list(
    app: &Rc<App>,
    list: &gtk4::Box,
    items: &[Item],
    live: &Rc<RefCell<HashMap<String, (gtk4::Label, gtk4::ProgressBar)>>>,
) {
    if items.is_empty() {
        list.append(
            &gtk4::Label::builder()
                .label("No downloads yet\nDownload a title from its detail page to watch it without a connection. Hold an episode to download it.")
                .css_classes(["pa-body"])
                .wrap(true)
                .xalign(0.0)
                .build(),
        );
        return;
    }
    let row = |it: &Item, title: String, indent: i32| -> gtk4::Box {
        let r = gtk4::Box::builder()
            .orientation(gtk4::Orientation::Vertical)
            .css_classes(["pa-entry", "have"])
            .margin_start(indent)
            .build();
        r.append(
            &gtk4::Label::builder()
                .label(title)
                .css_classes(["pa-entry-title"])
                .xalign(0.0)
                .wrap(true)
                .build(),
        );
        let status = gtk4::Label::builder()
            .label(it.status_line())
            .css_classes(["pa-entry-meta"])
            .xalign(0.0)
            .build();
        let bar = gtk4::ProgressBar::builder()
            .css_classes(["pa-progress"])
            .fraction(it.percent() as f64 / 100.0)
            .margin_top(4)
            .build();
        r.append(&status);
        r.append(&bar);
        r.append(
            &gtk4::Label::builder()
                .label(format!(
                    "{} · {}",
                    it.quality_label,
                    it.keep_until
                        .map(|t| format!("kept until {}", day(t)))
                        .unwrap_or_else(|| "kept until deleted".into())
                ))
                .css_classes(["pa-entry-meta"])
                .xalign(0.0)
                .build(),
        );
        live.borrow_mut().insert(it.id.clone(), (status, bar));
        r.append(&actions(app, vec![it.id.clone()], Some(it.clone())));
        r
    };
    let ids = |v: &[&Item]| v.iter().map(|i| i.id.clone()).collect::<Vec<_>>();
    for (series, seasons) in core::grouped(items) {
        match series {
            None => {
                for (_, its) in &seasons {
                    for it in its {
                        list.append(&row(it, it.title.clone(), 0));
                    }
                }
            }
            Some(name) => {
                let all: Vec<&Item> = seasons.iter().flat_map(|(_, v)| v.iter().copied()).collect();
                list.append(
                    &gtk4::Label::builder()
                        .label(name)
                        .css_classes(["pa-season-title"])
                        .xalign(0.0)
                        .margin_top(10)
                        .build(),
                );
                list.append(&actions(app, ids(&all), None));
                for (season, its) in &seasons {
                    list.append(
                        &gtk4::Label::builder()
                            .label(
                                season
                                    .map(|s| format!("Season {s}"))
                                    .unwrap_or_else(|| "Episodes".into()),
                            )
                            .css_classes(["pa-section-label"])
                            .xalign(0.0)
                            .build(),
                    );
                    list.append(&actions(app, ids(its), None));
                    for it in its {
                        list.append(&row(it, format!("E{} · {}", it.episode.unwrap_or(0), it.title), 8));
                    }
                }
            }
        }
    }
}

fn day(t: i64) -> String {
    glib::DateTime::from_unix_local(t)
        .and_then(|d| d.format("%-d %b %Y"))
        .map(|s| s.to_string())
        .unwrap_or_default()
}

/// Capture and test hook (`dl:<verb>[:argument]` through PLAYARR_CONTROL): `start:<work id>[:quality]` (a film), `startep:<series work id>` (its first episode), `pause`,
/// `resume`, `cancel`, `delete`, `play`, `keep:<days>` and `quality:<id>` act on the first download in the list.
pub fn control(app: &Rc<App>, arg: &str) {
    let Some(client) = app.client.borrow().clone() else {
        return;
    };
    init(app, client.clone());
    let m = mgr();
    let mut parts = arg.splitn(3, ':');
    let (verb, a, b) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next());
    let first = m.items.borrow().first().map(|i| i.id.clone());
    match (verb, first) {
        ("start" | "startep", _) => {
            let (work_id, quality, ep) = (a.to_string(), b.unwrap_or("original").to_string(), verb == "startep");
            let c = client.clone();
            bg(
                move || {
                    let d = c.work(&work_id).ok()?;
                    let (file, title, series, season, episode) = if ep {
                        let s = d.children.seasons.iter().find(|s| s.season.season_number > 0)?;
                        let e = s.episodes.iter().find(|e| e.media_file_id.is_some())?;
                        (
                            e.media_file_id.clone()?,
                            e.episode.title.clone().unwrap_or_default(),
                            Some(d.work.title.clone()),
                            Some(s.season.season_number),
                            Some(e.episode.episode_number),
                        )
                    } else {
                        (d.media_file_id.clone()?, d.work.title.clone(), None, None, None)
                    };
                    let o = parse_options(&c.download_options(&file).ok()?);
                    Some((file, title, series, season, episode, o, work_id))
                },
                move |r| {
                    let Some((file, title, series_title, season, episode, o, work_id)) = r else {
                        return;
                    };
                    let label = o
                        .list
                        .iter()
                        .find(|(id, _)| *id == quality)
                        .map(|(_, l)| l.clone())
                        .unwrap_or_else(|| quality.clone());
                    mgr().add(
                        Spec {
                            media_file_id: file,
                            work_id,
                            title,
                            series_title,
                            season,
                            episode,
                        },
                        (quality, label),
                        o.container,
                        None,
                    );
                },
            );
        }
        ("pause", Some(id)) => m.pause(&id),
        ("resume", Some(id)) => m.resume(&id),
        ("cancel" | "delete", Some(id)) => m.cancel(&id),
        ("play", Some(id)) => {
            if let Some(it) = m.find(&id) {
                play(app, &it)
            }
        }
        ("keep", Some(id)) => {
            let days = a.parse::<i64>().ok();
            m.edit(&id, |i| i.keep_until = days.map(|d| now() + d * 86400));
            m.changed();
        }
        ("quality", Some(id)) => m.requality(&id, a, a),
        _ => {}
    }
}
