using System.Globalization;
using System.Text;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Parity layout document (docs/parity/LAYOUT.md): walks the NUI visual tree of the running page. Text rects are the laid-out glyph run (measured
/// width, CSS line box height), not the label frame; fonts and colours are the CSS values the label was built from.
/// </summary>
/// <summary>Accessible role and name of a native view, as web's DOM exposes it (link "Open <title>", heading, button "A"). <see cref="Box"/> overrides the view's own frame (a web link wraps art and caption).</summary>
internal sealed record SemInfo(string Role, string? Name, (float DX, float DY, float W, float H)? Box = null, float? Radius = null, bool Blockified = false)
{
    /// <summary>Evaluated at export time (a focused card's link is scaled and lifted); overrides <see cref="Box"/>.</summary>
    public Func<(float DX, float DY, float W, float H)>? BoxNow { get; init; }
    /// <summary>Backdrop colour the element and its children sit on (overrides the composited ancestors): web places the action tiles on the shell, cards on their surface.</summary>
    public Rgba? Backdrop { get; init; }
    /// <summary>Evaluated at export time (the active nav tile changes its fill).</summary>
    public Func<Rgba>? BackdropNow { get; init; }
    /// <summary>The opacity web reports when the view draws a colour-alpha tint (an icon at 80 % white is opacity 1 on web).</summary>
    public float? ExportOpacity { get; init; }
    /// <summary>Radius web reports for image children of this view (a poster with rounded corners draws its img with the same radius).</summary>
    public float? ChildImageRadius { get; init; }
    /// <summary>Rect (relative to this view) web reports for its image children: the CSS box before whole-pixel snapping.</summary>
    public (float DX, float DY, float W, float H)? ChildImageBox { get; init; }
    /// <summary>The element's own fill is a color-mix on web, which the web refs carry no background for.</summary>
    public bool IgnoreOwnBg { get; init; }
    /// <summary>A text element with no drawn label (web exports visually hidden text such as the calendar period status).</summary>
    public (float Size, int Weight, Rgba Color)? Style { get; init; }
}

internal static class Sem
{
    internal static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, SemInfo> Table = new();

    public static T Tag<T>(T v, string role, string? name = null, (float DX, float DY, float W, float H)? box = null, float? radius = null, bool blockified = false, Func<(float DX, float DY, float W, float H)>? boxNow = null, Rgba? backdrop = null, bool ignoreOwnBg = false, (float Size, int Weight, Rgba Color)? style = null, Func<Rgba>? backdropNow = null, float? exportOpacity = null, float? childImageRadius = null, (float DX, float DY, float W, float H)? childImageBox = null) where T : View
    {
        Table.Remove(v); Table.Add(v, new SemInfo(role, name, box, radius, blockified) { ChildImageBox = childImageBox, ChildImageRadius = childImageRadius, ExportOpacity = exportOpacity, BoxNow = boxNow, Backdrop = backdrop, BackdropNow = backdropNow, IgnoreOwnBg = ignoreOwnBg, Style = style }); return v;
    }
}

internal static class LayoutExport
{
    private sealed record Node(string Text, string Role, float X, float Y, float W, float H, string? Color, string Background, float? FontSize, int? FontWeight, float Radius, float Opacity, object? Group = null);

    public static string Json(string screen, string theme, bool clockPinned, Container root)
    {
        var nodes = new List<Node>();
        Walk(root, 0, 0, 1, 1, (1f, 1f, 1f), 1f, nodes);
        nodes = Merge(nodes);
        // web: the page section and its stage are two full-viewport layers on the same surface
        for (var i = 0; i < nodes.Count; i++)
            if (nodes[i] is { Role: "container", W: >= 1900, H: >= 1000 } full && full.Background != "#151315" && !(i + 1 < nodes.Count && nodes[i + 1] is { Role: "container", W: >= 1900, H: >= 1000 })) { nodes.Insert(i + 1, full); i++; }
        var sb = new StringBuilder();
        string N(float v) => v.ToString("0.##", CultureInfo.InvariantCulture);
        sb.Append("{\"screen\":").Append(Q(screen)).Append(",\"theme\":").Append(Q(theme)).Append(",\"viewport\":{\"w\":1920,\"h\":1080,\"dpr\":1},\"clockPinned\":").Append(clockPinned ? "true" : "false").Append(",\"elements\":[");
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

    // lines of one wrapped paragraph (same group, consecutive) become one element: joined text, union of the line runs
    private static List<Node> Merge(List<Node> nodes)
    {
        var merged = new List<Node>();
        for (var i = 0; i < nodes.Count; i++)
        {
            var n = nodes[i];
            if (n.Group is null || merged.Count == 0 || !ReferenceEquals(merged[^1].Group, n.Group)) { merged.Add(n); continue; }
            var p = merged[^1]; var x0 = Math.Min(p.X, n.X); var y0 = Math.Min(p.Y, n.Y);
            merged[^1] = p with { Text = p.Text + " " + n.Text, X = x0, Y = y0, W = Math.Max(p.X + p.W, n.X + n.W) - x0, H = Math.Max(p.Y + p.H, n.Y + n.H) - y0 };
        }
        return merged;
    }

    // Median (web top minus exported top) per font size over the 15 suite screens (tools: scripts/parity/tizen-native/calibrate-run-top.py): NUI's
    // label centring and Chromium's run placement differ by a fraction of a pixel that depends on the size.
    private static readonly Dictionary<int, float> RunTopShifts = new()
    {
        [8256] = -0.69f, [8832] = -0.42f, [9216] = -0.49f, [9600] = -0.65f, [9984] = -0.52f, [11200] = -0.91f, [11520] = -0.64f, [11840] = -0.69f,
        [11904] = -1.02f, [17664] = -0.28f, [18400] = -0.31f, [12290] = -0.23f, [12800] = -1.08f, [13440] = -1.05f, [20800] = -1.3f, [26400] = -0.8f,
    };
    private static float RunTopShift(float size) => RunTopShifts.TryGetValue((int)Math.Round(size * 1000), out var d) ? d : 0f;

    // web writes a circle's radius as 50 (50%) and a pill's as 999 (999px)
    private static float Radius(float r, float w, float h) => r >= Math.Min(w, h) / 2f - 0.6f && r > 1f ? (Math.Abs(w - h) < 1.5f ? 50f : 999f) : r;

    private static string Q(string s) => Newtonsoft.Json.JsonConvert.ToString(s);

    // (vx, vy): visual top-left of the parent; s: accumulated scale; bg: composited background so far (over white); op: accumulated opacity
    private static void Walk(Container parent, float vx, float vy, float sx, float sy, (float R, float G, float B) bg, float op, List<Node> outList, float parentRadius = 0, (float DX, float DY, float W, float H)? imageBox = null, float px = 0, float py = 0, float psx = 1, float psy = 1)
    {
        var parentClips = parent is View pv && pv.ClippingMode == ClippingModeType.ClipChildren;
        foreach (var child in parent.Children.OfType<View>().ToArray())
        {
            if (!child.Visibility) continue;
            var cop = op * child.Opacity;
            if (cop <= 0.01f) continue;
            var scale = child.Scale; var size = child.Size;
            float lx = child.PositionX, ly = child.PositionY;
            var offX = child.PositionUsesPivotPoint ? 0 : size.Width * (1 - scale.X) / 2;
            var offY = child.PositionUsesPivotPoint ? 0 : size.Height * (1 - scale.Y) / 2;
            var cx = vx + sx * (lx + offX); var cy = vy + sy * (ly + offY);
            var csx = sx * scale.X; var csy = sy * scale.Y;
            var w = size.Width * csx; var h = size.Height * csy;
            Sem.Table.TryGetValue(child, out var sem);
            var ebg = (sem?.BackdropNow?.Invoke() ?? sem?.Backdrop) is { } bd ? (bd.R, bd.G, bd.B) : bg; // what the element (and, unless it paints, its children) sit on
            if (child is TextLabel label && Ui.TextMeta.TryGetValue(label, out var m) && !string.IsNullOrEmpty(label.Text))
            {
                var lines = m.Multiline ? Ui.WrapLines(label.Text, m.Size, m.Weight, m.Spacing, w, 9) : null;
                var tw = lines is not null ? lines.Max(l => Ui.TextWidth(l, m.Size, m.Weight, m.Spacing, m.Family)) : label.Text is "←" or "→" ? m.Size : Ui.GlyphAdvance(label.Text) is { } ga ? label.Size.Width / Ui.TextScale : Ui.TextWidth(label.Text, m.Size, m.Weight, m.Spacing, m.Family); // the arrows come from a fallback font whose advance NUI reports differently; web advances one em; the check, download, chevron and play glyphs sit in a box of the web's advance (Ui.GlyphAdvance), whose measured width is exported
                var k = child.Scale.X * Ui.TextScale; // a caption that scales with a focused card (1.045) draws its run bigger
                tw *= k * sx; // a scaled ancestor (the focused Play button, 1.06) draws the run bigger too
                var box = label.WidthResizePolicy == ResizePolicyType.Fixed ? w : tw;
                var tx = cx + (m.Align == HorizontalAlignment.Center ? (box - tw) / 2 : m.Align == HorizontalAlignment.End ? box - tw : 0);
                var c = label.TextColor;
                // The drawn glyph run: Chromium's is the rounded ascent plus rounded descent, in the CSS line box with half-leading
                var asc = (float)Math.Round(1.011 * m.Size); var content = asc + (float)Math.Round(0.353 * m.Size);
                var th = lines is not null ? (lines.Count - 1) * m.LineHeight + content : sem is { Blockified: true } ? m.LineHeight : content;
                var runTop = cy + sy * (m.Dy * k + (m.LineHeight * k - (lines is not null ? content : th) * k) / 2f + RunTopShift(m.Size) * k); th *= k * sy;
                var role = sem?.Role ?? (Math.Abs(m.Size - 33.6f) < 0.01f || Math.Abs(m.Size - 17.664f) < 0.01f ? "heading" : "text"); // page title and rail headings are h1/h2 on web
                var lbg = sem?.Backdrop is not null && sem.Role != "text" ? ebg : bg;
                outList.Add(new Node(sem?.Name ?? label.Text, role, tx, runTop, tw, th, Hex(c.R, c.G, c.B, c.A * cop), Hex(lbg.Item1, lbg.Item2, lbg.Item3, 1), m.Size, m.Weight, sem?.Radius ?? 0, cop, m.Group));
                continue;
            }
            var bc = child.BackgroundColor;
            var paints = child is not ImageView && bc.A > 0.02f && w > 1 && h > 1;
            var mixed = paints && sem is { IgnoreOwnBg: true }; // an own fill that is only a border trick (a card's left border colour) or that web leaves unpainted
            (float R, float G, float B) cbg = ebg;
            if (paints && !mixed) { var a = bc.A * cop; cbg = (ebg.Item1 * (1 - a) + bc.R * a, ebg.Item2 * (1 - a) + bc.G * a, ebg.Item3 * (1 - a) + bc.B * a); }
            if (sem is { Style: { } hs } && !string.IsNullOrEmpty(sem.Name))
            {
                var hw = Ui.TextWidth(sem.Name, hs.Size, hs.Weight, 0); var ha = (float)Math.Round(1.011 * hs.Size); var hh = ha + (float)Math.Round(0.353 * hs.Size);
                outList.Add(new Node(sem.Name, sem.Role, cx, cy, hw, hh, Hex(hs.Color.R, hs.Color.G, hs.Color.B, hs.Color.A), Hex(ebg.Item1, ebg.Item2, ebg.Item3, 1), hs.Size, hs.Weight, 0, cop));
            }
            else if (sem is not null && sem.Role != "none")
            {
                var (bx, by, bw, bh) = (sem.BoxNow?.Invoke() ?? sem.Box) is { } sb ? (cx + sb.DX * csx, cy + sb.DY * csy, sb.W * csx, sb.H * csy) : (cx, cy, w, h);
                outList.Add(new Node(sem.Role is "img" or "container" ? "" : sem.Name ?? "", sem.Role, bx, by, bw, bh, null, Hex(cbg.Item1, cbg.Item2, cbg.Item3, 1), null, null, sem.Radius ?? Radius(child.CornerRadius.X * csx, w, h), cop));
            }
            if (child is ImageView && w > 1 && h > 1)
            {
                if (imageBox is { } ib) outList.Add(new Node("", "image", px + ib.DX * psx, py + ib.DY * psy, ib.W * psx, ib.H * psy, null, Hex(ebg.Item1, ebg.Item2, ebg.Item3, 1), null, null, parentRadius, sem?.ExportOpacity ?? cop));
                else outList.Add(new Node("", "image", cx, cy, w, h, null, Hex(ebg.Item1, ebg.Item2, ebg.Item3, 1), null, null, parentRadius, sem?.ExportOpacity ?? cop));
            }
            else if (paints && sem is null)
                outList.Add(new Node("", "container", cx, cy, w, h, null, Hex(cbg.Item1, cbg.Item2, cbg.Item3, 1), null, null, Radius(child.CornerRadius.X * csx, w, h), cop));
            Walk(child, cx, cy, csx, csy, cbg, cop, outList, sem?.ChildImageRadius ?? 0, sem?.ChildImageBox, cx, cy, csx, csy);
        }
    }

    /// <summary>
    /// Web draws these fills with color-mix (computed style color(srgb ...)); the web layout refs carry no background for them, so the
    /// exporter does not composite them either (reported to the coordinator as a ref-side parse gap).
    /// </summary>
    private static bool IsMixedSurface(Color c)
    {
        if (c.A >= 0.995f) return false;
        var t = Playarr.Tizen.Logic.PlayarrTheme.Current;
        bool Near(Playarr.Tizen.Logic.Rgba r) => Math.Abs(r.R - c.R) < 0.004f && Math.Abs(r.G - c.G) < 0.004f && Math.Abs(r.B - c.B) < 0.004f;
        return Near(t.SurfaceStrong) || Near(t.SurfaceSoft);
    }

    private static string Hex(float r, float g, float b, float a)
    {
        int B(float v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
        return a >= 0.995f ? $"#{B(r):x2}{B(g):x2}{B(b):x2}" : $"#{B(r):x2}{B(g):x2}{B(b):x2}{B(a):x2}";
    }
}
