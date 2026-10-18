//! Home: a faded key-art backdrop and horizontal rails of 328 px cards, "On deck" first, then the server's rails.
use super::cards::{card, home_art_h, home_cover, home_w, CardOpts};
use super::images::Images;
use super::{bg, App};
use crate::api::Client;
use crate::model::{Rail, Work};
use gtk4::glib;
use gtk4::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

struct Deck {
    work: Work,
    fraction: f64,
}

struct RailRow {
    scrolled: gtk4::ScrolledWindow,
    cards: Vec<gtk4::Button>,
    selected: Option<gtk4::Button>,
}

fn rail_row(children: impl IntoIterator<Item = gtk4::Button>, selected: bool) -> RailRow {
    let row = gtk4::Box::new(gtk4::Orientation::Horizontal, 12);
    row.set_margin_start(16);
    row.set_margin_end(16);
    let mut cards = Vec::new();
    let mut selected_card = None;
    for c in children {
        if selected && cards.is_empty() {
            selected_card = Some(c.clone());
        }
        row.append(&c);
        cards.push(c);
    }
    let scrolled = gtk4::ScrolledWindow::builder()
        .child(&row)
        .vscrollbar_policy(gtk4::PolicyType::Never)
        .hscrollbar_policy(gtk4::PolicyType::Automatic)
        .propagate_natural_height(true)
        .build();
    // GTK scrolls a focused card only just into view: keep the page gutter beside it, so the last card's ring and
    // glow are not cut at the screen edge.
    for card in &cards {
        let (adj, row) = (scrolled.hadjustment(), row.downgrade());
        card.connect_has_focus_notify(move |card| {
            let Some(row) = row.upgrade().filter(|_| card.has_focus()) else {
                return;
            };
            let Some(b) = card.compute_bounds(&row) else { return };
            let (left, right) = (f64::from(b.x()) - 16.0, f64::from(b.x() + b.width()) + 16.0);
            if right > adj.value() + adj.page_size() {
                adj.set_value(right - adj.page_size());
            } else if left < adj.value() {
                adj.set_value(left.max(0.0));
            }
        });
    }
    RailRow {
        scrolled,
        cards,
        selected: selected_card,
    }
}

struct FocusSection {
    widget: gtk4::Overlay,
    scrolled: gtk4::ScrolledWindow,
    cards: Vec<gtk4::Button>,
    selected: Option<gtk4::Button>,
    halo_layer: gtk4::Fixed,
    halo: gtk4::Box,
}

fn section(title: &str, row: RailRow) -> FocusSection {
    let content = gtk4::Box::new(gtk4::Orientation::Vertical, 19);
    content.append(
        &gtk4::Label::builder()
            .label(title)
            .css_classes(["pa-rail-title"])
            .xalign(0.0)
            .margin_start(16)
            .build(),
    );
    // The web's shared scroller edge fade (38 px, eased, to 30% at the end side), as on the detail rails.
    let fade = gtk4::Box::builder()
        .css_classes(["pa-edge-fade"])
        .halign(gtk4::Align::End)
        .can_target(false)
        .build();
    fade.set_size_request(38, -1);
    let faded = gtk4::Overlay::new();
    faded.set_child(Some(&row.scrolled));
    faded.add_overlay(&fade);
    content.append(&faded);
    let section_overlay = gtk4::Overlay::builder().child(&content).build();
    let halo_layer = gtk4::Fixed::new();
    halo_layer.set_hexpand(true);
    halo_layer.set_vexpand(true);
    halo_layer.set_can_target(false);
    let halo = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    halo.add_css_class("pa-art");
    halo.add_css_class("selected");
    halo.add_css_class("pa-home-focus-halo");
    halo.set_size_request(home_w(), home_art_h());
    halo.set_can_target(false);
    halo.set_visible(false);
    halo_layer.put(&halo, 0.0, 0.0);
    // Clip the non-measuring halo to the full section, whose heading and 19px gap provide its outset.
    let halo_clip = gtk4::Viewport::new(None::<&gtk4::Adjustment>, None::<&gtk4::Adjustment>);
    halo_clip.set_child(Some(&halo_layer));
    halo_clip.add_css_class("pa-home-focus-clip");
    halo_clip.set_hexpand(true);
    halo_clip.set_vexpand(true);
    halo_clip.set_halign(gtk4::Align::Fill);
    halo_clip.set_valign(gtk4::Align::Fill);
    halo_clip.set_can_target(false);
    section_overlay.add_overlay(&halo_clip);
    section_overlay.set_measure_overlay(&halo_clip, false);
    FocusSection {
        widget: section_overlay,
        scrolled: row.scrolled,
        cards: row.cards,
        selected: row.selected,
        halo_layer,
        halo,
    }
}

