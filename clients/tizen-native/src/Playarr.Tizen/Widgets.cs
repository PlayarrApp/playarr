using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>A media card (web .media-card): art with watch state, title and optional sub line. One component for Home and the grids.</summary>
internal sealed class MediaCard
{
    public const float Width = 327.2f, Height = 184f;
    private const float SearchPlaylistFocusRingWidth = 3f;
    public View Box { get; } = new();
    public View Art { get; } = new();
    public TextLabel Title { get; }
    private readonly PlayarrTheme _t;
    private readonly float _scale, _lift, _blur, _shadowY, _shadowAlpha;
    private readonly float _boxScale, _boxLift, _boxY, _focusHeight;
    private readonly View? _ring;
    private View? _searchPlaylistFocusGlow;
    private readonly float _artDy;
    private View? _playlistIcon;
    private bool _playlistCollage;
    private bool _playlistHasCovers;
    private View? _playlistFocusGlow;
    private View? _playlistFocusRing;
    private bool _playlistCoverSet;
    private bool _focused;
    private TextLabel? _playlistMetadata;
    private string _playlistMediaType = "video";
    private bool _playlistShared;

    private float SearchPlaylistFocusRingExtent => SearchPlaylistFocusRingWidth / (_boxScale * _scale);

    /// <param name="scale">Focus scale (home 1.025, library 1.04).</param>
    /// <param name="lift">Focus lift in px (negative = up).</param>
    public MediaCard(AppEnv env, PlayarrTheme t, WorkCard card, float x, float y, bool showSub, float titleInset, float scale, float lift,
        float blur, float shadowY, float shadowAlpha, float boxHeight = 230f, float boxScale = 1f, float boxLift = 0f, float focusHeight = Height, bool showRing = true)
    {
        _t = t; _scale = scale; _lift = lift; _blur = blur; _shadowY = shadowY; _shadowAlpha = shadowAlpha;
        _boxScale = boxScale; _boxLift = boxLift; _boxY = y; _focusHeight = focusHeight;
        Box.PositionX = x; Box.PositionY = y; Box.Size = new Size(Width, boxHeight);
        // Chromium snaps an image's rect to whole device pixels (left and right edges rounded); a fractional rect resamples and blurs the poster
        var snapX = (float)Math.Round(x); var snapY = (float)Math.Round(y); var snapW = (float)Math.Round(x + Width) - snapX; var snapH = (float)Math.Round(y + Height) - snapY;
        _artDy = snapY - y; Art.PositionX = snapX - x; Art.PositionY = _artDy;
        Art.Size = new Size(snapW, snapH); Art.BackgroundColor = Ui.C(t.SurfaceSoft); Art.CornerRadius = 12.48f;
        Art.ClippingMode = ClippingModeType.ClipChildren;
        env.Images.Apply(Art, card.ThumbUrl, snapW, snapH, 12.48f);
        if (card.Progress > 0)
        {
            Art.Add(Ui.Box(0, Height - 3, Width, 3, new Rgba(1, 1, 1, 0.2f)));
            Art.Add(Ui.Box(0, Height - 3, Math.Max(3, Width * (float)card.Progress), 3, t.Brand));
        }
        Box.Add(Art);
        if (showRing)
        {
            // web: a 3 px ring on the focused card, the brand red in light and the pale brand pink in dark
            var rc = t.Name == "dark" ? new Color(t.BrandInk.R, t.BrandInk.G, t.BrandInk.B, 0.95f) : new Color(0.647f, 0.153f, 0.271f, 1);
            _ring = new View { Size = new Size(Width, Height), CornerRadius = 12.48f, BorderlineWidth = 3, BorderlineColor = rc, BorderlineOffset = -1 };
            _ring.Show(false);
            Art.Add(_ring);
        }
        if (card.Unseen)
        {
            var dot = Ui.Box(Width - 23.6f, 10.6f, 13, 13, t.Brand, 6.5f);
            dot.BorderlineWidth = 2; dot.BorderlineColor = new Color(1, 1, 1, 0.94f);
            Art.Add(dot); // web: the dot lives inside the art, so it scales and lifts with the focused poster
        }
        Title = Ui.Text(card.Title, titleInset, Height + 11.5f, 11.904f, 700, t.Ink, Width - titleInset * 2, 17.856f, spacing: -0.18f);
        Box.Add(Title);
        if (showSub) Box.Add(Ui.Text(card.Sub, titleInset, Height + 31.9f, 8.832f, 400, t.InkMuted, Width - titleInset * 2, 13.248f));
    }

