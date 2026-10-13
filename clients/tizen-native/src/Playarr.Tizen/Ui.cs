using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Thin helpers so screens read like the web CSS: absolute design pixels on the 1920x1080 canvas.</summary>
internal static class Ui
{
    private static TextLabel? _measure;
    private static bool? _fontDirectoryAdded;
    private static int _bundledNunitoFontCount;
    private static IReadOnlyList<global::Tizen.NUI.Text.FontInfo> _bundledNunitoFonts = Array.Empty<global::Tizen.NUI.Text.FontInfo>();

    internal static object FontRegistrationMetrics => new
    {
        fontDirectoryAdded = _fontDirectoryAdded,
        bundledNunitoFontCount = _bundledNunitoFontCount,
        bundledNunitoFonts = _bundledNunitoFonts.Select(font => new { family = font.Family, style = font.Style }).ToList(),
    };

    /// <summary>Natural single-line width of a string at the given style (a hidden label, measured synchronously).</summary>
    public static float TextWidth(string text, float size, int weight, float spacing, string family = Font)
    {
        if (_measure is null) { _measure = new TextLabel { MultiLine = false, WidthResizePolicy = ResizePolicyType.UseNaturalSize, HeightResizePolicy = ResizePolicyType.UseNaturalSize }; _measure.Opacity = 0; Window.Default.Add(_measure); }
        _measure.PixelSize = size; _measure.FontFamily = family; _measure.FontStyle = new PropertyMap().AddWeight(weight); _measure.CharacterSpacing = spacing; _measure.Text = text;
        return _measure.NaturalSize.Width;
    }

    /// <summary>Greedy word wrap like the browser's, using measured widths; the last line gets an ellipsis when text is cut at maxLines.</summary>
    public static List<string> WrapLines(string text, float size, int weight, float spacing, float width, int maxLines = int.MaxValue, string family = Font, bool balance = false)
    {
        var greedy = Wrap(text, size, weight, spacing, width, maxLines, family);
        return balance && greedy.Count > 1 && greedy.Count <= maxLines ? Balanced(text, size, weight, spacing, width, greedy.Count, family) ?? greedy : greedy;
    }

    /// <summary>
    /// Chrome's text-wrap: balance as the Android TV worker fitted it (97 % of 400 titles): keep the greedy line count at the box width, then take the break set
    /// with the smallest sum of squared line widths, plus 5000 px² when the last line is a single word. shortcut: breaks only after spaces, not hyphens.
    /// </summary>
    private static List<string>? Balanced(string text, float size, int weight, float spacing, float width, int lineCount, string family)
    {
        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var memo = new Dictionary<(int, int), float>();
        float W(int a, int b) { if (!memo.TryGetValue((a, b), out var w)) memo[(a, b)] = w = TextWidth(string.Join(' ', words[a..b]), size, weight, spacing, family); return w; }
        var best = float.MaxValue; int[]? bestCuts = null; var cuts = new int[lineCount + 1];
        void Go(int line, int start, float cost)
        {
            if (line == lineCount - 1)
            {
                if (start >= words.Length) return;
                var w = W(start, words.Length); if (w > width) return;
                var total = cost + w * w + (words.Length - start == 1 ? 5000 : 0);
                if (total < best) { best = total; bestCuts = (int[])cuts.Clone(); bestCuts[lineCount] = words.Length; bestCuts[line] = start; }
                return;
            }
            for (var end = start + 1; end < words.Length - (lineCount - 1 - line) + 1; end++)
            {
                var w = W(start, end); if (w > width) break;
                cuts[line] = start; Go(line + 1, end, cost + w * w);
            }
        }
        Go(0, 0, 0);
        if (bestCuts is null) return null;
        var lines = new List<string>();
        for (var i = 0; i < lineCount; i++) lines.Add(string.Join(' ', words[bestCuts[i]..bestCuts[i + 1]]));
        return lines;
    }

