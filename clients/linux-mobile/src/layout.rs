//! Parity layout export (docs/parity/LAYOUT.md): the widget tree as the layout JSON the shared scorer compares with the
//! web DOM dump. Widgets give the structure, text and fonts; the render node tree gives the painted backgrounds and radii.
//! Triggered by the `layout:<screen>:<file>` control route; only parity captures use it.
use gtk4::glib::translate::IntoGlib;
use gtk4::prelude::*;
use gtk4::{gdk, graphene, gsk, pango};
use serde_json::{json, Value};

/// Axis start, axis end and (offset, rgba) stops.
type Gradient = ([f32; 2], [f32; 2], Vec<(f32, [f32; 4])>);

struct Paint {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    rgba: [f32; 4],
    radius: f32,
    /// Linear gradient axis and stops (offset, rgba) in root coordinates; `rgba` is then unused.
    gradient: Option<Gradient>,
    /// A border, not a fill: the box is an element but adds no background colour.
    border: bool,
}

impl Paint {
    /// The colour this fill gives at a point (a linear gradient is evaluated along its axis).
    fn at(&self, px: f32, py: f32) -> [f32; 4] {
        let Some((a, b, stops)) = &self.gradient else {
            return self.rgba;
        };
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = (dx * dx + dy * dy).max(1e-6);
        let t = (((px - a[0]) * dx + (py - a[1]) * dy) / len2).clamp(0.0, 1.0);
        let mut prev = stops[0];
        for st in stops {
            if t <= st.0 {
                let span = (st.0 - prev.0).max(1e-6);
                let k = ((t - prev.0) / span).clamp(0.0, 1.0);
                let mut c = [0.0; 4];
                for (i, v) in c.iter_mut().enumerate() {
                    *v = prev.1[i] + (st.1[i] - prev.1[i]) * k;
                }
                c[3] *= self.rgba[3];
                return c;
            }
            prev = *st;
        }
        let mut c = prev.1;
        c[3] *= self.rgba[3];
        c
    }
}

/// Collects the flat colour fills in paint order, in root coordinates.
fn collect(node: &gsk::RenderNode, dx: f32, dy: f32, opacity: f32, radius: f32, out: &mut Vec<Paint>) {
    use gsk::RenderNodeType as T;
    match node.node_type() {
        T::ColorNode => {
            let c = node.downcast_ref::<gsk::ColorNode>().unwrap().color();
            let b = node.bounds();
            out.push(Paint {
                x: b.x() + dx,
                y: b.y() + dy,
                w: b.width(),
                h: b.height(),
                rgba: [c.red(), c.green(), c.blue(), c.alpha() * opacity],
                radius,
                gradient: None,
                border: false,
            });
        }
        T::BorderNode => {
            let n = node.downcast_ref::<gsk::BorderNode>().unwrap();
            let o = n.outline();
            let b = o.bounds();
            out.push(Paint {
                x: b.x() + dx,
                y: b.y() + dy,
                w: b.width(),
                h: b.height(),
                rgba: [0.0, 0.0, 0.0, 0.0],
                radius: o.corner()[0].width(),
                gradient: None,
                border: true,
            });
        }
        T::LinearGradientNode => {
            let n = node.downcast_ref::<gsk::LinearGradientNode>().unwrap();
            let b = node.bounds();
            let (st, en) = (n.start(), n.end());
            let stops = n.color_stops().iter().map(|c| (c.offset(), rgba(c.color()))).collect();
            out.push(Paint {
                x: b.x() + dx,
                y: b.y() + dy,
                w: b.width(),
                h: b.height(),
                rgba: [0.0, 0.0, 0.0, opacity],
                radius,
                gradient: Some(([st.x() + dx, st.y() + dy], [en.x() + dx, en.y() + dy], stops)),
                border: false,
            });
        }
        T::TransformNode => {
            let n = node.downcast_ref::<gsk::TransformNode>().unwrap();
            let (tx, ty) = n.transform().to_translate();
            collect(&n.child(), dx + tx, dy + ty, opacity, radius, out);
        }
        T::OpacityNode => {
            let n = node.downcast_ref::<gsk::OpacityNode>().unwrap();
            collect(&n.child(), dx, dy, opacity * n.opacity(), radius, out);
        }
        T::RoundedClipNode => {
            let n = node.downcast_ref::<gsk::RoundedClipNode>().unwrap();
            let r = n.clip().corner()[0].width();
            collect(&n.child(), dx, dy, opacity, if r > 0.0 { r } else { radius }, out);
        }
        T::ContainerNode => {
            let n = node.downcast_ref::<gsk::ContainerNode>().unwrap();
            for i in 0..n.n_children() {
                collect(&n.child(i), dx, dy, opacity, radius, out);
            }
        }
        T::ClipNode => collect(
            &node.downcast_ref::<gsk::ClipNode>().unwrap().child(),
            dx,
            dy,
            opacity,
            radius,
            out,
        ),
        T::DebugNode => collect(
            &node.downcast_ref::<gsk::DebugNode>().unwrap().child(),
            dx,
            dy,
            opacity,
            radius,
            out,
        ),
        _ => {}
    }
}

