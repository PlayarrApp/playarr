//! Release calendar: agenda, week and month views over `GET /api/v1/calendar`.
use super::images::Images;
use super::{bg, header, App};
use crate::api::Client;
use crate::model::CalendarEntry;
use gtk4::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Date {
    pub y: i32,
    pub m: u32,
    pub d: u32,
}

/// Days since 1970-01-01 (proleptic Gregorian).
pub fn to_days(dt: Date) -> i64 {
    let y = dt.y as i64 - (dt.m <= 2) as i64;
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (dt.m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + dt.d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn from_days(z: i64) -> Date {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    Date {
        y: (y + (m <= 2) as i64) as i32,
        m,
        d,
    }
}

/// 0 = Monday .. 6 = Sunday.
pub fn weekday(dt: Date) -> u32 {
    (to_days(dt) + 3).rem_euclid(7) as u32
}

pub fn add_days(dt: Date, n: i64) -> Date {
    from_days(to_days(dt) + n)
}

pub fn days_in_month(y: i32, m: u32) -> u32 {
    let next = if m == 12 {
        Date { y: y + 1, m: 1, d: 1 }
    } else {
        Date { y, m: m + 1, d: 1 }
    };
    (to_days(next) - to_days(Date { y, m, d: 1 })) as u32
}

pub fn parse(s: &str) -> Option<Date> {
    let mut it = s.get(..10)?.split('-');
    Some(Date {
        y: it.next()?.parse().ok()?,
        m: it.next()?.parse().ok()?,
        d: it.next()?.parse().ok()?,
    })
}

pub fn iso(dt: Date) -> String {
    format!("{:04}-{:02}-{:02}", dt.y, dt.m, dt.d)
}

/// Height of the week columns' scroller in px: the web clips them above the floating nav.
const WEEK_CLIP: i32 = 422;
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

pub fn day_label(dt: Date) -> String {
    format!(
        "{}, {} {}",
        DAYS[weekday(dt) as usize],
        &MONTHS[dt.m as usize - 1][..3],
        dt.d
    )
}

/// The real local time, or PLAYARR_PARITY_CLOCK (RFC 3339) so parity captures show the fixture's "today".
fn now() -> gtk4::glib::DateTime {
    std::env::var("PLAYARR_PARITY_CLOCK")
        .ok()
        .and_then(|v| gtk4::glib::DateTime::from_iso8601(&v, None).ok())
        .and_then(|d| d.to_local().ok())
        .unwrap_or_else(|| gtk4::glib::DateTime::now_local().expect("local time"))
}

fn today() -> Date {
    let n = now();
    Date {
        y: n.year(),
        m: n.month() as u32,
        d: n.day_of_month() as u32,
    }
}

#[derive(Clone, Copy, PartialEq)]
enum View {
    Agenda,
    Week,
    Month,
}

struct Cal {
    app: Rc<App>,
    client: Client,
    imgs: Images,
    view: Cell<View>,
    /// Agenda: today. Week: its Monday. Month: the 1st.
    anchor: Cell<Date>,
    selected: Cell<Option<Date>>,
    range_label: gtk4::Label,
    /// The period controls; the web sits them 18 px lower on week and month than on the agenda.
    controls: gtk4::Box,
    body: gtk4::Box,
    days_view: gtk4::ScrolledWindow,
    fades: [gtk4::Box; 2],
    generation: Cell<u32>,
    entries: RefCell<Vec<CalendarEntry>>,
}

/// The release instant, or None for an all-day release: the server stores date-only releases as midnight UTC, which is a
/// date, not a moment, so it must neither shift to another day nor show a time (as the web `releaseInstant`).
fn release_instant(release_at: Option<&str>) -> Option<gtk4::glib::DateTime> {
    release_at
        .and_then(|t| gtk4::glib::DateTime::from_iso8601(t, None).ok())
        .filter(|d| d.to_unix() % 86_400 != 0)
}

/// "15:00" in local time for an ISO timestamp, or "All day".
fn time_label(release_at: Option<&str>) -> String {
    release_instant(release_at)
        .and_then(|d| d.to_local().ok())
        .and_then(|d| d.format("%H:%M").ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "All day".into())
}

fn kind_label(kind: &str) -> &'static str {
    match kind {
        "episode" => "Episodes",
        "movie" => "Movies",
        "album" => "Albums",
        "book" => "Books",
        _ => "Titles",
    }
}

fn release_label(kind: &str) -> &'static str {
    match kind {
        "air" => "Airs",
        "cinema" => "In cinemas",
        "digital" => "Digital",
        "physical" => "Physical",
        _ => "Releases",
    }
}

