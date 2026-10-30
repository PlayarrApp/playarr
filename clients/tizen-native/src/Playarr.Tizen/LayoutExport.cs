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
    internal static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, string> Roles = new();

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, object> Overlays = new();
    /// <summary>A generated gradient or scrim image: translucent by construction, so it never hides what is under it.</summary>
    public static T Overlay<T>(T v) where T : View { Overlays.Add(v, v); return v; }
    internal static bool IsOverlay(View v) => Overlays.TryGetValue(v, out _);

    public static T Tag<T>(T v, string role, string? name = null) where T : View
    {
        Roles.Remove(v); Roles.Add(v, role);
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
        Walk(ctx, root, 0, 0, 1, 1, (bg.R, bg.G, bg.B), 1f, new RectF(0, 0, ctx.VW, ctx.VH));
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
            if (n.PaintOnly && !whole)
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

    // vx, vy: screen top-left of the parent; sx, sy: its accumulated scale; bg: the real backgrounds composited so far (over the window colour); op: accumulated opacity; clip: the visible area left by ancestors that clip their children
    private static void Walk(Ctx ctx, Container parent, float vx, float vy, float sx, float sy, (float R, float G, float B) bg, float op, RectF clip)
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
            var w = size.Width * csx; var h = size.Height * csy;
            var id = ctx.NextId++; ctx.Views[id] = child;
            Sem.Roles.TryGetValue(child, out var role);
            var name = string.IsNullOrEmpty(child.AccessibilityName) ? null : child.AccessibilityName;
            var box = new RectF(cx, cy, w, h);

            if (child is TextLabel label && Ui.TextMeta.TryGetValue(label, out var m) && !string.IsNullOrEmpty(label.Text))
            {
                // a label that draws its own pill (fill, border, rounded corners) is the web span: its fill is the run's background and its corner radius the run's radius
                var own = label.BackgroundColor; var ownFill = own.A > 0.02f;
                var runBg = bg; if (ownFill) runBg = (bg.R * (1 - own.A) + own.R * own.A, bg.G * (1 - own.A) + own.G * own.A, bg.B * (1 - own.A) + own.B * own.A);
                var runRadius = ownFill || label.BorderlineWidth > 0 ? Math.Min(label.CornerRadius.X * csx, Math.Min(w, h) / 2f) : 0;
                var pad = label.Padding; // TextGeometry is relative to the text area, which the label's padding insets
                var runs = TextRuns(label, m).Select(run => (run.Text, R: new RectF(cx + (run.X + pad.Start) * csx, cy + (run.Y + pad.Top) * csy, run.W * csx, run.H * csy))).Where(r => r.R.W > 0 && r.R.H > 0).ToList();
                foreach (var (runText, r) in runs)
                {
                    if (!r.Overlaps(clip)) continue;
                    var c = label.TextColor; if (c.A * cop <= 0.01f) continue; // fully transparent text is not text
                    ctx.Nodes.Add(new Node(runText, role ?? "text", r.X, r.Y, r.W, r.H, Hex(c.R, c.G, c.B, c.A), Hex(runBg.R, runBg.G, runBg.B, 1), label.PixelSize * label.Scale.X /* glyph size in CSS px; an ancestor's focus scale is a transform, which the web export leaves out of fontSize (LAYOUT.md) while the rect carries it */, m.Weight, runRadius, cop, id, false));
                }
                continue;
            }

            var bc = child.BackgroundColor;
            var fills = child is not ImageView && bc.A > 0.02f;
            var border = child is not ImageView && child.BorderlineWidth > 0 && child.BorderlineColor.A > 0.02f;
            var shadow = child is not ImageView && child.BoxShadow is not null;
            (float R, float G, float B) cbg = bg;
            if (fills) { var a = bc.A; cbg = (bg.R * (1 - a) + bc.R * a, bg.G * (1 - a) + bc.G * a, bg.B * (1 - a) + bc.B * a); }
            var visible = w > 1 && h > 1 && box.Overlaps(clip);
            var radius = Math.Min(child.CornerRadius.X * csx, Math.Min(w, h) / 2f);
            if (visible)
            {
                // a section whose top edge is drawn as a hairline child (a top border) is a painted container
                var hairline = role == "container" && child.Children.OfType<View>().Any(c => c.PositionY < 1 && c.Size.Height <= 1.5f && c.Size.Width >= size.Width * 0.95f && c.BackgroundColor.A > 0.02f);
                // a shadow-only helper that sits behind a sibling of the same box is that sibling's second shadow layer (NUI draws one BoxShadow per view, a CSS box-shadow list has two): the sibling is the element
                var shadowLayer = shadow && !fills && !border && !hairline && parent.Children.OfType<View>().Any(o => !ReferenceEquals(o, child) && o.PositionX == child.PositionX && o.PositionY == child.PositionY && o.Size.Width == size.Width && o.Size.Height == size.Height);
                var painted = (fills || border || shadow || hairline) && !shadowLayer;
                var control = role is not null and not ("container" or "none" or "text" or "img");
                if (child is ImageView)
                    ctx.Nodes.Add(new Node("", role is null or "none" ? "image" : role, cx, cy, w, h, null, Hex(bg.R, bg.G, bg.B, 1), null, null, radius, cop, id, false));
                else if (control || (role == "img" && painted))
                    ctx.Nodes.Add(new Node(name ?? "", role!, cx, cy, w, h, null, Hex(cbg.R, cbg.G, cbg.B, 1), null, null, radius, cop, id, false));
                else if (painted)
                    ctx.Nodes.Add(new Node("", "container", cx, cy, w, h, null, Hex(cbg.R, cbg.G, cbg.B, 1), null, null, radius, cop, id, true));
            }
            var childClip = child.ClippingMode == ClippingModeType.ClipChildren ? clip.Intersect(box) : clip;
            Walk(ctx, child, cx, cy, csx, csy, cbg, cop, childClip);
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
            float y = pos[0].Y, x = pos[0].X, w = sz[0].Width + label.CharacterSpacing /* a glyph's size is its advance without letter spacing; the layout places the next glyph at x + size + CharacterSpacing, so the glyph's laid-out advance (what the web run box measures) includes the spacing */, h = sz[0].Height;
            var li = meta.Multiline ? lines.FindIndex(l => Math.Abs(l.Top - y) < h * 0.5f) : (lines.Count > 0 ? 0 : -1);
            if (li < 0) lines.Add((y, y + h, x, x + w, i, i));
            else { var l = lines[li]; lines[li] = (Math.Min(l.Top, y), Math.Max(l.Bottom, y + h), Math.Min(l.L, x), Math.Max(l.R, x + w), l.First, i); }
        }
        foreach (var l in lines.OrderBy(l => l.Top))
            yield return (System.Text.RegularExpressions.Regex.Replace(text[l.First..(l.Last + 1)], @"\s+", " ").Trim(), l.L, l.Top, l.R - l.L, l.Bottom - l.Top); // exactly the glyph union TextGeometry reports
    }

    private static string Hex(float r, float g, float b, float a)
    {
        int B(float v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
        return a >= 0.995f ? $"#{B(r):x2}{B(g):x2}{B(b):x2}" : $"#{B(r):x2}{B(g):x2}{B(b):x2}{B(a):x2}";
    }
}