    public void SetFocused(bool focused)
    {
        _focused = focused;
        Box.Scale = focused ? new Vector3(_boxScale, _boxScale, 1) : new Vector3(1, 1, 1);
        Box.PositionY = _boxY + (focused ? _boxLift : 0);
        Art.Scale = focused ? new Vector3(_scale, _scale, 1) : new Vector3(1, 1, 1);
        Art.PositionY = _artDy + (focused ? _lift : 0);
        Art.BoxShadow = _searchPlaylistFocusGlow is not null
            ? focused
                ? new Shadow(52, new Color(31 / 255f, 14 / 255f, 20 / 255f, 0.28f), new Vector2(0, 22), new Vector2(0, 0))
                : new Shadow(34, new Color(31 / 255f, 14 / 255f, 20 / 255f, 0.16f), new Vector2(0, 12), new Vector2(0, 0))
            : focused && !_playlistCollage ? new Shadow(_blur, new Color(56 / 255f, 38 / 255f, 33 / 255f, _shadowAlpha), new Vector2(0, _shadowY), new Vector2(0, 0)) : null;
        if (_playlistCollage)
        {
            SetPlaylistGroupShadow();
            SetPlaylistFocusGlow(focused);
        }
        if (_searchPlaylistFocusGlow is not null)
        {
            var glowColor = _t.Name == "dark" ? _t.BrandInk : Rgba.Hex(0xa52745);
            var ringExtent = SearchPlaylistFocusRingExtent;
            _searchPlaylistFocusGlow.PositionX = Art.PositionX - ringExtent;
            _searchPlaylistFocusGlow.PositionY = Art.PositionY - ringExtent;
            _searchPlaylistFocusGlow.Scale = Art.Scale;
            _searchPlaylistFocusGlow.Show(focused);
            _searchPlaylistFocusGlow.BoxShadow = focused
                ? new Shadow(20, new Color(glowColor.R, glowColor.G, glowColor.B, 0.45f), new Vector2(0, 0), new Vector2(0, 0))
                : null;
        }
        if (_playlistCollage && _playlistHasCovers) SetPlaylistFocusRing(focused);
        if (_ring is not null)
        {
            var showRing = focused && !(_playlistCollage && _playlistHasCovers) && _searchPlaylistFocusGlow is null;
            _ring.Show(showRing);
            if (showRing) _ring.RaiseToTop(); // the poster loads later and would otherwise sit on top of the ring
        }
        Title.TextColor = focused ? (_t.Name == "dark" ? new Color(1, 1, 1, 1) : new Color(0, 0, 0, 1)) : Ui.C(_t.Ink);
    }

    public Box FocusRect(float x, float y)
    {
        var width = Width * _boxScale;
        var height = _focusHeight * _boxScale;
        return new Box(x + (Width - width) / 2, y + _boxLift + (_focusHeight - height) / 2, width, height);
    }

    public void SetPlaylistItemCount(int count)
    {
        if (_playlistMetadata is null) return;
        var mediaType = _playlistMediaType.Equals("audio", StringComparison.OrdinalIgnoreCase) ? "Audio" : "Video";
        var ownership = _playlistShared ? "Shared" : "Personal";
        _playlistMetadata.Text = $"{mediaType} · {ownership} · {count} {(count == 1 ? "title" : "titles")}";
        _playlistMetadata.Show(true);
    }

