using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Thin helpers so screens read like the web CSS: absolute design pixels on the 1920x1080 canvas.</summary>
internal static class Ui
{
    /// <summary>The theme's hairline colour family (dark: light grey, light: warm ink) at the given alpha.</summary>
    public static Color LineA(PlayarrTheme t, float alpha) => new(t.Line.R, t.Line.G, t.Line.B, alpha);

    public static void Restart(this global::Tizen.NUI.Timer t) { t.Stop(); t.Start(); }
    public static void Show(this View v, bool visible) => v.Opacity = visible ? 1f : 0f;

    public const string Font = "Nunito Sans";
    public const string Mono = "JetBrains Mono";

    public static Color C(Rgba c) => new(c.R, c.G, c.B, c.A);

    public static string ResPath(string relative) =>
        global::Tizen.Applications.Application.Current.DirectoryInfo.Resource + relative;

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
