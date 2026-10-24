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

    /// <summary>A wrapped paragraph as one single-line label per line (CSS line height <paramref name="lh"/>); returns the number of lines.</summary>
    public static int Paragraph(View parent, string text, float x, float y, float size, int weight, Rgba color, float width, float lh, float spacing = 0, int maxLines = int.MaxValue, bool balance = false, string role = "text")
    {
        var lines = WrapLines(text, size, weight, spacing, width, maxLines, balance: balance);
        var group = new object();
        for (var i = 0; i < lines.Count; i++)
        {
            var label = Text(lines[i], x, y + i * lh, size, weight, color, width, lh, spacing: spacing);
            TextMeta.TryGetValue(label, out var meta); if (meta is not null) meta.Group = group;
            if (role != "text") Sem.Tag(label, role);
            parent.Add(label);
        }
        return lines.Count;
    }

    /// <summary>The theme's hairline colour family (dark: light grey, light: warm ink) at the given alpha.</summary>
    /// <summary>Web .tv-filter-drawer: the strong surface at 94 % over the page, with a wide soft shadow falling to its left (box-shadow -32px 0 90px).</summary>
    public static View DrawerPanel(PlayarrTheme t)
    {
        var p = Box(1560, 0, 360, 1080, new Rgba(t.SurfaceStrong.R, t.SurfaceStrong.G, t.SurfaceStrong.B, 0.94f));
        p.BoxShadow = new Shadow(90, new Color(40 / 255f, 26 / 255f, 24 / 255f, 0.24f), new Vector2(-32, 0), new Vector2(0, 0));
        return p;
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
        if (WebBySize.TryGetValue((int)Math.Round(size * 1000), out var ws)) weight = ws.OrderBy(w => Math.Abs(w - weight)).First();
        return Array.IndexOf(WebWeights.Instanced, weight) >= 0 ? ($"{Font} W{weight}", 400) : (family, weight);
    }

    /// <summary>Registers the bundled Nunito Sans weights so TextLabel can use them by family name.</summary>
    public static void RegisterFonts() => FontClient.Instance.AddCustomFontDirectory(ResPath("fonts"));

    public static View Box(float x, float y, float w, float h, Rgba? bg = null, float radius = 0)
    {
        var v = new View { PositionX = x, PositionY = y, Size = new Size(w, h) };
        if (bg is { } c) v.BackgroundColor = C(c);
        if (radius > 0) v.CornerRadius = radius;
        return v;
    }

    /// <summary>
    /// CSS-like text in design px. (x, y) is the top-left of the CSS line box, so a label with line height <paramref name="lh"/>
    /// sits where the web's does; weight 300..800; <paramref name="spacing"/> is letter spacing in px.
    /// </summary>
    public static TextLabel Text(string text, float x, float y, float size, int weight, Rgba color, float w = 0, float lh = 0,
        HorizontalAlignment align = HorizontalAlignment.Begin, bool multiline = false, bool upper = false, float spacing = 0, string family = Font, int maxLines = 0)
    {
        (family, weight) = Face(family, weight, size);
        var cssWeight = family.StartsWith(Font + " W", StringComparison.Ordinal) ? int.Parse(family[(Font.Length + 2)..]) : weight;
        var cssY = y;
        var line = lh > 0 ? lh : size * 1.4f;
        var boxH = Math.Max(line, size * 1.45f); // tall enough that descenders are not clipped; the text stays centred on the CSS line box
        y -= (boxH - line) / 2f;
        if (!multiline && family.StartsWith(Font, StringComparison.Ordinal)) y -= BaselineShifts.Up(size); // NUI vs Chromium baseline rounding, measured per size
        var t = new TextLabel(upper ? text.ToUpperInvariant() : text)
        {
            PositionX = x,
            PositionY = y,
            PixelSize = size * TextScale,
            TextColor = C(color),
            FontFamily = family,
            FontStyle = new PropertyMap().AddWeight(weight),
            HorizontalAlignment = align,
            VerticalAlignment = multiline ? VerticalAlignment.Top : VerticalAlignment.Center,
            MultiLine = multiline,
            Ellipsis = !multiline,
        };
        if (spacing != 0) t.CharacterSpacing = spacing * TextScale;
        if (multiline && maxLines > 0) t.Ellipsis = false;
        if (multiline) { t.RelativeLineHeight = line / (size * 1.364f); t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(w * TextScale, size * 1.6f * Math.Max(2, maxLines) * TextScale); }
        else if (w > 0) { t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size((w + (align == HorizontalAlignment.Begin ? 3 : 0)) * TextScale, boxH * TextScale); } // slack: the drawn advances can exceed the measured ones by a fraction of a pixel, which would ellipsise a line that fits
        else { t.WidthResizePolicy = ResizePolicyType.UseNaturalSize; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(0, boxH * TextScale); }
        t.PivotPoint = global::Tizen.NUI.PivotPoint.TopLeft; t.PositionUsesPivotPoint = true; t.ParentOrigin = global::Tizen.NUI.ParentOrigin.TopLeft;
        t.Scale = new Vector3(1 / TextScale, 1 / TextScale, 1);
        TextMeta.Add(t, new TextMetaInfo(size, cssWeight, line, cssY - y, spacing, align, color, multiline));
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
        return new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) };
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
    public static View PanelWash(PlayarrTheme t, float width = 1190)
    {
        var dark = t.Name == "dark"; var mix = dark ? 0.44f : 0.48f;
        Rgba Frost(float a) => new(t.SurfaceSoft.R * mix + t.SurfaceStrong.R * (1 - mix), t.SurfaceSoft.G * mix + t.SurfaceStrong.G * (1 - mix), t.SurfaceSoft.B * mix + t.SurfaceStrong.B * (1 - mix), a);
        var w = width;
        return Gradient(TizenClient.DesignWidth - w, 0, w, TizenClient.DesignHeight, true,
            (0, Frost(0)), (0.12f, Frost(dark ? 0.72f : 0.68f)), (0.34f, Frost(dark ? 0.9f : 0.88f)), (0.62f, Frost(dark ? 0.97f : 0.96f)), (1, Frost(1)));
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
        return new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) };
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
        return new ImageView(path) { PositionX = x, PositionY = y, Size = new Size(w, h) };
    }

    /// <summary>The details-panel scrim over a panel box (x, y, w, h): extends 40% left, 22% right, 14% above and below, as web.</summary>
    public static View PanelScrim(PlayarrTheme t, float x, float y, float w, float h)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
        Directory.CreateDirectory(dir);
        var path = dir + $"scrim-{t.Name}.png";
        if (!File.Exists(path)) File.WriteAllBytes(path, GradientPng.PanelScrim(new Rgba(t.Surface.R, t.Surface.G, t.Surface.B, 0.94f)));
        return new ImageView(path) { PositionX = x - 0.4f * w, PositionY = y - 0.14f * h, Size = new Size(w * 1.62f, h * 1.28f) };
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
    /// <summary>Lines of one wrapped paragraph share a group: web has one element for the whole block.</summary>
    public object? Group { get; set; }
}
