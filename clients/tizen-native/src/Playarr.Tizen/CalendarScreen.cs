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
    private const float WeekClipX = 153.6f, WeekClipY = 160f, WeekClipW = 1660f, WeekClipH = 880f;
    private const float WeekColumnW = 440f, WeekColumnClipPad = 5f, WeekColumnWClip = 450f, WeekColumnPitch = 460f;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly CalendarView _view;
    private readonly View _root = new();
    private readonly View _body = new();
    private readonly View _scroller = new();
    private readonly FocusSet _focus = new();
    private readonly DateTime _today;
    private DateTime _anchor;
    private TextLabel? _period; private View? _periodBox;
    private FiltersDrawer? _drawer;
    private CalendarLinkDrawer? _linkDrawer;
    private int _first;                // first focusable index of the entries
    private bool _loaded;
    private bool _monitoredOnly;
    private IList<CalendarEntry> _entries = new List<CalendarEntry>();
    private float _scrollY;
    private readonly View _panel = new();
    private readonly List<Focusable> _panelItems = new(); // the agenda panel's two buttons belong to the focused entry and follow it
    private readonly KeyArt _keyArt;
    private View? _weekTrack;
    private readonly View?[] _weekContents = new View?[7];
    private readonly float[] _weekContentHeights = new float[7];
    private float _weekXScroll;
    private readonly float[] _weekYScroll = new float[7];

    public bool IsReady => _loaded;
    public View Root => _root;
    public string Route => (_view == CalendarView.Agenda ? "/calendar" : $"/calendar?view={_view.ToString().ToLowerInvariant()}") + (_drawer is not null ? (_view == CalendarView.Agenda ? "?" : "&") + "panel=filters" : _linkDrawer is not null ? (_view == CalendarView.Agenda ? "?" : "&") + "panel=link" : "");
    public string? FocusedLabel => _drawer?.FocusedLabel ?? _linkDrawer?.FocusedLabel ?? _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public CalendarScreen(AppEnv env, CalendarView view)
    {
        _env = env; _t = env.Theme; _view = view; _today = env.ClockNow().Date; _keyArt = new KeyArt(env, armed: true);
        _anchor = view == CalendarView.Month ? new DateTime(_today.Year, _today.Month, 1) : view == CalendarView.Week ? CalendarRules.StartOfWeek(_today) : _today;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        if (view == CalendarView.Agenda) _root.Add(Ui.Box(0, 0, TizenClient.DesignWidth, TizenClient.DesignHeight, _t.Surface)); // web: the agenda page has a section and a stage layer
        
        if (view == CalendarView.Agenda) { _root.Add(_keyArt.Root); _root.Add(Ui.PanelWash(_t, 1248)); } // web: the focused entry's backdrop under the agenda panel's frost
        _root.Add(Ui.Heading("Calendar", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        _root.Add(_panel);
        _root.Add(_body);
        BuildNav();
        BuildTiles();
        _ = LoadAsync();
    }

    // ---- header and tiles ----

    private void BuildNav()
    {
        var wide = _view == CalendarView.Agenda ? 133f : _view == CalendarView.Week ? 110.7f : 104.1f; // the label's width plus 40.5 px, right edge fixed
        var x = 1613.1f - wide;
        _period = Ui.Text("", 0, 14, 14.72f, 700, _t.InkSoft, wide, 22.08f, HorizontalAlignment.Center);
        _periodBox = Pill(x, wide, "", () => { }, "period"); _periodBox.Add(_period);
        Pill(1628.5f, 50, "←", () => Step(-1), "previous");
        Pill(1693.8f, 84, "Today", () => { _anchor = _view == CalendarView.Month ? new DateTime(_today.Year, _today.Month, 1) : _view == CalendarView.Week ? CalendarRules.StartOfWeek(_today) : _today; _ = LoadAsync(); }, "today");
        Pill(1793.2f, 50, "→", () => Step(1), "next");
    }

    private View Pill(float x, float w, string text, Action select, string label)
    {
        var box = Ui.Box(x, 56.2f, w, 50, _t.Surface, 25);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.153f);
        if (text.Length > 0) box.Add(Ui.Text(text, 0, 14, 14.72f, 700, _t.InkSoft, w, 22.08f, HorizontalAlignment.Center));
        if (label == "previous") Sem.Tag(box, "button", "Previous"); else if (label == "next") Sem.Tag(box, "button", "Next"); else if (label == "today") Sem.Tag(box, "button", "Today");
        var ring = Ring.Make(w, 50, 25, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        _root.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 56.2f, w, 50), Label = label, Select = select, Style = f => ring.Show(f) });
        return box;
    }

    private void BuildTiles()
    {
        Tile(151.2f, 62, 72, "Calendar link", "bell", OpenLinkDrawer);
        Tile(236.1f, 62, 72, "Filters", "filters", OpenDrawer);
        // web: Down from the period navigation lands on Filters, not on Calendar link
        _focus.Overrides[(2, RemoteKey.Down)] = 5;
        _focus.Overrides[(5, RemoteKey.Up)] = 2;
        _focus.Items.Add(new BackControl(_env, _t, _root, "link", "Back to home").Item); // after the tiles, so the pill and tile indices above stay fixed
        _first = _focus.Items.Count;
    }

    private void Tile(float y, float w, float h, string text, string icon, Action select)
    {
        var tile = Ui.Box(1845.5f, y, w, h, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 14);
        tile.BorderlineWidth = 1; tile.BorderlineColor = Ui.LineA(_t, 0.075f);
        Sem.Tag(tile, "button", text);
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

    private void OpenLinkDrawer()
    {
        var feed = _env.Abs("/api/v1/calendar/feed.ics?token=parity"); // the real token comes from the server's subscription endpoint; the text is volatile
        _linkDrawer = new CalendarLinkDrawer(_env, feed, CloseLinkDrawer, Toast);
        _root.Add(_linkDrawer.Root);
    }

    public void OpenLinkFromRoute() => OpenLinkDrawer();

    private void CloseLinkDrawer() { if (_linkDrawer is null) return; _root.Remove(_linkDrawer.Root); _linkDrawer.Root.Dispose(); _linkDrawer = null; }

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
        if (_period is not null && _periodBox is not null) Sem.Tag(_periodBox, "button", _period.Text); // the pill is the button; its name is the period it shows
        var statusText = _view == CalendarView.Month ? _anchor.ToString("MMMM yyyy", gb) : _view == CalendarView.Week ? $"{start.ToString("d MMM", gb)} – {end.ToString("d MMM yyyy", gb)}" : $"{start.ToString("d MMM", gb)} – {end.ToString("d MMM yyyy", gb)}";
        _body.Add(Sem.Tag(new View { PositionX = _view == CalendarView.Agenda ? 0 : 153.6f, PositionY = _view == CalendarView.Agenda ? 1 : 163 }, "status", statusText)); // web: visually hidden period text
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
        for (var i = 0; i < 7; i++) _body.Add(Ui.Text(days[i], GridX + i * CellW, HeadY + 6, 12f, 400, _t.InkMuted, CellW, 18f, HorizontalAlignment.Center, upper: true, spacing: 0.96f));
        var byDay = Visible.GroupBy(CalendarRules.LocalDay).ToDictionary(g => g.Key, g => g.OrderBy(Order).ToList());
        var rows = (int)Math.Ceiling(((end - start).TotalDays + 1) / 7);
        for (var r = 0; r < rows; r++)
            for (var c = 0; c < 7; c++)
            {
                var day = start.AddDays(r * 7 + c); var x = GridX + c * CellW; var y = RowsY + r * CellH;
                var outside = day.Month != _anchor.Month;
                var cell = Ui.Box(x, y, CellW, CellH, new Rgba(_t.SurfaceSoft.R, _t.SurfaceSoft.G, _t.SurfaceSoft.B, outside ? 0.35f : 0f), 0);
                cell.BorderlineWidth = 1; cell.BorderlineColor = Ui.C(_t.Line);
                Sem.Tag(cell, "container"); // web: only the days outside the month carry a fill; every day has the hairline border
                _body.Add(cell);
                var list = byDay.TryGetValue(day, out var l) ? l : new List<CalendarEntry>();
                var shown = Math.Min(4, list.Count);
                for (var k = 0; k < shown; k++)
                {
                    var e = list[k];
                    var dot = ToneColor(CalendarRules.Tone(e, _today));
                    var ly = 15.3f + k * 25.4f;
                    var row = new View { PositionX = 5.8f, PositionY = 1.8f + k * 25.4f, Size = new Size(226, 44) }; // the event row (dot and title); the day cell is the focus target
                    row.Add(Ui.Box(5.6f, ly + 4.1f - row.PositionY, 8.8f, 8.8f, dot, 4.4f));
                    var multi = e.Members is { Count: > 1 } m ? $" · {m.Count}×" : "";
                    row.Add(Ui.Text(e.Title + multi, 21.6f, ly - row.PositionY, 12.48f, multi.Length > 0 ? 700 : 400, _t.Ink, CellW - 36, 14.976f));
                    cell.Add(row);
                }
                cell.Add(Ui.Text(day.Day.ToString(), 8.8f, CellH - 33, 12.8f, 640, day == _today ? _t.Ink : outside ? _t.InkMuted : _t.Ink, 30, 19.2f));
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
        _weekXScroll = 0;
        Array.Clear(_weekYScroll, 0, _weekYScroll.Length);
        _weekTrack = new View { PositionX = WeekColumnClipPad, Size = new Size(WeekClipW, WeekClipH) };
        var clip = new View
        {
            PositionX = WeekClipX - WeekColumnClipPad, PositionY = WeekClipY,
            Size = new Size(WeekClipW + WeekColumnClipPad, WeekClipH), ClippingMode = ClippingModeType.ClipChildren,
        };
        clip.Add(_weekTrack);
        _body.Add(clip);
        for (var i = 0; i < 7; i++)
        {
            var day = start.AddDays(i); var x = i * WeekColumnPitch;
            var column = new View
            {
                PositionX = x - WeekColumnClipPad, Size = new Size(WeekColumnWClip, WeekClipH),
                ClippingMode = ClippingModeType.ClipChildren,
            };
            var content = new View();
            column.Add(content);
            _weekTrack.Add(column);
            _weekContents[i] = content;
            var head = day.ToString("dddd d MMMM", CultureInfo.GetCultureInfo("en-GB"));
            content.PositionX = WeekColumnClipPad;
            content.Add(Ui.Text(head, 0, 14, 18.4f, 640, day == _today ? _t.Accent : _t.Ink, WeekColumnW, 27.6f));
            if (day == _today)
            {
                var holder = new View { PositionX = 0, PositionY = 5.8f };
                content.Add(holder);
                TodayTag(holder, Ui.TextWidth(head, 18.4f, 640, 0) + 9.42f, 11.2f);
            }
            var headingRing = Ring.Make(WeekColumnW, 34, 0, new Rgba(1, 1, 1));
            headingRing.PositionY = 3;
            headingRing.Show(false);
            content.Add(headingRing);
            var dayIndex = i;
            _focus.Items.Add(new Focusable
            {
                Rect = () => WeekRect(dayIndex, 8, WeekColumnW, 34),
                Label = "day " + day.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB")).ToLowerInvariant(),
                Style = focused => headingRing.Show(focused),
                Focused = () => RevealWeekItem(dayIndex, 8, WeekColumnW, 34),
            });
            var y = 48f;
            if (!byDay.ContainsKey(day) || byDay[day].Count == 0) content.Add(Ui.Text("Nothing scheduled", 0, 47.6f, 19.2f, 400, _t.InkMuted, WeekColumnW, 28.8f)); // web: an empty day says so
            foreach (var e in byDay.TryGetValue(day, out var l) ? l : new List<CalendarEntry>())
            {
                var cardY = y;
                var cardHeight = 0f;
                cardHeight = EntryCard(content, e, 0, cardY, WeekColumnW, WeekClipX + x,
                    () => WeekRect(dayIndex, cardY, WeekColumnW, cardHeight),
                    () => RevealWeekItem(dayIndex, cardY, WeekColumnW, cardHeight));
                y += cardHeight + 13.6f;
            }
            _weekContentHeights[i] = Math.Max(WeekClipH, y);
        }
    }

    private Box WeekRect(int dayIndex, float y, float width, float height) =>
        new(WeekClipX + dayIndex * WeekColumnPitch - _weekXScroll, WeekClipY + y - _weekYScroll[dayIndex], width, height);

    private void RevealWeekItem(int dayIndex, float y, float width, float height)
    {
        _weekXScroll = CalendarScroll.EnsureVisible(_weekXScroll, WeekClipW,
            7 * WeekColumnPitch - (WeekColumnPitch - WeekColumnW) + WeekColumnClipPad, dayIndex * WeekColumnPitch,
            width, 20);
        _weekTrack!.PositionX = WeekColumnClipPad - _weekXScroll;
        _weekYScroll[dayIndex] = CalendarScroll.EnsureVisible(_weekYScroll[dayIndex], WeekClipH,
            _weekContentHeights[dayIndex], y, height, 16);
        _weekContents[dayIndex]!.PositionY = -_weekYScroll[dayIndex];
    }

    /// <summary>web .calendar-today-tag: the day heading's colour as a 1 px outline, no fill, small upper-case text.</summary>
    private void TodayTag(View parent, float x, float y)
    {
        var tag = Ui.Box(x, y, 60.5f, 22, new Rgba(0, 0, 0, 0), 11);
        tag.BorderlineWidth = 1; tag.BorderlineColor = Ui.C(_t.Accent);
        Sem.Tag(tag, "none");
        tag.Add(Sem.Tag(Ui.Text("Today", 0, 1.7f, 11.2f, 640, _t.Accent, 60.5f, 16.8f, HorizontalAlignment.Center, upper: true, spacing: 0.9f), "text"));
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
            var band = Ui.Box(0, y, 1033.4f, 44, _t.Name == "dark" ? _t.Bg : _t.Surface, 0); // web --agenda-heading-base: --bg dark, --surface light
            Sem.Tag(band, "heading");
            var head = g.Key.ToString("dddd d MMMM", CultureInfo.GetCultureInfo("en-GB"));
            band.Add(Ui.Text(head, 0, 8.2f, 18.4f, 640, g.Key == _today ? _t.Accent : _t.Ink, 400, 27.6f));
            if (g.Key == _today) TodayTag(band, Ui.TextWidth(head, 18.4f, 640, 0) + 9.42f, 11);
            clip.Add(band);
            y += 76f;
            foreach (var e in g.OrderBy(Order)) y += EntryCard(clip, e, 0, y, 1033.4f, 783.4f) + 13.6f;
            y += 18.5f; // web agenda pitch: 215 px per entry with a subtitle line
        }
    }

    /// <summary>One entry card (web .media-card-solid in the calendar); returns its height.</summary>
    private float EntryCard(View parent, CalendarEntry e, float x, float y, float w, float screenX, Func<Box>? focusRect = null, Action? onFocused = null)
    {
        var members = e.Members is { Count: > 1 } ? e.Members : null;
        var sub = members is not null
            ? $"{members.Count} episodes · " + string.Join(", ", members.Select(m => CalendarRules.EpisodeCode(m.SeasonNumber, m.EpisodeNumber)))
            : string.Join(" · ", new[] { CalendarRules.EpisodeCode(e.SeasonNumber, e.EpisodeNumber), e.Subtitle }.Where(s => !string.IsNullOrEmpty(s)));
        var textW = w - 70.4f - 16f;
        var h = 106.9f + (sub.Length * 9.6f > textW ? 28.8f : 0) - (sub.Length == 0 ? 29f : 0); // web: an entry without a subtitle line is 29 px shorter
        // web .calendar-entry: --surface-strong with a 4 px left border (--success when available, else --ink-muted); the border colour is the card, the surface sits 4 px in
        var card = Ui.Box(x, y, w, h, _t.SurfaceStrong, 12);
        card.BorderlineWidth = 1; card.BorderlineColor = Ui.C(_t.LineStrong); // web --line-strong
        card.ClippingMode = ClippingModeType.ClipChildren;
        card.Add(Ui.Box(0, 0, 4, h, CalendarRules.Tone(e, _today) == CalendarTone.Available ? ToneColor(CalendarTone.Available) : _t.InkMuted, 0)); // the 4 px left border
        var poster = Ui.Box(16, 23.5f + (h - 106.9f) / 2, 40, 60, _t.SurfaceSoft, 6);
        poster.ClippingMode = ClippingModeType.ClipChildren;
        Sem.Tag(poster, "none");
        // A poster URL on the server's own loopback (the seeded static server) is unreachable from the TV: ask the server's artwork route instead.
        if (e.PosterUrl is { Length: > 0 } pu) LoadPoster(poster, e.WorkId is { } posterWork && Uri.TryCreate(pu, UriKind.Absolute, out var posterUri) && posterUri.IsLoopback ? $"/api/v1/artwork/work/{posterWork:D}/poster?w=185" : pu);
        card.Add(poster);
        card.Add(Ui.Text(e.Title, 70.4f, sub.Length == 0 ? 9.72f : 9, 19.2f, 640, _t.Ink, textW, 28.8f));
        if (sub.Length > 0) card.Add(Ui.Text(sub, 70.4f, 40.2f, 19.2f, 400, _t.InkSoft, textW, 28.8f, multiline: sub.Length * 9.6f > textW, maxLines: 2));
        var my = h - 106.9f + 71.4f - (sub.Length == 0 ? 0.61f : 0); // one-line entries: web meta row 0.6 px higher than the bottom-anchored position
        var instant = CalendarRules.ReleaseInstant(e);
        var parts = new List<string> { instant is { } at ? at.ToLocalTime().ToString("HH:mm") : "All day", e.ReleaseType is "digital" ? "Digital release" : "Airs", e.MediaKind == "movie" ? "Movies" : "Episodes" };
        // web .calendar-entry-meta: one span per part, 12 px apart (a run of spaces would drift from the span edges)
        var mx = 70.4f;
        foreach (var part in parts) { var partW = Ui.TextWidth(part, 12.8f, 400, 0); card.Add(Ui.Text(part, mx, my, 12.8f, 400, _t.InkMuted, partW + 4, 19.2f)); mx += partW + 12; }
        var tone = CalendarRules.Tone(e, _today);
        var label = tone switch { CalendarTone.Available => "Available", CalendarTone.Upcoming => "Upcoming", CalendarTone.Missing => "Missing", _ => "Not tracked" };
        var pw = Ui.TextWidth(label, 13.44f, 750, 0) + 22.8f; // web .status-pill: 0.65rem padding and a 1 px border each side
        var pill = Ui.Box(mx, sub.Length == 0 ? my - 0.46f : my, pw, 26.6f, new Rgba(ToneColor(tone).R * 0.14f + _t.Surface.R * 0.86f, ToneColor(tone).G * 0.14f + _t.Surface.G * 0.86f, ToneColor(tone).B * 0.14f + _t.Surface.B * 0.86f), 13.3f); // web color-mix(tone 14 %, --surface)
        pill.BorderlineWidth = 1; pill.BorderlineColor = new Color(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.6f);
        pill.Add(Sem.Tag(Ui.Text(label, 0, 2.95f, 13.44f, 750, _t.Ink, pw, 18.8f, HorizontalAlignment.Center), "text"));
        Sem.Tag(pill, "none");
        card.Add(pill);
        // web: the whole entry is one button named by its text parts; its children sit on the surface
        Sem.Tag(card, "button", string.Join(" ", new[] { e.Title, sub }.Concat(parts).Append(label).Where(t => t.Length > 0)));
        var ring = Ring.Make(w, h, 12, new Rgba(1, 1, 1)); ring.Show(false); card.Add(ring);
        parent.Add(card);
        var ty = y;
        _focus.Items.Add(new Focusable
        {
            Rect = focusRect ?? (() => new Box(screenX, ty - _scrollY, w, h)), Label = e.Title.ToLowerInvariant(), Style = f => ring.Show(f),
            Focused = onFocused ?? (() => { if (_view == CalendarView.Agenda) ShowEntry(e); }),
            Select = () => { if (e.WorkId is { } wid) _env.Navigate(HomeScreen.DetailRoute(new WorkCard(wid, e.MediaKind == "movie" ? WorkKind.Movie : WorkKind.Series, e.Title, "", "", "", null, null, null, 0, false))); },
        });
        return h;
    }

    /// <summary>Agenda: the left panel describes the focused entry (web .details-panel.is-stage).</summary>
    private void ShowEntry(CalendarEntry e)
    {
        foreach (var c in _panel.Children.ToArray()) { _panel.Remove(c); c.Dispose(); }
        foreach (var old in _panelItems) _focus.Items.Remove(old);
        _panelItems.Clear();
        _keyArt.Set(e.WorkId is { } work ? $"/api/v1/artwork/work/{work:D}/backdrop?w=780" : null);
        var tone = CalendarRules.Tone(e, _today);
        _panel.Add(Ui.Text($"{(e.MediaKind == "movie" ? "Movies" : "Episodes")} \u00b7 {(e.ReleaseType is "digital" ? "Digital release" : "Airs")}", 153.6f, 263.2f, 12.288f, 800, _t.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f));
        var lines = Ui.Paragraph(_panel, e.Title, 153.6f, 307.42f, 69.12f, 600, _t.Ink, 369, 62.208f, -4.98f, 5);
        var my = 308.5f + 62.208f * lines + 24.6f;
        var code = CalendarRules.EpisodeCode(e.SeasonNumber, e.EpisodeNumber);
        var gb = CultureInfo.GetCultureInfo("en-GB");
        var day = CalendarRules.ReleaseInstant(e) is { } when // web: Intl dateStyle full + timeStyle short, or the day heading then All day
            ? when.ToLocalTime().ToString("dddd, d MMMM yyyy", gb) + " at " + when.ToLocalTime().ToString("HH:mm")
            : CalendarRules.LocalDay(e).ToString("dddd d MMMM", gb) + " \u00b7 All day";
        Ui.MetaRow(_panel, string.Join("     ", new[] { code.Length > 0 ? code + (e.Subtitle is { Length: > 0 } ? " \u00b7 " + e.Subtitle : "") : null, day }.Where(x => x is not null)!), 153.6f, my + 1.6f, 13.056f, 600, DetailsPanel.Soft(_t), 19.584f); // glyph-run top calibration
        var label = tone switch { CalendarTone.Available => "Available", CalendarTone.Upcoming => "Upcoming", CalendarTone.Missing => "Missing", _ => "Not tracked" };
        var pw = Ui.TextWidth(label, 13.44f, 750, 0) + 22.8f; // web .status-pill: 0.65rem padding and a 1 px border each side
        var pill = Ui.Box(153.6f, my + 37.9f, pw, 26.6f, new Rgba(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.14f), 13.3f);
        pill.BorderlineWidth = 1; pill.BorderlineColor = new Color(ToneColor(tone).R, ToneColor(tone).G, ToneColor(tone).B, 0.6f);
        pill.Add(Sem.Tag(Ui.Text(label, 0, 4, 13.44f, 750, _t.Ink, pw, 18.8f, HorizontalAlignment.Center), "text"));
        _panel.Add(pill);
        var overviewLines = Ui.Paragraph(_panel, e.Overview ?? "", 153.6f, my + 86f, 13.824f, 600, DetailsPanel.Soft(_t), 336, 21.842f, 0, 5);
        var by = my + 111f + 21.842f * overviewLines; // web: the buttons follow the synopsis
        var open = Ui.Box(153.6f, by, 124, 58, _t.Accent, 29);
        open.Add(Ui.Text("Open series", 0, 17.1f, 14.72f, 720, _t.OnAccent, 124, 22.08f, HorizontalAlignment.Center));
        Sem.Tag(open, "button", "Open series");
        var openRing = Ring.Make(124, 58, 29, new Rgba(1, 1, 1)); openRing.Show(false); open.Add(openRing);
        _panelItems.Add(new Focusable { Rect = () => new Box(153.6f, by, 124, 58), Label = "open series", Style = f => openRing.Show(f), Select = () => { if (e.WorkId is { } wid) _env.Navigate(HomeScreen.DetailRoute(new WorkCard(wid, e.MediaKind == "movie" ? WorkKind.Movie : WorkKind.Series, e.Title, "", "", "", null, null, null, 0, false))); } });
        _panel.Add(open);
        var wl = Ui.Box(286.28f, by - 0.83f, 179.31f, 58, new Rgba(_t.Surface.R, _t.Surface.G, _t.Surface.B, 0.78f), 29);
        wl.BorderlineWidth = 1; wl.BorderlineColor = Ui.LineA(_t, 0.153f);
        wl.Add(Ui.Text("+", 21.0f, 18.0f, 14.72f, 720, _t.InkSoft, 14, 22.08f));
        wl.Add(Ui.Text("Add to watchlist", 39.44f, 17.9f, 14.72f, 900, _t.InkSoft, 130, 22.08f));
        Sem.Tag(wl, "button", "Add to watchlist");
        var wlRing = Ring.Make(179.31f, 58, 29, new Rgba(1, 1, 1)); wlRing.Show(false); wl.Add(wlRing);
        _panelItems.Add(new Focusable { Rect = () => new Box(286.28f, by, 179.31f, 58), Label = "add to watchlist", Style = f => wlRing.Show(f), Select = () => Toast("The watchlist is not available in this app yet.") });
        _focus.Items.AddRange(_panelItems);
        _panel.Add(wl);
    }

    /// <summary>web sizedPosterUrl: a TMDB original becomes a tile-sized w185 (calendar months show over a hundred posters).</summary>
    private static string SizedPosterUrl(string url, int width = 185) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Host == "image.tmdb.org" && u.AbsolutePath.StartsWith("/t/p/original/")
            ? new UriBuilder(u) { Path = $"/t/p/w{width}/" + u.AbsolutePath["/t/p/original/".Length..] }.Uri.ToString() : url;

    private void LoadPoster(View poster, string url)
    {
        if (url.StartsWith('/')) { _env.Images.Apply(poster, url, 40, 60, 6, roundImage: true); return; }
        var sized = SizedPosterUrl(url);
        _env.Images.Track(async () =>
        {
            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            ImageView? image = null;
            await AuthImage.OnUiAsync(() =>
            {
                image = new ImageView(sized) { Size = new Size(40, 60) };
                image.ResourceReady += (_, _) => ready.TrySetResult();
                poster.Add(image);
                if (image.IsResourceReady() || image.LoadingStatus == ImageView.LoadingStatusType.Failed) ready.TrySetResult();
            });
            try { await ready.Task.WaitAsync(TimeSpan.FromSeconds(15)).ConfigureAwait(false); }
            catch (TimeoutException)
            {
                // A failed external image must not mutate a later screenshot after readiness settles.
                await AuthImage.OnUiAsync(() => { if (image is not null) { poster.Remove(image); image.Dispose(); } });
                Dbg.Log("CAL external poster timed out");
            }
        });
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
        if (_linkDrawer is not null) return _linkDrawer.OnKey(key);
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