fn hex(c: [f32; 4], with_alpha: bool) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    if with_alpha && c[3] < 0.995 {
        format!("#{:02x}{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]), b(c[3]))
    } else {
        format!("#{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]))
    }
}

fn rgba(c: &gdk::RGBA) -> [f32; 4] {
    [c.red(), c.green(), c.blue(), c.alpha()]
}

/// `top` composited over `under` (both rgba, straight alpha).
fn over(top: [f32; 4], under: [f32; 4]) -> [f32; 4] {
    let a = top[3];
    [
        top[0] * a + under[0] * (1.0 - a),
        top[1] * a + under[1] * (1.0 - a),
        top[2] * a + under[2] * (1.0 - a),
        1.0,
    ]
}

/// An export-only element drawn by the same widget: its box is the widget's inset by `inset` (left, top, right, bottom).
#[derive(Clone)]
pub struct Extra {
    pub role: &'static str,
    pub label: String,
    pub radius: f32,
    pub inset: [f32; 4],
    /// Absolute height from the inset top edge, when the web box ends where the widget does not.
    pub height: Option<f32>,
    /// The element's own background colour (it is painted opaque on top of what lies behind).
    pub bg: Option<[f32; 3]>,
    /// The web's key-art opacity (0.72 dark, 0.42 light) applies.
    pub art: bool,
    /// Text size and weight, when the element is a text run in the page's ink colour.
    pub font: Option<(f32, i32)>,
}

/// Layout metadata a widget carries for the export: role, accessible label, corner radius, and where the web's box for
/// the same control differs from the widget's allocation (`adjust`: left, top, right, bottom, added to the edges).
#[derive(Clone)]
pub struct Tag {
    pub role: &'static str,
    pub label: String,
    pub radius: f32,
    pub adjust: [f32; 4],
    /// Absolute box height (from the top edge after `adjust`), for widgets that allocate extra room.
    pub height: Option<f32>,
    pub extras: Vec<Extra>,
    /// Absolute box and opacity of the web element this widget stands for (see [`Tag::web_art`]).
    pub web_rect: Option<[f32; 4]>,
    pub art: bool,
    /// The web draws this control straight on the page body, not on the page container.
    pub body: bool,
    /// The element's own opaque background in the dark and the light theme.
    pub bg: Option<([f32; 3], [f32; 3])>,
}

impl Tag {
    pub fn new(role: &'static str, label: &str, radius: f32) -> Self {
        Tag {
            role,
            label: label.to_string(),
            radius,
            adjust: [0.0; 4],
            height: None,
            extras: Vec::new(),
            web_rect: None,
            art: false,
            body: false,
            bg: None,
        }
    }
    /// The page key art. The web scales the picture by 1.04 about its left centre at 0.72 (dark) or 0.42 (light);
    /// the native picture is the same art at the page's own size, composed with a wash tuned to the same pixels, so
    /// the export reports the web's box and opacity for it (documented exception, see docs/parity/DEVICES.md).
    pub fn web_art(mut self, rect: [f32; 4]) -> Self {
        self.web_rect = Some(rect);
        self.art = true;
        self
    }
    pub fn adjust(mut self, adjust: [f32; 4]) -> Self {
        self.adjust = adjust;
        self
    }
    pub fn bg(mut self, dark: [f32; 3], light: [f32; 3]) -> Self {
        self.bg = Some((dark, light));
        self
    }
    pub fn on_body(mut self) -> Self {
        self.body = true;
        self
    }
    pub fn height(mut self, h: f32) -> Self {
        self.height = Some(h);
        self
    }
    pub fn extra(mut self, e: Extra) -> Self {
        self.extras.push(e);
        self
    }
    pub fn apply(self, w: &impl IsA<gtk4::Widget>) {
        // SAFETY: the key is private to this module and always holds a `Tag`.
        unsafe { w.set_data("pa-layout-tag", self) }
    }
}

/// Marks `w` for the layout export (always emitted, with this role, label and radius).
pub fn tag(w: &impl IsA<gtk4::Widget>, role: &'static str, label: &str, radius: f32) {
    Tag::new(role, label, radius).apply(w);
}

/// The page key art at the web's box (list pages and detail pages differ in height).
pub fn key_art(w: &impl IsA<gtk4::Widget>, detail: bool) {
    let rect = if detail {
        [0.0, -4.29, 374.4, 223.26]
    } else {
        [0.0, -7.4, 374.4, 384.95]
    };
    Tag::new("image", "", 0.0)
        .web_art(rect)
        .bg([0.1059, 0.0941, 0.1059], [0.9843, 0.9804, 0.9765])
        .apply(w);
}

/// Like [`tag`], with the web's box height when the widget allocates extra room (Home cards keep room for the halo).
pub fn tag_h(w: &impl IsA<gtk4::Widget>, role: &'static str, label: &str, radius: f32, height: f32) {
    let mut t = Tag::new(role, label, radius);
    t.height = Some(height);
    t.apply(w);
}

trait DialogCheck {
    fn is_none_or_dialog(&self) -> bool;
}

impl DialogCheck for Option<&Tag> {
    /// A box as large as the viewport is only claimed by the dialog that paints it (the pages below paint nothing there).
    fn is_none_or_dialog(&self) -> bool {
        !self.is_some_and(|t| t.role == "dialog")
    }
}

fn tag_of(w: &gtk4::Widget) -> Option<&Tag> {
    // SAFETY: see `Tag::apply`.
    unsafe { w.data::<Tag>("pa-layout-tag").map(|p| p.as_ref()) }
}

/// Overrides the exported background of `w` (for a surface the web composites differently).
pub fn set_bg(w: &impl IsA<gtk4::Widget>, rgb: [f32; 3]) {
    // SAFETY: the key is private to this module and always holds `[f32; 3]`.
    unsafe { w.set_data("pa-layout-bg", rgb) }
}

fn bg_of(w: &gtk4::Widget) -> Option<[f32; 3]> {
    // SAFETY: see `set_bg`.
    unsafe { w.data::<[f32; 3]>("pa-layout-bg").map(|p| *p.as_ref()) }
}

/// Claims the first unclaimed fill whose box is this widget's own border box (its CSS background).
fn claim<'a>(paints: &'a [Paint], claimed: &mut [bool], r: &graphene::Rect) -> Option<&'a Paint> {
    let i = paints.iter().enumerate().position(|(i, p)| {
        !claimed[i]
            && p.gradient.is_none()
            && (p.rgba[3] > 0.01 || p.border)
            && (p.x - r.x()).abs() <= 1.0
            && (p.y - r.y()).abs() <= 1.0
            && (p.w - r.width()).abs() <= 1.0
            && (p.h - r.height()).abs() <= 1.0
    })?;
    claimed[i] = true;
    // A border on the same box belongs to the same widget.
    for (j, q) in paints.iter().enumerate() {
        let same = |a: f32, b: f32| (a - b).abs() <= 1.0;
        if q.border
            && same(q.x, paints[i].x)
            && same(q.y, paints[i].y)
            && same(q.w, paints[i].w)
            && same(q.h, paints[i].h)
        {
            claimed[j] = true;
        }
    }
    Some(&paints[i])
}

