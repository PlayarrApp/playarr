//! Release calendar: agenda, week and month views over `GET /api/v1/calendar`.
use super::{bg, App};
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

fn today() -> Date {
    let n = gtk4::glib::DateTime::now_local().expect("local time");
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
    view: Cell<View>,
    /// Agenda: today. Week: its Monday. Month: the 1st.
    anchor: Cell<Date>,
    selected: Cell<Option<Date>>,
    nav_label: gtk4::Label,
    nav_row: gtk4::Box,
    body: gtk4::Box,
    generation: Cell<u32>,
    entries: RefCell<Vec<CalendarEntry>>,
}

fn entry_widget(app: &Rc<App>, e: &CalendarEntry) -> gtk4::Button {
    let col = gtk4::Box::new(gtk4::Orientation::Vertical, 2);
    col.append(
        &gtk4::Label::builder()
            .label(&e.title)
            .css_classes(["pa-card-title"])
            .xalign(0.0)
            .wrap(true)
            .build(),
    );
    let mut sub = Vec::new();
    if let (Some(s), Some(n)) = (e.season_number, e.episode_number) {
        sub.push(format!("S{s}E{n}"));
    }
    if let Some(t) = e.subtitle.as_deref().filter(|t| !t.is_empty()) {
        sub.push(t.to_string());
    }
    if !sub.is_empty() {
        col.append(
            &gtk4::Label::builder()
                .label(sub.join(" · "))
                .css_classes(["pa-card-meta"])
                .xalign(0.0)
                .wrap(true)
                .build(),
        );
    }
    // The left border shows availability (we have it) versus not, never which library it belongs to.
    let class = if e.has_file { "have" } else { "missing" };
    let b = gtk4::Button::builder()
        .child(&col)
        .css_classes(["pa-card", "pa-entry", class])
        .hexpand(true)
        .halign(gtk4::Align::Fill)
        .build();
    if let Some(id) = e.work_id.clone() {
        let app = app.clone();
        let title = e.title.clone();
        b.connect_clicked(move |_| {
            if let Some(client) = app.client.borrow().clone() {
                let page = super::detail::build(
                    app.clone(),
                    client.clone(),
                    super::images::Images::new(client),
                    id.clone(),
                );
                app.push_page(&title, &page);
            }
        });
    } else {
        b.set_sensitive(false);
    }
    b
}

impl Cal {
    fn range(&self) -> (Date, Date) {
        let a = self.anchor.get();
        match self.view.get() {
            View::Agenda => (a, add_days(a, 29)),
            View::Week => (a, add_days(a, 6)),
            View::Month => (
                a,
                Date {
                    d: days_in_month(a.y, a.m),
                    ..a
                },
            ),
        }
    }

    fn refresh(self: &Rc<Self>) {
        self.generation.set(self.generation.get() + 1);
        let gen = self.generation.get();
        let (from, to) = self.range();
        self.nav_row.set_visible(self.view.get() != View::Agenda);
        self.nav_label.set_label(&match self.view.get() {
            View::Month => format!("{} {}", MONTHS[from.m as usize - 1], from.y),
            _ => format!("{} – {}", day_label(from), day_label(to)),
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
            if let Some(d) = parse(&e.date) {
                m.entry(d).or_default().push(e.clone());
            }
        }
        m
    }

    fn day_section(&self, dt: Date, entries: &[CalendarEntry], empty_text: Option<&str>) {
        let head = gtk4::Label::builder()
            .label(day_label(dt).to_uppercase())
            .css_classes(["pa-day"])
            .xalign(0.0)
            .margin_top(10)
            .build();
        if dt == today() {
            head.add_css_class("pa-today");
        }
        self.body.append(&head);
        for e in entries {
            self.body.append(&entry_widget(&self.app, e));
        }
        if entries.is_empty() {
            if let Some(t) = empty_text {
                self.body.append(
                    &gtk4::Label::builder()
                        .label(t)
                        .css_classes(["pa-muted"])
                        .xalign(0.0)
                        .build(),
                );
            }
        }
    }

    fn render(self: &Rc<Self>) {
        let days = self.by_day();
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
                    self.day_section(*d, es, None);
                }
            }
            View::Week => {
                let start = self.anchor.get();
                for i in 0..7 {
                    let d = add_days(start, i);
                    self.day_section(d, days.get(&d).map(Vec::as_slice).unwrap_or(&[]), Some("Nothing today"));
                }
            }
            View::Month => self.render_month(&days),
        }
    }

    fn render_month(self: &Rc<Self>, days: &BTreeMap<Date, Vec<CalendarEntry>>) {
        let first = self.anchor.get();
        let grid = gtk4::Grid::builder()
            .column_homogeneous(true)
            .row_spacing(2)
            .halign(gtk4::Align::Center)
            .build();
        for (i, n) in DAYS.iter().enumerate() {
            grid.attach(
                &gtk4::Label::builder().label(*n).css_classes(["pa-muted"]).build(),
                i as i32,
                0,
                1,
                1,
            );
        }
        let offset = weekday(first) as i64;
        let selected = self.selected.get().unwrap_or_else(|| {
            if today().y == first.y && today().m == first.m {
                today()
            } else {
                first
            }
        });
        self.selected.set(Some(selected));
        for n in 0..days_in_month(first.y, first.m) {
            let d = Date { d: n + 1, ..first };
            let idx = offset + n as i64;
            let overlay = gtk4::Overlay::new();
            let b = gtk4::Button::builder()
                .label(d.d.to_string())
                .css_classes(["pa-cell"])
                .build();
            if d == selected {
                b.add_css_class("selected");
            }
            overlay.set_child(Some(&b));
            if days.contains_key(&d) {
                overlay.add_overlay(
                    &gtk4::Box::builder()
                        .css_classes(["pa-dot"])
                        .halign(gtk4::Align::Center)
                        .valign(gtk4::Align::End)
                        .margin_bottom(5)
                        .build(),
                );
            }
            let me = self.clone();
            b.connect_clicked(move |_| {
                me.selected.set(Some(d));
                while let Some(c) = me.body.first_child() {
                    me.body.remove(&c);
                }
                me.render();
            });
            grid.attach(&overlay, (idx % 7) as i32, 1 + (idx / 7) as i32, 1, 1);
        }
        self.body.append(&grid);
        self.day_section(
            selected,
            days.get(&selected).map(Vec::as_slice).unwrap_or(&[]),
            Some("Nothing on this day"),
        );
    }

    fn set_view(self: &Rc<Self>, v: View) {
        self.view.set(v);
        let t = today();
        self.anchor.set(match v {
            View::Agenda => t,
            View::Week => add_days(t, -(weekday(t) as i64)),
            View::Month => Date { d: 1, ..t },
        });
        self.selected.set(None);
        self.refresh();
    }

    fn step(self: &Rc<Self>, dir: i64) {
        let a = self.anchor.get();
        self.anchor.set(match self.view.get() {
            View::Week => add_days(a, 7 * dir),
            View::Month => {
                let m0 = a.y * 12 + a.m as i32 - 1 + dir as i32;
                Date {
                    y: m0.div_euclid(12),
                    m: m0.rem_euclid(12) as u32 + 1,
                    d: 1,
                }
            }
            View::Agenda => a,
        });
        self.selected.set(None);
        self.refresh();
    }
}

