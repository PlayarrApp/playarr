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
/// ancestor's clip, or fully covered by a later opaque paint are left out, as the web export leaves them out. No web value is used.
/// </summary>
internal static class LayoutExport
{
    private sealed record Node(string Text, string Role, float X, float Y, float W, float H, string? Color, string Background, float? FontSize, int? FontWeight, float Radius, float Opacity,
        int Order, int Id, int[] Chain, float PaintAlpha, (float R, float G, float B, float A)? Fill = null);

    private sealed class Ctx
    {
        public readonly List<Node> Nodes = new();
        public int Order;
        public int NextId;
        public float VW, VH;
    }

    public static string Json(string screen, string theme, bool clockPinned, Container root)
    {
        var win = Window.Instance.WindowSize;
        var ctx = new Ctx { VW = win.Width, VH = win.Height };
        var bg = Window.Instance.BackgroundColor;
        Walk(ctx, root, 0, 0, 1, 1, (bg.R, bg.G, bg.B), 1f, new RectF(0, 0, ctx.VW, ctx.VH), Array.Empty<int>());
        var nodes = DropOccluded(ctx.Nodes);
        // the background of an element is what is painted behind and including it at its centre: every earlier (or own) translucent fill over the window colour, in paint order
        var fills = ctx.Nodes.Where(f => f.Fill is not null).ToList();
        for (var i = 0; i < nodes.Count; i++)
        {
            var n = nodes[i]; var px = Math.Clamp(n.X + n.W / 2, 0, ctx.VW - 1); var py = Math.Clamp(n.Y + n.H / 2, 0, ctx.VH - 1); // the visible part's centre
            (float R, float G, float B) c = (bg.R, bg.G, bg.B);
            foreach (var f in fills)
            {
                if (f.Order > n.Order || f.Id == n.Id && n.Text.Length > 0 && n.FontSize is not null) continue;
                if (px < f.X || px > f.X + f.W || py < f.Y || py > f.Y + f.H) continue;
                var a = f.Fill!.Value.A; c = (c.R * (1 - a) + f.Fill.Value.R * a, c.G * (1 - a) + f.Fill.Value.G * a, c.B * (1 - a) + f.Fill.Value.B * a);
            }
            nodes[i] = n with { Background = Hex(c.R, c.G, c.B, 1) };
        }
        var sb = new StringBuilder();
        string N(float v) => v.ToString("0.##", CultureInfo.InvariantCulture);
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
        return sb.Append("]}").ToString();
    }

    private readonly record struct RectF(float X, float Y, float W, float H)
    {
        public float R => X + W; public float B => Y + H;
        public RectF Intersect(RectF o) { var x = Math.Max(X, o.X); var y = Math.Max(Y, o.Y); return new RectF(x, y, Math.Max(0, Math.Min(R, o.R) - x), Math.Max(0, Math.Min(B, o.B) - y)); }
        public bool Overlaps(RectF o) => X < o.R && o.X < R && Y < o.B && o.Y < B;
        public bool Contains(float px, float py) => px >= X && px <= R && py >= Y && py <= B;
    }

    private static string Q(string s) => Newtonsoft.Json.JsonConvert.ToString(s);

    // web: an element is dropped when every one of 3x3 samples of its box lands on a later paint (an image, or a fill of alpha 0.5 or more) outside its own subtree
    private static List<Node> DropOccluded(List<Node> all)
    {
        var painters = all.Where(p => p.PaintAlpha >= 0.5f).ToList();
        var kept = new List<Node>();
        foreach (var n in all)
        {
            var covered = true;
            foreach (var fy in new[] { 0.2f, 0.5f, 0.8f })
                foreach (var fx in new[] { 0.2f, 0.5f, 0.8f })
                {
                    var px = n.X + n.W * fx; var py = n.Y + n.H * fy;
                    if (px < 0 || py < 0) { continue; }
                    var hit = painters.Any(p => p.Order > n.Order && p.Id != n.Id && !p.Chain.Contains(n.Id) && !n.Chain.Contains(p.Id) && px >= p.X && px <= p.X + p.W && py >= p.Y && py <= p.Y + p.H);
                    if (!hit) { covered = false; break; }
                }
            if (!covered) kept.Add(n);
        }
        return kept;
    }

    // vx, vy: screen top-left of the parent; sx, sy: its accumulated scale; bg: the real backgrounds composited so far (over the window colour); op: accumulated opacity; clip: the visible area left by ancestors that clip their children
    private static void Walk(Ctx ctx, Container parent, float vx, float vy, float sx, float sy, (float R, float G, float B) bg, float op, RectF clip, int[] chain)
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
            var id = ctx.NextId++; var myChain = chain.Append(id).ToArray();
            Sem.Roles.TryGetValue(child, out var role);
            var name = string.IsNullOrEmpty(child.AccessibilityName) ? null : child.AccessibilityName;
            var box = new RectF(cx, cy, w, h);

