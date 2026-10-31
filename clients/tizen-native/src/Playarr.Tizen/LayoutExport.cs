using System.Globalization;
using System.Text;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// The app's accessibility semantics of a view: the web role it exposes (link, button, heading, ...) and its accessible name (read back from
/// the view's real <c>AccessibilityName</c>). Nothing else about the layout is declared here: bounds, colours, radii and text all come from the view.
/// </summary>
internal static class Sem
{
    // the native accessibility role each exported role name stands for; the role lives on the view itself (View.AccessibilityRole) and the export reads it back from there
    private static readonly Dictionary<string, Role> Native = new()
    {
        ["button"] = Role.PushButton, ["container"] = Role.Panel, ["heading"] = Role.Heading, ["img"] = Role.Image, ["link"] = Role.Link,
        ["none"] = Role.RedundantObject, ["text"] = Role.Text, ["textbox"] = Role.Entry, ["slider"] = Role.Slider, ["dialog"] = Role.Dialog,
        ["video"] = Role.Video, ["group"] = Role.Grouping, ["search"] = Role.Form, ["status"] = Role.StatusBar,
    };
    // views the app never tagged keep their class default role (an ImageView reports Image, a plain View a panel), which says nothing about intent: only a tagged view's role is read
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, object> Tagged = new();
    internal static string? RoleOf(View v) => !Tagged.TryGetValue(v, out _) ? null : Native.FirstOrDefault(p => p.Value == v.AccessibilityRole).Key;

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, object> Overlays = new();
    /// <summary>A generated gradient or scrim image: translucent by construction, so it never hides what is under it.</summary>
    public static T Overlay<T>(T v) where T : View { Overlays.Add(v, v); return v; }
    internal static bool IsOverlay(View v) => Overlays.TryGetValue(v, out _);

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, object> Mixes = new();
    /// <summary>A fill the web declares as <c>color-mix(in srgb, X p%, transparent)</c>: the browser serialises that as color(srgb r g b / a) with channels at 6 decimals, not as 8-bit rgba().</summary>
    public static T ColorMix<T>(T v) where T : View { Mixes.AddOrUpdate(v, v); return v; }
    internal static bool IsColorMix(View v) => Mixes.TryGetValue(v, out _);

    public static T Tag<T>(T v, string role, string? name = null) where T : View
    {
        v.AccessibilityRole = Native.TryGetValue(role, out var native) ? native : throw new ArgumentException("no native role for " + role);
        Tagged.Remove(v); Tagged.Add(v, v);
        if (name is not null) v.AccessibilityName = name;
        return v;
    }
}

/// <summary>
/// Parity layout document (docs/parity/LAYOUT.md): reads the laid-out NUI tree of the running page and nothing else. Boxes are each view's
/// position and size with the scale of itself and its ancestors; text elements are the per-line glyph runs the label's own text layout reports
/// (<c>TextGeometry</c>); colours, radii, opacity and backgrounds are the view properties. Views that are invisible, outside the viewport or an
/// ancestor's clip are left out; whether a candidate is covered is decided on the rendered screen (hide it, grab, compare), not from geometry. No web value is used.
/// </summary>
internal static class LayoutExport
{
    private sealed record Node(string Text, string Role, float X, float Y, float W, float H, string? Color, string Background, float? FontSize, int? FontWeight, float Radius, float Opacity,
        int Id, bool PaintOnly);

    private sealed class Ctx
    {
        public readonly List<Node> Nodes = new();
        public int NextId;
        public readonly Dictionary<int, View> Views = new();
        public float VW, VH;
    }

    private static Ctx Collect(Container root)
    {
        var win = Window.Instance.WindowSize;
        var ctx = new Ctx { VW = win.Width, VH = win.Height };
        var bg = Window.Instance.BackgroundColor;
        Walk(ctx, root, 0, 0, 1, 1, (Math.Round(bg.R * 255.0), Math.Round(bg.G * 255.0), Math.Round(bg.B * 255.0)), 1f, new RectF(0, 0, ctx.VW, ctx.VH), 1f);
        return ctx;
    }

