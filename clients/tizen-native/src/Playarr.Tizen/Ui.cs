using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Thin helpers so screens read like the web CSS: absolute design pixels on the 1920x1080 canvas.</summary>
internal static class Ui
{
    private static TextLabel? _measure;

    /// <summary>Natural single-line width of a string at the given style (a hidden label, measured synchronously).</summary>
    public static float TextWidth(string text, float size, int weight, float spacing, string family = Font)
    {
        if (_measure is null) { _measure = new TextLabel { MultiLine = false, WidthResizePolicy = ResizePolicyType.UseNaturalSize, HeightResizePolicy = ResizePolicyType.UseNaturalSize }; _measure.Opacity = 0; Window.Default.Add(_measure); }
        (family, weight) = Face(family, weight, size);
        var k = Math.Min(MeasureScale, Math.Max(1f, 200f / size)); // very large glyph sizes overflow the label texture
        _measure.PixelSize = size * k; _measure.FontFamily = family; _measure.FontStyle = new PropertyMap().AddWeight(weight); _measure.CharacterSpacing = spacing * k; _measure.Text = text;
        return _measure.NaturalSize.Width / k;
    }

    /// <summary>NUI's own natural single-line height (the font's laid-out line) of a label of this size and weight, measured on the hidden label like <see cref="TextWidth"/>.</summary>
    /// <summary>The ascent and descent (px per px of font size) FontClient reports for the font file a label of this family and weight draws with.</summary>
    private static readonly Dictionary<(string, float), (float Asc, float Desc)> MetricsCache = new();

    /// <summary>Ascent and descent in px of the font file FontClient resolves for this label font (family and weight) at this pixel size, as FontClient reports them.</summary>
    internal static (float Asc, float Desc) FontAscentDescent(float size, int weight, string family, float pixelSize = 0)
    {
        (var fam, var w) = Face(family, weight, size);
        var file = fam == Mono ? $"fonts/JetBrainsMono-{(w >= 600 ? 700 : 400)}.ttf" : fam.StartsWith(Font + " W", StringComparison.Ordinal) ? $"fonts/NunitoSans{fam.Substring(Font.Length + 1)}.ttf" : $"fonts/NunitoSans-{w}.ttf";
        if (pixelSize <= 0) pixelSize = size; var key = (file, pixelSize);
        if (MetricsCache.TryGetValue(key, out var hit)) return hit;
        var fc = FontClient.Instance; var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
        var getId = typeof(FontClient).GetMethod("GetFontId", flags, null, new[] { typeof(string), typeof(uint), typeof(uint) }, null)!;
        var getMetrics = typeof(FontClient).GetMethod("GetFontMetrics", flags)!;
        var metricsType = getMetrics.GetParameters()[1].ParameterType;
        var id = (uint)getId.Invoke(fc, new object[] { ResPath(file), (uint)Math.Round(pixelSize * 64), 0u })!;
        var fm = Activator.CreateInstance(metricsType, flags, null, null, null)!;
        getMetrics.Invoke(fc, new[] { (object)id, fm });
        float Read(string n) => Convert.ToSingle(metricsType.GetProperty(n, flags)!.GetValue(fm));
        return MetricsCache[key] = (Read("Ascender"), -Math.Abs(Read("Descender")));
    }

    internal static string FontMetricsProbe() => string.Join("; ", new[] { 12f, 24f, 48f }.Select(sz => { var (a, d) = FontAscentDescent(sz, 400, Font); return $"size {sz}: asc {a} desc {d}"; }));

    private static readonly Dictionary<(float, int, string), float> HeightCache = new();
    public static float TextHeight(float size, int weight, string family = Font)
    {
        if (HeightCache.TryGetValue((size, weight, family), out var cached)) return cached;
        var key = (size, weight, family);
        TextWidth("Hg", size, weight, 0, family);
        (family, weight) = Face(family, weight, size);
        var k = Math.Min(MeasureScale, Math.Max(1f, 200f / size));
        _measure!.PixelSize = size * k; _measure.FontFamily = family; _measure.FontStyle = new PropertyMap().AddWeight(weight); _measure.CharacterSpacing = 0; _measure.Text = "Hg";
        return HeightCache[key] = _measure.NaturalSize.Height / k;
    }