    /// <summary>Replaces the directory placeholder with the web's poster-first, backdrop-fallback cover stack.</summary>
    public void SetPlaylistCovers(AppEnv env, string playlistName, IReadOnlyList<Work> works)
    {
        if (_playlistCoverSet) return;
        _playlistCoverSet = true;
        if (_playlistIcon is not null)
        {
            Art.Remove(_playlistIcon);
            _playlistIcon.Dispose();
            _playlistIcon = null;
        }

        var covers = works.Take(PlaylistCoverSelection.Limit).ToList();
        if (covers.Count == 0)
        {
            static Rgba Mix(Rgba foreground, Rgba background, float foregroundAmount) => new(
                foreground.R * foregroundAmount + background.R * (1 - foregroundAmount),
                foreground.G * foregroundAmount + background.G * (1 - foregroundAmount),
                foreground.B * foregroundAmount + background.B * (1 - foregroundAmount));
            var empty = Ui.DiagonalGradient(0, 0, Width, Height, 135,
                (0, Mix(_t.Brand, _t.SurfaceSoft, 0.18f)), (1, _t.SurfaceSoft));
            empty.CornerRadius = 12.48f;
            empty.BoxShadow = new Shadow(30, new Color(56 / 255f, 38 / 255f, 33 / 255f, 0.08f), new Vector2(0, 12), new Vector2(0, 0));
            Art.Add(empty);
            const float nameFontSize = 10.88f; // web: 0.68rem at the 16px root size
            const float nameRasterScale = 4;
            const float nameLineHeight = 1.5f; // inherited web body line-height
            var emptyLabel = new TextLabel(PlaylistDirectoryModel.EmptyCoverDisplayName(playlistName))
            {
                AccessibilityName = playlistName,
                PositionX = 16,
                PositionY = 16,
                Size = new Size((Width - 32) * nameRasterScale, (Height - 32) * nameRasterScale),
                WidthResizePolicy = ResizePolicyType.Fixed,
                HeightResizePolicy = ResizePolicyType.Fixed,
                PixelSize = nameFontSize * nameRasterScale,
                PivotPoint = global::Tizen.NUI.PivotPoint.TopLeft,
                PositionUsesPivotPoint = true,
                Scale = new Vector3(1 / nameRasterScale, 1 / nameRasterScale, 1),
                TextColor = Ui.C(_t.InkMuted),
                FontFamily = Ui.Font,
                FontStyle = new PropertyMap().Add("weight", new PropertyValue("regular")),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                MultiLine = true,
                Ellipsis = false,
                // Match Ui.Text's conversion: NUI relative line height multiplies its 1.364x native glyph height.
                RelativeLineHeight = nameLineHeight / 1.364f,
            };
            Art.Add(emptyLabel);
            if (_focused) _ring?.RaiseToTop();
            return;
        }

        Art.BackgroundColor = new Color(0, 0, 0, 0);
        Art.ClippingMode = default;
        _playlistHasCovers = true;
        EnsurePlaylistFocusGlow();
        _ring?.Show(false);
        // Add back-to-front. The first selected work stays on top, matching the web z-index order.
        for (var index = covers.Count - 1; index >= 0; index--)
        {
            var work = covers[index];
            var inset = index * 0.05f;
            var horizontalInset = inset * 0.7f;
            var x = Width * horizontalInset;
            var y = Height * inset;
            var width = Width * (1 - 2 * horizontalInset);
            var height = Height * (1 - inset);
            var layer = new View
            {
                PositionX = x,
                PositionY = y,
                Size = new Size(width, height),
                BackgroundColor = Ui.C(_t.SurfaceSoft),
                CornerRadius = 12.48f,
                ClippingMode = ClippingModeType.ClipChildren,
                BorderlineWidth = 1,
                BorderlineColor = Ui.C(new Rgba(_t.LineStrong.R, _t.LineStrong.G, _t.LineStrong.B, _t.LineStrong.A * 0.76f)),
                Orientation = new Rotation(new Radian((float)((index - (covers.Count - 1) / 2.0) * -1.5 * Math.PI / 180)), new Vector3(0, 0, 1)),
            };
            Art.Add(layer);
            var path = ArtworkPaths.Path(work, ImageKind.Poster) ?? ArtworkPaths.Path(work, ImageKind.Backdrop);
            env.Images.Apply(layer, path, width, height, 12.48f);
        }
        _ring?.Show(false);
        SetPlaylistGroupShadow();
        SetPlaylistFocusGlow(_focused);
        SetPlaylistFocusRing(_focused);
    }