struct FocusSectionWeak {
    widget: glib::WeakRef<gtk4::Overlay>,
    scrolled: glib::WeakRef<gtk4::ScrolledWindow>,
    cards: Vec<glib::WeakRef<gtk4::Button>>,
    layer: glib::WeakRef<gtk4::Fixed>,
    halo: glib::WeakRef<gtk4::Box>,
}

fn track_focused_cards(sections: &[FocusSection]) {
    let sections_weak: Vec<_> = sections
        .iter()
        .map(|section| FocusSectionWeak {
            widget: section.widget.downgrade(),
            scrolled: section.scrolled.downgrade(),
            cards: section.cards.iter().map(|card| card.downgrade()).collect(),
            layer: section.halo_layer.downgrade(),
            halo: section.halo.downgrade(),
        })
        .collect();
    let selected_weak = sections
        .iter()
        .find_map(|section| section.selected.as_ref())
        .map(|selected| selected.downgrade());
    let refresh: Rc<dyn Fn()> = Rc::new(move || {
        let live: Vec<_> = sections_weak
            .iter()
            .filter_map(|section| {
                Some((
                    section.widget.upgrade()?,
                    section.scrolled.upgrade()?,
                    section
                        .cards
                        .iter()
                        .map(|card| card.upgrade())
                        .collect::<Option<Vec<_>>>()?,
                    section.layer.upgrade()?,
                    section.halo.upgrade()?,
                ))
            })
            .collect();
        let target = live
            .iter()
            .flat_map(|(_, _, cards, _, _)| cards)
            .find(|card| card.has_focus())
            .cloned()
            .or_else(|| selected_weak.as_ref().and_then(|selected| selected.upgrade()));

        for (_, scrolled, cards, halo_layer, halo) in live {
            let Some(card) = target
                .as_ref()
                .filter(|target| cards.iter().any(|card| card == *target))
            else {
                halo.set_visible(false);
                continue;
            };
            let (Some(card_bounds), Some(viewport_bounds)) =
                (card.compute_bounds(&halo_layer), scrolled.compute_bounds(&halo_layer))
            else {
                halo.set_visible(false);
                continue;
            };
            let card_right = card_bounds.x() + card.width() as f32;
            let card_bottom = card_bounds.y() + home_art_h() as f32;
            let viewport_right = viewport_bounds.x() + viewport_bounds.width();
            let viewport_bottom = viewport_bounds.y() + viewport_bounds.height();
            if card.width() == 0
                || card_right <= viewport_bounds.x()
                || card_bounds.x() >= viewport_right
                || card_bottom <= viewport_bounds.y()
                || card_bounds.y() >= viewport_bottom
            {
                halo.set_visible(false);
                continue;
            }
            halo.set_size_request(card.width(), home_art_h());
            halo_layer.move_(&halo, card_bounds.x() as f64, card_bounds.y() as f64);
            halo.set_visible(true);
        }
    });

    for section in sections {
        for card in &section.cards {
            let refresh = refresh.clone();
            card.connect_has_focus_notify(move |_| refresh());
        }
        let section_widget = section.widget.downgrade();
        let pending = Rc::new(Cell::new(false));
        let refresh_on_adjustment = refresh.clone();
        let schedule_adjustment_refresh: Rc<dyn Fn()> = Rc::new(move || {
            if pending.replace(true) {
                return;
            }
            let Some(widget) = section_widget.upgrade() else {
                pending.set(false);
                return;
            };
            let pending_tick = pending.clone();
            let section_tick = section_widget.clone();
            let refresh_tick = refresh_on_adjustment.clone();
            widget.add_tick_callback(move |widget, _| {
                if section_tick.upgrade().is_none() {
                    pending_tick.set(false);
                    return gtk4::glib::ControlFlow::Break;
                }
                let pending_after_layout = pending_tick.clone();
                let section_after_layout = section_tick.clone();
                let refresh_after_layout = refresh_tick.clone();
                widget.add_tick_callback(move |_, _| {
                    pending_after_layout.set(false);
                    if section_after_layout.upgrade().is_some() {
                        refresh_after_layout();
                    }
                    gtk4::glib::ControlFlow::Break
                });
                gtk4::glib::ControlFlow::Break
            });
        });
        let adjustment = section.scrolled.hadjustment();
        let refresh_on_scroll = schedule_adjustment_refresh.clone();
        adjustment.connect_value_changed(move |_| refresh_on_scroll());
        let refresh_on_resize = schedule_adjustment_refresh.clone();
        adjustment.connect_changed(move |_| refresh_on_resize());
        let refresh_on_map = refresh.clone();
        section.widget.connect_map(move |widget| {
            let refresh = refresh_on_map.clone();
            widget.add_tick_callback(move |_, _| {
                refresh();
                gtk4::glib::ControlFlow::Break
            });
        });
    }
}