    internal static readonly System.Runtime.CompilerServices.ConditionalWeakTable<View, TextMetaInfo> TextMeta = new();

    /// <summary>Greedy word wrap like the browser's, using measured widths; see <see cref="TextWrap"/>.</summary>
    public static List<string> WrapLines(string text, float size, int weight, float spacing, float width, int maxLines = int.MaxValue, string family = Font, bool balance = false) =>
        TextWrap.WrapLines(text, s => TextWidth(s, size, weight, spacing, family), width, maxLines, balance);

    /// <summary>Web .tv-preview-meta: one span per part, 12.8 px apart (a run of spaces would drift from the span edges). Parts are joined by three or more spaces.</summary>
    public static void MetaRow(View parent, string joined, float x, float y, float size, int weight, Rgba color, float lh, float gap = 12.8f)
    {
        foreach (var part in System.Text.RegularExpressions.Regex.Split(joined, " {3,}").Where(p => p.Length > 0))
        {
            parent.Add(Text(part, x, y, size, weight, color, 0, lh));
            x += TextWidth(part, size, weight, 0) + gap;
        }
    }

    /// <summary>A heading (page title, rail title): a text label the accessibility tree exposes as a heading.</summary>
    public static TextLabel Heading(string text, float x, float y, float size, int weight, Rgba color, float w = 0, float lh = 0, HorizontalAlignment align = HorizontalAlignment.Begin, bool multiline = false, bool upper = false, float spacing = 0, string family = Font, int maxLines = 0) =>
        Sem.Tag(Text(text, x, y, size, weight, color, w, lh, align, multiline, upper, spacing, family, maxLines), "heading");

    /// <summary>A wrapped paragraph as one single-line label per line (CSS line height <paramref name="lh"/>); returns the number of lines.</summary>
    public static int Paragraph(View parent, string text, float x, float y, float size, int weight, Rgba color, float width, float lh, float spacing = 0, int maxLines = int.MaxValue, bool balance = false, string role = "text")
    {
        var lines = WrapLines(text, size, weight, spacing, width, maxLines, balance: balance);
        if (lines.Count == 0) return 0;
        // one single-line label per wrapped line: the web exports one glyph run per rendered line, each as tall as the font's content area
        for (var i = 0; i < lines.Count; i++)
        {
            var label = Text(lines[i], x, y + i * lh, size, weight, color, 0, lh, spacing: spacing);
            if (role != "text") Sem.Tag(label, role);
            parent.Add(label);
        }
        return lines.Count;
    }

    /// <summary>The theme's hairline colour family (dark: light grey, light: warm ink) at the given alpha.</summary>
    /// <summary>Web .tv-filter-drawer: the strong surface at 94 % over the page, with a wide soft shadow falling to its left (box-shadow -32px 0 90px).</summary>
    public static View DrawerPanel(PlayarrTheme t)
    {
        var p = Box(1560, 0, 360, 1080, t.SurfaceStrong.Mixed(0.94f));
        p.BoxShadow = new Shadow(90, new Color(40 / 255f, 26 / 255f, 24 / 255f, 0.24f), new Vector2(-32, 0), new Vector2(0, 0));
        return p;
    }