    private void EnsurePlaylistFocusGlow()
    {
        if (_playlistFocusGlow is not null) return;
        _playlistFocusGlow = new View
        {
            PositionX = Art.PositionX,
            PositionY = Art.PositionY,
            Size = Art.Size,
            CornerRadius = Art.CornerRadius,
            BackgroundColor = new Color(0, 0, 0, 0),
        };
        Box.Add(_playlistFocusGlow);
        _playlistFocusGlow.LowerToBottom();
    }

    private void SetPlaylistFocusGlow(bool focused)
    {
        if (_playlistFocusGlow is null) return;
        _playlistFocusGlow.Scale = focused ? new Vector3(_scale, _scale, 1) : new Vector3(1, 1, 1);
        _playlistFocusGlow.PositionY = _artDy + (focused ? _lift : 0);
        if (!focused)
        {
            _playlistFocusGlow.BoxShadow = null;
            return;
        }

        // Web adds a separate 20 px, 4 px spread glow to the playlist card ring. Keep this layer independent of the
        // brown cover-stack shadow above; the glow token is brand-ink in dark and brand-strong in light.
        var glow = _t.Name == "dark" ? _t.BrandInk : Rgba.Hex(0xa52745);
        _playlistFocusGlow.BoxShadow = new Shadow(20, new Color(glow.R, glow.G, glow.B, 0.45f), new Vector2(0, 0), new Vector2(4, 4));
    }

    private void SetPlaylistGroupShadow()
    {
        if (!_playlistHasCovers)
        {
            Art.BoxShadow = null;
            return;
        }

        // BoxShadow follows this rounded rectangle, not the stacked images' alpha. The front cover fills this frame,
        // so its outer silhouette stays close; one NUI shadow approximates the web's two measured focus shadows.
        var opacity = _focused ? 0.44f : 0.14f;
        var blur = _focused ? 10f : 5f;
        var offsetY = _focused ? 9.2f : 5f;
        Art.BoxShadow = new Shadow(blur, new Color(56 / 255f, 38 / 255f, 33 / 255f, opacity), new Vector2(0, offsetY), new Vector2(0, 0));
    }

    private void SetPlaylistFocusRing(bool focused)
    {
        if (_playlistFocusRing is null)
        {
            const float spread = 3f;
            var ring = new View
            {
                PositionX = Art.PositionX - spread,
                PositionY = Art.PositionY - spread,
                Size = new Size(Art.Size.Width + spread * 2, Art.Size.Height + spread * 2),
                CornerRadius = Art.CornerRadius + spread,
                BorderlineWidth = spread,
                BorderlineOffset = -1,
                BorderlineColor = _t.Name == "dark"
                    ? new Color(_t.BrandInk.R, _t.BrandInk.G, _t.BrandInk.B, 0.95f)
                    : new Color(0.647f, 0.153f, 0.271f, 1),
                BackgroundColor = new Color(0, 0, 0, 0),
            };
            Box.Add(ring);
            _playlistFocusRing = ring;
        }

        _playlistFocusRing.Scale = focused ? new Vector3(_scale, _scale, 1) : new Vector3(1, 1, 1);
        _playlistFocusRing.PositionY = _artDy + (focused ? _lift : 0) - 3f;
        _playlistFocusRing.Show(focused);
        if (focused) _playlistFocusRing.RaiseToTop();
    }

    public static MediaCard Home(AppEnv env, WorkCard card, float x, float y) =>
        new(env, env.Theme, card, x, y, showSub: true, titleInset: 0, scale: 1.025f, lift: -6, blur: 52, shadowY: 26, shadowAlpha: 0.32f);