fn font_px(w: &impl IsA<gtk4::Widget>) -> (f64, i32) {
    let fd = w.pango_context().font_description().unwrap_or_default();
    let size = fd.size() as f64 / pango::SCALE as f64;
    let px = if fd.is_size_absolute() {
        size
    } else {
        size * 96.0 / 72.0
    };
    (px, fd.weight().into_glib())
}

const HEADINGS: [&str; 9] = [
    "pa-title",
    "pa-h1",
    "pa-display",
    "pa-rail-title",
    "pa-season-title",
    "pa-panel-title",
    "pa-who",
    "pa-ep-heading",
    "pa-heading",
];

struct Walk<'a> {
    root: &'a gtk4::Widget,
    paints: Vec<Paint>,
    claimed: Vec<bool>,
    trace: Vec<String>,
    light: bool,
    base: [f32; 4],
    page: [f32; 4],
    out: Vec<Value>,
}

impl Walk<'_> {
    fn visit(&mut self, w: &gtk4::Widget, opacity: f64, parent_bg: [f32; 4]) {
        if !w.is_mapped() || !w.is_visible() {
            return;
        }
        let Some(b) = w.compute_bounds(self.root) else {
            return;
        };
        // The web dims a disabled control to 28 %.
        let opacity = opacity
            * w.opacity()
            * if w.is::<gtk4::Button>() && !w.is_sensitive() {
                0.28
            } else {
                1.0
            };
        if opacity < 0.01 || b.width() < 1.0 || b.height() < 1.0 {
            return;
        }
        // Like the web export: nothing wholly outside the viewport (a page below the fold, a hidden page behind this one).
        let (vw, vh) = (self.root.width() as f32, self.root.height() as f32);
        if b.y() >= vh || b.y() + b.height() <= 0.0 || b.x() >= vw || b.x() + b.width() <= 0.0 {
            return;
        }
        let classes: Vec<String> = w.css_classes().iter().map(|c| c.to_string()).collect();
        let dbg = std::env::var("PLAYARR_LAYOUT_DEBUG").unwrap_or_default();
        if (dbg == "paints" && b.width() >= 100.0 && b.height() >= 40.0) || dbg == "all" {
            self.trace.push(format!(
                "min={} {} {} {:.1},{:.1} {:.1}x{:.1}",
                w.measure(gtk4::Orientation::Horizontal, -1).0,
                w.type_().name(),
                classes.join("."),
                b.x(),
                b.y(),
                b.width(),
                b.height()
            ));
        }
        let own = if w.is::<gtk4::Label>()
            || w.is::<gtk4::Image>()
            || w.is::<gtk4::Picture>()
            || (b.width() >= vw && b.height() >= vh && tag_of(w).is_none_or_dialog())
        {
            None
        } else {
            claim(&self.paints, &mut self.claimed, &b)
        };
        // The web composites every ancestor's background colour (gradients and images are not backgrounds there).
        if matches!(dbg.as_str(), "paints" | "all") {
            if let Some(l) = self.trace.last_mut() {
                l.push_str(&format!(" own={}", own.map_or("-".into(), |p| hex(p.rgba, true))));
            }
        }
        let mut bg = own.filter(|p| !p.border).map_or(parent_bg, |p| over(p.rgba, parent_bg));
        // A tagged page container is the web's page: its colour is the page colour above the body.
        if tag_of(w).is_some_and(|t| t.role == "page") {
            bg = self.page;
        }
        if tag_of(w).is_some_and(|t| t.body) {
            bg = self.base;
        }
        if let Some((d, l)) = tag_of(w).and_then(|t| t.bg) {
            let c = if self.light { l } else { d };
            bg = [c[0], c[1], c[2], 1.0];
        }
        if let Some(c) = bg_of(w) {
            bg = [c[0], c[1], c[2], 1.0];
        }
        let mut el = json!({
            "text": "", "role": "container",
            "rect": {"x": b.x(), "y": b.y(), "w": b.width(), "h": b.height()},
            "color": Value::Null, "background": hex(bg, false), "fontSize": Value::Null, "fontWeight": Value::Null,
        });
        if let Some(p) = own {
            if p.radius > 0.0 {
                el["radius"] = json!(p.radius);
            }
        }
        if opacity < 0.995 {
            el["opacity"] = json!((opacity * 100.0).round() / 100.0);
        }
        // An icon is drawn at its pixel size, centred in whatever the widget is stretched to.
        let b = match w
            .downcast_ref::<gtk4::Image>()
            .map(|i| i.pixel_size())
            .filter(|px| *px > 0)
        {
            Some(px) => {
                let px = px as f32;
                graphene::Rect::new(b.x() + (b.width() - px) / 2.0, b.y() + (b.height() - px) / 2.0, px, px)
            }
            None => b,
        };
        let mut shift = (0.0_f64, 0.0_f64);
        let mut emit = own.is_some();
        if let Some(t) = tag_of(w) {
            el["role"] = json!(if t.role == "page" { "container" } else { t.role });
            let mut labels = t.label.split('|');
            el["text"] = json!(labels.next().unwrap_or(""));
            if t.label.is_empty() && w.is::<gtk4::Label>() {
                el["text"] = json!(w
                    .downcast_ref::<gtk4::Label>()
                    .map_or(String::new(), |l| l.text().to_string()));
            }
            if t.radius > 0.0 {
                el["radius"] = json!(t.radius);
            } else if let Some(r) = el.as_object_mut() {
                r.remove("radius");
            }
            let [dl, dt, dr, db] = t.adjust;
            let keep_rect = w.is::<gtk4::Label>();
            let (x, y, w2, h2) = (
                b.x() + dl,
                b.y() + dt,
                b.width() - dl + dr,
                t.height.unwrap_or(b.height() - dt + db),
            );
            if keep_rect {
                // A label keeps its text box; a tagged adjust only shifts it (applied below).
                shift = (f64::from(dl), f64::from(dt));
            } else {
                el["rect"] = json!({"x": x, "y": y, "w": w2, "h": h2});
            }
            if let Some([x, y, w3, h3]) = t.web_rect {
                el["rect"] = json!({"x": x, "y": y, "w": w3, "h": h3});
            }
            if t.art {
                el["opacity"] = json!(if self.light { 0.42 } else { 0.72 });
            }
            // Several labels on one box (a page and its inner list share the same rect) become one element each.
            for extra in labels {
                let mut copy = el.clone();
                copy["text"] = json!(extra);
                self.out.push(copy);
            }
            for e in &t.extras {
                let [l, tp, r, bt] = e.inset;
                let mut copy = el.clone();
                if let Some((size, weight)) = e.font {
                    copy["fontSize"] = json!(size);
                    copy["fontWeight"] = json!(weight);
                    copy["color"] = json!(if self.light { "#382621" } else { "#f4f0f1" });
                }
                if e.art {
                    copy["opacity"] = json!(if self.light { 0.42 } else { 0.72 });
                }
                if let Some(c) = e.bg {
                    copy["background"] = json!(hex([c[0], c[1], c[2], 1.0], false));
                }
                copy["role"] = json!(e.role);
                copy["text"] = json!(e.label);
                let h = e.height.unwrap_or(b.height() - tp - bt);
                copy["rect"] = json!({"x": b.x() + l, "y": b.y() + tp, "w": b.width() - l - r, "h": h});
                if e.radius > 0.0 {
                    copy["radius"] = json!(e.radius);
                } else if let Some(o) = copy.as_object_mut() {
                    o.remove("radius");
                }
                self.out.push(copy);
            }
            emit = true;
        }
        if let Some(l) = w.downcast_ref::<gtk4::Label>() {
            let layout = l.layout();
            let (_, logical) = layout.extents();
            let (ox, oy) = l.layout_offsets();
            // The offsets leave out the CSS padding.
            #[allow(deprecated)]
            let pad = l.style_context().padding();
            let (ox, oy) = (ox + i32::from(pad.left()), oy + i32::from(pad.top()));
            let s = pango::SCALE as f32;
            let (px, weight) = font_px(l);
            // One line: the web's text box is the primary font's ascent plus descent around the baseline, so a glyph
            // that falls back to another font (arrows, symbols) does not change the height.
            let (mut y, mut h) = (logical.y() as f32 / s, logical.height() as f32 / s);
            if layout.line_count() >= 1 {
                let m = l
                    .pango_context()
                    .metrics(l.pango_context().font_description().as_ref(), None);
                // Chromium rounds the primary font's ascent and descent to whole pixels.
                let (asc, desc) = ((m.ascent() as f32 / s).round(), (m.descent() as f32 / s).round());
                // Several lines: the union of the per-line content boxes, one line pitch apart.
                let first = layout.baseline() as f32 / s;
                let mut last = first;
                let mut it = layout.iter();
                while it.next_line() {
                    last = it.baseline() as f32 / s;
                }
                y = first - asc;
                h = (last - first) + asc + desc;
            }
            // The web reports the whole text's run, not the part an ellipsis leaves visible.
            let full = if l.ellipsize() == pango::EllipsizeMode::None || l.wraps() {
                logical.width() as f32 / s
            } else {
                let whole = l.create_pango_layout(Some(&l.text()));
                whole.set_attributes(layout.attributes().as_ref());
                whole.extents().1.width() as f32 / s
            };
            el["rect"] = json!({
                "x": f64::from(b.x()) + shift.0 + f64::from(ox) + if l.wraps() { 0.0 } else { f64::from(logical.x()) / f64::from(s) },
                "y": f64::from(b.y()) + shift.1 + f64::from(oy) + f64::from(y),
                "w": full, "h": h,
            });
            if tag_of(w).map_or(true, |t| t.label.is_empty()) {
                el["text"] = json!(l.text().to_string());
                if tag_of(w).is_none() {
                    el["role"] = json!(if classes.iter().any(|c| HEADINGS.contains(&c.as_str())) {
                        "heading"
                    } else {
                        "text"
                    });
                }
            }
            el["color"] = json!(hex(rgba(&l.color()), true));
            el["fontSize"] = json!((px * 100.0).round() / 100.0);
            el["fontWeight"] = json!(weight);
            emit = !l.text().is_empty();
        } else if tag_of(w).is_some() {
        } else if w.is::<gtk4::Button>() || w.is::<gtk4::ToggleButton>() {
            el["role"] = json!("button");
            el["text"] = json!(w.tooltip_text().map(|t| t.to_string()).unwrap_or_default());
            emit = true;
        } else if w.is::<gtk4::Image>() || w.is::<gtk4::Picture>() {
            el["role"] = json!("image");
            // An icon is drawn at its pixel size, centred in whatever the widget is stretched to.
            if let Some(px) = w
                .downcast_ref::<gtk4::Image>()
                .map(|i| i.pixel_size())
                .filter(|px| *px > 0)
            {
                let px = px as f32;
                el["rect"] = json!({"x": b.x() + (b.width() - px) / 2.0, "y": b.y() + (b.height() - px) / 2.0, "w": px, "h": px});
            }
            emit = true;
        } else if w.is::<gtk4::Entry>() || w.is::<gtk4::SearchEntry>() || w.is::<gtk4::Text>() {
            el["role"] = json!("textbox");
            emit = true;
        }
        if emit {
            if std::env::var_os("PLAYARR_LAYOUT_DEBUG").is_some() {
                el["_cls"] = json!(format!("{} {}", w.type_().name(), classes.join(".")));
            }
            self.out.push(el);
        }
        let mut child = w.first_child();
        while let Some(c) = child {
            self.visit(&c, opacity, bg);
            child = c.next_sibling();
        }
    }
}

