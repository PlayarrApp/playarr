//! Parity layout export (docs/parity/LAYOUT.md): what GTK actually laid out and drew, as the layout JSON the shared scorer
//! compares with the web DOM dump. It reads and converts, nothing else: real widget bounds (transforms and clipping
//! included), real colours, opacities and radii from the GSK snapshot, real Pango line boxes, the accessible role and the
//! accessible name the app sets. It never moves a box, invents an element or substitutes a web value; where the result
//! differs from the web, the app changes. Triggered by the `layout:<screen>:<file>` control route; only parity captures use it.
use gtk4::glib::translate::IntoGlib;
use gtk4::prelude::*;
use gtk4::{gdk, graphene, gsk, pango};
use serde_json::{json, Value};

type Rect = [f32; 4];
/// Axis start, axis end and (offset, rgba) stops.
type Gradient = ([f32; 2], [f32; 2], Vec<(f32, [f32; 4])>);

/// Sets the widget's accessible name (what a screen reader announces), which the export reads back.
pub fn name(w: &impl IsA<gtk4::Widget>, text: &str) {
    w.upcast_ref::<gtk4::Widget>()
        .update_property(&[gtk4::accessible::Property::Label(text)]);
    // SAFETY: the key is private to this module and always holds a `String`.
    unsafe { w.set_data("pa-a11y-name", text.to_string()) };
}

fn a11y_name(w: &gtk4::Widget) -> Option<String> {
    // SAFETY: see `name`.
    unsafe { w.data::<String>("pa-a11y-name").map(|p| p.as_ref().clone()) }
}

/// A flat fill, gradient or border in the snapshot, in root coordinates.
struct Fill {
    b: Rect,
    rgba: [f32; 4],
    radius: f32,
    /// Linear gradient axis start, end and (offset, rgba) stops.
    gradient: Option<Gradient>,
    border: bool,
    opacity: f32,
}

struct Run {
    b: Rect,
    color: [f32; 4],
    opacity: f32,
}

struct Tex {
    b: Rect,
    opacity: f32,
}

#[derive(Default)]
struct Paints {
    fills: Vec<Fill>,
    runs: Vec<Run>,
    textures: Vec<Tex>,
}

fn rect_of(r: &graphene::Rect) -> Rect {
    [r.x(), r.y(), r.width(), r.height()]
}

fn to_root(m: &graphene::Matrix, r: &graphene::Rect) -> Rect {
    rect_of(&m.transform_bounds(r))
}

fn clip_rect(a: Rect, b: Rect) -> Rect {
    let (x0, y0) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x1, y1) = ((a[0] + a[2]).min(b[0] + b[2]), (a[1] + a[3]).min(b[1] + b[3]));
    [x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)]
}