    /// <summary>Search result: title and kind share the web's inset two-column caption row.</summary>
    public static MediaCard Search(AppEnv env, WorkCard card, float x, float y)
    {
        var isPlaylist = card.Kind == WorkKind.Unknown && card.Kicker == "Playlist";
        var c = new MediaCard(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f,
            scale: isPlaylist ? 1.025f : 1.015f, lift: isPlaylist ? 0 : -6, blur: 52, shadowY: 22, shadowAlpha: 0.28f,
            boxScale: isPlaylist ? 1.015f : 1f, boxLift: isPlaylist ? -6 : 0);
        if (card.Kind == WorkKind.Unknown)
        {
            if (card.Kicker == "Playlist")
            {
                var theme = env.Theme;
                var linearStart = BlendThemeColor(theme.SurfaceSoft, theme.SurfaceStrong, 0.12f);
                c.Art.BackgroundColor = Ui.C(theme.SurfaceStrong);
                var linear = Ui.DiagonalGradient(0, 0, Width, Height, 145, (0, linearStart), (1, theme.SurfaceStrong));
                linear.CornerRadius = 12.48f;
                var radial = Ui.RadialGradient(0, 0, Width, Height, new Rgba(theme.Brand.R, theme.Brand.G, theme.Brand.B, 0.34f), 0.76f, 0.22f, 0.42f);
                radial.CornerRadius = 12.48f;
                c.Art.Add(linear);
                c.Art.Add(radial);
                var iconSize = Math.Max(42f, Width * 0.34f);
                var iconX = (Width - iconSize) / 2;
                var iconY = (Height - iconSize) / 2;
                var stroke = BlendThemeColor(theme.Ink, theme.Brand, 0.24f);
                c.Art.Add(Ui.Icon("search-playlist-fill", iconX, iconY, iconSize, new Rgba(theme.Brand.R, theme.Brand.G, theme.Brand.B, 0.22f)));
                c.Art.Add(Ui.Icon("search-playlist-lines", iconX, iconY, iconSize, stroke));
                c.Art.BoxShadow = new Shadow(34, new Color(31 / 255f, 14 / 255f, 20 / 255f, 0.16f), new Vector2(0, 12), new Vector2(0, 0));
                var glowColor = theme.Name == "dark" ? theme.BrandInk : Rgba.Hex(0xa52745);
                var ringExtent = c.SearchPlaylistFocusRingExtent;
                c._searchPlaylistFocusGlow = new View
                {
                    PositionX = c.Art.PositionX - ringExtent,
                    PositionY = c.Art.PositionY - ringExtent,
                    Size = new Size(c.Art.Size.Width + ringExtent * 2, c.Art.Size.Height + ringExtent * 2),
                    CornerRadius = 12.48f + ringExtent,
                    BorderlineWidth = ringExtent,
                    BorderlineColor = Ui.C(glowColor),
                    BorderlineOffset = -1,
                    BackgroundColor = new Color(0, 0, 0, 0),
                };
                c._searchPlaylistFocusGlow.Show(false);
                c.Box.Add(c._searchPlaylistFocusGlow);
                c._searchPlaylistFocusGlow.LowerToBottom();
            }
            else c.Art.Add(Ui.Icon("games", Width / 2 - 32, Height / 2 - 32, 64, env.Theme.InkMuted));
        }
        var kind = card.Sub.ToUpperInvariant();
        var layout = SearchCaptionLayout.Create(Width, 1.92f, Ui.TextWidth(kind, 8.448f, 700, 0), 9.6f);
        c.Title.PositionX = layout.TitleX;
        c.Title.Size = new Size(layout.TitleWidth, 17.856f);
        c.Box.Add(Ui.Text(kind, layout.CaptionX, Height + 14.5f, 8.448f, 700, env.Theme.InkMuted, layout.CaptionWidth, 12.672f, HorizontalAlignment.End));
        return c;
    }

    private static Rgba BlendThemeColor(Rgba first, Rgba second, float secondWeight) => new(
        first.R * (1 - secondWeight) + second.R * secondWeight,
        first.G * (1 - secondWeight) + second.G * secondWeight,
        first.B * (1 - secondWeight) + second.B * secondWeight,
        first.A * (1 - secondWeight) + second.A * secondWeight);

    public static MediaCard Library(AppEnv env, WorkCard card, float x, float y) =>
        new(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f, scale: 1.04f, lift: -5.1f, blur: 48, shadowY: 24, shadowAlpha: 0.30f);

    /// <summary>Playlist directory card: web scales the whole title card 1.015 and lifts it 5 px, with 1.025 art focus.</summary>
    public static MediaCard PlaylistDirectory(AppEnv env, WorkCard card, float x, float y)
    {
        var media = new MediaCard(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f, scale: 1.025f, lift: 0,
            blur: 52, shadowY: 24, shadowAlpha: 0.30f, boxHeight: 213.4f, boxScale: 1.015f, boxLift: -5f, focusHeight: 213.4f);
        media._playlistCollage = true;
        AddPlaylistKind(media, env, card, directory: true);
        return media;
    }

