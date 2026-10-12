using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Web /downloads: Active, Downloaded and Needs attention lists, grouped series, season, episode, with Pause/Resume, Cancel, Play, Edit and Delete.
/// shortcut: rows are rebuilt on every change and focus is restored by label; upgrade to in-place row updates if lists get long.
/// </summary>
internal sealed class DownloadsScreen : IPage
{
    private const float RowH = 92f, ViewTop = 168f, ViewH = 860f;
    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly View _root = new();
    private readonly View _list = new();
    private readonly FocusSet _focus = new();
    private readonly global::Tizen.NUI.Timer _refresh = new(1000);
    private DownloadDrawer? _drawer;
    private float _scroll;
    private bool _dirty;

    public bool IsReady => true;
    public View Root => _root;
    public string Route => "/downloads";
    public string? FocusedLabel => _drawer?.FocusedLabel ?? _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY + _scroll : 540;

    public DownloadsScreen(AppEnv env)
    {
        _env = env; _t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text("Downloads", 226.6f, 56.2f, 33.6f, 700, _t.Ink, 600, 50, spacing: -1.51f));
        var clip = new View { PositionY = ViewTop, Size = new Size(TizenClient.DesignWidth, ViewH), ClippingMode = ClippingModeType.ClipChildren };
        clip.Add(_list);
        _root.Add(clip);
        _env.Downloads.Changed += MarkDirty;
        _refresh.Tick += (_, _) => { if (_dirty) { _dirty = false; Build(); } return true; };
        _refresh.Start();
        Build();
    }

    private void MarkDirty() => _dirty = true;

    private void Build(string? keepLabel = null)
    {
        keepLabel ??= _focus.Item?.Label;
        _focus.Clear();
        foreach (var c in _list.Children.ToArray()) { _list.Remove(c); c.Dispose(); }
        var all = _env.Downloads.Records.OrderBy(r => r.SeriesTitle ?? r.Title).ThenBy(r => r.Season).ThenBy(r => r.Episode).ToList();
        var active = all.Where(r => r.State is DownloadState.Queued or DownloadState.Processing or DownloadState.Downloading or DownloadState.Paused).ToList();
        var done = all.Where(r => r.State == DownloadState.Ready).ToList();
        var bad = all.Where(r => r.State is DownloadState.Failed or DownloadState.Canceled or DownloadState.Expired).ToList();
        var y = 0f;
        if (all.Count == 0)
        {
            _list.Add(Ui.Text("No downloads yet", 153.6f, 150, 30, 700, _t.Ink, 800, 44));
            _list.Add(Ui.Text("Download a title from its detail page to watch it without a connection.", 153.6f, 200, 16, 400, _t.InkMuted, 900, 24));
            _drawer = _drawer; return;
        }
        y = Section("Active", active, y, "Nothing is downloading.");
        y = Section("Downloaded", done, y, "Nothing has finished downloading yet.");
        if (bad.Count > 0) y = Section("Needs attention", bad, y, "");
        var found = keepLabel is null ? -1 : _focus.Items.FindIndex(i => i.Label == keepLabel);
        if (_focus.Items.Count > 0) _focus.Set(found >= 0 ? found : 0);
        Scroll();
    }

    private float Section(string heading, List<DownloadRecord> rows, float y, string empty)
    {
        _list.Add(Ui.Text(heading, 153.6f, y + 8, 9.6f, 800, _t.InkMuted, 400, 14.4f, upper: true, spacing: 0.67f));
        y += 40;
        if (rows.Count == 0 && empty.Length > 0) { _list.Add(Ui.Text(empty, 153.6f, y + 8, 14, 400, _t.InkMuted, 900, 21)); return y + 56; }
        string? lastSeries = null; int? lastSeason = null;
        foreach (var r in rows)
        {
            if (r.SeriesTitle is { } s && s != lastSeries)
            {
                lastSeries = s; lastSeason = null;
                _list.Add(Ui.Text($"{s}", 153.6f, y + 12, 15, 700, _t.InkSoft, 900, 22));
                GroupButtons(y, 1766 - 24, s, rows.Where(x => x.SeriesTitle == s).ToList(), $"series {s}");
                y += 48;
            }
            if (r.SeriesTitle is not null && r.Season is { } sn && sn != lastSeason)
            {
                lastSeason = sn;
                _list.Add(Ui.Text($"Season {sn}", 173.6f, y + 8, 12, 700, _t.InkMuted, 400, 18));
                GroupButtons(y - 4, 1766 - 24, $"{r.SeriesTitle} season {sn}", rows.Where(x => x.SeriesTitle == r.SeriesTitle && x.Season == sn).ToList(), $"season {sn} of {r.SeriesTitle}", small: true);
                y += 40;
            }
            Row(r, y); y += RowH;
        }
        return y + 16;
    }

    private void Row(DownloadRecord r, float y)
    {
        var card = Ui.Box(153.6f, y, 1612.8f, RowH - 10, _t.SurfaceSoft, 16);
        var title = r.Season is { } se && r.Episode is { } ep ? $"Season {se}, episode {ep}  {r.Title}" : r.Title;
        card.Add(Ui.Text(title, 28, 12, 17.6f, 700, _t.Ink, 800, 26));
        var size = r.TotalBytes is { } tb ? $"{Bytes(r.BytesDownloaded)} of {Bytes(tb)}" : "unknown size";
        var line = $"{StatusText(r)}   {r.QualityLabel}   {(r.State == DownloadState.Ready ? Bytes(r.TotalBytes ?? r.BytesDownloaded) : size)}   {r.Keep.Label}";
        card.Add(Ui.Text(r.Error is { Length: > 0 } && r.State == DownloadState.Failed ? "Failed: " + r.Error : line, 28, 44, 12, 400, _t.InkMuted, 780, 18));
        if (r.State is DownloadState.Downloading or DownloadState.Paused or DownloadState.Processing or DownloadState.Queued)
        {
            card.Add(Ui.Box(28, 66, 760, 5, new Rgba(_t.Ink.R, _t.Ink.G, _t.Ink.B, 0.14f), 2.5f));
            card.Add(Ui.Box(28, 66, (float)(760 * r.Fraction), 5, _t.Brand, 2.5f));
        }
        var buttons = new List<(string Text, string Label, Action Do)>();
        var id = r.Id;
        switch (r.State)
        {
            case DownloadState.Downloading: case DownloadState.Queued: case DownloadState.Processing:
                buttons.Add(("Pause", "pause", () => { _env.Downloads.Pause(id); Build(); }));
                buttons.Add(("Cancel", "cancel", () => Remove(id)));
                break;
            case DownloadState.Paused:
                buttons.Add(("Resume", "resume", () => { _env.Downloads.Resume(id); Build(); }));
                buttons.Add(("Cancel", "cancel", () => Remove(id)));
                break;
            case DownloadState.Ready:
                buttons.Add(("Play", "play", () => _env.Navigate($"/player/{r.MediaFileId}?local={id}")));
                buttons.Add(("Edit", "edit", () => OpenEdit(r)));
                buttons.Add(("Delete", "delete", () => Remove(id)));
                break;
            default:
                if (r.State == DownloadState.Failed) buttons.Add(("Retry", "retry", () => { _env.Downloads.Resume(id); Build(); }));
                buttons.Add(("Delete", "delete", () => Remove(id)));
                break;
        }
        var x = 1612.8f - 24; var items = new List<(float X, float W, string Text, string Label, Action Do)>();
        foreach (var b in Enumerable.Reverse(buttons)) { var w = 28 + b.Text.Length * 8.2f; x -= w; items.Add((x, w, b.Text, b.Label, b.Do)); x -= 10; }
        foreach (var it in Enumerable.Reverse(items))
        {
            var bx = it.X; var by = 17f; var bw = it.W;
            var btn = Ui.Box(bx, by, bw, 48, _t.SurfaceStrong, 24);
            btn.BorderlineWidth = 1; btn.BorderlineColor = Ui.LineA(_t, 0.153f);
            btn.Add(Ui.Text(it.Text, 0, 15, 12, 700, _t.Ink, bw, 18, HorizontalAlignment.Center));
            var ring = Ring.Make(bw, 48, 24, new Rgba(1, 1, 1)); ring.Show(false); btn.Add(ring);
            card.Add(btn);
            var absY = y + by; var absX = 153.6f + bx;
            _focus.Items.Add(new Focusable { Rect = () => new Box(absX, absY, bw, 48), Label = $"{it.Label} {r.Title}".ToLowerInvariant() + (r.Episode is { } e ? $" {e}" : ""), Style = f => ring.Show(f), Select = it.Do });
        }
        _list.Add(card);
    }

    /// <summary>Pause or resume all, and delete all, for a series or season header (web: actions at every level).</summary>
    private void GroupButtons(float y, float right, string key, List<DownloadRecord> members, string label, bool small = false)
    {
        var ids = members.Select(m => m.Id).ToList();
        var running = members.Any(m => m.State is DownloadState.Downloading or DownloadState.Queued or DownloadState.Processing);
        var paused = members.Any(m => m.State is DownloadState.Paused);
        var items = new List<(string Text, string Label, Action Do)>();
        if (running) items.Add(("Pause all", $"pause {label}", () => { _env.Downloads.PauseMany(ids); Build(); }));
        else if (paused) items.Add(("Resume all", $"resume {label}", () => { _env.Downloads.ResumeMany(ids); Build(); }));
        items.Add(("Delete all", $"delete {label}", () => { _ = Task.Run(async () => { await _env.Downloads.RemoveManyAsync(ids); SynchronizationContextHolder.Post(() => Build()); }); }));
        var h = small ? 34f : 40f; var x = right;
        foreach (var it in Enumerable.Reverse(items))
        {
            var w = 24 + it.Text.Length * 7.4f; x -= w; var bx = x; var by = y;
            var btn = Ui.Box(bx, by, w, h, _t.SurfaceSoft, h / 2);
            btn.Add(Ui.Text(it.Text, 0, (h - 16) / 2, 11, 700, _t.Ink, w, 16, HorizontalAlignment.Center));
            var ring = Ring.Make(w, h, h / 2, new Rgba(1, 1, 1)); ring.Show(false); btn.Add(ring);
            _list.Add(btn);
            _focus.Items.Add(new Focusable { Rect = () => new Box(bx, by, w, h), Label = it.Label.ToLowerInvariant(), Style = f => ring.Show(f), Select = it.Do });
            x -= 10;
        }
    }

    private void Remove(string id)
    {
        _ = Task.Run(async () => { await _env.Downloads.RemoveAsync(id); SynchronizationContextHolder.Post(() => Build()); });
    }

    private void OpenEdit(DownloadRecord r)
    {
        if (_drawer is not null) return;
        // web #945: the quality section lists the server's options and is absent when they cannot be loaded (offline)
        _drawer = new DownloadDrawer(_env, r.Title, null, r.Keep, (_, keep, _) => { _env.Downloads.EditKeep(r.Id, keep); CloseDrawer(); Build(); }, CloseDrawer);
        _root.Add(_drawer.Root);
        if (!Guid.TryParse(r.MediaFileId, out var file)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                var (_, options) = await _env.DownloadsServer.OptionsAsync(file);
                if (options.Count == 0) return;
                SynchronizationContextHolder.Post(() =>
                {
                    if (_drawer is null) return;
                    CloseDrawer();
                    _drawer = new DownloadDrawer(_env, r.Title, options, r.Keep, (q, keep, _) => ConfirmEdit(r, file, q, keep), CloseDrawer, currentQualityId: r.QualityId);
                    _root.Add(_drawer.Root);
                });
            }
            catch (Exception e) { Dbg.Log("DOWNLOAD edit options failed: " + e.Message); }
        });
    }

    /// <summary>A new quality re-converts through a new ticket (a failed request leaves the current copy alone), then the old copy goes; the same quality only takes the keep-until.</summary>
    private void ConfirmEdit(DownloadRecord r, Guid file, DownloadQuality? q, KeepUntil keep)
    {
        CloseDrawer();
        if (q is null || q.Id == r.QualityId) { _env.Downloads.EditKeep(r.Id, keep); Build(); return; }
        var next = new DownloadRecord { WorkId = r.WorkId, MediaFileId = r.MediaFileId, Title = r.Title, Subtitle = r.Subtitle, SeriesTitle = r.SeriesTitle, Season = r.Season, Episode = r.Episode,
            QualityId = q.Id, QualityLabel = q.Label, Container = r.Container, TotalBytes = q.Estimate ? null : q.Bytes, RuntimeMs = r.RuntimeMs };
        _ = Task.Run(async () =>
        {
            try { await _env.Downloads.StartAsync(next, file, keep); await _env.Downloads.RemoveAsync(r.Id); }
            catch (Exception e) { Dbg.Log("DOWNLOAD quality change failed: " + e.Message); }
            SynchronizationContextHolder.Post(() => Build());
        });
    }

    private void CloseDrawer() { if (_drawer is null) return; _root.Remove(_drawer.Root); _drawer.Root.Dispose(); _drawer = null; }

    private void Scroll()
    {
        if (_focus.Item is null) return;
        var c = _focus.CurrentRect.CentreY - ViewTop;
        if (c + _scroll > ViewH - 120) _scroll = ViewH - 120 - c;
        if (c + _scroll < 120) _scroll = Math.Min(0, 120 - c);
        _list.PositionY = _scroll;
    }

    private static string StatusText(DownloadRecord r) => r.State switch
    {
        DownloadState.Queued => "Queued", DownloadState.Processing => "Preparing", DownloadState.Downloading => $"Downloading {(int)(r.Fraction * 100)}%",
        DownloadState.Paused => "Paused", DownloadState.Ready => "Downloaded", DownloadState.Failed => "Failed", DownloadState.Canceled => "Canceled", _ => "Expired",
    };

    public static string Bytes(long b) => b >= 1L << 30 ? $"{b / (double)(1L << 30):0.0} GB" : b >= 1L << 20 ? $"{b / (double)(1L << 20):0} MB" : $"{b / 1024.0:0} KB";

    public bool OnKey(RemoteKey key)
    {
        if (_drawer is not null) return _drawer.OnKey(key);
        switch (key)
        {
            case RemoteKey.Back: return false;
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            default:
                var moved = _focus.Move(key);
                if (moved) Scroll();
                return moved || key != RemoteKey.Left;
        }
    }
}
