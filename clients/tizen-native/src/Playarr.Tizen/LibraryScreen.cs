using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Movies, Series or Music: the three-column library grid (web Library, 1920x1080 measurements).</summary>
internal sealed class LibraryScreen : IPage
{
    private static readonly float[] ColX = { 783.4f, 1136.4f, 1489.5f };
    private const float FirstRowY = 162f, RowPitch = 240.4f, FocusedRowMaxY = 826f, ClipX = 729.6f, PageSize = 200;
    private const int Columns = 3;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly WorkKind _kind;
    private readonly string _title;
    private readonly View _root = new();
    private readonly View _grid = new();
    private readonly KeyArt _keyArt;
    private View? _fadeTop, _fadeBottom, _tile;
    private readonly DetailsPanel _panel;
    private readonly Dictionary<int, MediaCard> _views = new();
    private readonly List<WorkCard> _items = new();
    private readonly List<Work> _works = new();
    private readonly IReadOnlyDictionary<Guid, WatchProgress> _noProgress = new Dictionary<Guid, WatchProgress>();
    private IReadOnlyDictionary<Guid, WatchProgress> _progress;
    private int _total, _focus = -1;
    private float _scroll;
    private bool _loading;
    private PageSubtitle? _subtitle;
    // right-hand side targets: the Filters tile and the A-Z rail (geometric focus together with the grid)
    private readonly List<Focusable> _side = new();
    private readonly Dictionary<char, View> _letterDots = new();
    private readonly Dictionary<char, TextLabel> _letterLabels = new();
    private int _sideFocus = -1;
    private char _activeLetter = '\0';

    private Guid? _restoreId;
    public object? SaveState() => _focus >= 0 ? (_items[_focus].WorkId, _scroll) : null;
    public void RestoreState(object state) { var (id, scroll) = ((Guid, float))state; _restoreId = id; _scroll = scroll; }

    public bool IsReady => _items.Count > 0;
    public View Root => _root;
    private readonly string _baseRoute;
    public string Route => _filters is not null ? _baseRoute + "?panel=filters" : _baseRoute;
    public string? FocusedLabel => _filters?.FocusedLabel ?? _drawer?.FocusedLabel ?? (_sideFocus >= 0 ? _side[_sideFocus].Label : _focus < 0 ? null : $"open {_items[_focus].Title}".ToLowerInvariant());
    public bool HasFocusTarget => _items.Count > 0;
    public float FocusCentreY => FirstRowY - _scroll + (_focus / Columns) * RowPitch + MediaCard.Height / 2;