/// Availability chip: have it, upcoming, or missing (aired without a file).
fn status_chip(e: &CalendarEntry, today_date: Date) -> (&'static str, &'static str) {
    if e.has_file {
        ("Available", "ok")
    } else if parse(&e.date).map(|d| d > today_date).unwrap_or(false) {
        ("Upcoming", "soon")
    } else {
        ("Missing", "gone")
    }
}

/// `week`: the narrow week-column card, whose status chip sits on its own line.
fn entry_widget(app: &Rc<App>, imgs: &Images, e: &CalendarEntry, week: bool) -> gtk4::Button {
    let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 14);
    let thumb = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .can_shrink(true)
        .build();
    // A blank 40 x 60 box sizes the frame; the poster is an overlay, so its own size cannot widen it.
    let sizer = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    sizer.set_size_request(40, 60);
    let frame = gtk4::Overlay::builder()
        .child(&sizer)
        .overflow(gtk4::Overflow::Hidden)
        .css_classes(["pa-thumb"])
        .valign(gtk4::Align::Center)
        .halign(gtk4::Align::Start)
        .build();
    frame.add_overlay(&thumb);
    if let Some(id) = &e.work_id {
        imgs.load(Client::artwork_path(id, "poster", 160), &thumb);
    }
    row.append(&frame);
    let col = gtk4::Box::builder()
        .orientation(gtk4::Orientation::Vertical)
        .spacing(2)
        .hexpand(true)
        .valign(gtk4::Align::Center)
        .build();
    col.append(
        &gtk4::Label::builder()
            .label(&e.title)
            .css_classes(["pa-entry-title"])
            .xalign(0.0)
            .ellipsize(gtk4::pango::EllipsizeMode::End)
            .max_width_chars(1)
            .build(),
    );
    let mut sub = Vec::new();
    if let (Some(s), Some(n)) = (e.season_number, e.episode_number) {
        sub.push(format!("S{s:02}E{n:02}"));
    }
    if let Some(t) = e.subtitle.as_deref().filter(|t| !t.is_empty()) {
        sub.push(t.to_string());
    }
    if !sub.is_empty() {
        let line = gtk4::Label::builder()
            .label(sub.join(" · "))
            .css_classes(["pa-entry-sub"])
            .xalign(0.0)
            .max_width_chars(1)
            .build();
        // The web week card wraps the episode line; the agenda row keeps one line.
        if week {
            line.set_wrap(true);
            line.set_wrap_mode(gtk4::pango::WrapMode::WordChar);
        } else {
            line.set_ellipsize(gtk4::pango::EllipsizeMode::End);
        }
        col.append(&line);
    }
    let meta = gtk4::Box::builder()
        .spacing(12)
        .css_classes(["pa-entry-metarow"])
        .build();
    for t in [
        time_label(e.release_at.as_deref()),
        release_label(&e.release_type).to_string(),
        kind_label(&e.media_kind).to_string(),
    ] {
        meta.append(&gtk4::Label::builder().label(t).css_classes(["pa-entry-meta"]).build());
    }
    let (text, class) = status_chip(e, today());
    let chip = gtk4::Label::builder()
        .label(text)
        .css_classes(["pa-chip-status", class])
        .halign(gtk4::Align::Start)
        .build();
    if week {
        col.append(&meta);
        col.append(&chip);
    } else {
        // The web's agenda chip is 21 px tall, sitting 1.5 px below the meta text.
        chip.add_css_class("agenda");
        chip.set_valign(gtk4::Align::Center);
        meta.append(&chip);
        col.append(&meta);
    }
    row.append(&col);
    // The left border shows availability (we have it) versus not, never which library it belongs to.
    let have = if e.has_file { "have" } else { "missing" };
    let b = gtk4::Button::builder()
        .child(&row)
        .css_classes(if week {
            vec!["pa-card", "pa-entry", have, "week"]
        } else {
            vec!["pa-card", "pa-entry", have]
        })
        .hexpand(true)
        .halign(gtk4::Align::Fill)
        .build();
    if let Some(id) = e.work_id.clone() {
        let (app, imgs, title) = (app.clone(), imgs.clone(), e.title.clone());
        b.connect_clicked(move |_| {
            if let Some(client) = app.client.borrow().clone() {
                let page = super::detail::build(app.clone(), client, imgs.clone(), id.clone());
                app.push_bare(&title, &page);
            }
        });
    } else {
        b.set_sensitive(false);
    }
    b
}