    /// <summary>
    /// The candidate boxes (every element the walk found, before visibility is decided), as a JSON array of [x, y, w, h, paintOnly, view]. Visibility is decided by the driver on the
    /// real rendered screen (<see cref="Hide"/>, grab, compare), never from geometry: it passes the indices of the candidates whose own pixels change as <c>keep</c> to <see cref="Json"/>.
    /// </summary>
    public static string Candidates(Container root) =>
        "[" + string.Join(",", Collect(root).Nodes.Select(n => $"[{N(n.X)},{N(n.Y)},{N(n.W)},{N(n.H)},{(n.PaintOnly ? 1 : 0)},{n.Id}]")) + "]";

    private static string N(float v) => v.ToString("0.##", CultureInfo.InvariantCulture);

    private static readonly List<Action> Restores = new();

    /// <summary>
    /// Changes what the given candidates draw so a grab of the real screen shows whether they are visible: a text, image or control is hidden whole (its subtree with it);
    /// a container that only paints a fill, border or shadow has that paint turned into opaque magenta, so a fill that matches the colour beneath it still shows up when it is
    /// not covered, and what the container holds keeps drawing. With <paramref name="whole"/> every candidate is hidden with its subtree (a container counts as visible when it or what it holds is topmost somewhere, as the web's element lookup treats it). <see cref="Unhide"/> restores everything.
    /// </summary>
    public static void Hide(Container root, IEnumerable<int> indices, bool whole = false)
    {
        Unhide();
        var ctx = Collect(root);
        var loud = new Color(1, 0, 1, 1);
        foreach (var index in indices)
        {
            if (index < 0 || index >= ctx.Nodes.Count) continue;
            var n = ctx.Nodes[index]; var v = ctx.Views[n.Id];
            if (v is TextField input && !whole)
            {
                // an input draws nothing of its own while it is empty (its placeholder is a sibling label), so hiding it changes no pixel: its box is painted loud instead, which shows on the real screen only where the field is topmost
                var bc = input.BackgroundColor; var fill = new Color(bc.R, bc.G, bc.B, bc.A);
                input.BackgroundColor = loud;
                Restores.Add(() => input.BackgroundColor = fill);
            }
            else if (v is ImageView overlay && n.PaintOnly && !whole)
            {
                // a generated gradient that stands for a container's fill (the panel frost): its image is swapped for opaque magenta over its own box, so it shows on the real screen
                // only where it is topmost (a dim 6-level frost would otherwise fall under the visibility threshold, although nothing covers it)
                var url = overlay.ResourceUrl; var bc = overlay.BackgroundColor; var fill = new Color(bc.R, bc.G, bc.B, bc.A);
                overlay.ResourceUrl = ""; overlay.BackgroundColor = loud;
                Restores.Add(() => { overlay.ResourceUrl = url; overlay.BackgroundColor = fill; });
            }
            else if (n.PaintOnly && !whole)
            {
                // NUI hands back live objects (a Color bound to the view), so the values are copied before the paint is changed
                var bc = v.BackgroundColor; var fill = new Color(bc.R, bc.G, bc.B, bc.A); var bcol = v.BorderlineColor; var border = new Color(bcol.R, bcol.G, bcol.B, bcol.A); var sh = v.BoxShadow;
                var shadow = sh is Shadow s ? new Shadow(s.BlurRadius, new Color(s.Color.R, s.Color.G, s.Color.B, s.Color.A), new Vector2(s.Offset.X, s.Offset.Y), new Vector2(s.Extents.X, s.Extents.Y)) : null;
                // only what is changed is restored: assigning a BackgroundColor would also replace a view's BackgroundImage
                var fillChanged = fill.A > 0.02f; var borderChanged = v.BorderlineWidth > 0 && border.A > 0.02f; var shadowChanged = shadow is not null;
                if (fillChanged) v.BackgroundColor = loud;
                if (borderChanged) v.BorderlineColor = loud;
                if (shadowChanged) v.BoxShadow = new Shadow(shadow!.BlurRadius, loud, shadow.Offset, shadow.Extents);
                Restores.Add(() => { if (fillChanged) v.BackgroundColor = fill; if (borderChanged) v.BorderlineColor = border; if (shadowChanged) v.BoxShadow = shadow; });
            }
            else if (v.Visibility) { var op = v.Opacity; v.Opacity = 0; Restores.Add(() => v.Opacity = op); } // opacity 0 hides the view and its subtree; the original opacity is restored
        }
    }