pub fn build(app: Rc<App>, client: Client) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 10);
    page.set_margin_top(20);
    page.set_margin_bottom(110);
    page.set_margin_start(16);
    page.set_margin_end(16);
    page.append(
        &gtk4::Label::builder()
            .label("Calendar")
            .css_classes(["pa-pagehead"])
            .xalign(0.0)
            .build(),
    );

    let seg = gtk4::Box::builder()
        .css_classes(["pa-seg", "linked"])
        .halign(gtk4::Align::Start)
        .build();
    let agenda = gtk4::ToggleButton::builder().label("Agenda").active(true).build();
    let week = gtk4::ToggleButton::builder().label("Week").group(&agenda).build();
    let month = gtk4::ToggleButton::builder().label("Month").group(&agenda).build();
    for b in [&agenda, &week, &month] {
        seg.append(b);
    }
    page.append(&seg);

    let nav_row = gtk4::Box::new(gtk4::Orientation::Horizontal, 8);
    let prev = gtk4::Button::builder()
        .icon_name("go-previous-symbolic")
        .css_classes(["pa-secondary"])
        .build();
    let next = gtk4::Button::builder()
        .icon_name("go-next-symbolic")
        .css_classes(["pa-secondary"])
        .build();
    let nav_label = gtk4::Label::builder().css_classes(["pa-body"]).hexpand(true).build();
    nav_row.append(&prev);
    nav_row.append(&nav_label);
    nav_row.append(&next);
    page.append(&nav_row);

    let body = gtk4::Box::new(gtk4::Orientation::Vertical, 8);
    page.append(&body);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    let t = today();
    let cal = Rc::new(Cal {
        app,
        client,
        view: Cell::new(View::Agenda),
        anchor: Cell::new(t),
        selected: Cell::new(None),
        nav_label,
        nav_row,
        body,
        generation: Cell::new(0),
        entries: RefCell::default(),
    });
    for (b, v) in [(&agenda, View::Agenda), (&week, View::Week), (&month, View::Month)] {
        let cal = cal.clone();
        b.connect_toggled(move |b| {
            if b.is_active() {
                cal.set_view(v);
            }
        });
    }
    {
        let cal = cal.clone();
        prev.connect_clicked(move |_| cal.step(-1));
    }
    {
        let cal = cal.clone();
        next.connect_clicked(move |_| cal.step(1));
    }
    // Capture hook: switch the view.
    {
        let (agenda, week, month) = (agenda.clone(), week.clone(), month.clone());
        cal.app.hooks.borrow_mut().insert(
            "calendar-view",
            Rc::new(move |v: &str| match v {
                "week" => week.set_active(true),
                "month" => month.set_active(true),
                _ => agenda.set_active(true),
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
