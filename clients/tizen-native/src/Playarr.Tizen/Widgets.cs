using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>A media card (web .media-card): art with watch state, title and optional sub line. One component for Home and the grids.</summary>
internal static class Widgets
{
    public const float RailEndInset = 46.4f;

    /// <summary>Web focus ring on a rail item (chapter thumbnail, cast circle): 3 px, brand red in light and pale pink in dark, with the soft glow. Add it inside the clipped art and show it on focus.</summary>
    public static (View Ring, View Glow) RailRing(PlayarrTheme t, float w, float h, float radius, float x = 0)
    {
        var rc = t.Name == "dark" ? new Color(t.BrandInk.R, t.BrandInk.G, t.BrandInk.B, 0.95f) : new Color(0.647f, 0.153f, 0.271f, 1);
        var ring = new View { Size = new Size(w, h), CornerRadius = radius, BorderlineWidth = 3, BorderlineColor = rc, BorderlineOffset = -1 };
        ring.Show(false);
        // the glow sits on its own view behind the art: a shadow on the clipped art squares off its corners
        var glow = new View { PositionX = x, Size = new Size(w, h), CornerRadius = radius, BoxShadow = new Shadow(14, new Color(rc.R, rc.G, rc.B, 0.4f), new Vector2(0, 4), new Vector2(0, 0)) };
        glow.Show(false);
        return (ring, glow);
    }
}