    /// <summary>Playlist detail card: web lifts the card 6 px and scales its art 1.025 without scaling the caption.</summary>
    public static MediaCard PlaylistDetail(AppEnv env, WorkCard card, float x, float y)
    {
        var media = new MediaCard(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f, scale: 1.025f, lift: 0,
            blur: 52, shadowY: 26, shadowAlpha: 0.32f, boxHeight: 213.4f, boxLift: -6f, focusHeight: 213.4f, showRing: false);
        if (card.Kind == WorkKind.Unknown) AddPlaylistKind(media, env, card);
        return media;
    }

    private static void AddPlaylistKind(MediaCard media, AppEnv env, WorkCard card, bool directory = false)
    {
        if (card.Kind == WorkKind.Unknown)
        {
            var icon = Ui.Icon("playlists", Width / 2 - 32, Height / 2 - 32, 64, env.Theme.InkMuted);
            media._playlistIcon = icon;
            media.Art.Add(icon);
        }
        if (directory)
        {
            media._playlistMediaType = card.Kicker;
            media._playlistShared = card.Sub.Equals("Shared", StringComparison.OrdinalIgnoreCase);
            media._playlistMetadata = Ui.Text("", 1.9f, Height + 31.9f, 8.832f, 400, env.Theme.InkMuted, Width - 3.8f, 13.248f);
            media._playlistMetadata.Show(false);
            media.Box.Add(media._playlistMetadata);
        }
        else
        {
            media.Box.Add(Ui.Text(card.Sub.ToUpperInvariant(), 0, Height + 14.5f, 8.448f, 700, env.Theme.InkMuted, Width, 12.672f, HorizontalAlignment.End));
        }
    }
}

/// <summary>Web .tv-key-art: the focused title's backdrop in grayscale, faded into the page colour.</summary>
internal sealed class KeyArt
{
    public View Root { get; } = new();
    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private string? _path, _shown;
    private bool _armed;

    /// <summary>
    /// As web: the key art of a library, search or detail page only appears once focus has moved (the page's first preview is
    /// not artwork-backed); Home shows it from the start (<paramref name="armed"/>).
    /// </summary>
    public void Arm() { if (_armed) return; _armed = true; var p = _path; _path = null; Set(p); }

    public KeyArt(AppEnv env, bool armed = false) { _armed = armed; _env = env; _t = env.Theme; Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight); }

    /// <summary>Shows the server artwork at <paramref name="artworkPath"/> (a /api/v1/artwork/... path) as key art.</summary>
    public void Set(string? artworkPath)
    {
        if (artworkPath == _path) return;
        _path = artworkPath;
        if (!_armed) return;
        foreach (var child in Root.Children.ToArray()) { Root.Remove(child); child.Dispose(); }
        if (artworkPath is null) return;
        var wanted = artworkPath;
        _ = Task.Run(async () =>
        {
            var file = await _env.Images.GetAsync(wanted).ConfigureAwait(false);
            if (file is null) return;
            SynchronizationContextHolder.Post(() =>
            {
                if (_path != wanted) return; // focus moved on
                foreach (var child in Root.Children.ToArray()) { Root.Remove(child); child.Dispose(); }
                var dark = _t.Name == "dark";
                var img = Ui.FilteredImage(file, -20, -22.9f, 1038.3f, 1190.6f, dark ? 0.82f : 1f, dark ? 0.6f : 1.1f);
                img.Opacity = dark ? 0.07f : 0.035f; // web (measured at 1920x1080): the art is only a ghost in both themes
                Root.Add(img);
                var s = _t.Surface; var clear = new Rgba(s.R, s.G, s.B, 0);
                Root.Add(Ui.Gradient(-20 + 1038.3f * 0.72f, 0, 1038.3f * 0.28f, 1080, true, (0, clear), (1, s)));
                Root.Add(Ui.Gradient(0, 0, 1920, 1080, true, (0, s), (0.22f, clear), (1, clear)));
                Root.Add(Ui.Gradient(0, 0, 1920, 1080, false, (0, s), (0.18f, clear), (0.82f, clear), (1, s)));
            });
        });
    }
}

