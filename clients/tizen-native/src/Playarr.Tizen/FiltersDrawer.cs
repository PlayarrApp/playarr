using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>One section of the Filters drawer: a choice grid, a select or a toggle.</summary>
internal sealed class FilterSection
{
    public string Heading { get; }
    public string[] Options { get; }
    public int Selected { get; set; }
    public Func<int, bool> Changed { get; }
    public bool IsSelect { get; }
    public bool IsToggle { get; }
    public bool KeepFocusAfterChange { get; }
    /// <summary>A language multi-select (web MultiSelect): the facets (null while loading), the picked codes and the change callback.</summary>
    public bool Multi { get; private init; }
    public IReadOnlyList<LanguageFacet>? Facets { get; set; }
    public bool FacetsFailed { get; set; }
    public HashSet<string> Picked { get; private init; } = new();
    public Action<IReadOnlyList<string>>? OnPicked { get; private init; }

    public static FilterSection Languages(string heading, IEnumerable<string> picked, Action<IReadOnlyList<string>> onPicked) =>
        new(heading, new[] { "Any language" }, 0, _ => { }, IsSelect: true) { Multi = true, Picked = new HashSet<string>(picked), OnPicked = onPicked };

    public FilterSection(string Heading, string[] Options, int Selected, Action<int> Changed, bool IsSelect = false, bool IsToggle = false)
    {
        this.Heading = Heading; this.Options = Options; this.Selected = Selected;
        this.Changed = index => { Changed(index); return true; };
        this.IsSelect = IsSelect; this.IsToggle = IsToggle;
    }

    public FilterSection(string Heading, string[] Options, int Selected, Func<int, bool> Changed, bool KeepFocusAfterChange = false)
    {
        this.Heading = Heading; this.Options = Options; this.Selected = Selected; this.Changed = Changed;
        this.KeepFocusAfterChange = KeepFocusAfterChange;
    }
}

/// <summary>Web .tv-filter-drawer: a 360 px right panel (kicker, title, close, sections). Measured at 1920x1080.</summary>
internal sealed class FiltersDrawer
{
    private readonly FocusSet _focus = new();
    private readonly Action _close;
    private readonly PlayarrTheme _t; private readonly string _kicker; private readonly FilterSection[] _sections; private readonly Action<string> _toast;
    private View _c = new(); private float _scroll; private View? _listView; private object? _list;

    private static void AddViewGlyph(View b, int i, float w, Rgba c)
    {
        if (i == 0) { for (var k = 0; k < 3; k++) b.Add(Ui.Box(w / 2 - 9, 14 + k * 4.5f, 18, 1.8f, c, 0.9f)); return; }
        for (var k = 0; k < 3; k++)
        {
            var r = Ui.Box(w / 2 - 10 + k * 7.5f, 13, 5, 13, null, 1.5f);
            r.BorderlineWidth = 1.5f; r.BorderlineColor = Ui.C(c); b.Add(r);
        }
    }
    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    public FiltersDrawer(AppEnv env, string kicker, FilterSection[] sections, Action close, Action<string> toast)
    {
        _t = env.Theme; _close = close; _kicker = kicker; _sections = sections; _toast = toast;
        Build();
        _focus.Set(0); // web opens with the close button focused
    }

    private void Build()
    {
        var t = _t; var toast = _toast; var kicker = _kicker; var sections = _sections;
        foreach (var c in Root.Children.ToArray()) { Root.Remove(c); c.Dispose(); }
        _focus.Items.Clear(); _listView = null;
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.DrawerPanel(t);
        panel.BorderlineWidth = 1; panel.BorderlineColor = Ui.C(t.Line);
        Root.Add(panel);
        var clip = new View { PositionY = 130, Size = new Size(1920, 950), ClippingMode = ClippingModeType.ClipChildren };
        _c = new View { PositionY = -130 - _scroll };
        clip.Add(_c);
        Root.Add(Ui.Text(kicker, 1606, 54, 9.6f, 800, t.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Ui.Text("Filters", 1606, 71.6f, 38.4f, 600, t.Ink, 200, 57.6f, spacing: -2.1f));
        var x = Ui.Box(1826, 54, 48, 50, t.SurfaceSoft, 25);
        x.Add(Ui.Icon("close", 14, 15, 20, t.Ink));
        var xr = Ring.Make(48, 50, 25, new Rgba(1, 1, 1)); xr.Show(false); x.Add(xr);
        Root.Add(x);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Select = _close, Style = f => xr.Show(f) });