    public static void Unhide() { for (var i = Restores.Count - 1; i >= 0; i--) Restores[i](); Restores.Clear(); } // newest first: a view hidden twice (a wrapped label has one candidate per line) ends on its original state

    public static string Json(string screen, string theme, bool clockPinned, Container root, IReadOnlyCollection<int>? keep = null)
    {
        var ctx = Collect(root);
        var nodes = keep is null ? ctx.Nodes : ctx.Nodes.Where((_, i) => keep.Contains(i)).ToList();
        var occluded = ctx.Nodes.Count - nodes.Count;
        var sb = new StringBuilder();
        sb.Append("{\"screen\":").Append(Q(screen)).Append(",\"theme\":").Append(Q(theme)).Append(",\"viewport\":{\"w\":").Append(N(ctx.VW)).Append(",\"h\":").Append(N(ctx.VH)).Append(",\"dpr\":1},\"clockPinned\":").Append(clockPinned ? "true" : "false").Append(",\"elements\":[");
        for (var i = 0; i < nodes.Count; i++)
        {
            var n = nodes[i]; if (i > 0) sb.Append(',');
            sb.Append("{\"text\":").Append(Q(n.Text)).Append(",\"role\":").Append(Q(n.Role))
              .Append(",\"rect\":{\"x\":").Append(N(n.X)).Append(",\"y\":").Append(N(n.Y)).Append(",\"w\":").Append(N(n.W)).Append(",\"h\":").Append(N(n.H)).Append('}')
              .Append(",\"color\":").Append(n.Color is null ? "null" : Q(n.Color)).Append(",\"background\":").Append(Q(n.Background))
              .Append(",\"fontSize\":").Append(n.FontSize is { } f ? N(f) : "null").Append(",\"fontWeight\":").Append(n.FontWeight is { } w ? w.ToString(CultureInfo.InvariantCulture) : "null");
            if (n.Radius > 0) sb.Append(",\"radius\":").Append(N(n.Radius));
            if (n.Opacity < 0.99f) sb.Append(",\"opacity\":").Append(N(n.Opacity));
            sb.Append('}');
        }
        return sb.Append("],\"occluded\":").Append(occluded).Append('}').ToString();
    }

    private readonly record struct RectF(float X, float Y, float W, float H)
    {
        public float R => X + W; public float B => Y + H;
        public RectF Intersect(RectF o) { var x = Math.Max(X, o.X); var y = Math.Max(Y, o.Y); return new RectF(x, y, Math.Max(0, Math.Min(R, o.R) - x), Math.Max(0, Math.Min(B, o.B) - y)); }
        public bool Overlaps(RectF o) => X < o.R && o.X < R && Y < o.B && o.Y < B;
        public bool Contains(float px, float py) => px >= X && px <= R && py >= Y && py <= B;
    }

    private static string Q(string s) => Newtonsoft.Json.JsonConvert.ToString(s);

    // ts: the product of the CSS transforms (focus and active scale on plain views) above; a TextLabel's own 1/TextScale is a drawing detail, not a transform. The web reports border-radius as declared (pre-transform) but caps it at half the short side of the transformed box, so only the declared part is taken out of the transforms.
    // vx, vy: screen top-left of the parent; sx, sy: its accumulated scale; bg: the real backgrounds composited so far (over the window colour); op: accumulated opacity; clip: the visible area left by ancestors that clip their children
    // the web reports a declared radius before the transforms, but a radius that reaches half the short side (circle, pill, percentage) is capped on the transformed box
    private static float CapRadius(float drawn, float ts, float w, float h)
    {
        var half = Math.Min(w, h) / 2f;
        return drawn >= half - 0.01f ? half : Math.Min(drawn / ts, half);
    }