    private static List<string> Wrap(string text, float size, int weight, float spacing, float width, int maxLines, string family)
    {
        var lines = new List<string>(); var cur = "";
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var next = cur.Length == 0 ? word : cur + " " + word;
            if (cur.Length > 0 && TextWidth(next, size, weight, spacing, family) > width) { lines.Add(cur); cur = word; } else cur = next;
        }
        if (cur.Length > 0) lines.Add(cur);
        if (lines.Count > maxLines)
        {
            lines.RemoveRange(maxLines, lines.Count - maxLines);
            var last = lines[^1];
            while (last.Length > 0 && TextWidth(last + "\u2026", size, weight, spacing, family) > width) last = last[..^1].TrimEnd();
            lines[^1] = last + "\u2026";
        }
        return lines;
    }

    /// <summary>A wrapped paragraph as one single-line label per line (CSS line height <paramref name="lh"/>); returns the number of lines.</summary>
    public static int Paragraph(View parent, string text, float x, float y, float size, int weight, Rgba color, float width, float lh, float spacing = 0, int maxLines = int.MaxValue, bool balance = false)
    {
        var lines = WrapLines(text, size, weight, spacing, width, maxLines, balance: balance);
        for (var i = 0; i < lines.Count; i++) parent.Add(Text(lines[i], x, y + i * lh, size, weight, color, width, lh, spacing: spacing));
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

    /// <summary>Registers the bundled Nunito Sans weights so TextLabel can use them by family name.</summary>
    public static void RegisterFonts()
    {
        var fontDirectory = System.IO.Path.GetFullPath(ResPath("fonts")) + System.IO.Path.DirectorySeparatorChar;
        _fontDirectoryAdded = FontClient.Instance.AddCustomFontDirectory(ResPath("fonts"));
        _bundledNunitoFonts = FontClient.Instance.GetSystemFonts()
            .Where(font => font.Family.Contains("Nunito Sans", StringComparison.OrdinalIgnoreCase)
                && font.Path.StartsWith(fontDirectory, StringComparison.Ordinal))
            .ToList();
        _bundledNunitoFontCount = _bundledNunitoFonts.Count;
    }

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
        var line = lh > 0 ? lh : size * 1.4f;
        var boxH = Math.Max(line, size * 1.45f); // tall enough that descenders are not clipped; the text stays centred on the CSS line box
        y -= (boxH - line) / 2f;
        var t = new TextLabel(upper ? text.ToUpperInvariant() : text)
        {
            PositionX = x,
            PositionY = y,
            PixelSize = size,
            TextColor = C(color),
            FontFamily = family,
            FontStyle = new PropertyMap().AddWeight(weight),
            HorizontalAlignment = align,
            VerticalAlignment = multiline ? VerticalAlignment.Top : VerticalAlignment.Center,
            MultiLine = multiline,
            Ellipsis = !multiline,
        };
        if (spacing != 0) t.CharacterSpacing = spacing;
        if (multiline && maxLines > 0) t.Ellipsis = false;
        if (multiline) { t.RelativeLineHeight = line / (size * 1.364f); t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(w, size * 1.6f * Math.Max(2, maxLines)); }
        else if (w > 0) { t.WidthResizePolicy = ResizePolicyType.Fixed; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(w, boxH); }
        else { t.WidthResizePolicy = ResizePolicyType.UseNaturalSize; t.HeightResizePolicy = ResizePolicyType.Fixed; t.Size = new Size(0, boxH); }
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
    public static ImageView FilteredImage(string url, float x, float y, float w, float h, float contrast, float brightness)
    {
        var frag = "precision mediump float;\nvarying mediump vec2 vTexCoord;\nuniform sampler2D sTexture;\nuniform lowp vec4 uColor;\n" +
                   "void main(){ vec4 c = texture2D(sTexture, vTexCoord); float g = dot(c.rgb, vec3(0.299, 0.587, 0.114)); " +
                   $"g = ((g - 0.5) * {contrast:0.###} + 0.5) * {brightness:0.###}; gl_FragColor = vec4(vec3(g), c.a) * uColor; }}";
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
    public static ImageView Remote(string file, float w, float h, SamplingModeType sampling = SamplingModeType.Lanczos)
    {
        var map = new PropertyMap();
        map.Add(Visual.Property.Type, new PropertyValue((int)Visual.Type.Image));
        map.Add(ImageVisualProperty.URL, new PropertyValue(file));
        map.Add(ImageVisualProperty.FittingMode, new PropertyValue((int)FittingModeType.ScaleToFill));
        map.Add(ImageVisualProperty.SamplingMode, new PropertyValue((int)sampling));
        map.Add(ImageVisualProperty.DesiredWidth, new PropertyValue((int)Math.Round(w)));
        map.Add(ImageVisualProperty.DesiredHeight, new PropertyValue((int)Math.Round(h)));
        return new ImageView { Size = new Size(w, h), Image = map };
    }

    public static ImageView Icon(string name, float x, float y, float size, Rgba tint) => new(ResPath($"icons/{name}.svg"))
    {
        PositionX = x, PositionY = y, Size = new Size(size, size), Color = C(tint),
    };

    private static PropertyMap AddWeight(this PropertyMap map, int weight)
    {
        map.Add("weight", new PropertyValue(weight >= 800 ? "extraBold" : weight >= 700 ? "bold" : weight >= 600 ? "semiBold" : weight >= 500 ? "medium" : weight >= 400 ? "regular" : "light"));
        return map;
    }
}