fn pill(label: &str) -> gtk4::Button {
    gtk4::Button::builder().label(label).css_classes(["pa-pill"]).build()
}

/// A round control with a text arrow, as the web's period navigation.
fn round_arrow(arrow: &str) -> gtk4::Button {
    let b = gtk4::Button::builder().css_classes(["pa-pill", "round"]).build();
    b.set_child(Some(
        &gtk4::Label::builder()
            .label(arrow)
            .css_classes(["pa-back-arrow"])
            .build(),
    ));
    b
}

impl Cal {
    fn range(&self) -> (Date, Date) {
        let a = self.anchor.get();
        match self.view.get() {
            View::Agenda => (a, add_days(a, 29)),
            View::Week => (a, add_days(a, 6)),
            View::Month => {
                let last = Date {
                    d: days_in_month(a.y, a.m),
                    ..a
                };
                (
                    add_days(a, -(weekday(a) as i64)),
                    add_days(last, 6 - weekday(last) as i64),
                )
            }
        }
    }

    fn refresh(self: &Rc<Self>) {
        self.generation.set(self.generation.get() + 1);
        let gen = self.generation.get();
        let (from, to) = self.range();
        let short = |d: Date| format!("{} {}", d.d, &MONTHS[d.m as usize - 1][..3]);
        self.range_label.set_label(&match self.view.get() {
            View::Month => format!(
                "{} {}",
                &MONTHS[self.anchor.get().m as usize - 1][..3],
                self.anchor.get().y
            ),
            View::Week if from.m == to.m => format!("{} – {}", from.d, short(to)),
            _ => format!("{} – {}", short(from), short(to)),
        });
        while let Some(c) = self.body.first_child() {
            self.body.remove(&c);
        }
        self.body.append(
            &gtk4::Label::builder()
                .label("Loading…")
                .css_classes(["pa-muted"])
                .margin_top(20)
                .build(),
        );
        let (me, c) = (self.clone(), self.client.clone());
        bg(
            move || c.calendar(&iso(from), &iso(to)),
            move |res| {
                if me.generation.get() != gen {
                    return;
                }
                while let Some(c) = me.body.first_child() {
                    me.body.remove(&c);
                }
                match res {
                    Err(e) => me.body.append(
                        &gtk4::Label::builder()
                            .label(e.to_string())
                            .css_classes(["pa-error"])
                            .wrap(true)
                            .build(),
                    ),
                    Ok(entries) => {
                        me.entries.replace(entries);
                        me.render();
                    }
                }
            },
        );
    }

    fn by_day(&self) -> BTreeMap<Date, Vec<CalendarEntry>> {
        let mut m: BTreeMap<Date, Vec<CalendarEntry>> = BTreeMap::new();
        for e in self.entries.borrow().iter() {
            // Timed releases belong to their local day, all-day ones to the entry date (as the web groupByLocalDay).
            let day = release_instant(e.release_at.as_deref())
                .and_then(|d| d.to_local().ok())
                .map(|d| Date {
                    y: d.year(),
                    m: d.month() as u32,
                    d: d.day_of_month() as u32,
                })
                .or_else(|| parse(&e.date));
            if let Some(d) = day {
                m.entry(d).or_default().push(e.clone());
            }
        }
        // All-day entries first, then by time and title.
        for list in m.values_mut() {
            list.sort_by_cached_key(|e| {
                (
                    release_instant(e.release_at.as_deref()).map_or(i64::MIN, |d| d.to_unix()),
                    e.title.to_lowercase(),
                )
            });
        }
        m
    }