    private static void Walk(Ctx ctx, Container parent, float vx, float vy, float sx, float sy, (double R, double G, double B) bg, float op, RectF clip, float ts)
    {
        foreach (var child in parent.Children.OfType<View>().ToArray())
        {
            if (!child.Visibility) continue;
            var cop = op * child.Opacity;
            if (cop <= 0.01f) continue;
            var scale = child.Scale; var size = child.Size;
            var offX = child.PositionUsesPivotPoint ? 0 : size.Width * (1 - scale.X) / 2;
            var offY = child.PositionUsesPivotPoint ? 0 : size.Height * (1 - scale.Y) / 2;
            var cx = vx + sx * (child.PositionX + offX); var cy = vy + sy * (child.PositionY + offY);
            var csx = sx * scale.X; var csy = sy * scale.Y;
            var cts = child is TextLabel ? ts : ts * scale.X;
            var w = size.Width * csx; var h = size.Height * csy;
            var id = ctx.NextId++; ctx.Views[id] = child;
            var role = Sem.RoleOf(child);
            var name = string.IsNullOrEmpty(child.AccessibilityName) ? null : child.AccessibilityName;
            var box = new RectF(cx, cy, w, h);

            if (child is TextLabel label && Ui.TextMeta.TryGetValue(label, out var m) && !string.IsNullOrEmpty(label.Text))
            {
                // a label that draws its own pill (fill, border, rounded corners) is the web span: its fill is the run's background and its corner radius the run's radius
                var own = label.BackgroundColor; var ownFill = own.A > 0.02f;
                var runBg = bg; if (ownFill) runBg = Over(bg, own);
                var runRadius = ownFill || label.BorderlineWidth > 0 ? CapRadius(label.CornerRadius.X * csx, cts, w, h) : 0;
                var pad = label.Padding; // TextGeometry is relative to the text area, which the label's padding insets
                var runs = TextRuns(label, m).Select(run => (run.Text, R: new RectF(cx + (run.X + pad.Start) * csx, cy + (run.Y + pad.Top) * csy, run.W * csx, run.H * csy))).Where(r => r.R.W > 0 && r.R.H > 0).ToList();
                foreach (var (runText, r) in runs)
                {
                    if (!r.Overlaps(clip)) continue;
                    var c = label.TextColor; if (c.A * cop <= 0.01f) continue; // fully transparent text is not text
                    ctx.Nodes.Add(new Node(runText, role ?? "text", r.X, r.Y, r.W, r.H, Hex(c.R, c.G, c.B, c.A), Hex255(runBg), label.PixelSize * label.Scale.X /* glyph size in CSS px; an ancestor's focus scale is a transform, which the web export leaves out of fontSize (LAYOUT.md) while the rect carries it */, m.Weight, runRadius, cop, id, false));
                }
                continue;
            }

            var bc = child.BackgroundColor;
            var fills = child is not ImageView && bc.A > 0.02f;
            var border = child is not ImageView && child.BorderlineWidth > 0 && child.BorderlineColor.A > 0.02f;
            var shadow = child is not ImageView && child.BoxShadow is not null;
            (double R, double G, double B) cbg = bg;
            if (fills) cbg = Over(bg, bc, Sem.IsColorMix(child));
            var visible = w > 1 && h > 1 && box.Overlaps(clip);
            var radius = CapRadius(child.CornerRadius.X * csx, cts, w, h);
            if (visible)
            {
                // a section whose top edge is drawn as a hairline child (a top border) is a painted container
                var hairline = role == "container" && child.Children.OfType<View>().Any(c => c.PositionY < 1 && c.Size.Height <= 1.5f && c.Size.Width >= size.Width * 0.95f && c.BackgroundColor.A > 0.02f);
                // a shadow-only helper that sits behind a sibling of the same box is that sibling's second shadow layer (NUI draws one BoxShadow per view, a CSS box-shadow list has two): the sibling is the element
                var shadowLayer = shadow && !fills && !border && !hairline && parent.Children.OfType<View>().Any(o => !ReferenceEquals(o, child) && o.PositionX == child.PositionX && o.PositionY == child.PositionY && o.Size.Width == size.Width && o.Size.Height == size.Height);
                var painted = (fills || border || shadow || hairline) && !shadowLayer;
                var control = role is not null and not ("container" or "none" or "text" or "img");
                if (child is ImageView)
                    ctx.Nodes.Add(new Node(role == "video" ? name ?? "" : "", role is null or "none" ? "image" : role, cx, cy, w, h, null, Hex255(bg), null, null, radius, cop, id, role == "container" && Sem.IsOverlay(child)));
                else if (control || (role == "img" && painted))
                    ctx.Nodes.Add(new Node(name ?? "", role!, cx, cy, w, h, null, Hex255(cbg), null, null, radius, cop, id, false));
                else if (painted)
                    ctx.Nodes.Add(new Node("", "container", cx, cy, w, h, null, Hex255(cbg), null, null, radius, cop, id, true));
            }
            var childClip = child.ClippingMode == ClippingModeType.ClipChildren ? clip.Intersect(box) : clip;
            Walk(ctx, child, cx, cy, csx, csy, cbg, cop, childClip, cts);
        }
    }

