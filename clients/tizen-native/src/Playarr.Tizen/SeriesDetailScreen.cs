using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using DownloadRecord = Playarr.Tizen.Logic.DownloadRecord; // Playarr.Core now has its own
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Series detail (web WorkDetail for a series): lead episode copy and actions on the left, one episode rail per season on the right.</summary>
internal sealed class SeriesDetailScreen : IPage
{
    private const float RailX = 881.6f, CardPitch = 292.95f, FocusedHeadingY = 358f, RailPitch = 314.3f, ClipX = 729.6f;

    private sealed class Rail { public View Row = new(); public float Scroll; public List<int> Items = new(); }

    /// <summary>Web puts the cast heading 37.7 px lower than one more season rail would be (measured at 1920x1080).</summary>
    private const float CastGap = 37.7f;
    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly Guid _id;
    private readonly View _root = new();
    private readonly View _content = new();
    private readonly View _stack = new() { PositionX = -ClipX };
    private readonly View _copy = new();
    private readonly KeyArt _keyArt;
    private readonly FocusSet _focus = new();
    private readonly List<Rail> _rails = new();
    private readonly List<(int Rail, int Col, EpisodeDetail Ep, SeasonDetail Season)> _episodes = new();
    private readonly Dictionary<int, (int, int, EpisodeDetail, SeasonDetail)> _episodeByFocus = new();
    private WorkDetail? _detail;
    private IReadOnlyDictionary<Guid, WatchProgress> _progress = new Dictionary<Guid, WatchProgress>();
    private int _activeRail, _seasonCount;
    private int _leadFocus;
    private bool _captureReady;

