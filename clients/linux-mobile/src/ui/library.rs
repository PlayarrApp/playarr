//! Library grid (movies, series) with infinite scroll.
use super::cards::poster_card;
use super::images::Images;
use super::{bg, App};
use crate::api::Client;
use gtk4::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

const PAGE: usize = 30;

pub fn grid() -> gtk4::FlowBox {
    gtk4::FlowBox::builder()
        .selection_mode(gtk4::SelectionMode::None)
        .min_children_per_line(2)
        .max_children_per_line(3)
        .row_spacing(14)
        .column_spacing(10)
        .homogeneous(true)
        .halign(gtk4::Align::Center)
        .valign(gtk4::Align::Start)
        .margin_start(12)
        .margin_end(12)
        .build()
}

pub fn build(app: Rc<App>, client: Client, imgs: Images, kind: &'static str, title: &str) -> gtk4::Widget {
    let page = gtk4::Box::new(gtk4::Orientation::Vertical, 14);
    page.set_margin_top(20);
    page.set_margin_bottom(110);
    page.append(
        &gtk4::Label::builder()
            .label(title)
            .css_classes(["pa-pagehead"])
            .xalign(0.0)
            .margin_start(16)
            .build(),
    );
    let flow = grid();
    page.append(&flow);
    let status = gtk4::Label::builder()
        .label("Loading…")
        .css_classes(["pa-muted"])
        .build();
    page.append(&status);
    let scroll = gtk4::ScrolledWindow::builder()
        .child(&page)
        .hscrollbar_policy(gtk4::PolicyType::Never)
        .css_classes(["pa-page"])
        .build();

    let loaded = Rc::new(Cell::new(0usize));
    let total = Rc::new(Cell::new(usize::MAX));
    let busy = Rc::new(Cell::new(false));
    let load_more = {
        let (loaded, total, busy) = (loaded.clone(), total.clone(), busy.clone());
        Rc::new(move || {
            if busy.get() || loaded.get() >= total.get() {
                return;
            }
            busy.set(true);
            let (c, offset) = (client.clone(), loaded.get());
            let (flow, status, imgs, app) = (flow.clone(), status.clone(), imgs.clone(), app.clone());
            let (loaded, total, busy) = (loaded.clone(), total.clone(), busy.clone());
            bg(
                move || c.catalog(kind, offset, PAGE, "title"),
                move |res| {
                    busy.set(false);
                    match res {
                        Err(e) => status.set_label(&e.to_string()),
                        Ok(p) => {
                            total.set(p.total.map(|t| t.max(0) as usize).unwrap_or(offset + p.items.len()));
                            loaded.set(offset + p.items.len());
                            if p.items.is_empty() {
                                total.set(loaded.get());
                            }
                            for w in &p.items {
                                let a = app.clone();
                                flow.append(&poster_card(&imgs, w, move |w| a.open_work(w)));
                            }
                            status.set_visible(loaded.get() < total.get());
                            status.set_label("Loading more…");
                        }
                    }
                },
            );
        })
    };
    let lm = load_more.clone();
    scroll.connect_edge_reached(move |_, pos| {
        if pos == gtk4::PositionType::Bottom {
            lm();
        }
    });
    load_more();
    scroll.upcast()
}