internal sealed class MediaCard
{
    public const float Width = 327.2f, Height = 184f;
    private const float SearchPlaylistFocusRingWidth = 3f;
    public float W { get; }
    public float H { get; }
    public View Box { get; } = new();
    public View Art { get; } = new();
    public TextLabel Title { get; }
    private readonly PlayarrTheme _t;
    private readonly float _scale, _lift, _blur, _shadowY, _shadowAlpha;
    private readonly float _boxScale, _boxLift, _boxY, _focusHeight;
    private readonly View? _ring;
    private View? _searchPlaylistFocusGlow;
    private float _artDy;
    private const float StackDrop = 10f;
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
        float blur, float shadowY, float shadowAlpha, float boxHeight = 230f, float boxScale = 1f, float boxLift = 0f, float focusHeight = 0, bool showRing = true, float restBlur = 0, float artW = Width, float artH = Height)
    {
        W = artW; H = artH; if (focusHeight <= 0) focusHeight = artH;
        _t = t; _scale = scale; _lift = lift; _blur = blur; _shadowY = shadowY; _shadowAlpha = shadowAlpha;
        _boxScale = boxScale; _boxLift = boxLift; _boxY = y; _focusHeight = focusHeight;
        Box.PositionX = x; Box.PositionY = y; Box.Size = new Size(W, boxHeight);
        // Chromium snaps an image's rect to whole device pixels (left and right edges rounded); a fractional rect resamples and blurs the poster
        var snapX = (float)Math.Round(x); var snapY = (float)Math.Round(y); var snapW = (float)Math.Round(x + W) - snapX; var snapH = (float)Math.Round(y + H) - snapY;
        _artDy = snapY - y; Art.PositionX = snapX - x; Art.PositionY = _artDy;
        Art.Size = new Size(snapW, snapH); Art.BackgroundColor = Ui.C(t.SurfaceSoft); Art.CornerRadius = 12.48f;
        Art.ClippingMode = ClippingModeType.ClipChildren;
        env.Images.Apply(Art, card.ThumbUrl, snapW, snapH, 12.48f);
        if (card.Progress > 0)
        {
            Art.Add(Ui.Box(0, H - 3, W, 3, new Rgba(1, 1, 1, 0.2f)));
            Art.Add(Ui.Box(0, H - 3, Math.Max(3, W * (float)card.Progress), 3, t.Brand));
        }
        if (card.StackOptions > 1) AddStack(card, snapW);
        if (restBlur > 0)
        {
            // web's second shadow layer (a CSS box-shadow list has two): a sibling behind the art that follows its lift and scale
            _shadow2 = new View { PositionX = Art.PositionX, PositionY = Art.PositionY, Size = new Size(snapW, snapH), CornerRadius = 12.48f };
            Box.Add(_shadow2);
        }
        _restBlur = restBlur;
        Box.Add(Art);
        if (showRing)
        {
            // web: a 3 px ring on the focused card, the brand red in light and the pale brand pink in dark
            var rc = t.Name == "dark" ? new Color(t.BrandInk.R, t.BrandInk.G, t.BrandInk.B, 0.95f) : new Color(0.647f, 0.153f, 0.271f, 1);
            _ring = new View { Size = new Size(W, H), CornerRadius = 12.48f, BorderlineWidth = 3, BorderlineColor = rc, BorderlineOffset = -1 };
            _ring.Show(false);
            Art.Add(_ring);
        }
        if (card.Unseen)
        {
            var dot = Ui.Box(W - 23.6f, 10.6f, 13, 13, t.Brand, 6.5f);
            dot.BorderlineWidth = 2; dot.BorderlineColor = new Color(1, 1, 1, 0.94f);
            Art.Add(dot); // web: the dot lives inside the art, so it scales and lifts with the focused poster
        }
        var drop = card.StackOptions > 1 ? StackDrop : 0;
        Title = Ui.Text(card.Title, titleInset, H + 11.5f + drop, 11.904f, 700, t.Ink, W - titleInset * 2, 17.856f, spacing: -0.18f);
        Box.Add(Title);
        _titleY = Title.PositionY; _subY = H + 31.9f + drop;
        if (showSub) { _sub = Ui.Text(card.Sub, titleInset, H + 31.9f + drop, 8.832f, 400, t.InkMuted, W - titleInset * 2, 13.248f); Box.Add(_sub); }
        if (restBlur > 0) SetFocused(false); // paints the resting shadows
    }

    private View? _stackNear, _stackFar, _shadow2, _sub;
    private float _titleY, _subY;
    /// <summary>Web Home: the focused card's caption rises 8 px with the card (the art's own lift is part of that).</summary>
    public float FocusCaptionLift { get; init; }
    private readonly float _restBlur;

    /// <summary>
    /// Web .tv-home-card.is-stacked: the art sits 10 px lower under two offset slivers (shadow 0 -5px 0 -2px and 0 -10px 0 -4px, ink over
    /// the soft surface), with a "N ways to continue" badge in its top-left corner.
    /// </summary>
    private void AddStack(WorkCard card, float artWidth)
    {
        Art.PositionY += StackDrop;
        _artDy += StackDrop;
        _stackFar = new View { PositionX = 4, PositionY = StackDrop - 6, Size = new Size(artWidth - 8, H - 8), CornerRadius = 8.5f };
        _stackNear = new View { PositionX = 2, PositionY = StackDrop - 3, Size = new Size(artWidth - 4, H - 4), CornerRadius = 10.5f };
        PaintStack(false);
        Box.Add(_stackFar); Box.Add(_stackNear);
        var label = $"{card.StackOptions} ways to continue";
        var w = Ui.TextWidth(label, 8.96f, 400, 0.358f) + 17.6f;
        var badge = Ui.Box(8, 8, w, 19.8f, new Rgba(8 / 255f, 8 / 255f, 10 / 255f, 0.72f), 9.9f);
        badge.Add(Ui.Text(label, 0, 3.2f, 8.96f, 400, new Rgba(1, 1, 1), w, 13.4f, HorizontalAlignment.Center, spacing: 0.358f));
        Art.Add(badge);
    }

    private void PaintStack(bool focused)
    {
        if (_stackNear is null || _stackFar is null) return;
        Color Mix(float a) { var i = _t.Ink; var s = _t.SurfaceSoft; return new Color(i.R * a + s.R * (1 - a), i.G * a + s.G * (1 - a), i.B * a + s.B * (1 - a), 1); }
        _stackNear.BackgroundColor = Mix(focused ? 0.30f : 0.24f);
        _stackFar.BackgroundColor = Mix(focused ? 0.18f : 0.13f);
    }

    public void SetFocused(bool focused)
    {
        _focused = focused;
        PaintStack(focused);
        Box.Scale = focused ? new Vector3(_boxScale, _boxScale, 1) : new Vector3(1, 1, 1);
        Box.PositionY = _boxY + (focused ? _boxLift : 0);
        Art.Scale = focused ? new Vector3(_scale, _scale, 1) : new Vector3(1, 1, 1);
        Art.PositionY = _artDy + (focused ? _lift : 0);
        if (FocusCaptionLift != 0) { var d = focused ? FocusCaptionLift : 0; Title.PositionY = _titleY + d; if (_sub is not null) _sub.PositionY = _subY + d; }
        Art.BoxShadow = _searchPlaylistFocusGlow is not null
            ? focused
                ? new Shadow(52, new Color(31 / 255f, 14 / 255f, 20 / 255f, 0.28f), new Vector2(0, 22), new Vector2(0, 0))
                : new Shadow(34, new Color(31 / 255f, 14 / 255f, 20 / 255f, 0.16f), new Vector2(0, 12), new Vector2(0, 0))
            : focused && !_playlistCollage ? new Shadow(_blur, new Color(56 / 255f, 38 / 255f, 33 / 255f, _shadowAlpha), new Vector2(0, _shadowY), new Vector2(0, 0))
            : _restBlur > 0 ? new Shadow(_restBlur, new Color(56 / 255f, 38 / 255f, 33 / 255f, _restBlur > 21 ? 0.16f : 0.14f), new Vector2(0, 10), new Vector2(0, 0)) : null;
        if (_shadow2 is not null)
        {
            _shadow2.Scale = Art.Scale; _shadow2.PositionY = Art.PositionY;
            // web: focused 0 11px 22px (home) or 0 10px 20px (library) at about two thirds of the main alpha; at rest 0 3px 8px at 10 %
            _shadow2.BoxShadow = focused ? new Shadow(_blur * 0.42f, new Color(56 / 255f, 38 / 255f, 33 / 255f, _shadowAlpha * 0.68f), new Vector2(0, _shadowY * 0.42f), new Vector2(0, 0))
                : new Shadow(_restBlur * 0.4f, new Color(56 / 255f, 38 / 255f, 33 / 255f, 0.10f), new Vector2(0, 3), new Vector2(0, 0));
        }
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
        var width = W * _boxScale;
        var height = _focusHeight * _boxScale;
        return new Box(x + (W - width) / 2, y + _boxLift + (_focusHeight - height) / 2, width, height);
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
            var empty = Ui.DiagonalGradient(0, 0, W, H, 135,
                (0, Mix(_t.Brand, _t.SurfaceSoft, 0.18f)), (1, _t.SurfaceSoft));
            empty.CornerRadius = 12.48f;
            empty.BoxShadow = new Shadow(30, new Color(56 / 255f, 38 / 255f, 33 / 255f, 0.08f), new Vector2(0, 12), new Vector2(0, 0));
            Art.Add(empty);
            Art.Add(Ui.Text(playlistName, 20, 65, 18, 600, _t.Ink, W - 40, 44,
                HorizontalAlignment.Center, multiline: true, maxLines: 2));
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
            var x = W * horizontalInset;
            var y = H * inset;
            var width = W * (1 - 2 * horizontalInset);
            var height = H * (1 - inset);
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

    public static MediaCard Home(AppEnv env, WorkCard card, float x, float y, CardLayout? layout = null)
    {
        var l = layout ?? CardLayout.From("thumbnail", "medium");
        return new(env, env.Theme, l.Cover ? CoverCard(card) : card, x, y, showSub: true, titleInset: 1.9f, scale: 1.025f, lift: -6, blur: 52, shadowY: 26, shadowAlpha: 0.32f, restBlur: 22,
            boxHeight: l.ArtHeight + 46, artW: l.Width, artH: l.ArtHeight) { FocusCaptionLift = -8f };
    }

    /// <summary>Web cover view: the poster is the art (poster first, backdrop as the fallback); an On deck episode keeps its frame.</summary>
    private static WorkCard CoverCard(WorkCard c) => c.PosterUrl is { Length: > 0 } && c.ThumbUrl?.Contains("/thumbnail", StringComparison.Ordinal) != true ? c with { ThumbUrl = c.PosterUrl } : c;

    /// <summary>Search result: title and kind share the web's inset two-column caption row.</summary>
    public static MediaCard Search(AppEnv env, WorkCard card, float x, float y, CardLayout? cardLayout = null)
    {
        var l = cardLayout ?? CardLayout.Library(false, "medium");
        var isPlaylist = card.Kind == WorkKind.Unknown && card.Kicker == "Playlist";
        var c = new MediaCard(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f,
            scale: isPlaylist ? 1.025f : 1.015f, lift: isPlaylist ? 0 : -6, blur: 52, shadowY: 22, shadowAlpha: 0.28f,
            boxScale: isPlaylist ? 1.015f : 1f, boxLift: isPlaylist ? -6 : 0, boxHeight: l.ArtHeight + 46, artW: l.Width, artH: l.ArtHeight);
        if (card.Kind == WorkKind.Unknown)
        {
            if (card.Kicker == "Playlist")
            {
                var theme = env.Theme;
                var linearStart = BlendThemeColor(theme.SurfaceSoft, theme.SurfaceStrong, 0.12f);
                c.Art.BackgroundColor = Ui.C(theme.SurfaceStrong);
                var linear = Ui.DiagonalGradient(0, 0, c.W, c.H, 145, (0, linearStart), (1, theme.SurfaceStrong));
                linear.CornerRadius = 12.48f;
                var radial = Ui.RadialGradient(0, 0, c.W, c.H, new Rgba(theme.Brand.R, theme.Brand.G, theme.Brand.B, 0.34f), 0.76f, 0.22f, 0.42f);
                radial.CornerRadius = 12.48f;
                c.Art.Add(linear);
                c.Art.Add(radial);
                var iconSize = Math.Max(42f, c.W * 0.34f);
                var iconX = (c.W - iconSize) / 2;
                var iconY = (c.H - iconSize) / 2;
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
            else c.Art.Add(Ui.Icon("games", c.W / 2 - 32, c.H / 2 - 32, 64, env.Theme.InkMuted));
        }
        var kind = card.Sub.ToUpperInvariant();
        var layout = SearchCaptionLayout.Create(c.W, 1.92f, Ui.TextWidth(kind, 8.448f, 700, 0), 9.6f);
        c.Title.PositionX = layout.TitleX;
        c.Title.Size = new Size(layout.TitleWidth, 17.856f);
        c.Box.Add(Ui.Text(kind, layout.CaptionX, c.H + 14.5f, 8.448f, 700, env.Theme.InkMuted, layout.CaptionWidth, 12.672f, HorizontalAlignment.End));
        return c;
    }

    private static Rgba BlendThemeColor(Rgba first, Rgba second, float secondWeight) => new(
        first.R * (1 - secondWeight) + second.R * secondWeight,
        first.G * (1 - secondWeight) + second.G * secondWeight,
        first.B * (1 - secondWeight) + second.B * secondWeight,
        first.A * (1 - secondWeight) + second.A * secondWeight);

    public static MediaCard Library(AppEnv env, WorkCard card, float x, float y, CardLayout? layout = null)
    {
        var l = layout ?? CardLayout.Library(false, "medium");
        return new(env, env.Theme, l.Cover ? CoverCard(card) : card, x, y, showSub: false, titleInset: 1.9f, scale: 1.04f, lift: -5.1f, blur: 48, shadowY: 24, shadowAlpha: 0.30f, restBlur: 20,
            boxHeight: l.ArtHeight + 46, artW: l.Width, artH: l.ArtHeight);
    }

    /// <summary>Playlist directory card: web scales the whole title card 1.015 and lifts it 5 px, with 1.025 art focus.</summary>
    public static MediaCard PlaylistDirectory(AppEnv env, WorkCard card, float x, float y, CardLayout? cardLayout = null)
    {
        var l = cardLayout ?? CardLayout.Library(false, "medium");
        var media = new MediaCard(env, env.Theme, card, x, y, showSub: false, titleInset: 1.9f, scale: 1.025f, lift: 0,
            blur: 52, shadowY: 24, shadowAlpha: 0.30f, boxHeight: l.CardHeight, boxScale: 1.015f, boxLift: -5f, focusHeight: l.CardHeight, artW: l.Width, artH: l.ArtHeight);
        media._playlistCollage = true;
        AddPlaylistKind(media, env, card, directory: true);
        return media;
    }

    /// <summary>Playlist detail card: web lifts the card 6 px and scales its art 1.025 without scaling the caption.</summary>
    public static MediaCard PlaylistDetail(AppEnv env, WorkCard card, float x, float y, CardLayout? cardLayout = null)
    {
        var l = cardLayout ?? CardLayout.Library(false, "medium");
        var media = new MediaCard(env, env.Theme, card, x, y, showSub: true, titleInset: 1.9f, scale: 1.025f, lift: 0,
            blur: 52, shadowY: 26, shadowAlpha: 0.32f, boxHeight: l.CardHeight, boxLift: -6f, focusHeight: l.CardHeight, showRing: true, artW: l.Width, artH: l.ArtHeight);
        if (card.Kind == WorkKind.Unknown) AddPlaylistKind(media, env, card);
        return media;
    }

    private static void AddPlaylistKind(MediaCard media, AppEnv env, WorkCard card, bool directory = false)
    {
        if (card.Kind == WorkKind.Unknown)
        {
            var icon = Ui.Icon("playlists", media.W / 2 - 32, media.H / 2 - 32, 64, env.Theme.InkMuted);
            media._playlistIcon = icon;
            media.Art.Add(icon);
        }
        if (directory)
        {
            media._playlistMediaType = card.Kicker;
            media._playlistShared = card.Sub.Equals("Shared", StringComparison.OrdinalIgnoreCase);
            media._playlistMetadata = Ui.Text("", 1.9f, media.H + 31.9f, 8.832f, 400, env.Theme.InkMuted, media.W - 3.8f, 13.248f);
            media._playlistMetadata.Show(false);
            media.Box.Add(media._playlistMetadata);
        }
        else
        {
            media.Box.Add(Ui.Text(card.Sub.ToUpperInvariant(), 0, media.H + 14.5f, 8.448f, 700, env.Theme.InkMuted, media.W, 12.672f, HorizontalAlignment.End));
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
        _env.Images.Track(async () =>
        {
            var file = await _env.Images.GetAsync(wanted).ConfigureAwait(false);
            if (file is null) return;
            await AuthImage.OnUiAsync(() =>
            {
                if (_path != wanted) return; // focus moved on
                foreach (var child in Root.Children.ToArray()) { Root.Remove(child); child.Dispose(); }
                var dark = _t.Name == "dark";
                var img = Ui.FilteredImage(file, -20, -22.9f, 1038.3f, 1190.6f, dark ? 0.82f : 1f, dark ? 0.6f : 1.1f, fadeStartX: 0.72f);
                img.Opacity = dark ? 0.07f : 0.035f; // retain the current low-opacity TV treatment
                Root.Add(img);
                var s = _t.Surface; var clear = new Rgba(s.R, s.G, s.B, 0);
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
    public float ContentBottom { get; private set; }
    private readonly AppEnv _env;
    private readonly bool _library;
    private readonly bool _flow;
    private readonly bool _includeRuntime;
    private readonly bool _useWebNoMetaOverviewGap;
    private Guid _showing;
    private static readonly Dictionary<Guid, long?> RuntimeCache = new();

    public DetailsPanel(AppEnv env, bool library, bool flow = false, bool includeRuntime = true, bool useWebNoMetaOverviewGap = false)
    {
        _env = env;
        _library = library || flow;
        _flow = flow;
        _includeRuntime = includeRuntime;
        _useWebNoMetaOverviewGap = useWebNoMetaOverviewGap;
    }

    public void Show(WorkCard card, string? kickerOverride = null, string? metaLead = null)
    {
        _showing = card.WorkId;
        Render(card, kickerOverride, metaLead, _includeRuntime && RuntimeCache.TryGetValue(card.WorkId, out var rt) ? rt : null);
        if (_includeRuntime && !RuntimeCache.ContainsKey(card.WorkId))
            _env.Images.Track(() => FetchRuntimeAsync(card, kickerOverride, metaLead));
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
            var stillShowing = false;
            await AuthImage.OnUiAsync(() => stillShowing = _showing == card.WorkId);
            if (!stillShowing) return;
            var detail = await _env.Api.GetWorkAsync(card.WorkId);
            await AuthImage.OnUiAsync(() =>
            {
                RuntimeCache[card.WorkId] = detail.RuntimeMs;
                if (_showing == card.WorkId) Render(card, kicker, lead, detail.RuntimeMs);
            });
        }
        catch (Exception) { await AuthImage.OnUiAsync(() => RuntimeCache[card.WorkId] = null); }
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
        var noMetaGap = Math.Clamp(TizenClient.DesignHeight * 0.02f, 16f, 28f); // web .tv-home-feature overview margin: clamp(16px, 2vh, 28px)
        var oy = meta.Length == 0 && _useWebNoMetaOverviewGap
            ? ty + tlh * lines + noMetaGap
            : metaY + (_library ? 41.2f : 40.9f);
        var ovLine = _library ? 21.842f : 20.325f; var ovSize = _library ? 13.824f : 12.864f;
        var ovLines = Ui.Paragraph(Root, card.Overview, 153.6f, oy, ovSize, 600, Soft(t), 322, ovLine, 0, 5); // web clamps the preview overview at 5 lines on every page
        var top = ky; var bottom = oy + ovLines * ovLine;
        ContentBottom = bottom;
        var scrim = Ui.PanelScrim(t, 153.6f, top, 455, bottom - top);
        Root.Add(scrim); scrim.LowerToBottom();
    }

    private static Rgba Soft(PlayarrTheme t) => t.Name == "dark" ? new Rgba(0.855f, 0.84f, 0.844f) : t.InkSoft;

    public static string Runtime(long ms) => DetailModel.Runtime(ms); // web runtimeLabel: rounded, not truncated
}