    /// <summary>The layer a drawer draws its content in: a child of the dialog panel (web nests the content in the dialog), laid out in screen coordinates.</summary>
    public static View DrawerLayer(View panel)
    {
        var layer = new View { PositionX = -panel.PositionX, Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight) };
        Sem.Tag(layer, "none");
        panel.Add(layer);
        return layer;
    }

    /// <summary>
    /// Turns a text label into the web's pill: the label itself draws the fill, border and rounded corners over a box of <paramref name="w"/> x <paramref name="h"/>
    /// (the web span is that pill), and its line stays where it was drawn (the label's top becomes padding). The label's own radius and fill are what the exporter reads.
    /// </summary>
    public static TextLabel Pill(TextLabel label, float x, float y, float w, float h, Rgba fill, float radius, Color? border = null, float borderWidth = 0)
    {
        var top = label.PositionY;
        label.PositionX = x; label.PositionY = y;
        label.WidthResizePolicy = ResizePolicyType.Fixed; label.HeightResizePolicy = ResizePolicyType.Fixed;
        label.Size = new Size(w * TextScale, h * TextScale);
        label.Padding = new Extents(0, 0, (ushort)Math.Round(top * TextScale), 0);
        if (fill.A > 0) label.BackgroundColor = C(fill);
        label.CornerRadius = FullRadius(radius, w, h) * TextScale;
        if (borderWidth > 0 && border is { } b) { label.BorderlineWidth = borderWidth * TextScale; label.BorderlineColor = b; }
        return label;
    }

    public static Color LineA(PlayarrTheme t, float alpha) => new(t.Line.R, t.Line.G, t.Line.B, alpha);

    public static void Restart(this global::Tizen.NUI.Timer t) { t.Stop(); t.Start(); }
    public static void Show(this View v, bool visible) => v.Opacity = visible ? 1f : 0f;

    public const string Font = "Nunito Sans";
    public const string Mono = "JetBrains Mono";

    public static Color C(Rgba c) => new(c.R, c.G, c.B, c.A);

    public static string ResPath(string relative) =>
        global::Tizen.Applications.Application.Current.DirectoryInfo.Resource + relative;

    /// <summary>
    /// NUI lays text out with whole-pixel glyph advances (a 12.8 px "01:00" is 36 px, the web's subpixel layout 33.6 px). Labels are laid out at
    /// this multiple of the CSS size and drawn scaled back down, so advances land on 1/TextScale px like the browser's.
    /// </summary>
    internal const float TextScale = 4f;
    /// <summary>Measuring (never drawing) at 16x: advances land on 1/16 px, as the browser's subpixel layout.</summary>
    private const float MeasureScale = 16f;

    private static readonly Dictionary<int, int[]> WebBySize = WebWeights.BySize.ToDictionary(kv => (int)Math.Round(kv.Key * 1000), kv => kv.Value);

    /// <summary>
    /// NUI only picks the named weights of a family, the web interpolates its variable font (560, 640, 860, ...). The weights web CSS uses at
    /// each size are in <see cref="WebWeights"/> (generated from web DOM dumps); a call site's weight snaps to the nearest of them, and
    /// the fractional ones are drawn from the static instances "Nunito Sans W&lt;weight&gt;" in res/fonts (scripts/make-web-weights.py).
    /// </summary>
    private static (string Family, int Weight) Face(string family, int weight, float size)
    {
        if (family != Font) return (family, weight);
        if (WebBySize.TryGetValue((int)Math.Round(size * 1000), out var ws)) { var near = ws.OrderBy(w => Math.Abs(w - weight)).First(); if (Math.Abs(near - weight) <= 45) weight = near; }
        return Array.IndexOf(WebWeights.Instanced, weight) >= 0 ? ($"{Font} W{weight}", 400) : (family, weight);
    }

    /// <summary>Registers the bundled Nunito Sans weights so TextLabel can use them by family name.</summary>
    public static void RegisterFonts() => FontClient.Instance.AddCustomFontDirectory(ResPath("fonts"));

    /// <summary>A fully rounded box is drawn the way the web's border-radius 999px (pill) or 50% (circle, up to 100 px) is: the radius is clamped to half the short side when drawn, and the view reports the CSS value.</summary>
    internal static float FullRadius(float radius, float w, float h) => Math.Min(radius, Math.Min(w, h) / 2f); // a radius larger than half the short side draws as a full round (pill or circle); the view carries the drawn pixel radius

    public static View Box(float x, float y, float w, float h, Rgba? bg = null, float radius = 0)
    {
        var v = new View { PositionX = x, PositionY = y, Size = new Size(w, h) };
        if (bg is { } c) { v.BackgroundColor = C(c); }
        if (radius > 0) v.CornerRadius = FullRadius(radius, w, h);
        return v;
    }

    /// <summary>
    /// CSS-like text in design px. (x, y) is the top-left of the CSS line box, so a label with line height <paramref name="lh"/>
    /// sits where the web's does; weight 300..800; <paramref name="spacing"/> is letter spacing in px.
    /// </summary>
    public static TextLabel Text(string text, float x, float y, float size, int weight, Rgba color, float w = 0, float lh = 0,
        HorizontalAlignment align = HorizontalAlignment.Begin, bool multiline = false, bool upper = false, float spacing = 0, string family = Font, int maxLines = 0, bool exactLines = false, bool block = false)
    {
        var cssFamily = family; var reqWeight = weight;
        if (block) { multiline = true; exactLines = true; maxLines = 1; }
        // web draws these glyphs from fallback fonts (Liberation Sans arrows, DejaVu Sans symbols) with the primary font's line metrics; the bundled subsets carry the same advances and Nunito's ascent and descent
        if (family == Font && text is "←" or "→") { family = "Liberation Sans"; weight = weight >= 600 ? 700 : 400; }
        else if (family == Font && text is "⇩" or "☷" or "⌄" or "✓" or "▶") { family = "Playarr Symbols"; weight = weight >= 600 ? 700 : 400; }
        if (!multiline && w <= 0) w = TextWidth(upper ? text.ToUpperInvariant() : text, size, weight, spacing, family); // an inline run is as wide as its text
        (family, weight) = Face(family, weight, size);
        var cssWeight = family.StartsWith(Font + " W", StringComparison.Ordinal) ? int.Parse(family[(Font.Length + 2)..]) : weight; // a fallback-font arrow reports the weight its face really draws (Liberation Sans Bold, 700)
        var cssY = y;
        var line = lh > 0 ? lh : size * 1.4f;
        // a single line is a label exactly as tall as the browser's content area (rounded ascent plus rounded descent), top-aligned and centred in the CSS line box
        var content = CssLineBox.Content(size);
        // a block-level text element (the clock) is as tall as its CSS line; an inline run is the browser's content area
        var boxH = multiline ? Math.Max(line, size * 1.45f) : content;
        y += multiline ? (exactLines ? 0 : -(boxH - line) / 2f) : CssLineBox.Top(line, size); // single line: Blink puts the content area at the floored half-leading below the line top (FontHeight::AddLeading)
        var t = new TextLabel(upper ? text.ToUpperInvariant() : text)
        {
            PositionX = x,
            PositionY = y,
            PixelSize = size * TextScale,
            TextColor = C(color),
            FontFamily = family,
            FontStyle = new PropertyMap().AddWeight(weight),
            HorizontalAlignment = align,
            VerticalAlignment = VerticalAlignment.Top,
            MultiLine = multiline,
            Ellipsis = false, // an overflowing line is clipped by its parent, never elided, so every glyph has a laid-out position
        };
        if (!multiline && w > 0) t.RelativeLineHeight = boxH / TextHeight(size, reqWeight, cssFamily); // the label's line is exactly the box, as the browser's
        if (spacing != 0) t.CharacterSpacing = spacing * TextScale;
        if (multiline && maxLines > 0) t.Ellipsis = false;
        if (multiline) { if (exactLines) { t.LineSpacing = (line - TextHeight(size, reqWeight, cssFamily)) * TextScale; } else t.RelativeLineHeight = line / (size * 1.364f); t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size((w + (exactLines ? 3 : 0)) * TextScale, size * 1.6f * Math.Max(2, maxLines) * TextScale); }
        else if (w > 0) { t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size((w + (align == HorizontalAlignment.Begin ? 3 : 0)) * TextScale, boxH * TextScale); } // slack: the drawn advances can exceed the measured ones by a fraction of a pixel, which would ellipsise a line that fits
        else { t.WidthResizePolicy = ResizePolicyType.UseNaturalSize; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(0, boxH * TextScale); }
        t.PivotPoint = global::Tizen.NUI.PivotPoint.TopLeft; t.PositionUsesPivotPoint = true; t.ParentOrigin = global::Tizen.NUI.ParentOrigin.TopLeft;
        t.Scale = new Vector3(1 / TextScale, 1 / TextScale, 1);
        TextMeta.Add(t, new TextMetaInfo(size, cssWeight, line, cssY - y, spacing, align, color, multiline) { Family = cssFamily, Block = block });
        return t;
    }

    /// <summary>Linear gradient box ("to right" when horizontal, else "to bottom"); stops are (offset 0..1, straight-alpha colour). Rendered once to a PNG and stretched.</summary>
    public static View Gradient(float x, float y, float w, float h, bool horizontal, params (float At, Rgba Color)[] stops)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var key = (horizontal ? "h" : "v") + string.Join("_", stops.Select(s => $"{s.At:0.###}-{s.Color.R:0.##}-{s.Color.G:0.##}-{s.Color.B:0.##}-{s.Color.A:0.###}"));
        var path = dir + "grad-" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(key)))[..16] + ".png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.Make(horizontal, stops));
        return Sem.Overlay(new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) });
    }

    /// <summary>
    /// The web scroll-edge fade (page-layout.css [data-fade-axis]): content is masked down to the 30 % floor at the edge, easing back to full over
    /// 59.4 px with smoothstep stops at 25/50/75 % of the size. A mask cannot be cloned here, so this overlays the surface colour with the inverse alpha.
    /// </summary>
    public static View EdgeFade(float x, float y, float w, Rgba surface, bool atTop)
    {
        const float size = 59.4f, floor = 0.3f;
        float A(float k) => 1 - (floor + (1 - floor) * k);
        var edge = new[] { (0f, A(0)), (0.25f, A(0.156f)), (0.5f, A(0.5f)), (0.75f, A(0.844f)), (1f, A(1)) };
        var stops = (atTop ? edge : edge.Reverse().Select(e => (1 - e.Item1, e.Item2))).Select(e => (e.Item1, new Rgba(surface.R, surface.G, surface.B, e.Item2))).ToArray();
        return Gradient(x, atTop ? y : y - size, w, size, false, stops);
    }

    public static View HorizontalEdgeFade(float x, float y, float h, Rgba surface, bool atLeft)
    {
        const float size = 59.4f, floor = 0.3f;
        float A(float k) => 1 - (floor + (1 - floor) * k);
        var edge = new[] { (0f, A(0)), (0.25f, A(0.156f)), (0.5f, A(0.5f)), (0.75f, A(0.844f)), (1f, A(1)) };
        var stops = (atLeft ? edge : edge.Reverse().Select(e => (1 - e.Item1, e.Item2))).Select(e => (e.Item1, new Rgba(surface.R, surface.G, surface.B, e.Item2))).ToArray();
        return Gradient(atLeft ? x : x - size, y, size, h, true, stops);
    }

    /// <summary>
    /// Web .tv-library-grid-panel / .tv-rail-surface: the right 1190 px carry a frost (soft surface over the strong one, 48 % in light and 44 % in dark)
    /// that fades in from nothing at the left edge to full at the right.
    /// </summary>
    public static View PanelWash(PlayarrTheme t, float width = 1190.39f)
    {
        var dark = t.Name == "dark"; var mix = dark ? 0.44f : 0.48f;
        float Ch(float soft, float strong) => soft * mix + strong * (1 - mix);
        var frost = (Ch(t.SurfaceSoft.R, t.SurfaceStrong.R), Ch(t.SurfaceSoft.G, t.SurfaceStrong.G), Ch(t.SurfaceSoft.B, t.SurfaceStrong.B));
        var alphas = new[] { (0f, 0f), (0.12f, dark ? 0.72f : 0.68f), (0.34f, dark ? 0.9f : 0.88f), (0.62f, dark ? 0.97f : 0.96f), (1f, 1f) };
        var origin = TizenClient.DesignWidth - width;
        // a plain grouping view paints nothing itself: the export and the visibility check see only its two real paint children, each with its true bounds
        var root = new View { PositionX = origin, PositionY = 0, Size = new Size(width, TizenClient.DesignHeight) };
        // Key art (and its stage wash) ends at 133 + 900 px; right of that the panel lies over the flat page colour only, so it is drawn as the
        // browser's dithered result (see GradientPng.MakeDitheredPanel). Left of it the art shows through, so the translucent gradient stays.
        const int artEnd = 1033;
        var cut = (artEnd - origin) / width;
        var a0 = alphas.Last(s => s.Item1 <= cut); var a1 = alphas.First(s => s.Item1 > cut);
        var aCut = a0.Item2 + (a1.Item2 - a0.Item2) * (cut - a0.Item1) / (a1.Item1 - a0.Item1);
        Rgba Frost(float a) => new(frost.Item1, frost.Item2, frost.Item3, a);
        var left = alphas.Where(s => s.Item1 < cut).Select(s => (s.Item1 / cut, Frost(s.Item2))).Append((1f, Frost(aCut))).ToArray();
        var leftWidth = artEnd - origin;
        var g = Gradient(0, 0, leftWidth, TizenClient.DesignHeight, true, left);
        root.Add(Sem.Tag(g, "container"));
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var path = dir + $"panel-{t.Name}-{origin:0.###}-{width:0.###}-v3.png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.MakeDitheredPanel(alphas, frost, ((int)Math.Round(t.Surface.R * 255), (int)Math.Round(t.Surface.G * 255), (int)Math.Round(t.Surface.B * 255)), origin, width, artEnd, TizenClient.DesignHeight));
        root.Add(Sem.Tag(Sem.Overlay(new ImageView(path) { PositionX = artEnd - origin, PositionY = 0, Size = new Size(TizenClient.DesignWidth - artEnd, TizenClient.DesignHeight), SynchronousLoading = true }), "container"));
        return root;
    }

    /// <summary>Angled gradient rendered at the target aspect ratio so its direction is preserved when displayed.</summary>
    public static View DiagonalGradient(float x, float y, float w, float h, float degrees, params (float At, Rgba Color)[] stops)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var pixelWidth = Math.Max(1, (int)Math.Round(w));
        var pixelHeight = Math.Max(1, (int)Math.Round(h));
        var key = $"d{degrees:0.###}-{pixelWidth}x{pixelHeight}-" + string.Join("_", stops.Select(s => $"{s.At:0.###}-{s.Color.R:0.##}-{s.Color.G:0.##}-{s.Color.B:0.##}-{s.Color.A:0.###}"));
        var path = dir + "grad-" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(key)))[..16] + ".png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.MakeDiagonal(stops, pixelWidth, pixelHeight, degrees));
        return Sem.Overlay(new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) });
    }

    /// <summary>
    /// A CSS box-shadow ring around the rounded box at (x, y, w, h): the blurred, offset shadow outside the border box only (see <see cref="BoxShadowPng"/>),
    /// so a translucent fill over it is not tinted by it. Add it before the box so the box paints over.
    /// </summary>
    public static View BoxShadowRing(float x, float y, float w, float h, float radius, float blur, float dx, float dy, Rgba color)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        float fx = x - (float)Math.Floor(x), fy = y - (float)Math.Floor(y);
        var key = $"s{w:0.####}x{h:0.####}-{radius:0.###}-{blur:0.###}-{dx:0.###}-{dy:0.###}-{fx:0.####}-{fy:0.####}-{color.R:0.##}-{color.G:0.##}-{color.B:0.##}-{color.A:0.###}";
        var path = dir + "shadow-" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(key)))[..16] + ".png";
        var m = Playarr.Tizen.Logic.BoxShadowPng.Margin(blur, dx, dy);
        int iw = (int)Math.Ceiling(w + fx) + 2 * m, ih = (int)Math.Ceiling(h + fy) + 2 * m;
        if (!File.Exists(path)) File.WriteAllBytes(path, Playarr.Tizen.Logic.BoxShadowPng.Make(w, h, radius, blur, dx, dy, color, fx, fy).Png);
        return Sem.Overlay(new ImageView(path) { PositionX = (float)Math.Floor(x) - m, PositionY = (float)Math.Floor(y) - m, Size = new Size(iw, ih) });
    }

    public static View RadialGradient(float x, float y, float w, float h, Rgba color, float centerX, float centerY, float radiusFraction)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var pixelWidth = Math.Max(1, (int)Math.Round(w));
        var pixelHeight = Math.Max(1, (int)Math.Round(h));
        var key = $"r{pixelWidth}x{pixelHeight}-{centerX:0.###}-{centerY:0.###}-{radiusFraction:0.###}-{color.R:0.##}-{color.G:0.##}-{color.B:0.##}-{color.A:0.###}";
        var path = dir + "grad-" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(key)))[..16] + ".png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.MakeRadial(pixelWidth, pixelHeight, color, centerX, centerY, radiusFraction));
        return Sem.Overlay(new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) });
    }

    /// <summary>The details-panel scrim over a panel box (x, y, w, h): extends 40% left, 22% right, 14% above and below, as web.</summary>
    public static View PanelScrim(PlayarrTheme t, float x, float y, float w, float h)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var path = dir + $"scrim-{t.Name}.png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.PanelScrim(new Rgba(t.Surface.R, t.Surface.G, t.Surface.B, 0.94f)));
        return Sem.Overlay(new ImageView(path) { PositionX = x - 0.4f * w, PositionY = y - 0.14f * h, Size = new Size(w * 1.62f, h * 1.28f) });
    }

    /// <summary>An ImageView drawn through a grayscale/contrast/brightness shader (web's filter on the Home key art).</summary>
    public static ImageView FilteredImage(string url, float x, float y, float w, float h, float contrast, float brightness, float fadeStartX = 1f)
    {
        var alphaMask = fadeStartX >= 1f
            ? "1.0"
            : $"clamp((1.0 - vTexCoord.x) / {1f - fadeStartX:0.###}, 0.0, 1.0)";
        var frag = "precision mediump float;\nvarying mediump vec2 vTexCoord;\nuniform sampler2D sTexture;\nuniform lowp vec4 uColor;\n" +
                   "void main(){ vec4 c = texture2D(sTexture, vTexCoord); float g = dot(c.rgb, vec3(0.299, 0.587, 0.114)); " +
                   $"g = ((g - 0.5) * {contrast:0.###} + 0.5) * {brightness:0.###}; float mask = {alphaMask}; gl_FragColor = vec4(vec3(g), c.a * mask) * uColor; }}";
        var shader = new PropertyMap();
        shader.Add("fragmentShader", new PropertyValue(frag));
        var map = new PropertyMap();
        map.Add(Visual.Property.Type, new PropertyValue((int)Visual.Type.Image));
        map.Add(ImageVisualProperty.URL, new PropertyValue(url));
        map.Add(ImageVisualProperty.FittingMode, new PropertyValue((int)FittingModeType.ScaleToFill)); // object-fit: cover
        map.Add(Visual.Property.Shader, new PropertyValue(shader));
        var iv = new ImageView { PositionX = x, PositionY = y, Size = new Size(w, h) };
        iv.Image = map;
        iv.WidthResizePolicy = ResizePolicyType.Fixed; iv.HeightResizePolicy = ResizePolicyType.Fixed; iv.Size = new Size(w, h); iv.Position = new Position(x, y); // setting the visual must not resize the view to the picture's natural size
        return iv;
    }

    /// <summary>
    /// An image drawn at exactly (w, h) design px with object-fit: cover (centre crop) and a high-quality downscale filter, so the TV
    /// resamples as little and as well as the browser does (owner ruling: art scales exactly as web).
    /// </summary>
    public static ImageView Remote(string file, float w, float h, SamplingModeType sampling = SamplingModeType.Linear)
    {
        var map = new PropertyMap();
        map.Add(Visual.Property.Type, new PropertyValue((int)Visual.Type.Image));
        map.Add(ImageVisualProperty.URL, new PropertyValue(file));
        map.Add(ImageVisualProperty.FittingMode, new PropertyValue((int)FittingModeType.ScaleToFill));
        map.Add(ImageVisualProperty.SamplingMode, new PropertyValue((int)sampling));
        // no DesiredWidth: the full-size texture is sampled by the GPU (bilinear) as the browser does

        return new ImageView { Size = new Size(w, h), Image = map };
    }

    public static ImageView Icon(string name, float x, float y, float size, Rgba tint) => new(ResPath($"icons/{name}.svg"))
    {
        PositionX = x, PositionY = y, Size = new Size(size, size), Color = C(tint),
    };

    public static ImageView Icon(string name, float x, float y, float width, float height, Rgba tint) => new(ResPath($"icons/{name}.svg"))
    {
        PositionX = x, PositionY = y, Size = new Size(width, height), Color = C(tint),
    };

    private static PropertyMap AddWeight(this PropertyMap map, int weight)
    {
        map.Add("weight", new PropertyValue(weight >= 800 ? "extraBold" : weight >= 700 ? "bold" : weight >= 600 ? "semiBold" : weight >= 500 ? "medium" : weight >= 400 ? "regular" : "light"));
        return map;
    }
}

/// <summary>The CSS values a label was made from (the layout exporter reports these, not NUI's scaled internals). Dy: CSS line top minus the label's own top.</summary>
internal sealed record TextMetaInfo(float Size, int Weight, float LineHeight, float Dy, float Spacing, HorizontalAlignment Align, Rgba Color, bool Multiline)
{
    public string Family { get; set; } = Ui.Font;
    /// <summary>Lines of one wrapped paragraph share a group: web has one element for the whole block.</summary>
    public object? Group { get; set; }
    /// <summary>A block-level text element: its box is the CSS line, not the font's content area.</summary>
    public bool Block { get; set; }
}