pub fn build(app: Rc<App>, client: Client, imgs: Images) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 50);
    page.set_margin_top(93);
    page.set_margin_bottom(110);
    // The backdrop of the first title, dimmed and washed into the page colour, sits behind the rails.
    let backdrop = gtk4::Picture::builder()
        .content_fit(gtk4::ContentFit::Cover)
        .css_classes(["pa-key-art"])
        .valign(gtk4::Align::Start)
        .build();
    backdrop.set_size_request(-1, 340);
    let wash = gtk4::Box::builder()
        .css_classes(["pa-key-wash"])
        .valign(gtk4::Align::Start)
        .build();
    wash.set_size_request(-1, 340);
    // The web phone's key art is masked to nothing at its right edge and darkened at its left.
    let edge = gtk4::Box::builder()
        .css_classes(["pa-key-edge"])
        .valign(gtk4::Align::Start)
        .build();
    edge.set_size_request(-1, 340);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();
    let overlay = gtk4::Overlay::builder().child(&backdrop).build();
    overlay.add_overlay(&edge);
    overlay.add_overlay(&wash);
    overlay.add_overlay(&scroll);
    scroll.add_css_class("pa-transparent");
    let reload = Rc::new(move |app: Rc<App>| load(&page, &backdrop, app, client.clone(), imgs.clone()));
    reload(app.clone());
    // Coming back from detail or the player refreshes On deck.
    let nav = app.nav.clone();
    nav.connect_popped(move |nav, _| {
        if nav.navigation_stack().n_items() == 1 {
            reload(app.clone());
        }
    });
    overlay.upcast()
}