    public LibraryScreen(AppEnv env, WorkKind kind, string title, string route)
    {
        _env = env; _t = env.Theme; _kind = kind; _title = title; _baseRoute = route; _progress = _noProgress;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        _keyArt = new KeyArt(env, armed: true);
        _panel = new DetailsPanel(env, library: true);
        _root.Add(_keyArt.Root);
        _root.Add(_panel.Root);
        _root.Add(Ui.PanelWash(_t));
        var clip = new View { PositionX = ClipX, Size = new Size(TizenClient.DesignWidth - ClipX, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        _grid.PositionX = -ClipX;
        clip.Add(_grid);
        _root.Add(clip);
        _fadeTop = Ui.EdgeFade(ClipX, 0, TizenClient.DesignWidth - ClipX, _t.Surface, true);
        _fadeBottom = Ui.EdgeFade(ClipX, TizenClient.DesignHeight, TizenClient.DesignWidth - ClipX, _t.Surface, false);
        _fadeTop.Show(false); _root.Add(_fadeTop); _root.Add(_fadeBottom);
        BuildHeader();
        BuildSide();
        _ = LoadAsync(0);
    }

    private void BuildHeader()
    {
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text(_title, 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        _subtitle = new PageSubtitle(_env, _root, _title);
    }

    private void BuildSide()
    {
        // Filters tile (shell action column: 62x72 at 1845.5,151.2)
        var tile = Ui.Box(1845.5f, 151.2f, 62, 72, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 14);
        tile.BorderlineWidth = 1; tile.BorderlineColor = Ui.LineA(_t, 0.075f);
        tile.Add(Ui.Icon("filters", 19, 15, 24, _t.InkMuted)); // web: the sliders glyph
        _tile = tile;
        tile.Add(Ui.Text("Filters", 0, 44.6f, 8.256f, 700, _t.InkMuted, 62, 12.384f, HorizontalAlignment.Center, spacing: 0.165f));
        var ring = Ring.Make(62, 72, 14, new Rgba(1, 1, 1)); ring.Show(false); tile.Add(ring);
        _root.Add(tile);
        _side.Add(new Focusable { Rect = () => new Box(1845.5f, 151.2f, 62, 72), Label = "filters", Style = f => ring.Show(f), Select = OpenFilters });
        // A-Z rail
        var y = 295.2f;
        foreach (var letter in Alphabet.Letters)
        {
            var cy = y + 4.6f; var ly = y;
            var dot = Ui.Box(1879.5f - 12, cy - 12, 24, 24, _t.Ink, 12); dot.Show(false);
            _root.Add(dot); _letterDots[letter] = dot;
            var l = letter;
            var lbl = Ui.Text(letter.ToString(), 1869, ly - 2, 9.216f, 400, _t.InkMuted, 21, 13);
            lbl.HorizontalAlignment = HorizontalAlignment.Center;
            _root.Add(lbl); _letterLabels[letter] = lbl;
            var ringL = Ring.Make(24, 24, 12, new Rgba(1, 1, 1)); ringL.PositionX = -5; ringL.PositionY = -5; ringL.Show(false); dot.Add(ringL);
            _side.Add(new Focusable
            {
                Rect = () => new Box(1867.5f, cy - 12, 24, 24), Label = $"jump to {letter}".ToLowerInvariant(),
                Style = f => { ringL.Show(f); if (f) dot.Show(true); else if (letter != _activeLetter) dot.Show(false); },
                Select = () => JumpTo(l),
            });
            y += 44;
        }
    }

    private void JumpTo(char letter)
    {
        var i = Alphabet.FirstIndexOf(_works.Select(w => string.IsNullOrEmpty(w.SortTitle) ? w.Title : w.SortTitle).ToList(), letter);
        if (i < 0) return;
        _sideFocus = -1; _side.ForEach(f => f.Style(false));
        SetFocus(i / Columns * Columns);
    }

    private void SetActiveLetter(string title)
    {
        var l = Alphabet.LetterOf(title);
        if (l == _activeLetter) return;
        if (_letterDots.TryGetValue(_activeLetter, out var old)) { old.Show(false); _letterLabels[_activeLetter].TextColor = Ui.C(_t.InkMuted); }
        _activeLetter = l;
        if (_letterDots.TryGetValue(l, out var dot)) { dot.Show(true); _letterLabels[l].TextColor = Ui.C(_t.OnAccent); }
    }

    private async Task LoadAsync(int offset)
    {
        if (_loading) return;
        _loading = true;
        try
        {
            if (offset == 0) _progress = HomeModel.IndexByWork(await _env.Api.ListWatchProgressAsync());
            var page = await _env.Api.BrowseCatalogAsync(_kind, sort: _sort, order: _order, limit: (int)PageSize, offset: offset, availableOnly: true);
            SynchronizationContextHolder.Post(() =>
            {
                _total = (int)(page.Total ?? offset + page.Items.Count);
                // As web (orderWorks): the merged list is ordered by natural title, so "2 ..." comes before "10 ...".
                var focusedId = _focus >= 0 ? _items[_focus].WorkId : (Guid?)null;
                var known = _works.Select(w => w.Id).ToHashSet();
                _works.AddRange(page.Items.Where(w => known.Add(w.Id)));
                if (_sort == "title") _works.Sort(WorkLabels.CompareTitles); else _works.Sort((a, b) => a.AddedAt.CompareTo(b.AddedAt));
                if (_order == "desc") _works.Reverse();
                _items.Clear();
                _items.AddRange(_works.Select(w => HomeModel.Card(w, _progress, true)));
                foreach (var v in _views.Values) { _grid.Remove(v.Box); v.Box.Dispose(); }
                _views.Clear();
                if (focusedId is { } fid) _focus = Math.Max(0, _items.FindIndex(c => c.WorkId == fid));
                _subtitle?.Set($"{_total:N0} {(_kind == WorkKind.Artist ? "artists" : "titles")}");
                if (_focus < 0 && _items.Count > 0)
                {
                    var at = _restoreId is { } rid ? _items.FindIndex(c => c.WorkId == rid) : -1;
                    if (at >= 0 || _restoreId is null) { _restoreId = null; SetFocus(Math.Max(0, at)); }
                    else if (_items.Count < _total) _ = LoadAsync(_items.Count);
                    else { _restoreId = null; SetFocus(0); }
                }
                else Refresh();
            });
        }
        catch (Exception e) { Dbg.Log("LIB load failed: " + e); }
        finally { _loading = false; }
    }

    private FiltersDrawer? _filters;
    private string _sort = "title", _order = "asc";

    private void OpenFilters()
    {
        var sections = new[]
        {
            new FilterSection("View", new[] { "List", "Screen", "Cover" }, 1, i =>
            {
                if (i != 1) { Toast("Only the screen view is available in this app yet."); return false; }
                return true;
            }),
            new FilterSection("Sort by", new[] { "Title", "Date Added" }, _sort == "title" ? 0 : 1, i => ApplySort(i == 0 ? "title" : "date_added", _order)),
            new FilterSection("Order", new[] { "A-Z", "Z-A" }, _order == "asc" ? 0 : 1, i => ApplySort(_sort, i == 0 ? "asc" : "desc")),
            new FilterSection("Audio language", new[] { "Any language" }, 0, _ => { }, IsSelect: true),
            new FilterSection("Subtitle language", new[] { "Any language" }, 0, _ => { }, IsSelect: true),
        };
        _filters = new FiltersDrawer(_env, "Library controls", sections, CloseFilters, Toast);
        _root.Add(_filters.Root);
        _tile?.Show(false); // the drawer blurs what is behind it on web; nothing of the tile shows through
    }

    private void CloseFilters() { if (_filters is null) return; _tile?.Show(true); _root.Remove(_filters.Root); _filters.Root.Dispose(); _filters = null; }

    private void ApplySort(string sort, string order)
    {
        if (sort == _sort && order == _order) return;
        _sort = sort; _order = order;
        CloseFilters();
        foreach (var v in _views.Values) { _grid.Remove(v.Box); v.Box.Dispose(); }
        _views.Clear(); _works.Clear(); _items.Clear(); _focus = -1; _total = 0; _scroll = 0; _sideFocus = -1;
        _ = LoadAsync(0);
    }

    private ActionsDrawer? _drawer;
    public string? DrawerLabel => _drawer?.FocusedLabel;

    private void OpenDrawer()
    {
        if (_focus < 0) return;
        // web: with the drawer open the card behind it loses its focus look
        if (_views.TryGetValue(_focus, out var behind)) behind.SetFocused(false);
        _drawer = new ActionsDrawer(_env, _items[_focus], () => { _root.Remove(_drawer!.Root); _drawer.Root.Dispose(); _drawer = null; if (_focus >= 0 && _views.TryGetValue(_focus, out var again)) again.SetFocused(true); }, msg => Toast(msg));
        _root.Add(_drawer.Root);
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
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right) _keyArt.Arm();
        if (_filters is not null) return _filters.OnKey(key);
        if (_drawer is not null) return _drawer.OnKey(key);
        if (key == RemoteKey.SelectLong && _sideFocus < 0) { OpenDrawer(); return true; }
        if (_items.Count == 0) return key is not (RemoteKey.Left or RemoteKey.Back);
        if (_sideFocus >= 0) return SideKey(key);
        var col = _focus % Columns;
        switch (key)
        {
            case RemoteKey.Right: if (col < Columns - 1 && _focus + 1 < _items.Count) SetFocus(_focus + 1); else EnterSide(); return true;
            case RemoteKey.Left: if (col > 0) { SetFocus(_focus - 1); return true; } return false;
            case RemoteKey.Down: if (_focus + Columns < _items.Count) SetFocus(_focus + Columns); else if (_focus + 1 < _items.Count && _focus / Columns < (_items.Count - 1) / Columns) SetFocus(_items.Count - 1); return true;
            case RemoteKey.Up: if (_focus >= Columns) SetFocus(_focus - Columns); return true;
            case RemoteKey.Select: _env.Navigate(HomeScreen.DetailRoute(_items[_focus])); return true;
        }
        return false;
    }

    private void EnterSide()
    {
        var cy = FocusCentreY; var best = 0;
        for (var i = 1; i < _side.Count; i++) if (Math.Abs(_side[i].Rect().CentreY - cy) < Math.Abs(_side[best].Rect().CentreY - cy)) best = i;
        if (_focus >= 0 && _views.TryGetValue(_focus, out var v)) v.SetFocused(false);
        _sideFocus = best; _side[best].Style(true);
    }

    private bool SideKey(RemoteKey key)
    {
        if (key == RemoteKey.Select) { _side[_sideFocus].Select?.Invoke(); return true; }
        if (key == RemoteKey.Left || key == RemoteKey.Back)
        {
            var cy = _side[_sideFocus].Rect().CentreY;
            _side[_sideFocus].Style(false); _sideFocus = -1;
            // back to the grid: the card in the last column closest to the side item's height
            var best = _focus; var bestD = float.MaxValue;
            foreach (var kv in _views.Where(kv => kv.Key % Columns == Columns - 1 || kv.Key == _items.Count - 1))
            { var d = Math.Abs(FirstRowY - _scroll + (kv.Key / Columns) * RowPitch + MediaCard.Height / 2 - cy); if (d < bestD) { bestD = d; best = kv.Key; } }
            SetFocus(best);
            return true;
        }
        var next = GeometricFocus.Next(_side.Select(f => f.Rect()).ToList(), _sideFocus, key);
        if (next >= 0) { _side[_sideFocus].Style(false); _sideFocus = next; _side[next].Style(true); }
        return true;
    }

    private void SetFocus(int index)
    {
        if (_focus >= 0 && _views.TryGetValue(_focus, out var old)) old.SetFocused(false);
        _focus = index;
        var row = index / Columns;
        _scroll = Math.Clamp(_scroll, row * RowPitch - (FocusedRowMaxY - FirstRowY), row * RowPitch);
        Refresh();
        _views[index].SetFocused(true);
        var card = _items[index];
        _panel.Show(card, kickerOverride: card.Kicker.Contains('·') ? card.Kicker[(card.Kicker.IndexOf('·') + 2)..] : card.Kicker, metaLead: HomeModel.MetaLead(card));
        _keyArt.Set(card.BackdropUrl);
        SetActiveLetter(_works[index].SortTitle is { Length: > 0 } st ? st : card.Title);
        if (index > _items.Count - 40 && _items.Count < _total) _ = LoadAsync(_items.Count);
    }

    /// <summary>Keeps views only for the visible rows plus one row each side; positions the grid for the current scroll.</summary>
    private void Refresh()
    {
        _grid.PositionY = -_scroll;
        // web: the scroller fades at the start edge once scrolled and at the end edge while more rows are below
        var contentH = FirstRowY + (float)Math.Ceiling(Math.Max(_items.Count, (int)_total) / (float)Columns) * RowPitch + 110;
        _fadeTop?.Show(_scroll > 0.5f);
        _fadeBottom?.Show(_scroll + TizenClient.DesignHeight < contentH - 1);
        var first = Math.Max(0, (int)Math.Floor(_scroll / RowPitch) - 1);
        var last = first + 6;
        foreach (var i in _views.Keys.Where(i => i / Columns < first || i / Columns > last).ToList())
        {
            _grid.Remove(_views[i].Box); _views[i].Box.Dispose(); _views.Remove(i);
        }
        for (var r = first; r <= last; r++)
            for (var c = 0; c < Columns; c++)
            {
                var i = r * Columns + c;
                if (i >= _items.Count || _views.ContainsKey(i)) continue;
                var card = MediaCard.Library(_env, _items[i], ColX[c], FirstRowY + r * RowPitch);
                _grid.Add(card.Box); _views[i] = card;
                if (i == _focus) card.SetFocused(true);
            }
    }
}