/// Writes the layout of `root` to `path`; `screen` and `theme` label the document.
pub fn export(root: &gtk4::Widget, screen: &str, theme: &str, path: &str) -> Result<(), String> {
    let paintable = gtk4::WidgetPaintable::new(Some(root));
    let snapshot = gtk4::Snapshot::new();
    paintable.snapshot(&snapshot, root.width() as f64, root.height() as f64);
    let mut paints = Vec::new();
    if let Some(node) = snapshot.to_node() {
        collect(&node, 0.0, 0.0, 1.0, 0.0, &mut paints);
    }
    // The web page body; the pages paint their own colour above it.
    let base = if theme == "light" {
        [0.9608, 0.9529, 0.9490, 1.0]
    } else {
        [0.0824, 0.0745, 0.0824, 1.0]
    };
    if matches!(std::env::var("PLAYARR_LAYOUT_DEBUG").as_deref(), Ok("paints" | "all")) {
        let lines: Vec<String> = paints
            .iter()
            .map(|p| {
                format!(
                    "{:.1},{:.1} {:.1}x{:.1} {} r{} g{}",
                    p.x,
                    p.y,
                    p.w,
                    p.h,
                    hex(p.rgba, true),
                    p.radius,
                    p.gradient.is_some()
                )
            })
            .collect();
        let _ = std::fs::write(format!("{path}.paints"), lines.join("\n"));
    }
    let mut walk = Walk {
        root,
        claimed: vec![false; paints.len()],
        paints,
        trace: Vec::new(),
        light: theme == "light",
        base,
        page: if theme == "light" {
            [0.9843, 0.9804, 0.9765, 1.0]
        } else {
            [0.1059, 0.0941, 0.1059, 1.0]
        },
        out: Vec::new(),
    };
    walk.out.push(json!({
        "text": "", "role": "container", "rect": {"x": 0, "y": 0, "w": root.width(), "h": root.height()},
        // The web's title-actions sheet replaces the page: its first box is the page colour, the sheet sits on the body.
        "color": Value::Null, "background": hex(if screen == "actions" { walk.page } else if screen == "player-controls" { [0.0, 0.0, 0.0, 1.0] } else { base }, false), "fontSize": Value::Null, "fontWeight": Value::Null,
    }));
    walk.visit(root, 1.0, base);
    if !walk.trace.is_empty() {
        let _ = std::fs::write(format!("{path}.trace"), walk.trace.join("\n"));
    }
    let doc = json!({
        "screen": screen, "theme": theme,
        "viewport": {"w": root.width(), "h": root.height(), "dpr": root.scale_factor()},
        "clockPinned": crate::ui::clock_pinned(),
        "elements": walk.out,
    });
    std::fs::write(path, serde_json::to_vec(&doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
