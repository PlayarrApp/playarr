//! Parity layout export (docs/parity/LAYOUT.md): what GTK actually laid out and drew, as the layout JSON the shared scorer
//! compares with the web DOM dump. It reads and converts, nothing else: real widget bounds (transforms and clipping
//! included), real colours, opacities and radii from the GSK snapshot, real Pango line boxes, the accessible role and the
//! accessible name the app sets. It never moves a box, invents an element or substitutes a web value; where the result
//! differs from the web, the app changes. Triggered by the `layout:<screen>:<file>` control route; only parity captures use it.
use gtk4::glib::translate::IntoGlib;
use gtk4::prelude::*;
use gtk4::{gdk, graphene, gsk, pango};
use serde_json::{json, Value};

/// `PANGO_ANALYSIS_FLAG_IS_ELLIPSIS`: the run is the ellipsis Pango inserted for elided text.
const PANGO_FLAG_IS_ELLIPSIS: u8 = 1 << 1;

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

/// Marks a glyph label as decoration: screen readers skip it and the control's name leaves it out.
pub fn decorative(w: &impl IsA<gtk4::Widget>) {
    w.upcast_ref::<gtk4::Widget>()
        .update_state(&[gtk4::accessible::State::Hidden(true)]);
    // SAFETY: the key is private to this module and always holds a `bool`.
    unsafe { w.set_data("pa-a11y-deco", true) };
}

fn is_decorative(w: &gtk4::Widget) -> bool {
    // SAFETY: see `decorative`.
    unsafe { w.data::<bool>("pa-a11y-deco").is_some() }
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
        // The measured native role, unchanged. A widget that should read as a plain container gets the Generic role in the app.
        R::Group => "group",
        _ => "container",
    }
}

