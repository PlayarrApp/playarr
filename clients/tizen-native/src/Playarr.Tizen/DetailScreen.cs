using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using DownloadRecord = Playarr.Tizen.Logic.DownloadRecord; // Playarr.Core now has its own
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Film detail (web WorkDetail for a movie): copy and actions on the left, chapters on the right. Measured at 1920x1080.</summary>
internal sealed class DetailScreen : IPage
{
    private const float RailX = 881.6f, ChapterPitch = 292.95f, ChaptersHeadingY = 540f, ClipX = 729.6f;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly Guid _id;
    private readonly View _root = new();
    private readonly KeyArt _keyArt;
    private readonly View _content = new();
    private readonly View _chapterRow = new();
    private readonly FocusSet _focus = new();
    private readonly AuthImage _images;
    private WorkDetail? _detail;
    private WatchProgress? _progress;
    private float _chapterScroll;
    private View? _stack;
    private float _stackY;
    private Guid? _file;

    public bool IsReady => _focus.Items.Count > 0;
    public View Root => _root;
    public string Route => $"/movies/{_id}";
    public string? FocusedLabel => _dl?.FocusedLabel ?? _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public DetailScreen(AppEnv env, Guid id)
    {
        _env = env; _t = env.Theme; _id = id; _images = new AuthImage(env.Api);
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        _keyArt = new KeyArt(env, armed: true);
        _root.Add(_keyArt.Root);
        _root.Add(Ui.PanelWash(_t)); // web: the right rail panel frosts the key art (the page top is not a surface fade)
        _root.Add(_content);
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var detail = await _env.Api.GetWorkAsync(_id);
            WatchProgress? progress = null;
            if (detail.MediaFileId is { } f) { try { progress = await _env.Api.GetWatchProgressAsync(f); } catch (Exception) { /* none yet */ } }
            SynchronizationContextHolder.Post(() => { try { Build(detail, progress); } catch (Exception e) { Dbg.Log("DETAIL build failed: " + e); } });
        }
        catch (Exception e) { Dbg.Log("DETAIL load failed: " + e); }
    }

    private void Build(WorkDetail detail, WatchProgress? progress)
    {
        _detail = detail; _progress = progress; _file = detail.MediaFileId;
        var w = detail.Work;
        _keyArt.Set(ArtworkPaths.Path(w, ImageKind.Backdrop));
        BuildHeader(w);
        BuildCopy(w, detail);
        _ = LoadChaptersThenCastAsync(detail);
        if (_focus.Items.Count > 0) _focus.Set(PlayIndex);
    }

    private int PlayIndex;

    private void BuildHeader(Work w)
    {
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _content.Add(back);
        _content.Add(Ui.Text("Movies", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        new PageSubtitle(_env, _content, "Movies").Set(w.Title);
    }

    private void BuildCopy(Work w, WorkDetail d)
    {
        _content.Add(Ui.Text(w.Genres.FirstOrDefault() ?? "Movie", 153.6f, 259.2f, 12.288f, 800, _t.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f));
        var lines = Ui.Paragraph(_content, w.Title, 153.6f, 303.5f, 69.12f, 600, _t.Ink, 369, 62.208f, -4.98f, 5, balance: true);
        var bas = 303.5f + 62.208f * lines;
        var meta = new List<string> { "Movie" };
        if (d.RuntimeMs is > 0) meta.Add(DetailModel.Runtime(d.RuntimeMs.Value));
        if (WorkLabels.YearRange(w) is { } y) meta.Add(y);
        meta.AddRange(w.Genres.Take(3));
        _content.Add(Ui.Text(string.Join("     ", meta), 153.6f, bas + 27, 10.56f, 400, _t.InkMuted, 700, 15.84f));
        var ovLines = Ui.Paragraph(_content, w.Overview ?? "", 153.6f, bas + 64.5f, 12.864f, 400, _t.InkMuted, 336, 20.325f, 0, 5);

        // the action rows follow the overview: 5 lines put them at +203.8 (web), each line fewer lifts them by one line height
        var y1 = bas + 203.8f - (5 - Math.Max(1, ovLines)) * 20.325f; var y2 = y1 + 76f;
        var resume = _progress is { State: WatchState.InProgress } p ? "Resume from " + DetailModel.Clock(p.PositionMs) : "Play";
        AddButton("Download", "⇩", 153.6f, y1, 142, primary: false, label: "download", select: () => OpenDownload(w));
        AddButton("Playback", "☷", 311.6f, y1, 142, primary: false, label: "playback settings", select: () => Toast("Playback settings are not available in this app yet."));
        PlayIndex = _focus.Items.Count;
        AddButton(resume, "▶", 469.6f, y1, resume.Length > 4 ? 160.6f : 112, primary: true, label: $"play {w.Title}".ToLowerInvariant(), select: () => PlayFrom(_progress is { State: WatchState.InProgress } rp ? rp.PositionMs : null));
        AddButton("Add to watchlist", "+", 153.6f, y2, 142, primary: false, label: "add to watchlist", select: () => Toast("The watchlist is not available in this app yet."));
        AddButton("Add to Playlist", "+", 311.6f, y2, 142, primary: false, label: "add to playlist", select: () => Toast("Playlists are not available in this app yet."));
    }

    private void AddButton(string text, string glyph, float x, float y, float w, bool primary, string label, Action select)
    {
        var bg = primary ? _t.Ink : new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f);
        var box = Ui.Box(x, y, w, 64, bg, 32);
        if (!primary) { box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.075f); }
        var fg = primary ? _t.OnAccent : _t.Ink;
        var gw = primary ? 8f : 11f;
        var textW = text.Length * 6.4f;
        var startX = (w - (gw + 9.4f + textW)) / 2;
        var glyphLabel = Ui.Text(glyph, startX, 22.4f, 12.8f, 400, primary ? _t.OnAccent : _t.BrandInk, gw + 4, 19.2f);
        var textLabel = Ui.Text(text, startX + gw + 9.4f, 23.7f, 11.136f, 700, fg, textW + 20, 16.7f);
        box.Add(glyphLabel); box.Add(textLabel);
        var ring = Ring.Make(w, 64, 32, new Rgba(1, 1, 1));
        ring.Show(false);
        box.Add(ring);
        _content.Add(box);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, y, w, 64), Label = label, Select = select,
            Style = f =>
            {
                ring.Show(f);
                // web .tv-detail-play focus: brand-strong fill, white text, scale 1.06; Playback: ink at 88 % with the page colour as text, scale 1.06
                box.Scale = f && (primary || text == "Playback") ? new Vector3(1.06f, 1.06f, 1) : new Vector3(1, 1, 1);
                if (primary) { box.BackgroundColor = f ? new Color(0.647f, 0.153f, 0.271f, 1) : Ui.C(_t.Ink); glyphLabel.TextColor = f ? new Color(1, 1, 1, 1) : Ui.C(_t.OnAccent); textLabel.TextColor = f ? new Color(1, 1, 1, 1) : Ui.C(_t.OnAccent); }
                else if (text == "Playback") { box.BackgroundColor = f ? new Color(_t.Ink.R, _t.Ink.G, _t.Ink.B, 0.88f) : Ui.C(bg); glyphLabel.TextColor = f ? Ui.C(_t.Bg) : Ui.C(_t.BrandInk); textLabel.TextColor = f ? Ui.C(_t.Bg) : Ui.C(_t.Ink); }
            },
        });
    }

    /// <summary>Real chapters embedded in the file when it has any (web uses them as is), else the generated ones; then the cast rail below.</summary>
    private async Task LoadChaptersThenCastAsync(WorkDetail d)
    {
        IReadOnlyList<Chapter>? real = null;
        try
        {
            if (d.MediaFileId is { } f)
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, _env.Api.ResolveUrl($"/api/v1/media/{f:D}/chapters"));
                foreach (var h in await _env.Api.GetPlaybackRequestHeadersAsync()) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
                using var res = await new HttpClient().SendAsync(req);
                if (res.IsSuccessStatusCode) real = DetailModel.ParseChapters(await res.Content.ReadAsStringAsync());
            }
        }
        catch (Exception e) { Dbg.Log("CHAPTERS failed: " + e.Message); }
        var done = new TaskCompletionSource();
        SynchronizationContextHolder.Post(() => { try { BuildChapters(d, real is { Count: > 0 } ? real : DetailModel.GeneratedChapters(d.RuntimeMs ?? 0), generated: real is not { Count: > 0 }); } finally { done.SetResult(); } });
        await done.Task;
        await LoadCastAsync(d);
    }

    private void BuildChapters(WorkDetail d, IReadOnlyList<Chapter> chapters, bool generated)
    {
        if (chapters.Count == 0 || d.MediaFileId is not { } file) return;
        var clip = new View { PositionX = ClipX, Size = new Size(TizenClient.DesignWidth - ClipX, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        var stack = _stack = new View { PositionX = -ClipX };
        clip.Add(stack);
        _content.Add(clip);
        stack.Add(Ui.Text("Chapters", RailX, ChaptersHeadingY, 17.664f, 700, _t.Ink, 400, 26.496f, spacing: -0.53f));
        stack.Add(Ui.Text($"{chapters.Count} {(generated ? "scene markers" : "chapters")}", RailX, ChaptersHeadingY + 30.5f, 9.984f, 400, _t.InkMuted, 400, 14.976f));
        _chapterRow.PositionY = 620.7f; _chapterRow.Size = new Size(6000, 230);
        stack.Add(_chapterRow);
        foreach (var c in chapters)
        {
            var x = RailX + c.Index * ChapterPitch;
            var box = new View { PositionX = x, Size = new Size(268, 200) };
            var art = Ui.Box(0, 0, 268, 150.8f, _t.SurfaceSoft, 13.44f);
            art.ClippingMode = ClippingModeType.ClipChildren;
            _ = SetThumbAsync(art, file, c.StartMs);
            art.Add(Ui.Gradient(0, 0, 268, 150.8f, false, (0, new Rgba(0, 0, 0, 0.05f)), (1, new Rgba(0, 0, 0, 0.48f))));
            art.Add(Ui.Text((c.Index + 1).ToString("00"), 268 - 11.5f - 28, 150.8f - 8.8f - 28.8f, 19.2f, 560, new Rgba(1, 1, 1), 28, 28.8f, HorizontalAlignment.End));
            var (ring, glow) = Widgets.RailRing(_t, 268, 150.8f, 13.44f); art.Add(ring);
            box.Add(glow); box.Add(art);
            box.Add(Ui.Text(DetailModel.Clock(c.StartMs), 0, 165.3f, 8.832f, 700, _t.InkMuted, 40, 13.248f));
            var tt = Ui.Text(c.Title, 25.8f, 162.3f, 11.52f, 700, _t.Ink, 242, 17.28f, spacing: -0.17f);
            box.Add(tt);
            _chapterRow.Add(box);
            var idx = c.Index; var startMs = c.StartMs;
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x - _chapterScroll, 620.7f + _stackY, 268, 150.8f), Label = $"play from {c.Title}".ToLowerInvariant(),
                Select = () => PlayFrom(startMs),
                Style = f => { art.Scale = f ? new Vector3(1.025f, 1.025f, 1) : new Vector3(1, 1, 1); art.PositionY = f ? -6 : 0; ring.Show(f); if (f) ring.RaiseToTop(); glow.Show(f); glow.Scale = art.Scale; glow.PositionY = art.PositionY; tt.TextColor = f ? (_t.Name == "dark" ? new Color(1, 1, 1, 1) : new Color(0, 0, 0, 1)) : Ui.C(_t.Ink); },
                Focused = () => { SetStackY(0); ScrollChapters(idx); },
            });
        }
    }

    private void SetStackY(float y) { _stackY = y; if (_stack is not null) _stack.PositionY = y; }

    private async Task LoadCastAsync(WorkDetail d)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, _env.Api.ResolveUrl($"/api/v1/catalog/{d.Work.Id:D}/credits"));
            foreach (var h in await _env.Api.GetPlaybackRequestHeadersAsync()) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using var res = await new HttpClient().SendAsync(req);
            if (!res.IsSuccessStatusCode) return;
            var cast = Credits.ParseCast(await res.Content.ReadAsStringAsync());
            if (cast.Count == 0 || _stack is null) return;
            SynchronizationContextHolder.Post(() => new PeopleRail(_env, _stack, cast, 891f, _focus, () => _stackY, r => SetStackY(-(r.HeadingY - 540f))));
        }
        catch (Exception e) { Dbg.Log("CAST failed: " + e.Message); }
    }

    private async Task SetThumbAsync(View art, Guid file, long positionMs)
    {
        var path = await _images.GetAsync($"/api/v1/media/{file:D}/thumbnail?position_ms={positionMs}");
        if (path is null) return;
        SynchronizationContextHolder.Post(() => { var img = Ui.Remote(path, 268, 150.8f); art.Add(img); img.LowerToBottom(); });
    }

    private void ScrollChapters(int index)
    {
        var visible = TizenClient.DesignWidth - RailX - Widgets.RailEndInset; // web keeps the focused card clear of the screen edge: room for its scale, ring and glow
        var right = (index + 1) * ChapterPitch - 25f;
        if (right - _chapterScroll > visible) _chapterScroll = right - visible;
        if (index * ChapterPitch < _chapterScroll) _chapterScroll = index * ChapterPitch;
        _chapterRow.PositionX = -_chapterScroll;
    }

    private DownloadDrawer? _dl;

    /// <summary>Loads the file's download options, then asks for quality and keep-until; the transfer runs in the engine and shows on /downloads.</summary>
    private void OpenDownload(Work w)
    {
        if (_file is not { } file || _dl is not null) return;
        _dl = new DownloadDrawer(_env, "Download", [], KeepUntil.Forever, (_, _, _) => { }, CloseDownload, loading: "Loading download options…");
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
                    _dl = new DownloadDrawer(_env, w.Title, options, KeepUntil.Forever, (q, keep, _) => StartDownload(w, file, container, q ?? options[0], keep), CloseDownload);
                    _root.Add(_dl.Root);
                });
            }
            catch (Exception e)
            {
                Dbg.Log("DOWNLOAD options failed: " + e.Message);
                SynchronizationContextHolder.Post(() => { CloseDownload(); Toast("Download options could not be loaded."); });
            }
        });
    }

    private void StartDownload(Work w, Guid file, string container, DownloadQuality q, KeepUntil keep)
    {
        CloseDownload();
        var rec = new DownloadRecord { WorkId = w.Id.ToString("D"), Title = w.Title, QualityId = q.Id, QualityLabel = q.Label, Container = container, TotalBytes = q.Estimate ? null : q.Bytes, RuntimeMs = _detail?.RuntimeMs ?? 0 };
        _ = Task.Run(async () =>
        {
            try { await _env.Downloads.StartAsync(rec, file, keep); SynchronizationContextHolder.Post(() => Toast("Download started. Find it under Downloads.")); }
            catch (Exception e) { Dbg.Log("DOWNLOAD start failed: " + e.Message); SynchronizationContextHolder.Post(() => Toast(e.Message.Length is > 0 and < 90 ? e.Message : "The download could not be started.")); }
        });
    }

    private void CloseDownload() { if (_dl is null) return; _root.Remove(_dl.Root); _dl.Root.Dispose(); _dl = null; }

    private void PlayFrom(long? startMs)
    {
        if (_file is not { } f) return;
        _env.Navigate($"/player/{f}" + (startMs is > 0 ? $"?t={startMs}" : ""));
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

    public bool OnKey(RemoteKey key)
    {
        if (_dl is not null) return _dl.OnKey(key);
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right) _keyArt.Arm();
        switch (key)
        {
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            case RemoteKey.Back: return false;
            default: return _focus.Items.Count == 0 ? key != RemoteKey.Left : _focus.Move(key) || key != RemoteKey.Left;
        }
    }
}
