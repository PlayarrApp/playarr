using System.Globalization;
using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Calendar (web /calendar): month grid, week columns or the agenda list, with the period navigation and the shell action tiles
/// (Calendar link, Filters). Measured at 1920x1080. The default view is the agenda, as web.
/// </summary>
internal sealed class CalendarScreen : IPage
{
    private const float GridX = 153.6f, HeadY = 174f, CellW = 237.6f, CellH = 151.3f, RowsY = 204.8f;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly CalendarView _view;
    private readonly View _root = new();
    private readonly View _body = new();
    private readonly View _scroller = new();
    private readonly FocusSet _focus = new();
    private readonly DateTime _today = DateTime.Now.Date;
    private DateTime _anchor;
    private TextLabel? _period;
    private FiltersDrawer? _drawer;
    private int _first;                // first focusable index of the entries
    private bool _loaded;
    private bool _monitoredOnly;
    private IList<CalendarEntry> _entries = new List<CalendarEntry>();
    private float _scrollY;
    private readonly View _panel = new();

    public bool IsReady => _loaded;
    public View Root => _root;
    public string Route => (_view == CalendarView.Agenda ? "/calendar" : $"/calendar?view={_view.ToString().ToLowerInvariant()}") + (_drawer is not null ? (_view == CalendarView.Agenda ? "?" : "&") + "panel=filters" : "");
    public string? FocusedLabel => _drawer?.FocusedLabel ?? _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public CalendarScreen(AppEnv env, CalendarView view)
    {
        _env = env; _t = env.Theme; _view = view;
        _anchor = view == CalendarView.Month ? new DateTime(_today.Year, _today.Month, 1) : view == CalendarView.Week ? CalendarRules.StartOfWeek(_today) : _today;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text("Calendar", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        _root.Add(_panel);
        _root.Add(_body);
        BuildNav();
        BuildTiles();
        _ = LoadAsync();
    }

    // ---- header and tiles ----

    private void BuildNav()
    {
        var wide = _view == CalendarView.Agenda ? 145f : _view == CalendarView.Week ? 113f : 107f;
        var x = 1613.1f - wide;
        _period = Ui.Text("", x, 70.2f, 14.72f, 700, _t.InkSoft, wide, 22.08f, HorizontalAlignment.Center);
        Pill(x, wide, "", () => { }, "period");
        _root.Add(_period);
        Pill(1628.5f, 50, "←", () => Step(-1), "previous");
        Pill(1693.8f, 84, "Today", () => { _anchor = _view == CalendarView.Month ? new DateTime(_today.Year, _today.Month, 1) : _view == CalendarView.Week ? CalendarRules.StartOfWeek(_today) : _today; _ = LoadAsync(); }, "today");
        Pill(1793.2f, 50, "→", () => Step(1), "next");
    }

    private void Pill(float x, float w, string text, Action select, string label)
    {
        var box = Ui.Box(x, 56.2f, w, 50, _t.Surface, 25);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.153f);
        if (text.Length > 0) box.Add(Ui.Text(text, 0, 14, 14.72f, 700, _t.InkSoft, w, 22.08f, HorizontalAlignment.Center));
        var ring = Ring.Make(w, 50, 25, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        _root.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 56.2f, w, 50), Label = label, Select = select, Style = f => ring.Show(f) });
    }

    private void BuildTiles()
    {
        Tile(151.2f, 62, 72, "Calendar link", "calendar", () => Toast("Calendar links are not available in this app yet."));
        Tile(236.1f, 62, 72, "Filters", "library", OpenDrawer);
        // web: Down from the period navigation lands on Filters, not on Calendar link
        _focus.Overrides[(2, RemoteKey.Down)] = 5;
        _focus.Overrides[(5, RemoteKey.Up)] = 2;
        _first = _focus.Items.Count;
    }

    private void Tile(float y, float w, float h, string text, string icon, Action select)
    {
        var tile = Ui.Box(1845.5f, y, w, h, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 14);
        tile.BorderlineWidth = 1; tile.BorderlineColor = Ui.LineA(_t, 0.075f);
        tile.Add(Ui.Icon(icon, 19, 15, 24, _t.InkMuted));
        tile.Add(Ui.Text(text, 0, 44.6f, 8.256f, 700, _t.InkMuted, w, 12.384f, HorizontalAlignment.Center, spacing: 0.165f));
        var ring = Ring.Make(w, h, 14, new Rgba(1, 1, 1)); ring.Show(false); tile.Add(ring);
        _root.Add(tile);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1845.5f, y, w, h), Label = text.ToLowerInvariant(), Select = select, Style = f => ring.Show(f) });
    }

    private void OpenDrawer()
    {
        var views = new[] { "Agenda", "Week", "Month" };
        var sections = new[]
        {
            new FilterSection("View", views, _view == CalendarView.Agenda ? 0 : _view == CalendarView.Week ? 1 : 2, i =>
                _env.Navigate(i == 0 ? "/calendar?panel=filters" : $"/calendar?view={views[i].ToLowerInvariant()}&panel=filters")),
            new FilterSection("Type", new[] { "Any type" }, 0, _ => { }, IsSelect: true),
            new FilterSection("Status", new[] { "Any status" }, 0, _ => { }, IsSelect: true),
            new FilterSection("Monitoring", new[] { "Monitored only" }, _monitoredOnly ? 1 : 0, v => { _monitoredOnly = v == 1; Render(); }, IsToggle: true),
        };
        _drawer = new FiltersDrawer(_env, "Calendar", sections, CloseDrawer, Toast);
        _root.Add(_drawer.Root);
    }

    private void CloseDrawer() { if (_drawer is null) return; _root.Remove(_drawer.Root); _drawer.Root.Dispose(); _drawer = null; }

    /// <summary>Opened from a route that carries panel=filters (the parity suite reaches the views through the drawer).</summary>
    public void OpenFiltersFromRoute() => OpenDrawer();

    private void Step(int dir) { _anchor = CalendarRules.Step(_view, _anchor, dir); _ = LoadAsync(); }

    // ---- data ----

    private async Task LoadAsync()
    {
        try
        {
            var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
            var resp = await _env.Api.GetCalendarAsync(start, end);
            SynchronizationContextHolder.Post(() => { _entries = resp.Entries; _loaded = true; Render(); });
        }
        catch (Exception e) { Dbg.Log("CAL load failed: " + e.Message); }
    }

    private IEnumerable<CalendarEntry> Visible => _monitoredOnly ? _entries.Where(e => e.Monitored) : _entries;

    private void Render()
    {
        foreach (var c in _body.Children.ToArray()) { _body.Remove(c); c.Dispose(); }
        _focus.Items.RemoveRange(_first, _focus.Items.Count - _first);
        var (start, end) = CalendarRules.VisibleRange(_view, _anchor);
        var gb = CultureInfo.GetCultureInfo("en-GB");
        if (_period is not null)
            _period.Text = _view == CalendarView.Month ? _anchor.ToString("MMM yyyy", gb)
                : _view == CalendarView.Week ? $"{start.Day} – {end.ToString("d MMM", gb)}" : $"{start.ToString("d MMM", gb)} – {end.ToString("d MMM", gb)}";
        switch (_view)
        {
            case CalendarView.Month: RenderMonth(start, end); break;
            case CalendarView.Week: RenderWeek(start); break;
            default: RenderAgenda(start); break;
        }
        // web rests focus on "Today" only in the agenda; month and week show no ring until a key is pressed
        if (_focus.Current < 0 && _view == CalendarView.Agenda) _focus.Set(2);
        if (_view == CalendarView.Agenda && Visible.OrderBy(CalendarRules.LocalDay).ThenBy(Order).FirstOrDefault() is { } first) ShowEntry(first);
    }

    // ---- month ----

    private void RenderMonth(DateTime start, DateTime end)
    {
        var days = new[] { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };
        for (var i = 0; i < 7; i++) _body.Add(Ui.Text(days[i], GridX + i * CellW, HeadY + 6, 12f, 400, _t.InkMuted, CellW, 18f, upper: true, spacing: 0.96f));
        var byDay = Visible.GroupBy(CalendarRules.LocalDay).ToDictionary(g => g.Key, g => g.OrderBy(Order).ToList());
        var rows = (int)Math.Ceiling(((end - start).TotalDays + 1) / 7);
        for (var r = 0; r < rows; r++)
            for (var c = 0; c < 7; c++)
            {
                var day = start.AddDays(r * 7 + c); var x = GridX + c * CellW; var y = RowsY + r * CellH;
                var outside = day.Month != _anchor.Month;
                var cell = Ui.Box(x, y, CellW, CellH, new Rgba(_t.SurfaceSoft.R, _t.SurfaceSoft.G, _t.SurfaceSoft.B, outside ? 0.35f : 0.7f), 0);
                cell.BorderlineWidth = 1; cell.BorderlineColor = Ui.C(_t.Line);
                _body.Add(cell);
                var list = byDay.TryGetValue(day, out var l) ? l : new List<CalendarEntry>();
                var shown = Math.Min(4, list.Count);
                for (var k = 0; k < shown; k++)
                {
                    var e = list[k];
                    var dot = ToneColor(CalendarRules.Tone(e, _today));
                    var ly = 7 + k * 25.4f;
                    cell.Add(Ui.Box(11.4f, ly + 7, 8.8f, 8.8f, dot, 4.4f));
                    var multi = e.Members is { Count: > 1 } m ? $" · {m.Count}×" : "";
                    cell.Add(Ui.Text(e.Title + multi, 27.4f, ly, 12.48f, multi.Length > 0 ? 700 : 400, _t.Ink, CellW - 36, 14.976f));
                }
                cell.Add(Ui.Text(day.Day.ToString(), 11.8f, CellH - 33, 12.8f, 700, day == _today ? _t.Brand : outside ? _t.InkMuted : _t.Ink, 30, 19.2f));
                if (list.Count > shown) cell.Add(Ui.Text($"+{list.Count - shown} more", 43, CellH - 33, 12.48f, 400, _t.InkSoft, 90, 18.72f));
                var cx = x; var cy = y; var d = day;
                _focus.Items.Add(new Focusable { Rect = () => new Box(cx, cy, CellW, CellH), Label = "day " + d.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB")).ToLowerInvariant(), Style = f => { cell.BorderlineWidth = f ? 3 : 1; cell.BorderlineColor = f ? (_t.Name == "light" ? Ui.C(_t.Ink) : new Color(1, 1, 1, 0.9f)) : Ui.C(_t.Line); } });
            }
    }

    // web .status-pill: available = --success, upcoming = --brand, missing = --danger (the dark and light values differ), otherwise the soft ink
    private Rgba ToneColor(CalendarTone tone)
    {
        var dark = _t.Name == "dark";
        return tone switch
        {
            CalendarTone.Available => dark ? new Rgba(0.541f, 0.773f, 0.647f) : new Rgba(0.133f, 0.298f, 0.227f),
            CalendarTone.Missing => dark ? new Rgba(0.945f, 0.643f, 0.659f) : new Rgba(0.447f, 0.184f, 0.204f),
            CalendarTone.Upcoming => _t.Brand,
            _ => _t.InkSoft,
        };
    }

    private static (int, string) Order(CalendarEntry e) => (CalendarRules.ReleaseInstant(e) is { } at ? (int)at.ToLocalTime().TimeOfDay.TotalMinutes + 1 : 0, e.Title);

    // ---- week (columns) and agenda (one column) ----

    private void RenderWeek(DateTime start)
    {
        var byDay = Visible.GroupBy(CalendarRules.LocalDay).ToDictionary(g => g.Key, g => g.OrderBy(Order).ToList());
        var clip = new View { PositionX = 153.6f, Size = new Size(1700, 1080), ClippingMode = ClippingModeType.ClipChildren };
        _body.Add(clip);
        for (var i = 0; i < 7; i++)
        {
            var day = start.AddDays(i); var x = i * 460f;
            var head = day.ToString("dddd d MMMM", CultureInfo.GetCultureInfo("en-GB"));
            clip.Add(Ui.Text(head, x, 174, 18.4f, 640, day == _today ? _t.Accent : _t.Ink, 440, 27.6f));
            if (day == _today) { var holder = new View { PositionX = x, PositionY = 174 - 8.2f }; clip.Add(holder); TodayTag(holder, Ui.TextWidth(head, 18.4f, 640, 0) + 12, 11 + 0.2f); }
            var y = 208f;
            foreach (var e in byDay.TryGetValue(day, out var l) ? l : new List<CalendarEntry>())
                y += EntryCard(clip, e, x, y, 440, 153.6f + x) + 13.6f;
        }
    }

    /// <summary>web .calendar-today-tag: the day heading's colour as a 1 px outline, no fill, small upper-case text.</summary>
    private void TodayTag(View parent, float x, float y)
    {
        var tag = Ui.Box(x, y, 60.5f, 22, new Rgba(0, 0, 0, 0), 11);
        tag.BorderlineWidth = 1; tag.BorderlineColor = Ui.C(_t.Accent);
        tag.Add(Ui.Text("Today", 0, 2.6f, 11.2f, 700, _t.Accent, 60.5f, 16.8f, HorizontalAlignment.Center, upper: true, spacing: 0.9f));
        parent.Add(tag);
    }

    private void RenderAgenda(DateTime start)
    {
        var byDay = Visible.GroupBy(CalendarRules.LocalDay).OrderBy(g => g.Key).ToList();
        var clip = new View { PositionX = 783.4f, Size = new Size(1100, 1080), ClippingMode = ClippingModeType.ClipChildren };
        _body.Add(clip);
        var y = 162f;
        foreach (var g in byDay)
        {
            var band = Ui.Box(0, y, 1033.4f, 44, _t.Bg, 0);
            var head = g.Key.ToString("dddd d MMMM", CultureInfo.GetCultureInfo("en-GB"));
            band.Add(Ui.Text(head, 0, 8.2f, 18.4f, 640, g.Key == _today ? _t.Accent : _t.Ink, 400, 27.6f));
            if (g.Key == _today) TodayTag(band, Ui.TextWidth(head, 18.4f, 640, 0) + 12, 11);
            clip.Add(band);
            y += 76f;
            foreach (var e in g.OrderBy(Order)) y += EntryCard(clip, e, 0, y, 1033.4f, 783.4f) + 13.6f;
            y += 20f;
        }
    }

    /// <summary>One entry card (web .media-card-solid in the calendar); returns its height.</summary>
    private float EntryCard(View parent, CalendarEntry e, float x, float y, float w, float screenX)
    {
        var members = e.Members is { Count: > 1 } ? e.Members : null;
        var sub = members is not null
            ? $"{members.Count} episodes · " + string.Join(", ", members.Select(m => CalendarRules.EpisodeCode(m.SeasonNumber, m.EpisodeNumber)))
            : string.Join(" · ", new[] { CalendarRules.EpisodeCode(e.SeasonNumber, e.EpisodeNumber), e.Subtitle }.Where(s => !string.IsNullOrEmpty(s)));
        var textW = w - 70.4f - 16f;
        var h = 106.9f + (sub.Length * 9.6f > textW ? 28.8f : 0) - (sub.Length == 0 ? 28.5f : 0); // web: an entry without a subtitle line is 28.5 px shorter
        // web .calendar-entry: --surface-strong with a 4 px left border (--success when available, else --ink-muted); the border colour is the card, the surface sits 4 px in
        var card = Ui.Box(x, y, w, h, CalendarRules.Tone(e, _today) == CalendarTone.Available ? ToneColor(CalendarTone.Available) : _t.InkMuted, 12);
        var surface = Ui.Box(4, 0, w - 4, h, _t.SurfaceStrong, 12); surface.BorderlineWidth = 1; surface.BorderlineColor = Ui.C(_t.Line);
        card.Add(surface);
        var poster = Ui.Box(16, 23.5f + (h - 106.9f) / 2, 40, 60, _t.SurfaceSoft, 6);
        poster.ClippingMode = ClippingModeType.ClipChildren;
        if (e.PosterUrl is { Length: > 0 } pu) _ = LoadPoster(poster, pu);
        card.Add(poster);
        card.Add(Ui.Text(e.Title, 70.4f, 9, 19.2f, 640, _t.Ink, textW, 28.8f));
        if (sub.Length > 0) card.Add(Ui.Text(sub, 70.4f, 40.2f, 19.2f, 400, _t.InkSoft, textW, 28.8f, multiline: sub.Length * 9.6f > textW, maxLines: 2));
        var my = h - 106.9f + 71.4f;
        var instant = CalendarRules.ReleaseInstant(e);
        var parts = new List<string> { instant is { } at ? at.ToLocalTime().ToString("HH:mm") : "All day", e.ReleaseType is "digital" ? "Digital release" : "Airs", e.MediaKind == "movie" ? "Movies" : "Episodes" };
        card.Add(Ui.Text(string.Join("    ", parts), 70.4f, my, 12.8f, 400, _t.InkMuted, 260, 26.6f));
        var tone = CalendarRules.Tone(e, _today);
        var label = tone switch { CalendarTone.Available => "Available", CalendarTone.Upcoming => "Upcoming", CalendarTone.Missing => "Missing", _ => "Not tracked" };
        var pw = Ui.TextWidth(label, 13.44f, 800, 0) + 17;
        var pill = Ui.Box(70.4f + Ui.TextWidth(string.Join("    ", parts), 12.8f, 400, 0) + 12, my, pw, 26.6f, new Rgba(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.14f), 13.3f);
        pill.BorderlineWidth = 1; pill.BorderlineColor = new Color(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.6f);
        pill.Add(Ui.Text(label, 0, 4, 13.44f, 800, _t.Ink, pw, 18.8f, HorizontalAlignment.Center));
        card.Add(pill);
        var ring = Ring.Make(w, h, 12, new Rgba(1, 1, 1)); ring.Show(false); card.Add(ring);
        parent.Add(card);
        var ty = y;
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(screenX, ty - _scrollY, w, h), Label = e.Title.ToLowerInvariant(), Style = f => ring.Show(f),
            Focused = () => { if (_view == CalendarView.Agenda) ShowEntry(e); },
            Select = () => { if (e.WorkId is { } wid) _env.Navigate(HomeScreen.DetailRoute(new WorkCard(wid, e.MediaKind == "movie" ? WorkKind.Movie : WorkKind.Series, e.Title, "", "", "", null, null, null, 0, false))); },
        });
        return h;
    }

    /// <summary>Agenda: the left panel describes the focused entry (web .details-panel.is-stage).</summary>
    private void ShowEntry(CalendarEntry e)
    {
        foreach (var c in _panel.Children.ToArray()) { _panel.Remove(c); c.Dispose(); }
        var tone = CalendarRules.Tone(e, _today);
        _panel.Add(Ui.Text($"{(e.MediaKind == "movie" ? "Movies" : "Episodes")} \u00b7 {(e.ReleaseType is "digital" ? "Digital release" : "Airs")}", 153.6f, 263.2f, 12.288f, 800, _t.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f));
        var lines = Ui.Paragraph(_panel, e.Title, 153.6f, 291.5f, 69.12f, 600, _t.Ink, 369, 62.208f, -4.98f, 5);
        var my = 291.5f + 62.208f * lines + 22.6f;
        var code = CalendarRules.EpisodeCode(e.SeasonNumber, e.EpisodeNumber);
        var day = CalendarRules.LocalDay(e).ToString("dddd d MMMM", CultureInfo.GetCultureInfo("en-GB")) + (CalendarRules.ReleaseInstant(e) is { } when ? " \u00b7 " + when.ToLocalTime().ToString("HH:mm") : " \u00b7 All day"); // web: day, then the time or All day
        _panel.Add(Ui.Text(string.Join("     ", new[] { code.Length > 0 ? code + (e.Subtitle is { Length: > 0 } ? " \u00b7 " + e.Subtitle : "") : null, day }.Where(x => x is not null)!), 153.6f, my, 13.056f, 600, _t.InkSoft, 700, 19.584f));
        var label = tone switch { CalendarTone.Available => "Available", CalendarTone.Upcoming => "Upcoming", CalendarTone.Missing => "Missing", _ => "Not tracked" };
        var pw = Ui.TextWidth(label, 13.44f, 800, 0) + 17;
        var pill = Ui.Box(153.6f, my + 36.9f, pw, 26.6f, new Rgba(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.14f), 13.3f);
        pill.BorderlineWidth = 1; pill.BorderlineColor = new Color(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.6f);
        pill.Add(Ui.Text(label, 0, 4, 13.44f, 800, _t.Ink, pw, 18.8f, HorizontalAlignment.Center));
        _panel.Add(pill);
        Ui.Paragraph(_panel, e.Overview ?? "", 153.6f, my + 85f, 13.824f, 600, _t.InkSoft, 336, 21.842f, 0, 5);
        var by = my + 218f;
        var open = Ui.Box(153.6f, by, 124, 58, _t.Ink, 29);
        open.Add(Ui.Text("Open series", 0, 18, 14.72f, 700, _t.OnAccent, 124, 22.08f, HorizontalAlignment.Center));
        _panel.Add(open);
        var wl = Ui.Box(287.2f, by, 177.6f, 58, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 29);
        wl.BorderlineWidth = 1; wl.BorderlineColor = Ui.LineA(_t, 0.153f);
        wl.Add(Ui.Text("+", 21, 18, 14.72f, 700, _t.InkSoft, 14, 22.08f));
        wl.Add(Ui.Text("Add to watchlist", 39.6f, 18, 14.72f, 800, _t.Ink, 130, 22.08f));
        _panel.Add(wl);
    }

    /// <summary>web sizedPosterUrl: a TMDB original becomes a tile-sized w185 (calendar months show over a hundred posters).</summary>
    private static string SizedPosterUrl(string url, int width = 185) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Host == "image.tmdb.org" && u.AbsolutePath.StartsWith("/t/p/original/")
            ? new UriBuilder(u) { Path = $"/t/p/w{width}/" + u.AbsolutePath["/t/p/original/".Length..] }.Uri.ToString() : url;

    private async Task LoadPoster(View poster, string url)
    {
        if (url.StartsWith('/')) { _env.Images.Apply(poster, url, 40, 60); return; }
        var sized = SizedPosterUrl(url);
        SynchronizationContextHolder.Post(() => poster.Add(new ImageView(sized) { Size = new Size(40, 60) }));
        await Task.CompletedTask;
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
        if (_drawer is not null) return _drawer.OnKey(key);
        switch (key)
        {
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            case RemoteKey.Back: return false;
            default:
                if (_focus.Current < 0) _focus.Set(2); // starts on "Today" like web; the key then moves from there as before
                return _focus.Move(key) || key != RemoteKey.Left;
        }
    }
}