    /// <summary>One run per laid-out line of the label: the union of its glyphs' own bounds from the text layout (TextGeometry), in the label's local pixels. Nothing is added, measured elsewhere or guessed.</summary>
    private static IEnumerable<(string Text, float X, float Y, float W, float H)> TextRuns(TextLabel label, TextMetaInfo meta)
    {
        var text = label.Text; var lines = new List<(float Top, float Bottom, float L, float R, int First, int Last)>();
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsWhiteSpace(text[i])) continue;
            var pos = TextGeometry.GetTextPosition(label, i, i); var sz = TextGeometry.GetTextSize(label, i, i);
            if (pos.Count == 0 || sz.Count == 0) continue;
            float y = pos[0].Y, x = pos[0].X, w = sz[0].Width, h = sz[0].Height;
            var li = meta.Multiline ? lines.FindIndex(l => Math.Abs(l.Top - y) < h * 0.5f) : (lines.Count > 0 ? 0 : -1);
            if (li < 0) lines.Add((y, y + h, x, x + w, i, i));
            else { var l = lines[li]; lines[li] = (Math.Min(l.Top, y), Math.Max(l.Bottom, y + h), Math.Min(l.L, x), Math.Max(l.R, x + w), l.First, i); }
        }
        // The box of a run is the browser's content area: ascent and descent each rounded to a whole CSS px (Chrome SimpleFontData), hung from the baseline.
        // NUI rounds the same two metrics at the drawn pixel size (TextScale times the CSS size), so its glyph box is taller by up to a quarter px each side.
        // The baseline is the measured one: the laid-out glyph top plus the ascent FontClient reports for the drawn size. Nothing here is per text or per size.
        var k = label.PixelSize / meta.Size; var fam = meta.Family ?? Ui.Font;
        var drawn = Ui.FontAscentDescent(meta.Size, meta.Weight, fam, label.PixelSize);
        var design = Ui.FontAscentDescent(meta.Size, meta.Weight, fam, 500f); // the face's ascent and descent per px at a size where FreeType's whole-px rounding no longer matters
        var ascCss = (float)Math.Round(design.Asc / 500f * meta.Size); var descCss = (float)Math.Round(-design.Desc / 500f * meta.Size);
        foreach (var l in lines.OrderBy(l => l.Top))
        {
            var baseline = l.Top + drawn.Asc;
            yield return (System.Text.RegularExpressions.Regex.Replace(text[l.First..(l.Last + 1)], @"\s+", " ").Trim(), l.L, baseline - ascCss * k, l.R - l.L, (ascCss + descCss) * k);
        }
    }

    /// <summary>
    /// A fill with alpha over the backdrop, in the web exporter's arithmetic (layout-dump.mjs over): doubles on the 0..255 scale and the CSS alpha (a
    /// float 0.7f must not become 0.699999988, which tips a half-way channel the other way). Hex255 rounds like the web's hex2.
    /// </summary>
    private static (double R, double G, double B) Over((double R, double G, double B) bg, Color c, bool mix = false)
    {
        double a = Math.Round(c.A, 3);
        double Ch(double back, double top) => ((mix ? Math.Round((double)top, 6) * 255.0 : Math.Floor(top * 255.0 + 0.5)) * a + back * (1 - a)) / (a + 1 * (1 - a));
        return (Ch(bg.R, c.R), Ch(bg.G, c.G), Ch(bg.B, c.B));
    }

    private static string Hex255((double R, double G, double B) c) => $"#{(int)Math.Floor(c.R + 0.5):x2}{(int)Math.Floor(c.G + 0.5):x2}{(int)Math.Floor(c.B + 0.5):x2}"; // JS Math.round: halves up

    private static string Hex(float r, float g, float b, float a)
    {
        int B(float v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
        return a >= 0.995f ? $"#{B(r):x2}{B(g):x2}{B(b):x2}" : $"#{B(r):x2}{B(g):x2}{B(b):x2}{B(a):x2}";
    }
}