    fn day_section(
        &self,
        parent: &gtk4::Box,
        dt: Date,
        entries: &[CalendarEntry],
        empty_text: Option<&str>,
        week: bool,
    ) {
        let head = gtk4::Box::builder()
            .spacing(9)
            .height_request(44)
            .margin_bottom(0)
            .build();
        let name = format!(
            "{} {} {}",
            [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday"
            ][weekday(dt) as usize],
            dt.d,
            MONTHS[dt.m as usize - 1]
        );
        head.append(
            &gtk4::Label::builder()
                .label(name)
                .css_classes(["pa-day-title"])
                .xalign(0.0)
                .valign(gtk4::Align::Center)
                .build(),
        );
        if dt == today() {
            head.append(
                &gtk4::Label::builder()
                    .label("TODAY")
                    .css_classes(["pa-today-chip"])
                    .valign(gtk4::Align::Center)
                    .build(),
            );
        }
        let sec = gtk4::Box::builder()
            .orientation(gtk4::Orientation::Vertical)
            .spacing(13)
            .margin_bottom(if week { 19 } else { 31 })
            .build();
        head.set_margin_bottom(0);
        sec.append(&head);
        for (i, e) in entries.iter().enumerate() {
            let card = entry_widget(&self.app, &self.imgs, e, week);
            // The web's week cards sit 15 px apart; the 8 px column spacing only covers the day heading.
            if week && i > 0 {
                card.set_margin_top(7);
            }
            sec.append(&card);
        }
        if entries.is_empty() {
            if let Some(t) = empty_text {
                sec.append(
                    &gtk4::Label::builder()
                        .label(t)
                        .css_classes(["pa-muted"])
                        .xalign(0.0)
                        .build(),
                );
            }
        }
        if week {
            // The web's week columns are 295 px wide and sit side by side.
            sec.set_size_request(295, -1);
            sec.set_valign(gtk4::Align::Start);
            sec.set_spacing(8);
            head.set_height_request(22);
            head.set_margin_top(5);
        }
        parent.append(&sec);
    }

    fn render(self: &Rc<Self>) {
        let days = self.by_day();
        // The web lays the month out 720 px wide and the other views 510 px, inside a 360 px page.
        self.body
            .set_size_request(if self.view.get() == View::Month { 720 } else { 510 }, -1);
        if self.view.get() != View::Week {
            self.days_view.hadjustment().set_value(0.0);
        }
        match self.view.get() {
            View::Agenda => {
                if days.is_empty() {
                    self.body.append(
                        &gtk4::Label::builder()
                            .label("Nothing scheduled in the next 30 days.")
                            .css_classes(["pa-muted"])
                            .margin_top(20)
                            .build(),
                    );
                }
                for (d, es) in &days {
                    self.day_section(&self.body, *d, es, None, false);
                }
            }
            View::Week => {
                let start = self.anchor.get();
                let cols = gtk4::Box::builder().spacing(19).valign(gtk4::Align::Start).build();
                self.body.append(&cols);
                for i in 0..7 {
                    let d = add_days(start, i);
                    let es = days.get(&d).map(Vec::as_slice).unwrap_or(&[]);
                    self.day_section(&cols, d, es, Some("Nothing today"), true);
                }
                // The web opens the week scrolled to today's column.
                let today_col = (0..7).find(|i| add_days(start, *i) == today());
                let (me, view, cols) = (self.clone(), self.days_view.clone(), cols.clone());
                gtk4::glib::timeout_add_local_once(std::time::Duration::from_millis(80), move || {
                    // A quick switch to Month or Agenda must not inherit the week's scroll.
                    if me.view.get() != View::Week {
                        return;
                    }
                    let mut col = cols.first_child();
                    for _ in 0..today_col.unwrap_or(0) {
                        col = col.and_then(|c| c.next_sibling());
                    }
                    view.hadjustment()
                        .set_value(col.map_or(0.0, |c| f64::from(c.allocation().x())));
                });
            }
            View::Month => self.render_month(&days),
        }
    }