    public bool IsReady => _focus.Items.Count > 0 && _captureReady;
    public View Root => _root;
    public string Route => $"/series/{_id}";
    public string? FocusedLabel => _dl?.FocusedLabel ?? (_focus.Item is { } fi && _pillItems.IndexOf(fi) is var pi and >= 0 ? _slots[pi].Label : _focus.Item?.Label);
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public SeriesDetailScreen(AppEnv env, Guid id)
    {
        _env = env; _t = env.Theme; _id = id;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        _keyArt = new KeyArt(env, armed: true); // web paints the key art as soon as focus lands on the first episode
        _root.Add(_keyArt.Root);
        _root.Add(Ui.PanelWash(_t)); // web: the right rail panel frosts the key art (the page top is not a surface fade)
        _root.Add(_content);
        _root.Add(Ui.HorizontalEdgeFade(TizenClient.DesignWidth, 0, TizenClient.DesignHeight, _t.Surface, atLeft: false));
        _root.Add(Ui.EdgeFade(ClipX, TizenClient.DesignHeight, TizenClient.DesignWidth - ClipX, _t.Surface, atTop: false));
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var detail = await _env.Api.GetWorkAsync(_id);
            var rows = await _env.Api.ListWatchProgressAsync();
            SynchronizationContextHolder.Post(() => { try { Build(detail, rows); } catch (Exception e) { Dbg.Log("SDETAIL build failed: " + e); } });
        }
        catch (Exception e) { Dbg.Log("SDETAIL load failed: " + e); }
    }

    private void Build(WorkDetail detail, IList<WatchProgress> rows)
    {
        _detail = detail;
        _progress = rows.ToDictionary(r => r.MediaFileId);
        var w = detail.Work;
        _keyArt.Set(ArtworkPaths.Path(w, ImageKind.Backdrop));

        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _content.Add(back);
        _content.Add(Ui.Text("Series", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        new PageSubtitle(_env, _content, "Series").Set(w.Title, wrapIfClockBlocks: true);
        _content.Add(_copy);

        var clip = new View { PositionX = ClipX, Size = new Size(TizenClient.DesignWidth - ClipX, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        clip.Add(_stack);
        _content.Add(clip);

        // lead episode: the newest part-watched one, else the first
        var all = detail.Children.Seasons.SelectMany(s => s.Episodes.Select(e => (s, e))).ToList();
        var lead = all.Where(x => x.e.MediaFileId is { } f && _progress.TryGetValue(f, out var p) && p.State == WatchState.InProgress)
                      .OrderByDescending(x => _progress[x.e.MediaFileId!.Value].UpdatedAt ?? DateTimeOffset.MinValue).Select(x => ((SeasonDetail, EpisodeDetail)?)(x.s, x.e)).FirstOrDefault()
                   ?? all.Select(x => ((SeasonDetail, EpisodeDetail)?)(x.s, x.e)).FirstOrDefault();

        var seasons = detail.Children.Seasons.Where(s => s.Episodes.Count > 0).OrderBy(s => s.Season.SeasonNumber).ToList();
        for (var si = 0; si < seasons.Count; si++) BuildRail(si, seasons[si], file: (f) => { });
        _seasonCount = seasons.Count;
        LoadCastAsync(detail);
        if (lead is { } l) SetLead(l.Item1, l.Item2);
        if (_focus.Items.Count > 0)
        {
            var leadIdx = _episodes.FindIndex(x => lead is { } ll && x.Ep == ll.Item2);
            _focus.Set(leadIdx >= 0 ? leadIdx : 0);
        }
    }

    private void BuildRail(int si, SeasonDetail season, Action<Guid> file)
    {
        var rail = new Rail();
        var y = si * RailPitch;
        _stack.Add(Ui.Text($"Season {season.Season.SeasonNumber}", RailX, y, 17.664f, 700, _t.Ink, 400, 26.496f, spacing: -0.53f));
        _stack.Add(Ui.Text($"{season.Episodes.Count} episodes", RailX, y + 30.5f, 9.984f, 400, _t.InkMuted, 400, 14.976f));
        rail.Row.PositionY = y + 80.7f; rail.Row.Size = new Size(9000, 220);
        _stack.Add(rail.Row);
        _rails.Add(rail);
        for (var ci = 0; ci < season.Episodes.Count; ci++)
        {
            var ep = season.Episodes[ci];
            var x = RailX + ci * CardPitch;
            var box = new View { PositionX = x, Size = new Size(268, 200) };
            var art = Ui.Box(0, 0, 268, 150.8f, _t.SurfaceSoft, 13.44f);
            art.ClippingMode = ClippingModeType.ClipChildren;
            // web: the episode's own still when the catalog has one, else the media-file frame (cover crop); a 135deg black wash and the number sit on top
            var still = ep.Episode.Images.Any(i => i.Kind == ImageKind.Thumb) ? $"/api/v1/artwork/episode/{_detail!.Work.Id:D}/{ep.Episode.Id:D}/thumb?w=540" : null;
            if (still is not null || ep.MediaFileId is not null) SetThumbAsync(art, still, ep.MediaFileId);
            art.Add(Ui.Gradient(0, 0, 268, 150.8f, false, (0, new Rgba(0, 0, 0, 0.05f)), (1, new Rgba(0, 0, 0, 0.48f))));
            art.Add(Ui.Text(ep.Episode.EpisodeNumber.ToString("00"), 268 - 11.5f - 28, 150.8f - 8.8f - 28.8f, 19.2f, 560, new Rgba(1, 1, 1), 28, 28.8f, HorizontalAlignment.End));
            var unseen = ep.MediaFileId is { } mf && (!_progress.TryGetValue(mf, out var pr) || pr.State == WatchState.Unwatched);
            var inProgress = ep.MediaFileId is { } mf2 && _progress.TryGetValue(mf2, out var pr2) && pr2.State == WatchState.InProgress ? pr2 : null;
            if (inProgress is not null)
            {
                art.Add(Ui.Box(0, 147.8f, 268, 3, new Rgba(1, 1, 1, 0.2f)));
                art.Add(Ui.Box(0, 147.8f, Math.Max(3, 268 * (float)inProgress.Fraction), 3, _t.Brand));
            }
            var (ring, glow) = Widgets.RailRing(_t, 268, 150.8f, 13.44f); art.Add(ring);
            box.Add(glow); box.Add(art);
            if (unseen)
            {
                var dot = Ui.Box(268 - 23.6f, 10.6f, 13, 13, _t.Brand, 6.5f);
                dot.BorderlineWidth = 2; dot.BorderlineColor = new Color(1, 1, 1, 0.94f);
                box.Add(dot);
            }
            var code = $"S{season.Season.SeasonNumber:00} · E{ep.Episode.EpisodeNumber:00}";
            box.Add(Ui.Text(code, 0, 165.3f, 8.832f, 700, _t.InkMuted, 46, 13.248f));
            var tt = Ui.Text(ep.Episode.Title ?? $"Episode {ep.Episode.EpisodeNumber}", 45.8f, 162.3f, 11.52f, 700, _t.Ink, 222, 17.28f, spacing: -0.17f);
            box.Add(tt);
            rail.Row.Add(box);
            var railIdx = si; var col = ci; var epc = ep; var seasonc = season;
            _episodes.Add((si, ci, ep, season));
            _episodeByFocus[_focus.Items.Count] = (si, ci, ep, season);
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x - rail.Scroll, FocusedHeadingY - (_activeRail - railIdx) * RailPitch + 80.7f, 268, 150.8f),
                Label = $"play {code}".ToLowerInvariant(),
                Select = () => PlayEpisode(epc),
                Style = f => { art.Scale = f ? new Vector3(1.025f, 1.025f, 1) : new Vector3(1, 1, 1); art.PositionY = f ? -6 : 0; ring.Show(f); if (f) ring.RaiseToTop(); glow.Show(f); glow.Scale = art.Scale; glow.PositionY = art.PositionY; tt.TextColor = Ui.C(_t.Ink); },
                Focused = () => OnEpisodeFocused(railIdx, col, epc, seasonc),
            });
        }
    }

    private void LoadCastAsync(WorkDetail d)
    {
        _env.Images.Track(async () =>
        {
            string? content = null;
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, _env.Api.ResolveUrl($"/api/v1/catalog/{d.Work.Id:D}/credits"));
                foreach (var h in await _env.Api.GetPlaybackRequestHeadersAsync().ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
                using var res = await new HttpClient().SendAsync(req).ConfigureAwait(false);
                if (res.IsSuccessStatusCode) content = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch (Exception e) { Dbg.Log("SDETAIL cast request failed: " + e.Message); }

            var cast = content is null ? [] : Credits.ParseCast(content);
            var slot = _seasonCount; // web: the cast rail, else Similar Titles, takes the slot after the last season; Similar follows the cast
            if (cast.Count > 0)
            {
                var rail = slot;
                await AuthImage.OnUiAsync(() => new PeopleRail(_env, _stack, cast, rail * RailPitch + CastGap, _focus, () => _stack.PositionY, _ =>
                {
                    _activeRail = rail;
                    _stack.PositionY = FocusedHeadingY - rail * RailPitch - CastGap;
                }));
                slot++;
            }
            var similar = await SimilarRail.LoadAsync(_env, d.Work).ConfigureAwait(false);
            await AuthImage.OnUiAsync(() =>
            {
                if (similar.Count > 0)
                {
                    var rail = slot;
                    new SimilarRail(_env, _stack, similar, rail * RailPitch + CastGap, _focus, () => _stack.PositionY, _ =>
                    {
                        _activeRail = rail;
                        _stack.PositionY = FocusedHeadingY - rail * RailPitch - CastGap;
                    });
                }
                _captureReady = true;
            });
        });
    }

    private void OnEpisodeFocused(int rail, int col, EpisodeDetail ep, SeasonDetail season)
    {
        _activeRail = rail;
        var r = _rails[rail];
        var visible = TizenClient.DesignWidth - RailX - Widgets.RailEndInset; // web keeps the focused card clear of the screen edge: room for its scale, ring and glow
        var right = (col + 1) * CardPitch - 25f;
        if (right - r.Scroll > visible) r.Scroll = right - visible;
        if (col * CardPitch < r.Scroll) r.Scroll = col * CardPitch;
        r.Row.PositionX = -r.Scroll;
        _stack.PositionY = FocusedHeadingY - rail * RailPitch;
        SetLead(season, ep);
    }

    private void SetLead(SeasonDetail season, EpisodeDetail ep)
    {
        foreach (var c in _copy.Children.ToArray()) { _copy.Remove(c); c.Dispose(); }
        var w = _detail!.Work;
        var code = $"S{season.Season.SeasonNumber:00} · E{ep.Episode.EpisodeNumber:00}";
        _copy.Add(Ui.Text(code, 153.6f, 259.2f, 12.288f, 800, _t.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f));
        var lines = Ui.Paragraph(_copy, w.Title, 153.6f, 303.5f, 69.12f, 600, _t.Ink, 369, 62.208f, -4.98f, 5, balance: true);
        var bas = 303.5f + 62.208f * lines;
        _copy.Add(Ui.Text(ep.Episode.Title ?? "", 153.6f, bas + 21.7f, 21.12f, 600, _t.InkSoft, 312, 24.288f, spacing: -0.74f));
        var meta = new List<string> { $"Season {season.Season.SeasonNumber}", code };
        if (ep.RuntimeMs is > 0) meta.Add(DetailModel.Runtime(ep.RuntimeMs.Value));
        if (WorkLabels.YearRange(w) is { } y) meta.Add(y);
        if (ep.Episode.AirDate is { Length: > 0 } air && DateTime.TryParse(air, out var d)) meta.Add("Aired  " + d.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")));
        meta.AddRange(w.Genres.Take(3));
        _copy.Add(Ui.Text(string.Join("     ", meta), 153.6f, bas + 73f, 10.56f, 400, _t.InkMuted, 700, 15.84f));
        var synopsisLines = Ui.Paragraph(_copy, ep.Episode.Overview ?? w.Overview ?? "", 153.6f, bas + 110.5f, 12.864f, 400, _t.InkMuted, 336, 20.325f, 0, 5);
        var yb = bas + 110.5f + Math.Max(1, synopsisLines) * 20.325f + 12f;
        var hasProgress = ep.MediaFileId is { } f && _progress.TryGetValue(f, out var pr) && pr.State == WatchState.InProgress;
        _leadEp = ep;
        EnsurePillSlots();
        for (var i = 0; i < _slots.Length; i++) _slots[i].Clear();
        Pill(0, _copy, hasProgress ? "Resume" : "Start", "▶", 153.6f, yb, 156, true, hasProgress ? "resume" : "start", () => { if (_leadEp is { } le) PlayEpisode(le); });
        var px = 325.6f; var slot = 1;
        // web: "Ask again" only while the resume plan is something other than a plain start
        if (hasProgress) { Pill(slot++, _copy, "Ask again", "↺", px, yb, 142, false, "ask again", () => Toast("Resume choices are not available in this app yet.")); px += 158; }
        Pill(slot++, _copy, "Add to watchlist", "+", px, yb, 142, false, "add to watchlist", () => _ = AddToWatchlistAsync());
        Pill(slot, _copy, "Add to Playlist", "+", px + 158, yb, 142, false, "add to playlist", () => Toast("Playlists are not available in this app yet."));
        _keyArt.Set(ArtworkPaths.Path(w, ImageKind.Backdrop));
    }

    private sealed class PillSlot
    {
        public Box Rect = new(-5000, -5000, 1, 1); public View? Ring; public string Label = ""; public Action? Select; public Action<bool>? Style;
        public void Clear() { Rect = new Box(-5000, -5000, 1, 1); Ring = null; Label = ""; Select = null; Style = null; }
    }

    private readonly PillSlot[] _slots = { new(), new(), new(), new() };
    private EpisodeDetail? _leadEp;
    private bool _slotsRegistered;
    private readonly List<Focusable> _pillItems = new();

    /// <summary>The action pills are focusable (web: Start, Ask again, Add to watchlist, Add to Playlist); four fixed focus items follow the episodes, absent pills park off screen.</summary>
    private void EnsurePillSlots()
    {
        if (_slotsRegistered) return;
        _slotsRegistered = true;
        foreach (var slot in _slots)
        {
            var sl = slot;
            var item = new Focusable { Rect = () => sl.Rect, Label = "", Select = () => sl.Select?.Invoke(), Style = f => sl.Style?.Invoke(f) };
            _pillItems.Add(item); _focus.Items.Add(item);
        }
    }

    private void Pill(int slotIndex, View parent, string text, string glyph, float x, float y, float w, bool primary, string label, Action select)
    {
        var bg = primary ? _t.Ink : new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f);
        var box = Ui.Box(x, y, w, 64, bg, 32);
        if (!primary) { box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.075f); }
        var textW = text.Length * 6.4f; var startX = (w - (11 + 9.4f + textW)) / 2;
        var g = Ui.Text(glyph, startX, 22.4f, 12.8f, 400, primary ? _t.OnAccent : _t.BrandInk, 15, 19.2f);
        var tl = Ui.Text(text, startX + 20.4f, 23.7f, 11.136f, 700, primary ? _t.OnAccent : _t.Ink, textW + 20, 16.7f);
        box.Add(g); box.Add(tl);
        var ring = Ring.Make(w, 64, 32, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        parent.Add(box);
        var slot = _slots[slotIndex];
        slot.Rect = new Box(x, y, w, 64); slot.Ring = ring; slot.Label = label; slot.Select = select;
        // web .tv-detail-play focus: brand-strong fill, white text, scale 1.06 (the primary pill)
        slot.Style = f =>
        {
            ring.Show(f);
            box.Scale = f && primary ? new Vector3(1.06f, 1.06f, 1) : new Vector3(1, 1, 1);
            if (primary) { box.BackgroundColor = f ? new Color(0.647f, 0.153f, 0.271f, 1) : Ui.C(_t.Ink); g.TextColor = f ? new Color(1, 1, 1, 1) : Ui.C(_t.OnAccent); tl.TextColor = f ? new Color(1, 1, 1, 1) : Ui.C(_t.OnAccent); }
        };
    }

    private async Task AddToWatchlistAsync()
    {
        if (_detail is null) return;
        try { await _env.Api.AddToWatchlistAsync(_detail.Work).ConfigureAwait(false); SynchronizationContextHolder.Post(() => Toast("Added to your watchlist.")); }
        catch (Exception e) { Dbg.Log("WATCHLIST add failed: " + e.Message); SynchronizationContextHolder.Post(() => Toast("Watchlist is unavailable right now.")); }
    }

    private void Toast(string text)
    {
        var toast = Ui.Box(560, 960, 800, 56, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.96f), 28);
        toast.Add(Ui.Text(text, 0, 14, 14, 600, _t.Ink, 800, 28, HorizontalAlignment.Center));
        _root.Add(toast);
        var timer = new global::Tizen.NUI.Timer(2500);
        timer.Tick += (_, _) => { _root.Remove(toast); toast.Dispose(); return false; };
        timer.Start();
    }

    private void SetThumbAsync(View art, string? stillPath, Guid? file)
    {
        _env.Images.Track(async () =>
        {
            var path = stillPath is null ? null : await _env.Images.GetAsync(stillPath).ConfigureAwait(false);
            if (path is null && file is { } f) path = await _env.Images.GetAsync($"/api/v1/media/{f:D}/thumbnail").ConfigureAwait(false);
            if (path is null) return;
            await AuthImage.OnUiAsync(() => { var img = Ui.Remote(path, 268, 150.8f); art.Add(img); img.LowerToBottom(); });
        });
    }

    private void PlayEpisode(EpisodeDetail ep)
    {
        if (ep.MediaFileId is not { } f) return;
        var resume = _progress.TryGetValue(f, out var p) && p.State == WatchState.InProgress ? p.PositionMs : 0;
        _env.Navigate($"/player/{f}" + (resume > 0 ? $"?t={resume}" : ""));
    }

    private DownloadDrawer? _dl;

    /// <summary>Long press on an episode: pick scope (this episode or the whole season), quality and keep-until; one ticket per episode.</summary>
    private void OpenDownload()
    {
        if (_dl is not null || _detail is null) return;
        var cur = _focus.Current;
        var hit = _episodeByFocus.TryGetValue(cur, out var found) ? found : ((int, int, EpisodeDetail, SeasonDetail)?)null;
        if (hit is null || hit.Value.Item3.MediaFileId is not { } file) return;
        var (_, _, episode, season) = hit.Value;
        var w = _detail.Work;
        _dl = new DownloadDrawer(_env, w.Title, [], KeepUntil.Forever, (_, _, _) => { }, CloseDownload, loading: "Loading download options…");
        _root.Add(_dl.Root);
        _ = Task.Run(async () =>
        {
            try
            {
                var (container, options) = await _env.DownloadsServer.OptionsAsync(file);
                SynchronizationContextHolder.Post(() =>
                {
                    if (_dl is null) return;
                    CloseDownload();
                    _dl = new DownloadDrawer(_env, w.Title, options, KeepUntil.Forever, (q, keep, scope) => StartDownloads(w, season, episode, scope, container, q ?? options[0], keep), CloseDownload,
                        scopes: ["This episode", "Whole season"]);
                    _root.Add(_dl.Root);
                });
            }
            catch (Exception e) { Dbg.Log("DOWNLOAD options failed: " + e.Message); SynchronizationContextHolder.Post(CloseDownload); }
        });
    }

    private void StartDownloads(Work w, SeasonDetail season, EpisodeDetail picked, int scope, string container, DownloadQuality q, KeepUntil keep)
    {
        CloseDownload();
        var episodes = scope == 1 ? season.Episodes.Where(e => e.MediaFileId is not null).ToList() : [picked];
        _ = Task.Run(async () =>
        {
            foreach (var e in episodes)
            {
                var rec = new DownloadRecord
                {
                    WorkId = w.Id.ToString("D"), Title = e.Episode.Title ?? $"Episode {e.Episode.EpisodeNumber}", SeriesTitle = w.Title, Season = season.Season.SeasonNumber, Episode = e.Episode.EpisodeNumber,
                    QualityId = q.Id, QualityLabel = q.Label, Container = container, TotalBytes = q.Estimate ? null : q.Bytes, RuntimeMs = e.RuntimeMs ?? 0,
                };
                try { await _env.Downloads.StartAsync(rec, e.MediaFileId!.Value, keep); }
                catch (Exception ex) { Dbg.Log("DOWNLOAD start failed: " + ex.Message); }
            }
        });
    }

    private void CloseDownload() { if (_dl is null) return; _root.Remove(_dl.Root); _dl.Root.Dispose(); _dl = null; }

    public bool OnKey(RemoteKey key)
    {
        if (_dl is not null) return _dl.OnKey(key);
        if (key == RemoteKey.SelectLong) { OpenDownload(); return true; }
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right) _keyArt.Arm();
        switch (key)
        {
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            case RemoteKey.Back: return false;
            default:
                if (_focus.Items.Count == 0) return key != RemoteKey.Left;
                if (_focus.Move(key)) return true;
                // from the last pill Right returns to the episode rail (nothing is to its right at the pills' height)
                if (key == RemoteKey.Right && _focus.Item is { } cur && _pillItems.Contains(cur)) { _focus.Set(_episodes.FindIndex(x => _leadEp is { } le && x.Ep == le) is var li and >= 0 ? li : 0); return true; }
                return key != RemoteKey.Left;
        }
    }
}