/// <summary>The left panel: kicker, title, meta row and overview of the focused title. Sizes differ slightly between Home and the grids (as on web).</summary>
internal sealed class DetailsPanel
{
    public View Root { get; } = new();
    private readonly AppEnv _env;
    private readonly bool _library;
    private readonly bool _flow;
    private Guid _showing;
    private static readonly Dictionary<Guid, long?> RuntimeCache = new();

    public DetailsPanel(AppEnv env, bool library, bool flow = false) { _env = env; _library = library || flow; _flow = flow; }

    public void Show(WorkCard card, string? kickerOverride = null, string? metaLead = null)
    {
        _showing = card.WorkId;
        Render(card, kickerOverride, metaLead, RuntimeCache.TryGetValue(card.WorkId, out var rt) ? rt : null);
        if (!RuntimeCache.ContainsKey(card.WorkId))
            _ = FetchRuntimeAsync(card, kickerOverride, metaLead);
    }

    public void ShowPlaylistPreview(SearchPlaylistPreview preview)
    {
        _showing = Guid.Empty;
        var card = new WorkCard(Guid.Empty, WorkKind.Unknown, preview.DisplayTitle, preview.Eyebrow, preview.Eyebrow, "", null, null, null, 0, false);
        Render(card, preview.Eyebrow, null, null, preview.MaxTitleLines);
        Root.Show(true);
    }

    private async Task FetchRuntimeAsync(WorkCard card, string? kicker, string? lead)
    {
        try
        {
            await Task.Delay(140); // as web: focus must rest before the page-level selection follows it
            if (_showing != card.WorkId) return;
            var detail = await _env.Api.GetWorkAsync(card.WorkId);
            RuntimeCache[card.WorkId] = detail.RuntimeMs;
            SynchronizationContextHolder.Post(() => { if (_showing == card.WorkId) Render(card, kicker, lead, detail.RuntimeMs); });
        }
        catch (Exception) { RuntimeCache[card.WorkId] = null; }
    }

    private void Render(WorkCard card, string? kicker, string? lead, long? runtimeMs, int titleMaxLines = 5)
    {
        var t = _env.Theme;
        foreach (var child in Root.Children.ToArray()) { Root.Remove(child); child.Dispose(); }
        var ky = _flow ? 286.6f : 259.2f; var tsize = _flow ? 49.92f : 69.12f; var tlh = _flow ? 47.424f : 62.208f; var tw = _flow ? 420f : 369f; var ty = _flow ? 330.9f : 303.5f;
        Root.Add(Ui.Text(kicker ?? card.Kicker, 153.6f, ky, 12.288f, 800, t.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f));
        var lines = Ui.Paragraph(Root, card.Title, 153.6f, ty, tsize, 600, t.Ink, tw, tlh, _flow ? -3f : -4.98f, titleMaxLines, balance: true);
        var metaY = ty + tlh * lines + (_flow ? 27f : 22.6f) + (_library ? 4f : 0); // library panels: measured 4 px lower on web
        var metaSize = _library ? 13.056f : 12.864f;
        var meta = string.Join("   ", new[] { lead, runtimeMs is > 0 ? Runtime(runtimeMs.Value) : null }.Where(s => !string.IsNullOrEmpty(s)));
        if (meta.Length > 0) Root.Add(Ui.Text(meta, 153.6f, metaY, metaSize, 600, Soft(t), 455, _library ? 19.584f : 18, spacing: 0));
        var oy = metaY + (_library ? 41.2f : 40.9f);
        var ovLine = _library ? 21.842f : 20.325f; var ovSize = _library ? 13.824f : 12.864f;
        var ovLines = Ui.Paragraph(Root, card.Overview, 153.6f, oy, ovSize, 600, Soft(t), 336, ovLine, 0, _library ? 5 : 4);
        var top = ky; var bottom = oy + ovLines * ovLine;
        var scrim = Ui.PanelScrim(t, 153.6f, top, 455, bottom - top);
        Root.Add(scrim); scrim.LowerToBottom();
    }

    private static Rgba Soft(PlayarrTheme t) => t.Name == "dark" ? new Rgba(0.855f, 0.84f, 0.844f) : t.InkSoft;

    public static string Runtime(long ms) => DetailModel.Runtime(ms); // web runtimeLabel: rounded, not truncated
}