fn collect(node: &gsk::RenderNode, m: &graphene::Matrix, opacity: f32, radius: f32, out: &mut Paints) {
    use gsk::RenderNodeType as T;
    match node.node_type() {
        T::ColorNode => {
            let c = node.downcast_ref::<gsk::ColorNode>().unwrap().color();
            out.fills.push(Fill {
                b: to_root(m, &node.bounds()),
                rgba: rgba(&c),
                radius,
                gradient: None,
                border: false,
                opacity,
            });
        }
        T::BorderNode => {
            let n = node.downcast_ref::<gsk::BorderNode>().unwrap();
            let o = n.outline();
            out.fills.push(Fill {
                b: to_root(m, o.bounds()),
                rgba: [0.0; 4],
                radius: o.corner()[0].width(),
                gradient: None,
                border: true,
                opacity,
            });
        }
        T::LinearGradientNode => {
            let n = node.downcast_ref::<gsk::LinearGradientNode>().unwrap();
            let (s, e) = (m.transform_point(&n.start()), m.transform_point(&n.end()));
            let stops = n.color_stops().iter().map(|c| (c.offset(), rgba(c.color()))).collect();
            out.fills.push(Fill {
                b: to_root(m, &node.bounds()),
                rgba: [0.0; 4],
                radius,
                gradient: Some(([s.x(), s.y()], [e.x(), e.y()], stops)),
                border: false,
                opacity,
            });
        }
        T::TextNode => {
            let n = node.downcast_ref::<gsk::TextNode>().unwrap();
            out.runs.push(Run {
                b: to_root(m, &node.bounds()),
                color: rgba(&n.color()),
                opacity,
            });
        }
        T::TextureNode | T::TextureScaleNode => out.textures.push(Tex {
            b: to_root(m, &node.bounds()),
            opacity,
        }),
        T::TransformNode => {
            let n = node.downcast_ref::<gsk::TransformNode>().unwrap();
            let nm = n.transform().to_matrix().multiply(m);
            collect(&n.child(), &nm, opacity, radius, out);
        }
        T::OpacityNode => {
            let n = node.downcast_ref::<gsk::OpacityNode>().unwrap();
            collect(&n.child(), m, opacity * n.opacity(), radius, out);
        }
        T::RoundedClipNode => {
            let n = node.downcast_ref::<gsk::RoundedClipNode>().unwrap();
            let r = n.clip().corner()[0].width();
            collect(&n.child(), m, opacity, if r > 0.0 { r } else { radius }, out);
        }
        T::ContainerNode => {
            let n = node.downcast_ref::<gsk::ContainerNode>().unwrap();
            for i in 0..n.n_children() {
                collect(&n.child(i), m, opacity, radius, out);
            }
        }
        T::ClipNode => collect(
            &node.downcast_ref::<gsk::ClipNode>().unwrap().child(),
            m,
            opacity,
            radius,
            out,
        ),
        T::ColorMatrixNode => collect(
            &node.downcast_ref::<gsk::ColorMatrixNode>().unwrap().child(),
            m,
            opacity,
            radius,
            out,
        ),
        T::DebugNode => collect(
            &node.downcast_ref::<gsk::DebugNode>().unwrap().child(),
            m,
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

fn over(top: [f32; 4], under: [f32; 3]) -> [f32; 3] {
    let a = top[3];
    [
        top[0] * a + under[0] * (1.0 - a),
        top[1] * a + under[1] * (1.0 - a),
        top[2] * a + under[2] * (1.0 - a),
    ]
}

impl Fill {
    /// The colour this fill gives at a point (a linear gradient is evaluated along its axis), with its opacity applied.
    fn at(&self, px: f32, py: f32) -> [f32; 4] {
        let Some((a, b, stops)) = &self.gradient else {
            return [self.rgba[0], self.rgba[1], self.rgba[2], self.rgba[3] * self.opacity];
        };
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let t = (((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy).max(1e-6)).clamp(0.0, 1.0);
        let mut prev = stops[0];
        for st in stops {
            if t <= st.0 {
                let k = ((t - prev.0) / (st.0 - prev.0).max(1e-6)).clamp(0.0, 1.0);
                let mut c = [0.0; 4];
                for (i, v) in c.iter_mut().enumerate() {
                    *v = prev.1[i] + (st.1[i] - prev.1[i]) * k;
                }
                c[3] *= self.opacity;
                return c;
            }
            prev = *st;
        }
        let mut c = prev.1;
        c[3] *= self.opacity;
        c
    }
}

fn near(a: Rect, b: Rect, tol: f32) -> bool {
    (0..4).all(|i| (a[i] - b[i]).abs() <= tol)
}

fn contains(outer: Rect, inner: Rect, tol: f32) -> bool {
    inner[0] >= outer[0] - tol
        && inner[1] >= outer[1] - tol
        && inner[0] + inner[2] <= outer[0] + outer[2] + tol
        && inner[1] + inner[3] <= outer[1] + outer[3] + tol
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

fn role_of(w: &gtk4::Widget) -> &'static str {
    use gtk4::AccessibleRole as R;
    match w.accessible_role() {
        R::Button | R::ToggleButton => "button",
        R::Link => "link",
        R::TextBox | R::SearchBox => "textbox",
        R::Img => "image",
        R::Label => "text",
        R::Heading => "heading",
        R::Switch => "switch",
        R::ComboBox => "select",
        R::Tab => "tab",
        R::Dialog | R::AlertDialog => "dialog",
        R::Slider | R::Scrollbar => "slider",
        R::ProgressBar => "progressbar",
        R::List => "list",
        R::Search => "search",
        _ => "container",
    }
}

struct Item {
    json: Value,
    rect: Rect,
    /// Paints an opaque box (fill alpha of 0.5 or more, or an image): covers what lies under it.
    opaque: bool,
    /// Index one past the last item of this widget's subtree.
    end: usize,
}

struct Walk<'a> {
    root: &'a gtk4::Widget,
    paints: Paints,
    claimed: Vec<bool>,
    viewport: Rect,
    items: Vec<Item>,
}

impl Walk<'_> {
    /// The colour behind and including `r`: every fill that contains the box, composited over white.
    fn background(&self, r: Rect) -> [f32; 3] {
        let (cx, cy) = (r[0] + r[2] / 2.0, r[1] + r[3] / 2.0);
        let mut c = [1.0, 1.0, 1.0];
        for f in &self.paints.fills {
            if !f.border && contains(f.b, r, 0.6) {
                c = over(f.at(cx, cy), c);
            }
        }
        c
    }

    /// The widget's own fill: the first unclaimed paint whose box is its border box.
    fn own_fill(&mut self, b: Rect) -> Option<usize> {
        let i = self.paints.fills.iter().enumerate().position(|(i, f)| {
            !self.claimed[i]
                && !f.border
                && near(f.b, b, 0.55)
                && (f.gradient.is_some() || f.rgba[3] * f.opacity > 0.004)
        })?;
        self.claimed[i] = true;
        Some(i)
    }

    fn own_border(&mut self, b: Rect) -> bool {
        let mut any = false;
        for (i, f) in self.paints.fills.iter().enumerate() {
            if f.border && !self.claimed[i] && near(f.b, b, 0.55) {
                self.claimed[i] = true;
                any = true;
            }
        }
        any
    }

    fn visible(&self, r: Rect, clip: Rect) -> bool {
        let c = clip_rect(clip_rect(r, clip), self.viewport);
        c[2] > 0.0 && c[3] > 0.0
    }

    fn visit(&mut self, w: &gtk4::Widget, clip: Rect, widget_opacity: f64) {
        if !w.is_mapped() || !w.is_visible() {
            return;
        }
        let Some(rb) = w.compute_bounds(self.root) else {
            return;
        };
        let b = rect_of(&rb);
        let opacity = widget_opacity * w.opacity();
        let mut clip = clip;
        if w.overflow() == gtk4::Overflow::Hidden || w.is::<gtk4::ScrolledWindow>() {
            clip = clip_rect(clip, b);
        }
        let start = self.items.len();
        let emitted = self.visible(b, clip) && self.emit(w, b, opacity);
        let mut child = w.first_child();
        while let Some(c) = child {
            self.visit(&c, clip, opacity);
            child = c.next_sibling();
        }
        let end = self.items.len();
        if emitted {
            self.items[start].end = end;
        }
    }

    fn emit(&mut self, w: &gtk4::Widget, b: Rect, widget_opacity: f64) -> bool {
        let own = self.own_fill(b);
        let bordered = self.own_border(b);
        let mut el = json!({
            "text": "", "role": role_of(w),
            "rect": {"x": b[0], "y": b[1], "w": b[2], "h": b[3]},
            "color": Value::Null, "background": "#ffffff", "fontSize": Value::Null, "fontWeight": Value::Null,
        });
        let mut rect = b;
        let mut opacity = widget_opacity as f32;
        let mut opaque = false;
        let mut emit = false;
        if let Some(l) = w.downcast_ref::<gtk4::Label>() {
            let layout = l.layout();
            let (ox, oy) = l.layout_offsets();
            #[allow(deprecated)]
            let pad = l.style_context().padding();
            let (ox, oy) = (ox + i32::from(pad.left()), oy + i32::from(pad.top()));
            let s = pango::SCALE as f32;
            // The drawn lines: the union of the logical box of every line Pango laid out.
            let mut u: Option<Rect> = None;
            let mut it = layout.iter();
            loop {
                let (_, lg) = it.line_extents();
                let r = [
                    lg.x() as f32 / s,
                    lg.y() as f32 / s,
                    lg.width() as f32 / s,
                    lg.height() as f32 / s,
                ];
                u = Some(match u {
                    None => r,
                    Some(p) => {
                        let (x0, y0) = (p[0].min(r[0]), p[1].min(r[1]));
                        let (x1, y1) = ((p[0] + p[2]).max(r[0] + r[2]), (p[1] + p[3]).max(r[1] + r[3]));
                        [x0, y0, x1 - x0, y1 - y0]
                    }
                });
                if !it.next_line() {
                    break;
                }
            }
            if let Some(u) = u {
                rect = [b[0] + ox as f32 + u[0], b[1] + oy as f32 + u[1], u[2], u[3]];
            }
            let text = l.text().to_string();
            if text.is_empty() {
                return false;
            }
            let run = self
                .paints
                .runs
                .iter()
                .filter(|r| clip_rect(r.b, rect)[2] > 0.0 && clip_rect(r.b, rect)[3] > 0.0)
                .max_by(|a, c| {
                    let ia = clip_rect(a.b, rect);
                    let ic = clip_rect(c.b, rect);
                    (ia[2] * ia[3]).total_cmp(&(ic[2] * ic[3]))
                });
            let (col, op) = run.map_or((rgba(&l.color()), 1.0), |r| (r.color, r.opacity));
            opacity *= op;
            let (px, weight) = font_px(l);
            el["text"] = json!(text.split_whitespace().collect::<Vec<_>>().join(" "));
            el["color"] = json!(hex([col[0], col[1], col[2], col[3]], true));
            el["fontSize"] = json!((px * 100.0).round() / 100.0);
            el["fontWeight"] = json!(weight);
            emit = true;
        } else if w.is::<gtk4::Image>() || w.is::<gtk4::Picture>() {
            let mut t: Option<(Rect, f32)> = None;
            for tx in &self.paints.textures {
                if contains(b, tx.b, 0.6)
                    || (w.is::<gtk4::Picture>() && clip_rect(tx.b, b)[2] > 0.0 && clip_rect(tx.b, b)[3] > 0.0)
                {
                    t = Some(match t {
                        None => (tx.b, tx.opacity),
                        Some((p, o)) => {
                            let (x0, y0) = (p[0].min(tx.b[0]), p[1].min(tx.b[1]));
                            let (x1, y1) = (
                                (p[0] + p[2]).max(tx.b[0] + tx.b[2]),
                                (p[1] + p[3]).max(tx.b[1] + tx.b[3]),
                            );
                            ([x0, y0, x1 - x0, y1 - y0], o)
                        }
                    });
                }
            }
            if let Some((r, o)) = t {
                rect = if w.is::<gtk4::Picture>() { b } else { r };
                opacity *= o;
                el["role"] = json!("image");
                emit = true;
                opaque = w.is::<gtk4::Picture>();
            }
        } else if w.is::<gtk4::Button>()
            || w.is::<gtk4::Entry>()
            || w.is::<gtk4::SearchEntry>()
            || w.is::<gtk4::Text>()
            || w.is::<gtk4::DropDown>()
            || w.is::<gtk4::Switch>()
            || w.is::<gtk4::Scale>()
            || w.is::<gtk4::DrawingArea>()
        {
            let name = a11y_name(w).or_else(|| {
                if let Some(e) = w.downcast_ref::<gtk4::Entry>() {
                    return Some(e.placeholder_text().map(|t| t.to_string()).unwrap_or_default());
                }
                w.tooltip_text().map(|t| t.to_string())
            });
            el["text"] = json!(name.unwrap_or_else(|| child_text(w)));
            if w.is::<gtk4::DrawingArea>() {
                el["role"] = json!("image");
            }
            emit = true;
        } else if let Some(i) = own {
            let _ = i;
            emit = true;
        } else if bordered {
            emit = true;
        } else if let Some(n) = a11y_name(w) {
            el["text"] = json!(n);
            emit = true;
        }
        if let Some(i) = own {
            let f = &self.paints.fills[i];
            if f.radius > 0.0 {
                el["radius"] = json!(f.radius);
            }
            opaque = opaque || f.gradient.is_none() && f.rgba[3] * f.opacity >= 0.5;
            if !w.is::<gtk4::Label>() && !w.is::<gtk4::Image>() && !w.is::<gtk4::Picture>() {
                opacity *= f.opacity;
            }
        } else if bordered {
            if let Some(f) = self.paints.fills.iter().find(|f| f.border && near(f.b, b, 0.55)) {
                if f.radius > 0.0 {
                    el["radius"] = json!(f.radius);
                }
            }
        }
        if !emit {
            return false;
        }
        el["rect"] = json!({"x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3]});
        el["background"] = json!(hex(
            {
                let c = self.background(rect);
                [c[0], c[1], c[2], 1.0]
            },
            false
        ));
        if (opacity - 1.0).abs() > 0.004 {
            el["opacity"] = json!((opacity * 1000.0).round() / 1000.0);
        }
        self.items.push(Item {
            json: el,
            rect,
            opaque,
            end: 0,
        });
        true
    }
}

/// The text of the labels inside a control, the name a screen reader falls back to.
fn child_text(w: &gtk4::Widget) -> String {
    let mut parts = Vec::new();
    let mut stack = vec![w.clone()];
    while let Some(n) = stack.pop() {
        if let Some(l) = n.downcast_ref::<gtk4::Label>() {
            if n.is_visible() && !l.text().is_empty() {
                parts.push(l.text().to_string());
            }
            continue;
        }
        let mut c = n.last_child();
        while let Some(x) = c {
            stack.push(x.clone());
            c = x.prev_sibling();
        }
    }
    parts.join(" ")
}

/// Writes the layout of `root` to `path`; `screen` and `theme` label the document.
pub fn export(root: &gtk4::Widget, screen: &str, theme: &str, path: &str) -> Result<(), String> {
    let paintable = gtk4::WidgetPaintable::new(Some(root));
    let snapshot = gtk4::Snapshot::new();
    paintable.snapshot(&snapshot, root.width() as f64, root.height() as f64);
    let mut paints = Paints::default();
    if let Some(node) = snapshot.to_node() {
        collect(&node, &graphene::Matrix::new_identity(), 1.0, 0.0, &mut paints);
    }
    let viewport = [0.0, 0.0, root.width() as f32, root.height() as f32];
    let mut walk = Walk {
        root,
        claimed: vec![false; paints.fills.len()],
        paints,
        viewport,
        items: Vec::new(),
    };
    walk.visit(root, [-1.0e6, -1.0e6, 2.0e6, 2.0e6], 1.0);
    // An element fully covered by a later opaque box that is not part of it is not visible.
    let n = walk.items.len();
    let mut keep = vec![true; n];
    let mut occluded = 0;
    #[allow(clippy::needless_range_loop)] // `keep` and the items are indexed together and `j` runs ahead of `i`
    for i in 0..n {
        let r = clip_rect(walk.items[i].rect, viewport);
        if r[2] <= 0.0 || r[3] <= 0.0 {
            continue;
        }
        let end = walk.items[i].end.max(i + 1);
        for j in end..n {
            if walk.items[j].opaque && contains(walk.items[j].rect, r, 0.5) {
                keep[i] = false;
                occluded += 1;
                break;
            }
        }
    }
    let elements: Vec<Value> = walk
        .items
        .into_iter()
        .zip(keep)
        .filter_map(|(it, k)| k.then_some(it.json))
        .collect();
    let doc = json!({
        "screen": screen, "theme": theme,
        "viewport": {"w": root.width(), "h": root.height(), "dpr": root.scale_factor()},
        "clockPinned": crate::ui::clock_pinned(),
        "occluded": occluded,
        "elements": elements,
    });
    std::fs::write(path, serde_json::to_vec(&doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