    /// The web's month grid: a 720 px track of seven columns (the page clips the overflow), each cell holding the
    /// chips that fit above its bottom row (day number, "+N more"), as `MonthGrid` in tv-web.
    fn render_month(self: &Rc<Self>, days: &BTreeMap<Date, Vec<CalendarEntry>>) {
        let first = self.anchor.get();
        let start = add_days(first, -(weekday(first) as i64));
        let weeks = (weekday(first) + days_in_month(first.y, first.m)).div_ceil(7) as i64;
        let grid = gtk4::Grid::builder().column_homogeneous(true).hexpand(true).build();
        for (i, n) in DAYS.iter().enumerate() {
            grid.attach(
                &gtk4::Label::builder()
                    .label(n.to_uppercase())
                    .css_classes(["pa-mday"])
                    .build(),
                i as i32,
                0,
                1,
                1,
            );
        }
        let today_date = today();
        // The web's body fills the page; on the phone five rows come to about 82 px each.
        let cell_h = 410 / weeks as i32;
        let chips = ((cell_h - 2 - 44 - 2) / 22).max(0) as usize;
        for w in 0..weeks {
            for c in 0..7 {
                let d = add_days(start, w * 7 + c);
                let cell = gtk4::Box::builder()
                    .orientation(gtk4::Orientation::Vertical)
                    .css_classes(["pa-mcell"])
                    .height_request(cell_h)
                    .build();
                if d.m != first.m {
                    cell.add_css_class("outside");
                }
                if d == today_date {
                    cell.add_css_class("today");
                }
                // Same-day episodes of one series collapse into one "Title · N×" chip.
                let mut items: Vec<(String, &CalendarEntry, usize)> = Vec::new();
                for e in days.get(&d).map(Vec::as_slice).unwrap_or(&[]) {
                    let grouped = e.media_kind == "episode" && e.season_number.is_some() && e.episode_number.is_some();
                    let key = if grouped {
                        e.work_id.clone().unwrap_or_else(|| e.title.clone())
                    } else {
                        e.id.clone()
                    };
                    match items.iter_mut().find(|(k, _, _)| *k == key) {
                        Some(it) => it.2 += 1,
                        None => items.push((key, e, 1)),
                    }
                }
                let shown = items.len().min(chips);
                for (_, e, n) in items.iter().take(shown) {
                    let row = gtk4::Box::builder().spacing(9).css_classes(["pa-mline"]).build();
                    let tone = match status_chip(e, today_date).1 {
                        "ok" => "have",
                        "soon" => "soon",
                        _ => "missing",
                    };
                    row.append(
                        &gtk4::Box::builder()
                            .css_classes(["pa-dot", tone])
                            .valign(gtk4::Align::Center)
                            .build(),
                    );
                    let text = if *n > 1 {
                        format!("{} · {n}×", e.title)
                    } else {
                        e.title.clone()
                    };
                    row.append(
                        &gtk4::Label::builder()
                            .label(text)
                            .ellipsize(gtk4::pango::EllipsizeMode::End)
                            .xalign(0.0)
                            .build(),
                    );
                    cell.append(&row);
                }
                let foot = gtk4::Box::builder()
                    .spacing(12)
                    .valign(gtk4::Align::End)
                    .vexpand(true)
                    .css_classes(["pa-mfoot"])
                    .build();
                foot.append(
                    &gtk4::Label::builder()
                        .label(d.d.to_string())
                        .css_classes(["pa-mdaynum"])
                        .build(),
                );
                if items.len() > shown {
                    foot.append(
                        &gtk4::Label::builder()
                            .label(format!("+{} more", items.len() - shown))
                            .css_classes(["pa-mmore"])
                            .build(),
                    );
                }
                cell.append(&foot);
                grid.attach(&cell, c as i32, 1 + w as i32, 1, 1);
            }
        }
        self.body.append(&grid);
    }

