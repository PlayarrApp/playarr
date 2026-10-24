using System.Globalization;
using System.Text;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Parity layout document (docs/parity/LAYOUT.md): walks the NUI visual tree of the running page. Text rects are the laid-out glyph run (measured
/// width, CSS line box height), not the label frame; fonts and colours are the CSS values the label was built from.
/// </summary>
internal static class LayoutExport
{
    private sealed record Node(string Text, string Role, float X, float Y, float W, float H, string? Color, string Background, float? FontSize, int? FontWeight, float Radius, float Opacity);

    public static string Json(string screen, string theme, bool clockPinned, Container root)
    {
        var nodes = new List<Node>();
        Walk(root, 0, 0, 1, 1, (1f, 1f, 1f), 1f, nodes);
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

    private static string Q(string s) => Newtonsoft.Json.JsonConvert.ToString(s);

    // (vx, vy): visual top-left of the parent; s: accumulated scale; bg: composited background so far (over white); op: accumulated opacity
    private static void Walk(Container parent, float vx, float vy, float sx, float sy, (float R, float G, float B) bg, float op, List<Node> outList)
    {
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
            var cbg = bg;
            if (child is TextLabel label && Ui.TextMeta.TryGetValue(label, out var m) && !string.IsNullOrEmpty(label.Text))
            {
                var tw = Ui.TextWidth(label.Text, m.Size, m.Weight, m.Spacing);
                var box = label.WidthResizePolicy == ResizePolicyType.Fixed ? w : tw;
                var tx = cx + (m.Align == HorizontalAlignment.Center ? (box - tw) / 2 : m.Align == HorizontalAlignment.End ? box - tw : 0);
                var c = label.TextColor;
                outList.Add(new Node(label.Text, m.Size >= 24 ? "heading" : "text", tx, cy + m.Dy * csx, tw, m.LineHeight, Hex(c.R, c.G, c.B, c.A * cop), Hex(bg.R, bg.G, bg.B, 1), m.Size, m.Weight, 0, cop));
                continue;
            }
            if (child is ImageView img && w > 1 && h > 1)
                outList.Add(new Node("", "image", cx, cy, w, h, null, Hex(bg.R, bg.G, bg.B, 1), null, null, child.CornerRadius.X * csx, cop));
            var bc = child.BackgroundColor;
            if (child is not ImageView && bc.A > 0.02f && w > 1 && h > 1)
            {
                var a = bc.A * cop;
                cbg = (bg.R * (1 - a) + bc.R * a, bg.G * (1 - a) + bc.G * a, bg.B * (1 - a) + bc.B * a);
                outList.Add(new Node("", "container", cx, cy, w, h, null, Hex(cbg.R, cbg.G, cbg.B, 1), null, null, child.CornerRadius.X * csx, cop));
            }
            Walk(child, cx, cy, csx, csy, cbg, cop, outList);
        }
    }

    private static string Hex(float r, float g, float b, float a)
    {
        int B(float v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
        return a >= 0.995f ? $"#{B(r):x2}{B(g):x2}{B(b):x2}" : $"#{B(r):x2}{B(g):x2}{B(b):x2}{B(a):x2}";
    }
}