        Root.Add(clip);
        var y = 163.4f;
        foreach (var s in sections)
        {
            _c.Add(Ui.Text(s.Heading, 1606, y, 9.6f, 800, t.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
            var top = y + 26.4f;
            if (s.Multi)
            {
                var si = Array.IndexOf(sections, s);
                var label = s.Facets is null ? (s.FacetsFailed ? "Languages unavailable" : "Loading languages\u2026")
                    : s.Picked.Count == 0 ? "Any language" : string.Join(", ", s.Picked.Select(c => LanguageNames.Display(c, s.Facets.FirstOrDefault(f => f.Code == c)?.Name)));
                var box = Ui.Box(1606, top, 268, 58.8f, t.SurfaceSoft, 12);
                box.BorderlineWidth = 1; box.BorderlineColor = Ui.C(t.Line);
                box.Add(Ui.Text(label, 19.4f, 20.5f, 11.84f, 700, t.Ink, 200, 17.76f));
                box.Add(Ui.Text(_openMulti == si ? "\u2303" : "\u2304", 238.6f, 20.5f, 11.84f, 700, t.InkMuted, 12, 17.76f));
                var ring = Ring.Make(268, 58.8f, 12, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
                _c.Add(box);
                var yy = top; var secIndex = si; var ms = s;
                _fieldItems[si] = _focus.Items.Count;
                _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy - _scroll, 268, 58.8f), Label = s.Heading.ToLowerInvariant(), Style = f => ring.Show(f && _openMulti != secIndex), Select = () => ToggleMulti(secIndex) });
                y += 115.2f;
                if (_openMulti == si && s.Facets is { Count: > 0 })
                {
                    BuildList(s, top + 59.4f);
                    y += 268;
                }
            }
            else if (s.IsSelect)
            {
                var box = Ui.Box(1606, top, 268, 58.8f, t.SurfaceSoft, 12);
                box.BorderlineWidth = 1; box.BorderlineColor = Ui.C(t.Line);
                box.Add(Ui.Text(s.Options[s.Selected], 19.4f, 20.5f, 11.84f, 700, t.Ink, 200, 17.76f));
                box.Add(Ui.Text("\u2304", 238.6f, 20.5f, 11.84f, 700, t.InkMuted, 12, 17.76f));
                var ring = Ring.Make(268, 58.8f, 12, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
                _c.Add(box);
                var yy = top;
                _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy - _scroll, 268, 58.8f), Label = s.Heading.ToLowerInvariant(), Style = f => ring.Show(f), Select = () => toast("This filter is not available in this app yet.") });
                y += 115.2f;
            }
            else if (s.IsToggle)
            {
                var row = new View { PositionX = 1606, PositionY = top, Size = new Size(268, 40) };
                var track = Ui.Box(0, 6, 36, 22, s.Selected == 1 ? t.Ink : t.SurfaceSoft, 11);
                track.Add(Ui.Box(s.Selected == 1 ? 16 : 2, 2, 18, 18, s.Selected == 1 ? t.OnAccent : t.InkMuted, 9));
                row.Add(track);
                row.Add(Ui.Text(s.Options[0], 49, 5.6f, 19.2f, 400, t.Ink, 220, 28.8f));
                var ring = Ring.Make(268, 40, 12, new Rgba(1, 1, 1)); ring.Show(false); row.Add(ring);
                _c.Add(row);
                var yy = top; var cur = s;
                _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy - _scroll, 268, 40), Label = s.Heading.ToLowerInvariant(), Style = f => ring.Show(f), Select = () => { cur.Changed(cur.Selected == 1 ? 0 : 1); _focus.Set(0); } });
                y += 115f;
            }
            else
            {
                var n = s.Options.Length; var columns = n > 3 ? 3 : n; var gap = 8f; var w = (268 - gap * (columns - 1)) / columns;
                var choices = new List<(View Box, TextLabel Label)>();
                for (var i = 0; i < n; i++)
                {
                    var idx = i; var bx = 1606 + i % columns * (w + gap); var by = top + i / columns * 64; var active = i == s.Selected;
                    var b = Ui.Box(bx, by, w, 56, active ? t.Ink : t.SurfaceSoft, 12);
                    b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(t, 0.15f);
                    var label = Ui.Text(s.Options[i], 0, n == 3 ? 33 : 22.2f, 10.56f, 700, active ? t.OnAccent : t.InkMuted, w, 11.6f, HorizontalAlignment.Center);
                    b.Add(label);
                    if (n == 3) AddViewGlyph(b, i, w, active ? t.OnAccent : t.InkMuted); // web: a small List / Screen / Cover glyph above the label
                    var ring = Ring.Make(w, 56, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
                    _c.Add(b);
                    choices.Add((b, label));
                    var yy = by; var ww = w; var sec = s; var focusIndex = _focus.Items.Count;
                    _focus.Items.Add(new Focusable { Rect = () => new Box(bx, yy - _scroll, ww, 56), Label = $"{s.Heading} {s.Options[i]}".ToLowerInvariant(), Style = f => ring.Show(f), Select = () =>
                    {
                        if (sec.Changed(idx)) sec.Selected = idx;
                        for (var choiceIndex = 0; choiceIndex < choices.Count; choiceIndex++)
                        {
                            var (choice, text) = choices[choiceIndex];
                            var selected = choiceIndex == sec.Selected;
                            choice.BackgroundColor = Ui.C(selected ? t.Ink : t.SurfaceSoft);
                            text.TextColor = Ui.C(selected ? t.OnAccent : t.InkMuted);
                        }
                        _focus.Set(sec.KeepFocusAfterChange ? focusIndex : 0);
                    } });
                }
                y += 112.6f + Math.Max(0, (int)Math.Ceiling(n / (float)columns) - 1) * 64;
            }
        }

        _list = null;
    }

    private int _openMulti = -1, _active;
    private float _listScroll;
    private readonly Dictionary<int, int> _fieldItems = new();
    private const float ListH = 260f, RowH = 44f;

    /// <summary>Called when the facets arrive (or fail): redraws the drawer.</summary>
    public void Refresh() { var keep = _focus.Current; Build(); _focus.Set(Math.Min(Math.Max(keep, 0), _focus.Items.Count - 1)); }

    private void ToggleMulti(int si)
    {
        var s = _sections[si];
        if (s.Facets is not { Count: > 0 }) return;
        _openMulti = _openMulti == si ? -1 : si; _active = 0; _listScroll = 0;
        var keep = _focus.Current;
        Build();
        _focus.Set(Math.Min(keep, _focus.Items.Count - 1));
        if (_openMulti == si) { var y = 163.4f; EnsureVisible(ListBottom(si)); }
    }

    private float ListBottom(int si)
    {
        var y = 163.4f;
        for (var i = 0; i <= si; i++) y += i < si ? SectionHeight(_sections[i], i) : 26.4f + 58.8f + 0.6f + ListH;
        return y;
    }

    private float SectionHeight(FilterSection s, int i)
    {
        if (s.Multi) return 115.2f + (_openMulti == i && s.Facets is { Count: > 0 } ? 268 : 0);
        if (s.IsSelect) return 115.2f;
        if (s.IsToggle) return 115f;
        var n = s.Options.Length; var columns = n > 3 ? 3 : n;
        return 112.6f + Math.Max(0, (int)Math.Ceiling(n / (float)columns) - 1) * 64;
    }

    /// <summary>Scrolls the whole panel so a screen-space y (content coordinates) stays inside the clip, 40 px from the bottom edge.</summary>
    private void EnsureVisible(float contentBottom)
    {
        var maxBottom = 1040f;
        if (contentBottom - _scroll > maxBottom) _scroll = contentBottom - maxBottom;
        if (_scroll < 0) _scroll = 0;
        _c.PositionY = -130 - _scroll;
    }

    private void KeepItemVisible()
    {
        if (_focus.Item is null) return;
        var r = _focus.CurrentRect; // already scroll-adjusted
        if (r.Y + r.Height > 1040f) _scroll += r.Y + r.Height - 1040f;
        else if (r.Y < 150f && _scroll > 0) _scroll = Math.Max(0, _scroll - (150f - r.Y));
        _c.PositionY = -130 - _scroll;
    }

    private void BuildList(FilterSection s, float listY)
    {
        var t = _t;
        var holder = Ui.Box(1606, listY, 268, ListH, new Rgba(t.SurfaceSoft.R, t.SurfaceSoft.G, t.SurfaceSoft.B, 0.64f), 12);
        holder.BorderlineWidth = 1; holder.BorderlineColor = Ui.LineA(t, 0.108f);
        holder.ClippingMode = ClippingModeType.ClipChildren;
        _c.Add(holder);
        _listView = new View { PositionY = -_listScroll };
        holder.Add(_listView);
        var facets = s.Facets!;
        for (var i = 0; i < facets.Count; i++)
        {
            var f = facets[i]; var y = 5.8f + i * RowH; var picked = s.Picked.Contains(f.Code);
            var row = new View { PositionX = 5.8f, PositionY = y, Size = new Size(256.4f, RowH) };
            var cb = Ui.Box(10, 11, 22, 22, picked ? t.Ink : null, 5);
            cb.BorderlineWidth = 2; cb.BorderlineColor = Ui.C(picked ? t.Ink : t.InkMuted);
            if (picked) cb.Add(Ui.Text("\u2713", 0, 1, 14, 800, t.OnAccent, 22, 20, HorizontalAlignment.Center));
            row.Add(cb);
            row.Add(Ui.Text(LanguageNames.Display(f.Code, f.Name), 49, 10, 11.84f, 700, t.Ink, 150, 17.76f));
            row.Add(Ui.Text(f.Count.ToString(), 156, 10, 11, 400, t.InkMuted, 90, 17, HorizontalAlignment.End));
            if (i == _active)
            {
                var ring = Ring.Make(256.4f, RowH, 10, new Rgba(1, 1, 1)); ring.Position = new Position(0, 0); ring.PositionX = -2; ring.PositionY = -2; ring.Size = new Size(260.4f, RowH + 4); row.Add(ring);
            }
            _listView.Add(row);
        }
        // web: the list scrolls under the shared edge fades (30 % floor)
        var fade = new Rgba(t.SurfaceSoft.R * 0.64f + t.SurfaceStrong.R * 0.36f, t.SurfaceSoft.G * 0.64f + t.SurfaceStrong.G * 0.36f, t.SurfaceSoft.B * 0.64f + t.SurfaceStrong.B * 0.36f);
        if (_listScroll > 0.5f) { var f1 = Ui.EdgeFade(0, 0, 268, fade, true); holder.Add(f1); }
        if (_listScroll + ListH < 5.8f + facets.Count * RowH + 5.8f - 0.5f) { var f2 = Ui.EdgeFade(0, ListH, 268, fade, false); holder.Add(f2); }
    }

    private bool MultiKey(RemoteKey key)
    {
        var s = _sections[_openMulti]; var n = s.Facets!.Count;
        switch (key)
        {
            case RemoteKey.Down: if (_active + 1 < n) { _active++; } break;
            case RemoteKey.Up: if (_active > 0) { _active--; } break;
            case RemoteKey.Select:
                var code = s.Facets![_active].Code;
                if (!s.Picked.Remove(code)) s.Picked.Add(code);
                s.OnPicked?.Invoke(s.Picked.ToList());
                break;
            case RemoteKey.Back: case RemoteKey.Left: var si = _openMulti; _openMulti = -1; var fi = _fieldItems.TryGetValue(si, out var q) ? q : 0; Build(); _focus.Set(fi); return true;
            default: return true;
        }
        // keep the active row inside the 260 px list (web scrollIntoView)
        var top = 5.8f + _active * RowH;
        if (top - _listScroll < 0) _listScroll = top - 5.8f;
        if (top + RowH - _listScroll > ListH - 5.8f) _listScroll = top + RowH - (ListH - 5.8f);
        var keep = _focus.Current; Build(); _focus.Set(keep);
        return true;
    }

    public bool OnKey(RemoteKey key)
    {
        if (_openMulti >= 0) return MultiKey(key);
        switch (key)
        {
            case RemoteKey.Back: _close(); return true;
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            default: _focus.Move(key); KeepItemVisible(); return true;
        }
    }
}