fn load(page: &gtk4::Box, backdrop: &gtk4::Picture, app: Rc<App>, client: Client, imgs: Images) {
    let (page, backdrop) = (page.clone(), backdrop.clone());
    if page.first_child().is_none() {
        page.append(
            &gtk4::Label::builder()
                .label("Loading…")
                .css_classes(["pa-muted"])
                .build(),
        );
    }
    let c = client.clone();
    bg(
        move || {
            let rails = c.home_rails();
            // Most recently watched first, as the web lists On deck.
            let mut started: Vec<_> = c
                .all_progress()
                .unwrap_or_default()
                .into_iter()
                .filter(|p| p.state == "part_watched" && !p.work_id.is_empty() && p.position_ms > 0)
                .collect();
            started.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            // One entry per title (the newest episode wins), ten at most, as the web's On deck loader.
            let mut seen = std::collections::HashSet::new();
            started.retain(|p| seen.insert(p.work_id.clone()));
            let deck: Vec<Deck> = started
                .into_iter()
                .take(10)
                .filter_map(|p| {
                    let w = c.work(&p.work_id).ok()?.work;
                    Some(Deck {
                        fraction: if p.duration_ms > 0 {
                            p.position_ms as f64 / p.duration_ms as f64
                        } else {
                            0.0
                        },
                        work: w,
                    })
                })
                .collect();
            (rails, deck)
        },
        move |(rails, deck)| {
            while let Some(child) = page.first_child() {
                page.remove(&child);
            }
            let open = {
                let app = app.clone();
                move |w: &Work| app.open_work(w)
            };
            let mut initial_selection = true;
            let mut focus_sections = Vec::new();
            let mut art_set = false;
            let mut set_art = |w: &Work| {
                if !art_set {
                    if let Some(k) = ["backdrop", "poster"].iter().find(|k| w.has_image(k)) {
                        imgs.load(Client::artwork_path(&w.id, k, 1280), &backdrop);
                        art_set = true;
                    }
                }
            };
            if !deck.is_empty() {
                let selected = std::mem::take(&mut initial_selection);
                let cards: Vec<_> = deck
                    .iter()
                    .map(|d| {
                        set_art(&d.work);
                        let opts = CardOpts {
                            width: Some(home_w()),
                            art_h: Some(home_art_h()),
                            kinds: if home_cover() {
                                &["poster", "backdrop", "thumb"]
                            } else {
                                &["backdrop", "thumb", "poster"]
                            },
                            meta: Some(d.work.meta_line()),
                            progress: Some(d.fraction),
                            home_art: true,
                            ..Default::default()
                        };
                        card(&imgs, &d.work, opts, open.clone())
                    })
                    .collect();
                let section = section("On deck", rail_row(cards, selected));
                page.append(&section.widget);
                focus_sections.push(section);
            }
            match rails {
                Err(e) => page.append(
                    &gtk4::Label::builder()
                        .label(e.to_string())
                        .css_classes(["pa-error"])
                        .wrap(true)
                        .margin_start(16)
                        .margin_end(16)
                        .build(),
                ),
                Ok(rails) => {
                    for Rail { title, items, .. } in rails.into_iter().filter(|r| !r.items.is_empty()) {
                        let selected = std::mem::take(&mut initial_selection);
                        let cards: Vec<_> = items
                            .iter()
                            .map(|w| {
                                set_art(w);
                                let opts = CardOpts {
                                    width: Some(home_w()),
                                    art_h: Some(home_art_h()),
                                    kinds: if home_cover() {
                                        &["poster", "backdrop", "thumb"]
                                    } else {
                                        &["backdrop", "thumb", "poster"]
                                    },
                                    meta: Some(w.meta_line()),
                                    unseen: app.is_unseen(w),
                                    home_art: true,
                                    ..Default::default()
                                };
                                card(&imgs, w, opts, open.clone())
                            })
                            .collect();
                        let section = section(&title, rail_row(cards, selected));
                        page.append(&section.widget);
                        focus_sections.push(section);
                    }
                }
            }
            // Capture hook `rail-end:<n>`: focus the last card of rail n (0 = the first), so a capture sees its ring at the edge.
            let last_cards: Vec<_> = focus_sections
                .iter()
                .filter_map(|s| s.cards.last().map(|c| c.downgrade()))
                .collect();
            app.hooks.borrow_mut().insert(
                "rail-end",
                Rc::new(move |arg| {
                    let n = arg.parse::<usize>().unwrap_or(0);
                    if let Some(card) = last_cards.get(n).and_then(|c| c.upgrade()) {
                        card.grab_focus();
                    }
                }),
            );
            track_focused_cards(&focus_sections);
        },
    );
}
