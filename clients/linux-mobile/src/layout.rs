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
    /// The innermost clip box the texture is drawn under (a Picture clips to its own box).
    clip: Option<Rect>,
    opacity: f32,
}

#[derive(Default)]
struct Paints {
    fills: Vec<Fill>,
    runs: Vec<Run>,
    textures: Vec<Tex>,
    /// Rounded clips (a widget with `overflow: hidden` and a border radius): box and corner radius.
    clips: Vec<(Rect, f32)>,
    /// Opacity nodes (a disabled control's dimming, `opacity` in CSS): box and factor.
    /// Something else was drawn (video frame, canvas, shader): not a fill, text or texture.
    other: bool,
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

/// The corner radius of the rounded clip a fill is painted under, when the clip is the fill's own box.
fn clip_radius(rclip: Option<(Rect, f32)>, b: Rect) -> f32 {
    rclip.filter(|(cb, _)| near(*cb, b, 0.55)).map_or(0.0, |(_, r)| r)
}

fn collect(
    node: &gsk::RenderNode,
    m: &graphene::Matrix,
    opacity: f32,
    rclip: Option<(Rect, f32)>,
    clip: Option<Rect>,
    out: &mut Paints,
) {
    use gsk::RenderNodeType as T;
    match node.node_type() {
        T::ColorNode => {
            let c = node.downcast_ref::<gsk::ColorNode>().unwrap().color();
            let b = to_root(m, &node.bounds());
            out.fills.push(Fill {
                b,
                rgba: rgba(&c),
                radius: clip_radius(rclip, b),
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
            let b = to_root(m, &node.bounds());
            out.fills.push(Fill {
                b,
                rgba: [0.0; 4],
                radius: clip_radius(rclip, b),
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
            clip,
            opacity,
        }),
        T::TransformNode => {
            let n = node.downcast_ref::<gsk::TransformNode>().unwrap();
            let nm = n.transform().to_matrix().multiply(m);
            collect(&n.child(), &nm, opacity, rclip, clip, out);
        }
        T::OpacityNode => {
            let n = node.downcast_ref::<gsk::OpacityNode>().unwrap();
            collect(&n.child(), m, opacity * n.opacity(), rclip, clip, out);
        }
        T::RoundedClipNode => {
            let n = node.downcast_ref::<gsk::RoundedClipNode>().unwrap();
            let r = n.clip().corner()[0].width();
            out.clips.push((to_root(m, n.clip().bounds()), r));
            collect(
                &n.child(),
                m,
                opacity,
                Some((to_root(m, n.clip().bounds()), r)),
                clip,
                out,
            );
        }
        T::ContainerNode => {
            let n = node.downcast_ref::<gsk::ContainerNode>().unwrap();
            for i in 0..n.n_children() {
                collect(&n.child(i), m, opacity, rclip, clip, out);
            }
        }
        T::ClipNode => {
            let n = node.downcast_ref::<gsk::ClipNode>().unwrap();
            collect(&n.child(), m, opacity, rclip, Some(to_root(m, &n.clip())), out);
        }
        T::ColorMatrixNode => collect(
            &node.downcast_ref::<gsk::ColorMatrixNode>().unwrap().child(),
            m,
            opacity,
            rclip,
            clip,
            out,
        ),
        T::DebugNode => collect(
            &node.downcast_ref::<gsk::DebugNode>().unwrap().child(),
            m,
            opacity,
            rclip,
            clip,
            out,
        ),
        T::InsetShadowNode | T::OutsetShadowNode => {}
        _ => out.other = true,
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
        R::Img => "img",
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
        R::Group => "group",
        _ => "container",
    }
}

struct Item {
    json: Value,
    rect: Rect,
    /// Paints a box with alpha of 0.5 or more (or an image): it covers what is painted before it.
    opaque: bool,
    /// Index one past the last item of this widget's subtree.
    end: usize,
}

struct Walk<'a> {
    root: &'a gtk4::Widget,
    viewport: Rect,
    items: Vec<Item>,
}

/// The opacity GTK applies to the whole widget: opacity nodes on the path from the snapshot root down.
fn root_factor(node: &gsk::RenderNode) -> f32 {
    use gsk::RenderNodeType as T;
    match node.node_type() {
        T::OpacityNode => {
            let n = node.downcast_ref::<gsk::OpacityNode>().unwrap();
            n.opacity() * root_factor(&n.child())
        }
        T::TransformNode => root_factor(&node.downcast_ref::<gsk::TransformNode>().unwrap().child()),
        T::ClipNode => root_factor(&node.downcast_ref::<gsk::ClipNode>().unwrap().child()),
        T::RoundedClipNode => root_factor(&node.downcast_ref::<gsk::RoundedClipNode>().unwrap().child()),
        T::DebugNode => root_factor(&node.downcast_ref::<gsk::DebugNode>().unwrap().child()),
        T::ContainerNode => {
            let n = node.downcast_ref::<gsk::ContainerNode>().unwrap();
            if n.n_children() == 1 {
                root_factor(&n.child(0))
            } else {
                1.0
            }
        }
        _ => 1.0,
    }
}

fn union(a: Option<Rect>, b: Rect) -> Rect {
    match a {
        None => b,
        Some(p) => {
            let (x0, y0) = (p[0].min(b[0]), p[1].min(b[1]));
            let (x1, y1) = ((p[0] + p[2]).max(b[0] + b[2]), (p[1] + p[3]).max(b[1] + b[3]));
            [x0, y0, x1 - x0, y1 - y0]
        }
    }
}

fn overlap(a: Rect, b: Rect) -> f32 {
    let c = clip_rect(a, b);
    c[2] * c[3]
}

impl Walk<'_> {
    fn shown(&self, r: Rect, clip: Rect) -> bool {
        let c = clip_rect(clip_rect(r, clip), self.viewport);
        c[2] > 0.0 && c[3] > 0.0
    }

    fn visit(&mut self, w: &gtk4::Widget, clip: Rect, inherited: f32, parent_bg: [f32; 3]) {
        if !w.is_mapped() || !w.is_visible() {
            return;
        }
        let Some(rb) = w.compute_bounds(self.root) else {
            return;
        };
        let b = rect_of(&rb);
        // The widget's own paint: its snapshot alone (children included, but only the widget's own paint is claimed).
        let mut lp = Paints::default();
        let mut factor = 1.0;
        let paintable = gtk4::WidgetPaintable::new(Some(w));
        let snap = gtk4::Snapshot::new();
        // The paintable's own size: `width()` excludes the CSS border and padding, which the snapshot must not scale away.
        paintable.snapshot(
            &snap,
            f64::from(paintable.intrinsic_width()),
            f64::from(paintable.intrinsic_height()),
        );
        if let Some(node) = snap.to_node() {
            let m = graphene::Matrix::new_translate(&graphene::Point3D::new(b[0], b[1], 0.0));
            collect(&node, &m, 1.0, None, None, &mut lp);
            factor = root_factor(&node);
        }
        let mut clip = clip;
        if w.overflow() == gtk4::Overflow::Hidden || w.is::<gtk4::ScrolledWindow>() {
            clip = clip_rect(clip, b);
        }
        let start = self.items.len();
        let (emitted, bg) = if self.shown(b, clip) {
            self.emit(w, b, clip, inherited, factor, parent_bg, &lp)
        } else {
            (false, parent_bg)
        };
        let mut child = w.first_child();
        while let Some(c) = child {
            self.visit(&c, clip, inherited * factor, bg);
            child = c.next_sibling();
        }
        if emitted {
            self.items[start].end = self.items.len();
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &mut self,
        w: &gtk4::Widget,
        b: Rect,
        clip: Rect,
        inherited: f32,
        factor: f32,
        parent_bg: [f32; 3],
        lp: &Paints,
    ) -> (bool, [f32; 3]) {
        let own = lp
            .fills
            .iter()
            .find(|f| !f.border && near(f.b, b, 0.55) && (f.gradient.is_some() || f.rgba[3] * f.opacity > 0.004));
        let bordered = lp.fills.iter().any(|f| f.border && near(f.b, b, 0.55));
        let mut bg = parent_bg;
        if let Some(f) = own {
            bg = over(f.at(b[0] + b[2] / 2.0, b[1] + b[3] / 2.0), parent_bg);
        }
        let mut radius = own.map(|f| f.radius).filter(|r| *r > 0.0);
        if radius.is_none() {
            radius = lp
                .fills
                .iter()
                .find(|f| f.border && near(f.b, b, 0.55))
                .map(|f| f.radius)
                .filter(|r| *r > 0.0);
        }
        if radius.is_none() {
            radius = lp
                .clips
                .iter()
                .find(|(cb, r)| *r > 0.0 && near(*cb, b, 0.55))
                .map(|(_, r)| *r);
        }
        let base = |role: &str, text: &str, rect: Rect, opacity: f32, bgc: [f32; 3]| {
            let mut el = json!({
                "text": text, "role": role,
                "rect": {"x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3]},
                "color": Value::Null, "background": hex([bgc[0], bgc[1], bgc[2], 1.0], false),
                "fontSize": Value::Null, "fontWeight": Value::Null,
            });
            if (opacity - 1.0).abs() > 0.004 {
                el["opacity"] = json!((opacity * 1000.0).round() / 1000.0);
            }
            if let Some(r) = radius {
                el["radius"] = json!(r);
            }
            el
        };
        let own_op = own.map_or(inherited * factor, |f| inherited * f.opacity);
        let opaque_fill = own.is_some_and(|f| f.gradient.is_none() && f.rgba[3] * f.opacity * inherited >= 0.5);
        let end = self.items.len() + 1;
        if let Some(l) = w.downcast_ref::<gtk4::Label>() {
            let layout = l.layout();
            let text = layout.text().to_string();
            if text.trim().is_empty() {
                return (false, bg);
            }
            let (ox, oy) = l.layout_offsets();
            #[allow(deprecated)]
            let pad = l.style_context().padding();
            let (ox, oy) = (ox + i32::from(pad.left()), oy + i32::from(pad.top()));
            let s = pango::SCALE as f32;
            let (px, weight) = font_px(l);
            let mut it = layout.iter();
            let mut any = false;
            loop {
                let (_, lg) = it.line_extents();
                let Some(line) = it.line_readonly() else { break };
                let (st, len) = (line.start_index() as usize, line.length() as usize);
                let mut shown = text.get(st..st + len).unwrap_or("").to_string();
                let r = [
                    b[0] + ox as f32 + lg.x() as f32 / s,
                    b[1] + oy as f32 + lg.y() as f32 / s,
                    lg.width() as f32 / s,
                    lg.height() as f32 / s,
                ];
                if layout.is_ellipsized() {
                    // The drawn text is the longest prefix that fits with the ellipsis.
                    let fits = |n: usize| {
                        let t: String = shown.chars().take(n).collect::<String>() + "\u{2026}";
                        let pl = l.create_pango_layout(Some(&t));
                        pl.set_attributes(layout.attributes().as_ref());
                        (pl.extents().1.width() as f32 / s) <= r[2] + 0.5
                    };
                    let total = shown.chars().count();
                    let mut n = total;
                    while n > 0 && !fits(n) {
                        n -= 1;
                    }
                    shown = shown.chars().take(n).collect::<String>() + "\u{2026}";
                }
                let shown = shown.split_whitespace().collect::<Vec<_>>().join(" ");
                if !shown.is_empty() && self.shown(r, clip) {
                    let run = lp
                        .runs
                        .iter()
                        .filter(|u| overlap(u.b, r) > 0.0)
                        .max_by(|a, c| overlap(a.b, r).total_cmp(&overlap(c.b, r)));
                    let (col, op) = run.map_or((rgba(&l.color()), factor), |u| (u.color, u.opacity));
                    let mut el = base(role_of(w), &shown, r, inherited * op, bg);
                    el["color"] = json!(hex(col, true));
                    el["fontSize"] = json!((px * 100.0).round() / 100.0);
                    el["fontWeight"] = json!(weight);
                    self.items.push(Item {
                        json: el,
                        rect: r,
                        opaque: false,
                        end: self.items.len() + 1,
                    });
                    any = true;
                }
                if !it.next_line() {
                    break;
                }
            }
            return (any, bg);
        }
        let mut rect = b;
        let mut role = role_of(w);
        let mut text = String::new();
        let mut opacity = own_op;
        let mut opaque = opaque_fill;
        let emit;
        if w.is::<gtk4::Image>() || w.is::<gtk4::Picture>() {
            let pic = w.is::<gtk4::Picture>();
            let mut u: Option<Rect> = None;
            let mut op = factor;
            for t in &lp.textures {
                u = Some(union(u, t.b));
                op = t.opacity;
            }
            if u.is_some() || (pic && lp.other) {
                rect = if pic { b } else { u.unwrap_or(b) };
                role = if pic && lp.textures.is_empty() {
                    "video"
                } else {
                    "image"
                };
                opacity = inherited * op;
                opaque = pic && opacity >= 0.5;
                emit = true;
            } else {
                emit = false;
            }
        } else if w.is::<gtk4::ProgressBar>() || w.is::<gtk4::Scale>() {
            text = a11y_name(w).unwrap_or_default();
            emit = true;
        } else if w.is::<gtk4::DrawingArea>() {
            role = "image";
            emit = lp.other || !lp.fills.is_empty();
        } else if w.is::<gtk4::Button>()
            || w.is::<gtk4::Entry>()
            || w.is::<gtk4::SearchEntry>()
            || w.is::<gtk4::Text>()
            || w.is::<gtk4::DropDown>()
            || w.is::<gtk4::Switch>()
        {
            text = a11y_name(w)
                .filter(|_| w.accessible_role() != gtk4::AccessibleRole::Group)
                .or_else(|| {
                    w.downcast_ref::<gtk4::Entry>()
                        .and_then(|e| e.placeholder_text())
                        .map(|t| t.to_string())
                })
                .or_else(|| w.tooltip_text().map(|t| t.to_string()))
                .unwrap_or_else(|| {
                    if w.accessible_role() == gtk4::AccessibleRole::Group {
                        String::new()
                    } else {
                        child_text(w)
                    }
                });
            emit = true;
        } else if own.is_some() || bordered {
            emit = true;
        } else if let Some(n) = a11y_name(w) {
            text = n;
            emit = true;
        } else {
            emit = false;
        }
        if !emit {
            return (false, bg);
        }
        let el = base(role, &text, rect, opacity, bg);
        self.items.push(Item {
            json: el,
            rect,
            opaque,
            end,
        });
        // A trough and its progress are painted by the widget's own parts: each is a box of its own.
        let mut cur = bg;
        if w.is::<gtk4::ProgressBar>() || w.is::<gtk4::Scale>() {
            for f in &lp.fills {
                if !f.border && contains(b, f.b, 0.6) && f.rgba[3] * f.opacity > 0.004 {
                    cur = over(f.at(f.b[0] + f.b[2] / 2.0, f.b[1] + f.b[3] / 2.0), cur);
                    let mut j = base("container", "", f.b, inherited * f.opacity, cur);
                    if f.radius > 0.0 {
                        j["radius"] = json!(f.radius);
                    } else if let Some(o) = j.as_object_mut() {
                        o.remove("radius");
                    }
                    let at = self.items.len() + 1;
                    self.items.push(Item {
                        json: j,
                        rect: f.b,
                        opaque: false,
                        end: at,
                    });
                }
            }
        }
        (true, bg)
    }
}

/// The text of the labels inside a control, the name a screen reader falls back to.
fn child_text(w: &gtk4::Widget) -> String {
    let mut parts = Vec::new();
    let mut stack = vec![w.clone()];
    while let Some(n) = stack.pop() {
        if !n.is_mapped() {
            continue;
        }
        if let Some(l) = n.downcast_ref::<gtk4::Label>() {
            if !l.text().is_empty() {
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
    let viewport = [0.0, 0.0, root.width() as f32, root.height() as f32];
    let mut walk = Walk {
        root,
        viewport,
        items: Vec::new(),
    };
    walk.visit(root, [-1.0e6, -1.0e6, 2.0e6, 2.0e6], 1.0, [1.0, 1.0, 1.0]);
    // Occlusion as the web scorer samples it: nine points of the visible box; hidden when each lies under a later box
    // that paints (alpha of 0.5 or more) and is not part of the element.
    let n = walk.items.len();
    let mut keep = vec![true; n];
    let mut occluded = 0;
    #[allow(clippy::needless_range_loop)]
    // `keep` and the items are indexed together and the cover search runs ahead of `i`
    for i in 0..n {
        let r = clip_rect(walk.items[i].rect, viewport);
        if r[2] <= 0.0 || r[3] <= 0.0 {
            keep[i] = false;
            continue;
        }
        let end = walk.items[i].end.max(i + 1);
        let covered = [0.2_f32, 0.5, 0.8].iter().all(|fy| {
            [0.2_f32, 0.5, 0.8].iter().all(|fx| {
                let (px, py) = (r[0] + r[2] * fx, r[1] + r[3] * fy);
                walk.items[end..].iter().any(|o| {
                    o.opaque
                        && px >= o.rect[0]
                        && px <= o.rect[0] + o.rect[2]
                        && py >= o.rect[1]
                        && py <= o.rect[1] + o.rect[3]
                })
            })
        });
        if covered {
            keep[i] = false;
            occluded += 1;
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