            if (child is TextLabel label && Ui.TextMeta.TryGetValue(label, out var m) && !string.IsNullOrEmpty(label.Text))
            {
                var runs = TextRuns(label, m).Select(run => (run.Text, R: new RectF(cx + run.X * csx, cy + run.Y * csy, run.W * csx, run.H * csy))).Where(r => r.R.W > 0 && r.R.H > 0).ToList();
                foreach (var (runText, r) in runs)
                {
                    if (!r.Overlaps(clip)) continue;
                    var c = label.TextColor;
                    ctx.Nodes.Add(new Node(runText, role ?? "text", r.X, r.Y, r.W, r.H, Hex(c.R, c.G, c.B, c.A), Hex(bg.R, bg.G, bg.B, 1), label.PixelSize * label.Scale.X, m.Weight, role is "button" or "text" && parent is View pv ? Math.Min(pv.CornerRadius.X, Math.Min(pv.Size.Width, pv.Size.Height) / 2f) * sx : 0, cop, ctx.Order++, id, myChain, 0));
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
            var radius = child.CornerRadius.X * csx;
            if (visible)
            {
                // a section whose top edge is drawn as a hairline child (a top border) is a painted container
                var hairline = role == "container" && child.Children.OfType<View>().Any(c => c.PositionY < 1 && c.Size.Height <= 1.5f && c.Size.Width >= size.Width * 0.95f && c.BackgroundColor.A > 0.02f);
                var painted = fills || border || shadow || hairline;
                var control = role is not null and not ("container" or "none" or "text" or "img");
                if (child is ImageView)
                    ctx.Nodes.Add(new Node("", role is null or "none" ? "image" : role, cx, cy, w, h, null, Hex(bg.R, bg.G, bg.B, 1), null, null, radius, cop, ctx.Order++, id, myChain, cop));
                else if (control || (role == "img" && painted))
                    ctx.Nodes.Add(new Node(name ?? "", role!, cx, cy, w, h, null, Hex(cbg.R, cbg.G, cbg.B, 1), null, null, radius, cop, ctx.Order++, id, myChain, fills ? bc.A * cop : 0, fills ? (bc.R, bc.G, bc.B, bc.A * cop) : null));
                else if (painted)
                    ctx.Nodes.Add(new Node("", "container", cx, cy, w, h, null, Hex(cbg.R, cbg.G, cbg.B, 1), null, null, radius, cop, ctx.Order++, id, myChain, fills ? bc.A * cop : 0, fills ? (bc.R, bc.G, bc.B, bc.A * cop) : null));
            }
            var childClip = child.ClippingMode == ClippingModeType.ClipChildren ? clip.Intersect(box) : clip;
            Walk(ctx, child, cx, cy, csx, csy, cbg, cop, childClip, myChain);
        }
    }

    /// <summary>One run per laid-out line of the label: the characters' own bounds from the text layout (TextGeometry), merged per line, in the label's local pixels.</summary>
    private static IEnumerable<(string Text, float X, float Y, float W, float H)> TextRuns(TextLabel label, TextMetaInfo meta)
    {
        var text = label.Text; var lines = new List<(float Y, float Bottom, float L, float R, int First, int Last)>(); var spacing = label.CharacterSpacing; // the web's run ends after the last glyph's letter spacing; NUI's last glyph box does not carry it var lines = new List<(float Y, float Bottom, float L, float R, int First, int Last)>();
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsWhiteSpace(text[i])) continue;
            var pos = TextGeometry.GetTextPosition(label, i, i); var sz = TextGeometry.GetTextSize(label, i, i);
            if (pos.Count == 0 || sz.Count == 0) continue;
            float y = pos[0].Y, x = pos[0].X, w = sz[0].Width, h = sz[0].Height;
            var li = lines.FindIndex(l => Math.Abs(l.Y - y) < h * 0.5f);
            if (label.Ellipsis && x + w > label.Size.Width - 0.75f * label.PixelSize && Ui.TextWidth(text, meta.Size, meta.Weight, meta.Spacing, meta.Family) * Ui.TextScale > label.Size.Width) continue; // glyphs in the ellipsis zone of an elided label are replaced by the ellipsis and report unstable positions
            if (li < 0 && lines.Count > 0 && !meta.Multiline) continue; // a single-line label has one line: glyphs elsewhere were elided and are not drawn
            if (li >= 0 && x < lines[li].R - w * 0.5f) continue; // an elided glyph (past the ellipsis) is not drawn and reports no position of its own
            if (li < 0) lines.Add((y, y + h, x, x + w, i, i));
            else { var l = lines[li]; lines[li] = (l.Y, l.Bottom, Math.Min(l.L, x), Math.Max(l.R, x + w), l.First, i); }
        }
        foreach (var l in lines.OrderBy(l => l.Y))
        {
            // the run is the font's own line (measured on a label of this font); a wrapped label's lines start at the line top, a single line is centred in its box
            var box = l.Bottom - l.Y; var nat = Ui.TextHeight(meta.Size, meta.Weight, meta.Family) * Ui.TextScale;
            yield return (text[l.First..(l.Last + 1)], l.L, meta.Multiline ? l.Y : l.Y + (box - nat) / 2f, l.R - l.L + spacing, nat);
        }
    }

    private static string Hex(float r, float g, float b, float a)
    {
        int B(float v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
        return a >= 0.995f ? $"#{B(r):x2}{B(g):x2}{B(b):x2}" : $"#{B(r):x2}{B(g):x2}{B(b):x2}{B(a):x2}";
    }
}