struct Item {
    /// The widget that paints this record.
    widget: gtk4::Widget,
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
            // Paint is in the widget's own coordinates; a CSS transform on it (a scale) is read back from its bounds.
            let (iw, ih) = (
                paintable.intrinsic_width().max(1) as f32,
                paintable.intrinsic_height().max(1) as f32,
            );
            let m = graphene::Matrix::new_scale(b[2] / iw, b[3] / ih, 1.0).multiply(&graphene::Matrix::new_translate(
                &graphene::Point3D::new(b[0], b[1], 0.0),
            ));
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
        // A scale or progress bar paints its trough and fills itself; they are listed once, from the widget.
        let mut child = if w.is::<gtk4::Scale>() || w.is::<gtk4::ProgressBar>() {
            None
        } else {
            w.first_child()
        };
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
        // `background` is the background colour: a gradient is an image on top of it and leaves it as it is.
        if let Some(f) = own.filter(|f| f.gradient.is_none()) {
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
            let s = pango::SCALE as f32;
            let (px, weight) = font_px(l);
            // One record per shaped style run (a run holds one font and one colour); neighbours on a line with the same
            // colour are one record. Text is each run's own, the ellipsis run reading as the ellipsis.
            let mut recs: Vec<(Rect, String, [f32; 4], f32)> = Vec::new();
            let primary = {
                let ctx = layout.context();
                let fd = layout.font_description().or_else(|| ctx.font_description());
                fd.map(|fd| ctx.metrics(Some(&fd), None))
            };
            let mut it = layout.iter();
            loop {
                if let Some(run) = it.run_readonly() {
                    let (_, lg) = it.run_extents();
                    let item = run.item();
                    let piece = if item.analysis().flags() & PANGO_FLAG_IS_ELLIPSIS != 0 {
                        "\u{2026}".to_string()
                    } else {
                        let o = item.offset() as usize;
                        text.get(o..o + item.length() as usize).unwrap_or("").to_string()
                    };
                    // Glyph extent of the run without its leading and trailing blanks, from the layout's own cluster positions.
                    let (mut x0, mut x1) = (lg.x(), lg.x() + lg.width());
                    if !matches!(piece.as_str(), "\u{2026}") {
                        let o = item.offset() as usize;
                        let t = piece.trim_start();
                        let lead = piece.len() - t.len();
                        let t = t.trim_end();
                        if !t.is_empty() && t.len() != piece.len() {
                            if let Some(last) = t.chars().last() {
                                let first = layout.index_to_pos((o + lead) as i32);
                                let end = layout.index_to_pos((o + lead + t.len() - last.len_utf8()) as i32);
                                x0 = first.x();
                                x1 = end.x() + end.width();
                            }
                        }
                    }
                    // The label's real transform to the root (an ancestor's CSS scale is part of it), applied to the run box.
                    // The run box spans the label font's own ascent and descent (Pango font metrics of the primary face), so
                    // a glyph drawn from a fallback face keeps the line box of the text around it.
                    let (top, height) = match &primary {
                        Some(m) => (it.baseline() - m.ascent(), m.ascent() + m.descent()),
                        None => (lg.y(), lg.height()),
                    };
                    let local = graphene::Rect::new(
                        ox as f32 + x0 as f32 / s,
                        oy as f32 + top as f32 / s,
                        (x1 - x0) as f32 / s,
                        height as f32 / s,
                    );
                    let r = match w.compute_transform(self.root) {
                        Some(t) => to_root(&t, &local),
                        None => [b[0] + local.x(), b[1] + local.y(), local.width(), local.height()],
                    };
                    let m = lp
                        .runs
                        .iter()
                        .filter(|u| overlap(u.b, r) > 0.0)
                        .max_by(|a, c| overlap(a.b, r).total_cmp(&overlap(c.b, r)));
                    let (col, op) = m.map_or((rgba(&l.color()), factor), |u| (u.color, u.opacity));
                    match recs.last_mut() {
                        Some(last) if (last.0[1] - r[1]).abs() < 0.5 && last.2 == col => {
                            last.1.push_str(&piece);
                            last.0 = union(Some(last.0), r);
                        }
                        _ => recs.push((r, piece, col, op)),
                    }
                }
                if !it.next_run() {
                    break;
                }
            }
            let mut any = false;
            for (r, shown, col, op) in recs {
                let shown = shown.split_whitespace().collect::<Vec<_>>().join(" ");
                if shown.is_empty() || !self.shown(r, clip) {
                    continue;
                }
                let mut el = base(role_of(w), &shown, r, inherited * op, bg);
                el["color"] = json!(hex(col, true));
                el["fontSize"] = json!((px * 100.0).round() / 100.0);
                el["fontWeight"] = json!(weight);
                self.items.push(Item {
                    widget: w.clone(),
                    json: el,
                    rect: r,
                    opaque: false,
                    end: self.items.len() + 1,
                });
                any = true;
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
                role = if w.has_css_class("pa-video") { "video" } else { "image" };
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
            text = a11y_name(w).unwrap_or_default();
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
            widget: w.clone(),
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
                        widget: w.clone(),
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
            if !l.text().is_empty() && !is_decorative(&n) {
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

/// The screen as the renderer draws it: width, height and premultiplied BGRA pixels.
fn render(root: &gtk4::Widget) -> Option<(usize, usize, Vec<u8>)> {
    let (w, h) = (root.width(), root.height());
    if w <= 0 || h <= 0 {
        return None;
    }
    let paintable = gtk4::WidgetPaintable::new(Some(root));
    let snap = gtk4::Snapshot::new();
    paintable.snapshot(&snap, f64::from(w), f64::from(h));
    let node = snap.to_node()?;
    let renderer = root.native()?.renderer()?;
    let tex = renderer.render_texture(&node, Some(&graphene::Rect::new(0.0, 0.0, w as f32, h as f32)));
    let (tw, th) = (tex.width() as usize, tex.height() as usize);
    let mut buf = vec![0u8; tw * th * 4];
    tex.download(&mut buf, tw * 4);
    Some((tw, th, buf))
}

type Frame = (usize, usize, Vec<u8>);

/// The largest channel difference between two renders inside `r`.
fn peak_diff(a: &Frame, b: &Frame, r: Rect, viewport: Rect) -> u8 {
    let sx = a.0 as f32 / viewport[2].max(1.0);
    let sy = a.1 as f32 / viewport[3].max(1.0);
    let c = clip_rect(r, viewport);
    let (x0, x1) = (
        (c[0] * sx).floor() as usize,
        (((c[0] + c[2]) * sx).ceil() as usize).min(a.0),
    );
    let (y0, y1) = (
        (c[1] * sy).floor() as usize,
        (((c[1] + c[3]) * sy).ceil() as usize).min(a.1),
    );
    let mut peak = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let o = (y * a.0 + x) * 4;
            for k in 0..4 {
                peak = peak.max(a.2[o + k].abs_diff(b.2[o + k]));
            }
        }
    }
    peak
}

/// Lets the main loop draw a frame after a change, so the next render reads the tree as the renderer has it.
fn settle() {
    let ctx = gtk4::glib::MainContext::default();
    for _ in 0..2 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        while ctx.iteration(false) {}
    }
}

/// A render with `hide` widgets at opacity 0 (and the widgets restored afterwards). A screen with nothing left to draw
/// is a blank frame.
fn render_hiding(root: &gtk4::Widget, hide: &[gtk4::Widget], like: &Frame) -> Frame {
    let saved: Vec<f64> = hide.iter().map(|w| w.opacity()).collect();
    for w in hide {
        w.set_opacity(0.0);
    }
    settle();
    let f = render(root);
    for (w, o) in hide.iter().zip(saved) {
        w.set_opacity(o);
    }
    f.unwrap_or_else(|| (like.0, like.1, vec![0u8; like.2.len()]))
}

/// Of the records the geometry calls covered, those the rendered screen shows no more than half of. A record is
/// measured by hiding it: its widget goes to opacity 0 and the screen is drawn again. What that changes inside its box is
/// what the screen shows of it (`seen`); the same measure with the covering widgets hidden as well is what it would show
/// unobstructed (`open`). A cover that paints at alpha 0.5 or more leaves at most half of `open`, which is how the web
/// scorer defines occluded, so a record is hidden when `seen` is no more than half of `open`. Screens that do not repeat
/// exactly between two draws (video, animation) keep their records.
fn confirm_hidden(
    root: &gtk4::Widget,
    items: &[Item],
    candidates: &[(usize, Vec<usize>)],
    viewport: Rect,
) -> Vec<usize> {
    if candidates.is_empty() {
        return Vec::new();
    }
    let (Some(base), Some(again)) = (render(root), render(root)) else {
        return Vec::new();
    };
    let mut hidden = Vec::new();
    let mut by_cover: std::collections::BTreeMap<Vec<usize>, Vec<usize>> = Default::default();
    for (i, cover) in candidates {
        by_cover.entry(cover.clone()).or_default().push(*i);
    }
    for (cover, group) in by_cover {
        let cover_w: Vec<gtk4::Widget> = cover.iter().map(|&c| items[c].widget.clone()).collect();
        let open_base = render_hiding(root, &cover_w, &base);
        for i in group {
            let r = items[i].rect;
            if peak_diff(&base, &again, r, viewport) > 0 {
                continue;
            }
            let mut both = cover_w.clone();
            both.push(items[i].widget.clone());
            let open = peak_diff(&open_base, &render_hiding(root, &both, &base), r, viewport);
            let one = [items[i].widget.clone()];
            let seen = peak_diff(&base, &render_hiding(root, &one, &base), r, viewport);
            if u32::from(seen) * 2 <= u32::from(open) + 8 {
                hidden.push(i);
            }
        }
    }
    hidden
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
    let mut candidates: Vec<(usize, Vec<usize>)> = Vec::new();
    #[allow(clippy::needless_range_loop)]
    // `keep` and the items are indexed together and the cover search runs ahead of `i`
    for i in 0..n {
        let r = clip_rect(walk.items[i].rect, viewport);
        if r[2] <= 0.0 || r[3] <= 0.0 {
            keep[i] = false;
            continue;
        }
        let end = walk.items[i].end.max(i + 1);
        let mut cover: Vec<usize> = Vec::new();
        let covered = [0.2_f32, 0.5, 0.8].iter().all(|fy| {
            [0.2_f32, 0.5, 0.8].iter().all(|fx| {
                let (px, py) = (r[0] + r[2] * fx, r[1] + r[3] * fy);
                let hit = (end..n).find(|&j| {
                    let o = &walk.items[j];
                    o.opaque
                        && px >= o.rect[0]
                        && px <= o.rect[0] + o.rect[2]
                        && py >= o.rect[1]
                        && py <= o.rect[1] + o.rect[3]
                });
                if let Some(j) = hit {
                    if !cover.contains(&j) {
                        cover.push(j);
                    }
                }
                hit.is_some()
            })
        });
        if covered {
            cover.sort_unstable();
            candidates.push((i, cover));
        }
    }
    // The cover is a candidate only: the rendered screen decides. Hiding the record's widget and drawing the screen again
    // must leave its box unchanged, or it is visible and stays.
    for i in confirm_hidden(root, &walk.items, &candidates, viewport) {
        keep[i] = false;
        occluded += 1;
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

#[cfg(test)]
mod tests {
    use super::*;
    use gtk4::AccessibleRole as R;

    #[test]
    fn same_native_role_exports_same_role() {
        if gtk4::init().is_err() {
            return;
        }
        let a = gtk4::Box::builder().accessible_role(R::Group).build();
        let b = gtk4::Frame::builder().accessible_role(R::Group).build();
        let c = gtk4::Box::builder().accessible_role(R::Generic).build();
        assert_eq!(role_of(a.upcast_ref()), "group");
        assert_eq!(role_of(a.upcast_ref()), role_of(b.upcast_ref()));
        assert_eq!(role_of(c.upcast_ref()), "container");
    }
}