    fn set_view(self: &Rc<Self>, v: View) {
        self.view.set(v);
        self.controls.set_margin_top(if v == View::Agenda { 5 } else { 21 });
        let t = today();
        self.anchor.set(match v {
            View::Agenda => t,
            View::Week => add_days(t, -(weekday(t) as i64)),
            View::Month => Date { d: 1, ..t },
        });
        self.selected.set(None);
        let week = v == View::Week;
        self.days_view.set_max_content_height(if week { WEEK_CLIP } else { -1 });
        self.days_view.set_vscrollbar_policy(if week {
            gtk4::PolicyType::External
        } else {
            gtk4::PolicyType::Never
        });
        self.days_view.set_kinetic_scrolling(week);
        for f in &self.fades {
            f.set_visible(week);
        }
        self.refresh();
    }

    fn step(self: &Rc<Self>, dir: i64) {
        let a = self.anchor.get();
        self.anchor.set(match self.view.get() {
            View::Week => add_days(a, 7 * dir),
            View::Agenda => add_days(a, 30 * dir),
            View::Month => {
                let m0 = a.y * 12 + a.m as i32 - 1 + dir as i32;
                Date {
                    y: m0.div_euclid(12),
                    m: m0.rem_euclid(12) as u32 + 1,
                    d: 1,
                }
            }
        });
        self.selected.set(None);
        self.refresh();
    }

    /// The calendar controls sheet (the header's filter button): which view to show.
    fn show_controls(self: &Rc<Self>) {
        let col = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
        col.set_margin_start(16);
        col.set_margin_end(16);
        col.set_margin_bottom(24);
        col.append(
            &gtk4::Label::builder()
                .label("VIEW")
                .css_classes(["pa-section-label"])
                .xalign(0.0)
                .build(),
        );
        let row = gtk4::Box::builder().spacing(10).homogeneous(true).build();
        let agenda = gtk4::ToggleButton::builder()
            .label("Agenda")
            .css_classes(["pa-seg-tile"])
            .active(self.view.get() == View::Agenda)
            .build();
        let week = gtk4::ToggleButton::builder()
            .label("Week")
            .css_classes(["pa-seg-tile"])
            .group(&agenda)
            .active(self.view.get() == View::Week)
            .build();
        let month = gtk4::ToggleButton::builder()
            .label("Month")
            .css_classes(["pa-seg-tile"])
            .group(&agenda)
            .active(self.view.get() == View::Month)
            .build();
        for (b, v) in [(&agenda, View::Agenda), (&week, View::Week), (&month, View::Month)] {
            row.append(b);
            let me = self.clone();
            b.connect_toggled(move |b| {
                if b.is_active() && me.view.get() != v {
                    me.set_view(v);
                    me.app.close_panel();
                }
            });
        }
        col.append(&row);
        self.app.present_panel("Library controls", "Calendar", &col, true);
    }
}

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    page.set_margin_bottom(110);
    let head = header::build(&app, "Calendar", "filters");
    head.action.set_visible(true);
    head.extra.set_visible(true);
    page.append(&head.widget);

    let content = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    content.set_margin_start(16);
    content.set_margin_end(16);
    page.append(&content);

    let controls = gtk4::Box::builder()
        .spacing(8)
        .halign(gtk4::Align::End)
        .margin_top(5)
        .css_classes(["pa-cal-controls"])
        .build();
    let range_label = gtk4::Label::builder().css_classes(["pa-pill-label"]).build();
    let range = gtk4::Box::builder().css_classes(["pa-pill"]).build();
    range.append(&range_label);
    let prev = round_arrow("←");
    let today_btn = pill("Today");
    today_btn.add_css_class("selected");
    let next = round_arrow("→");
    controls.append(&range);
    controls.append(&prev);
    controls.append(&today_btn);
    controls.append(&next);
    content.append(&controls);

    // The web lays the days out 510 px wide inside a 360 px page and clips the overflow; so does this.
    let body = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    body.set_size_request(510, -1);
    body.set_halign(gtk4::Align::Start);
    let days_view = gtk4::ScrolledWindow::builder()
        .child(&body)
        .hscrollbar_policy(gtk4::PolicyType::External)
        .vscrollbar_policy(gtk4::PolicyType::Never)
        .kinetic_scrolling(false)
        .propagate_natural_height(true)
        .margin_top(6)
        .build();
    // Week view: the web clips the columns above the nav and fades their bottom and right edges toward the page.
    let fades = [
        ("pa-edge-fade-v", gtk4::Align::End, gtk4::Align::Fill),
        ("pa-edge-fade", gtk4::Align::Fill, gtk4::Align::End),
    ]
    .map(|(class, v, h)| {
        let f = gtk4::Box::builder()
            .css_classes([class])
            .valign(v)
            .halign(h)
            .can_target(false)
            .visible(false)
            .build();
        f.set_size_request(
            if h == gtk4::Align::End { 38 } else { -1 },
            if v == gtk4::Align::End { 38 } else { -1 },
        );
        f
    });
    let faded = gtk4::Overlay::new();
    faded.set_child(Some(&days_view));
    for f in &fades {
        faded.add_overlay(f);
    }
    content.append(&faded);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    let cal = Rc::new(Cal {
        app: app.clone(),
        client,
        imgs,
        view: Cell::new(View::Agenda),
        anchor: Cell::new(today()),
        selected: Cell::new(None),
        range_label,
        controls: controls.clone(),
        body,
        days_view,
        fades,
        generation: Cell::new(0),
        entries: RefCell::default(),
    });
    {
        let cal = cal.clone();
        head.action.connect_clicked(move |_| cal.show_controls());
    }
    {
        let cal = cal.clone();
        prev.connect_clicked(move |_| cal.step(-1));
    }
    {
        let cal = cal.clone();
        next.connect_clicked(move |_| cal.step(1));
    }
    {
        let cal = cal.clone();
        today_btn.connect_clicked(move |_| {
            let v = cal.view.get();
            cal.set_view(v);
        });
    }
    // Capture hook: switch the view.
    {
        let cal = cal.clone();
        app.hooks.borrow_mut().insert(
            "calendar-view",
            Rc::new(move |v: &str| {
                cal.set_view(match v {
                    "week" => View::Week,
                    "month" => View::Month,
                    _ => View::Agenda,
                })
            }),
        );
    }
    cal.refresh();
    scroll.upcast()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chip_states() {
        let mut e = CalendarEntry {
            id: "1".into(),
            date: "2026-10-12".into(),
            title: "t".into(),
            subtitle: None,
            media_kind: String::new(),
            has_file: false,
            work_id: None,
            season_number: None,
            episode_number: None,
            release_at: None,
            release_type: String::new(),
        };
        let t = Date { y: 2026, m: 10, d: 11 };
        assert_eq!(status_chip(&e, t).0, "Upcoming");
        e.date = "2026-10-11".into();
        assert_eq!(status_chip(&e, t).0, "Missing");
        e.has_file = true;
        assert_eq!(status_chip(&e, t).0, "Available");
    }

    #[test]
    fn midnight_utc_is_all_day() {
        assert!(release_instant(Some("2026-10-07T00:00:00Z")).is_none());
        assert!(release_instant(Some("2026-10-07T01:00:00Z")).is_some());
        assert_eq!(time_label(Some("2026-10-07T00:00:00Z")), "All day");
        assert_eq!(time_label(None), "All day");
    }

    #[test]
    fn civil_round_trip_and_weekday() {
        let d = Date { y: 2026, m: 10, d: 11 };
        assert_eq!(from_days(to_days(d)), d);
        assert_eq!(weekday(d), 6, "2026-10-11 is a Sunday");
        assert_eq!(weekday(Date { y: 1970, m: 1, d: 1 }), 3, "Thursday");
    }

    #[test]
    fn month_lengths_and_stepping() {
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2026, 2), 28);
        assert_eq!(days_in_month(2026, 12), 31);
        assert_eq!(
            add_days(Date { y: 2026, m: 12, d: 31 }, 1),
            Date { y: 2027, m: 1, d: 1 }
        );
        assert_eq!(parse("2026-10-11T00:00:00Z"), Some(Date { y: 2026, m: 10, d: 11 }));
        assert_eq!(iso(Date { y: 2026, m: 1, d: 5 }), "2026-01-05");
    }
}
