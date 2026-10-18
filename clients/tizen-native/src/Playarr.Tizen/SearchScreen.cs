using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Search (web /search): the query pill and prompt on the left, results in a three-column grid. Measured at 1920x1080.</summary>
internal sealed class SearchScreen : IPage
{
    private CardLayout _layout;
    private float ColXAt(int c) => 825.6f + c * _layout.LibraryPitchX;
    private const float FirstRowY = 172.8f, FocusedRowMaxY = 819f;
    private float RowPitch => _layout.CardHeight + 37.8f; // web: caption plus 37.8 px between rows
    private int Columns => _layout.Columns;
    private static readonly HttpClient SearchHttp = new();
    private static readonly (string Value, string Label, WorkKind? Kind)[] MediaTypes =
    {
        ("all", "All", null), ("movie", "Movies", WorkKind.Movie), ("series", "Series", WorkKind.Series),
        ("site", "Sites", WorkKind.Site), ("artist", "Music", WorkKind.Artist),
        ("playlist", "Playlists", null), ("game", "Games", null),
    };

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private bool _focusIndicatorWasEnabled;
    private readonly View _root = new();
    private readonly View _results = new();
    private readonly View _empty = new();
    private readonly KeyArt _keyArt;
    private readonly DetailsPanel _panel;
    private readonly TextField _field;
    private readonly View _clear;
    private readonly PageSubtitle _count;
    private readonly TextLabel _notice;
    private readonly TextLabel _prompt;
    private readonly TextLabel _gameHeading;
    private readonly TextLabel _gameNotice;
    private readonly List<MediaCard> _cards = new();
    private readonly List<WorkCard> _items = new();
    private readonly List<SearchResultTarget> _targets = new();
    private readonly List<Work> _searchResults = new();
    private readonly List<PlaylistTreeEntry> _playlists = new();
    private readonly List<DiscoveryTitle> _games = new();
    private readonly List<Focusable> _side = new();
    private View? _filterTile;
    private View? _filterCount;
    private OtherSources? _extras;
    private View? _fadeTop, _fadeBottom;
    private int _xRow = -1; private bool _xLink; // focus inside Other sources (row, title link instead of the pill)
    private int _extrasGen;
    private int _focus = -1;       // -1 = on the query field
    private int _sideFocus = -1;
    private float _scroll;
    private CancellationTokenSource? _search;
    private Task<IReadOnlyList<PlaylistTreeEntry>>? _playlistsRequest;
    private readonly global::Tizen.NUI.Timer _debounce;
    private string _query = "";
    private string _mediaType = "all";
    private FiltersDrawer? _filters;
    private bool _removed;
    private SearchFocusState? _restoreFocus;

    public View Root => _root;
    public object? SaveState() => new SearchFocusState(_focus, _scroll);
    public void RestoreState(object state)
    {
        if (state is SearchFocusState focus) _restoreFocus = focus;
    }

    public string Route
    {
        get
        {
            var query = new List<string>();
            if (_query.Length > 0) query.Add("q=" + Uri.EscapeDataString(_query));
            if (_mediaType != "all") query.Add("type=" + Uri.EscapeDataString(_mediaType));
            if (_filters is not null) query.Add("panel=filters");
            return "/search" + (query.Count == 0 ? "" : "?" + string.Join("&", query));
        }
    }
    public string? FocusedLabel => _filters?.FocusedLabel ?? (_xRow >= 0 && _extras is not null ? (_xLink ? $"open {_extras.Rows[_xRow].Title.Title}" : (_extras.Rows[_xRow].Listed ? "\u2713remove from watchlist" : "+add to watchlist")).ToLowerInvariant() : null) ?? (_sideFocus >= 0 ? _side[_sideFocus].Label : _focus < 0 ? "search" : $"open {_items[_focus].Title}".ToLowerInvariant());
    public float FocusCentreY => _filters is not null ? 79 : _sideFocus >= 0 ? _side[_sideFocus].Rect().CentreY : _focus < 0 ? 210.8f : FirstRowY - _scroll + (_focus / Columns) * RowPitch + _layout.ArtHeight / 2;

    public SearchScreen(AppEnv env, string route = "/search")
    {
        _env = env; _layout = CardLayout.Library(false, env.Store.Appearance().ArtworkSize); _t = env.Theme;
        _query = ReadQuery(route, "q");
        var requestedType = ReadQuery(route, "type");
        var requestedOption = MediaTypes.FirstOrDefault(t => t.Value == requestedType);
        _mediaType = requestedOption.Value is not null ? requestedType : "all";
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        _keyArt = new KeyArt(env);
        _panel = new DetailsPanel(env, library: true, flow: true);
        _root.Add(_keyArt.Root);
        _root.Add(_panel.Root);
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text("Search", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        _count = new PageSubtitle(env, _root, "Search");
        _notice = Ui.Text("", 153.6f, 266, 13.5f, 500, _t.InkMuted, 590, 54, multiline: true, maxLines: 2);
        _notice.Show(false);
        _root.Add(_notice);
        _gameHeading = Ui.Text("GAMES", 825.6f, 207.7f, 12.288f, 800, _t.InkMuted, 455, 18.432f, upper: true, spacing: 0.86f);
        _gameHeading.Show(false);
        _root.Add(_gameHeading);
        _gameNotice = Ui.Text("", 825.6f, 240f, 13.5f, 500, _t.InkMuted, 455, 44, multiline: true, maxLines: 2);
        _gameNotice.Show(false);
        _root.Add(_gameNotice);
        BuildSide();

        // query pill
        var form = Ui.Box(153.6f, 172.8f, 590, 76, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 38);
        form.BorderlineWidth = 1; form.BorderlineColor = Ui.LineA(_t, 0.15f);
        form.Add(Ui.Icon("search", 25, 26, 24, _t.InkMuted));
        _field = new TextField { PositionX = 66, PositionY = 18, Size = new Size(440, 40), PixelSize = 17f, TextColor = Ui.C(_t.Ink), FontFamily = Ui.Font,
            PlaceholderText = "Search your libraries and playlists", PlaceholderTextColor = Ui.C(_t.InkMuted), EnableCursorBlink = true };
        _field.TextChanged += (_, e) => OnText(_field.Text);
        form.Add(_field);
        _clear = Ui.Box(514, 11, 67, 54, null, 27);
        _clear.Add(Ui.Text("Clear", 0, 18.8f, 10.944f, 800, _t.InkMuted, 67, 16.4f, HorizontalAlignment.Center));
        _clear.Show(false);
        form.Add(_clear);
        var ring = Ring.Make(590, 76, 38, new Rgba(1, 1, 1)); ring.Show(false); form.Add(ring);
        _formRing = ring;
        _root.Add(form);
        _root.Add(_empty);
        BuildEmpty();
        _prompt = Ui.Text("", 153.6f, 302.8f, 13.824f, 400, _t.InkMuted, 590, 42.86f, multiline: true, maxLines: 3);
        _prompt.Show(false);
        _root.Add(_prompt);
        var clip = new View { PositionX = 729.6f, Size = new Size(TizenClient.DesignWidth - 729.6f, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        _results.PositionX = -729.6f;
        clip.Add(_results);
        _root.Add(clip);
        _fadeTop = Ui.EdgeFade(729.6f, 0, TizenClient.DesignWidth - 729.6f, _t.Surface, true);
        _fadeBottom = Ui.EdgeFade(729.6f, TizenClient.DesignHeight, TizenClient.DesignWidth - 729.6f, _t.Surface, false);
        _fadeTop.Show(false); _fadeBottom.Show(false); _root.Add(_fadeTop); _root.Add(_fadeBottom);
        _filterTile?.RaiseToTop();
        _debounce = new global::Tizen.NUI.Timer(300);
        _debounce.Tick += (_, _) => { _ = RunSearchAsync(_query); return false; };
        SetFieldFocus(true);
        if (_query.Length > 0) SetQuery(_query);
    }

    private readonly View _formRing;

    private void BuildEmpty()
    {
        _empty.Add(Ui.Text("Find any available movie, series, artist or playlist.", 153.6f, 302.8f, 13.824f, 400, _t.InkMuted, 272, 21.43f, multiline: true, maxLines: 3));
        var art = Ui.Box(1125f, 311.8f, 132, 132, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 66);
        art.BorderlineWidth = 1; art.BorderlineColor = Ui.LineA(_t, 0.15f);
        art.Add(Ui.Icon("search-empty", 37.6f, 47f, 57.6f, 38.4f, _t.Name == "dark" ? Rgba.Hex(0xd75a79) : Rgba.Hex(0xae2f4b))); // web TvEmptyState "search" graphic (zoom-out, 1.2x)
        _empty.Add(art);
        _empty.Add(Ui.Text("Start typing to search.", 1299f, 365.1f, 16.896f, 700, _t.Ink, 400, 25.344f, spacing: -0.34f));
    }

    private void BuildSide()
    {
        var tile = Ui.Box(1845.5f, 151.2f, 62, 72, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 14);
        _filterTile = tile;
        tile.Focusable = true;
        tile.BorderlineWidth = 1; tile.BorderlineColor = Ui.LineA(_t, 0.075f);
        tile.Add(Ui.Icon("filters", 19, 15, 24, _t.InkMuted));
        tile.Add(Ui.Text("Filters", 0, 44.6f, 8.256f, 700, _t.InkMuted, 62, 12.384f, HorizontalAlignment.Center, spacing: 0.165f));
        var count = Ui.Box(26.328125f, 55.7375f, 9.40625f, 9.90625f, _t.Accent, 4.953125f);
        count.Add(Ui.Text("1", 0, 0, 6.6048f, 800, _t.Bg, 9.40625f, 9.90625f, HorizontalAlignment.Center));
        count.Show(_mediaType != "all");
        _filterCount = count;
        tile.Add(count);
        var ring = Ring.Make(62, 72, 14, new Rgba(1, 1, 1)); ring.Show(false); tile.Add(ring);
        _root.Add(tile);
        _side.Add(new Focusable { Rect = () => new Box(1845.5f, 151.2f, 62, 72), Label = "filters", Style = f => ring.Show(f), Select = OpenFilters });
    }

    private static string ReadQuery(string route, string key)
    {
        var q = route.IndexOf('?');
        if (q < 0) return "";
        foreach (var part in route[(q + 1)..].Split('&'))
        {
            var pair = part.Split('=', 2);
            if (pair.Length == 2 && Uri.UnescapeDataString(pair[0]) == key)
                return Uri.UnescapeDataString(pair[1].Replace('+', ' '));
        }
        return "";
    }

    private void OpenFilters()
    {
        var selected = Array.FindIndex(MediaTypes, type => type.Value == _mediaType);
        _filters = new FiltersDrawer(_env, "Search", new[]
        {
            new FilterSection("Type", MediaTypes.Select(type => type.Label).ToArray(), Math.Max(0, selected), SetMediaType, KeepFocusAfterChange: true),
        }, CloseFilters, Toast);
        SetFieldFocus(false);
        FocusManager.Instance.ClearFocus();
        if (_sideFocus >= 0) _side[_sideFocus].Style(false);
        _sideFocus = -1;
        _root.Add(_filters.Root);
        _filterTile?.Show(false);
    }

    public void OpenFiltersFromRoute() => OpenFilters();

    private void CloseFilters()
    {
        if (_filters is null) return;
        _root.Remove(_filters.Root); _filters.Root.Dispose(); _filters = null;
        _filterTile?.Show(true);
        _sideFocus = 0; _side[_sideFocus].Style(true);
        if (_filterTile is not null) FocusManager.Instance.SetCurrentFocusView(_filterTile);
    }

    internal void OnRemoved()
    {
        if (_removed) return;
        _removed = true;
        _search?.Cancel();
        var focusManager = FocusManager.Instance;
        focusManager.ClearFocus();
        focusManager.EnableFocusIndicator(_focusIndicatorWasEnabled);
    }

    internal void OnAdded()
    {
        _focusIndicatorWasEnabled = FocusManager.Instance.IsFocusIndicatorEnabled();
        var focusManager = FocusManager.Instance;
        focusManager.EnableFocusIndicator(false);
        _removed = false;
        if (_filters is not null) focusManager.ClearFocus();
        else if (_sideFocus >= 0 && _filterTile is not null) focusManager.SetCurrentFocusView(_filterTile);
        else if (_focus < 0) focusManager.SetCurrentFocusView(_field);
        else if (_focus < _cards.Count) focusManager.SetCurrentFocusView(_cards[_focus].Box);
    }

    private bool SetMediaType(int index)
    {
        if (index < 0 || index >= MediaTypes.Length) return false;
        _mediaType = MediaTypes[index].Value;
        _filterCount?.Show(_mediaType != "all");
        _ = RunSearchAsync(_query);
        return true;
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

    private void SetFieldFocus(bool on)
    {
        _formRing.Show(on);
        _field.EnableEditing = false;
        _field.Focusable = on;
        if (on) FocusManager.Instance.SetCurrentFocusView(_field);
    }

    private void OnText(string text)
    {
        _query = text.Trim();
        _search?.Cancel();
        _notice.Show(false);
        _clear.Show(_query.Length > 0);
        _debounce.Restart();
    }

    /// <summary>Sets the query without the on-screen keyboard (parity driver and tests).</summary>
    public void SetQuery(string q) { _field.Text = q; OnText(q); }

    private async Task RunSearchAsync(string q)
    {
        _search?.Cancel();
        var cts = _search = new CancellationTokenSource();
        if (q.Length == 0)
        {
            SynchronizationContextHolder.Post(() =>
            {
                if (!cts.IsCancellationRequested) Show(new List<Work>(), new List<PlaylistTreeEntry>(), new List<DiscoveryTitle>(), q);
            });
            return;
        }
        try
        {
            var includeWorks = _mediaType is not ("playlist" or "game");
            var includePlaylists = _mediaType is "all" or "playlist";
            var includeGames = _mediaType == "game";
            var workTask = includeWorks
                ? new CatalogSearch(_env.Api, SearchHttp).SearchAsync(q, 60, cts.Token)
                : Task.FromResult<IReadOnlyList<Work>>(Array.Empty<Work>());
            var playlistTask = includePlaylists
                ? LoadPlaylistsAsync()
                : Task.FromResult<IReadOnlyList<PlaylistTreeEntry>>(Array.Empty<PlaylistTreeEntry>());
            var gameTask = includeGames
                ? new DiscoverySearch(_env.Api, SearchHttp).SearchGamesAsync(q, 25, cts.Token)
                : Task.FromResult(new DiscoverySearchResponse());
            var workResultTask = TryRequest(workTask);
            var playlistResultTask = TryRequest(playlistTask);
            var gameResultTask = TryRequest(gameTask);
            await Task.WhenAll(workResultTask, playlistResultTask, gameResultTask).ConfigureAwait(false);
            if (cts.IsCancellationRequested) return;
            var workResult = await workResultTask.ConfigureAwait(false);
            var playlistResult = await playlistResultTask.ConfigureAwait(false);
            var gameResult = await gameResultTask.ConfigureAwait(false);
            var works = workResult.Value ?? Array.Empty<Work>();
            var playlists = playlistResult.Value ?? Array.Empty<PlaylistTreeEntry>();
            var gameResponse = gameResult.Value ?? new DiscoverySearchResponse();
            var games = gameResponse.Titles;
            var notices = new List<string>();
            if (workResult.Error is not null) notices.Add("Library search is unavailable right now.");
            if (playlistResult.Error is not null) notices.Add("Playlist search is unavailable right now.");
            if (gameResult.Error is not null) notices.Add("Game search is unavailable right now.");
            else if (gameResponse.Providers.FirstOrDefault(provider => provider.Provider == "game" && provider.State != "ok") is { } providerIssue)
                notices.Add(string.IsNullOrWhiteSpace(providerIssue.Reason) ? "Game search is temporarily unavailable." : providerIssue.Reason);
            var notice = string.Join("  ", notices);
            SynchronizationContextHolder.Post(() =>
            {
                if (!cts.IsCancellationRequested) Show(works.ToList(), playlists.ToList(), games.ToList(), q, notice);
            });
        }
        catch (Exception e)
        {
            if (!cts.IsCancellationRequested)
            {
                Dbg.Log("SEARCH failed: " + e.Message);
                SynchronizationContextHolder.Post(() =>
                {
                    if (cts.IsCancellationRequested) return;
                    _notice.Text = "Search is unavailable right now.";
                    _notice.Show(true);
                });
            }
        }
    }

    private async Task<IReadOnlyList<PlaylistTreeEntry>> LoadPlaylistsAsync()
    {
        var request = _playlistsRequest ??= new PlaylistDirectoryApi(_env.Api, SearchHttp).LoadAsync();
        try { return await request.ConfigureAwait(false); }
        catch
        {
            if (ReferenceEquals(_playlistsRequest, request)) _playlistsRequest = null;
            throw;
        }
    }

    private static async Task<(T? Value, Exception? Error)> TryRequest<T>(Task<T> request)
    {
        try { return (await request.ConfigureAwait(false), null); }
        catch (Exception error) { return (default, error); }
    }

    private void Show(List<Work> works, List<PlaylistTreeEntry> playlists, List<DiscoveryTitle> games, string q, string? notice = null)
    {
        _searchResults.Clear(); _searchResults.AddRange(works);
        _playlists.Clear(); _playlists.AddRange(playlists);
        _games.Clear(); _games.AddRange(games);
        _notice.Text = CleanProviderReason(notice ?? "");
        _notice.Show(!string.IsNullOrWhiteSpace(notice));
        _query = q;
        RenderResults();
    }

    private void RenderResults()
    {
        foreach (var c in _cards) { _results.Remove(c.Box); c.Box.Dispose(); }
        _cards.Clear(); _items.Clear(); _targets.Clear(); _focus = -1; _scroll = 0; _results.PositionY = 0;
        if (_extras is not null) { _results.Remove(_extras.Root); _extras.Root.Dispose(); _extras = null; }
        _xRow = -1; _extrasGen++; UpdateFades();
        var targets = SearchResults.Build(_query, _mediaType, _searchResults, _playlists.Select(entry => entry.Playlist), _games);
        var gameEmpty = _mediaType == "game" && _query.Length > 0 && targets.Count == 0;
        _empty.Show(targets.Count == 0 && _query.Length == 0);
        _prompt.Text = gameEmpty ? "Choose a different title or refine your search." : "";
        _prompt.Show(gameEmpty);
        _count.Set(_query.Length > 0 ? $"{targets.Count} results".ToUpperInvariant() : "");
        _gameHeading.Show(gameEmpty);
        _gameNotice.Text = gameEmpty ? CleanProviderReason(_notice.Text) : "";
        _gameNotice.Show(gameEmpty && !string.IsNullOrWhiteSpace(_gameNotice.Text));
        _notice.Show(!gameEmpty && !string.IsNullOrWhiteSpace(_notice.Text));
        var progress = HomeModel.IndexByWork(Array.Empty<WatchProgress>());
        for (var i = 0; i < targets.Count; i++)
        {
            var target = targets[i];
            var card = target.Work is { } work
                ? HomeModel.Card(work, progress, true)
                : target.Playlist is { } playlist
                    ? new WorkCard(playlist.Id, WorkKind.Unknown, playlist.Name, playlist.IsSystem ? "System playlist" : "Playlist", "Playlist", "", null, null, null, 0, false)
                    : new WorkCard(Guid.Empty, WorkKind.Unknown, target.Game!.Title, DiscoveryCaption(target.Game), "Game", target.Game.Overview ?? "", null, null, null, 0, false);
            AddResult(card, target, i);
        }
        if (_items.Count > 0 && _targets[0].Work is not null) { _panel.Show(_items[0], kickerOverride: _items[0].Sub, metaLead: HomeModel.MetaLead(_items[0])); _keyArt.Set(_items[0].BackdropUrl); }
        else { _panel.Root.Show(false); }
        _panel.Root.Show(_items.Count > 0 && _targets[0].Work is not null);
        LoadExtras();
        if (_restoreFocus is { } restore)
        {
            _restoreFocus = null;
            _scroll = restore.ScrollOffset;
            SetFocus(restore.ResolveResultIndex(_items.Count));
        }
    }

    /// <summary>Web DiscoveryExtras: titles beyond the library, under the results (All, Movies and Series searches only).</summary>
    private void LoadExtras()
    {
        if (_query.Length == 0 || _mediaType is not ("all" or "movie" or "series")) return;
        var gen = _extrasGen; var q = _query; var cts = _search;
        var top = () => FirstRowY + (int)Math.Ceiling(_items.Count / (float)Columns) * RowPitch - 38.2f + 36;
        void Place(OtherSources next)
        {
            if (_extras is not null) { _results.Remove(_extras.Root); _extras.Root.Dispose(); }
            _extras = next; _results.Add(next.Root); UpdateFades();
        }
        Place(OtherSources.Note(_env, top(), "Checking other sources\u2026", false));
        _env.Images.Track(async () =>
        {
            string? failed = null; IReadOnlyList<DiscoveryTitle> titles = Array.Empty<DiscoveryTitle>();
            try
            {
                var response = await new DiscoverySearch(_env.Api, SearchHttp).SearchAsync(q, "media", 25, cts?.Token ?? default).ConfigureAwait(false);
                titles = DiscoverySearch.ExtraTitles(response.Titles);
            }
            catch (Exception e) { Dbg.Log("SEARCH extras failed: " + e.Message); failed = "Other sources are unavailable right now."; }
            await AuthImage.OnUiAsync(() =>
            {
                if (gen != _extrasGen || _removed) return;
                Place(failed is not null ? OtherSources.Note(_env, top(), failed, false)
                    : titles.Count == 0 ? OtherSources.Note(_env, top(), "Nothing found in other sources.", true)
                    : new OtherSources(_env, titles, top()));
            });
        });
    }

    /// <summary>Web scroll-edge fades on the results scroller: at the start once scrolled, at the end while content remains.</summary>
    private void UpdateFades()
    {
        var rows = (int)Math.Ceiling(_items.Count / (float)Columns);
        var contentH = FirstRowY + rows * RowPitch - 38.2f + 118.8f + (_extras is null ? 0 : 36 + _extras.Height);
        _fadeTop?.Show(_scroll > 0.5f);
        _fadeBottom?.Show(_items.Count > 0 && _scroll + TizenClient.DesignHeight < contentH - 1);
    }

    private void FocusExtras(int row, bool link)
    {
        if (_extras is null) return;
        if (_xRow >= 0) SetExtraRing(false);
        else if (_focus >= 0) _cards[_focus].SetFocused(false);
        SetFieldFocus(false);
        _xRow = row; _xLink = link && _extras.Rows[row].LibraryWork is not null;
        SetExtraRing(true);
        var y = _extras.Root.PositionY + _extras.Rows[row].Y;
        _scroll = Math.Clamp(_scroll, y + OtherSources.RowH + 118.8f - TizenClient.DesignHeight, y - 126f);
        _results.PositionY = -_scroll;
        UpdateFades();
    }

    private void SetExtraRing(bool on)
    {
        if (_extras is null || _xRow < 0) return;
        var r = _extras.Rows[_xRow];
        (_xLink ? r.LinkRing : r.Ring)?.Show(on);
    }

    private bool ExtrasKey(RemoteKey key)
    {
        if (_extras is null || _extras.Rows.Count == 0) { _xRow = -1; return true; }
        var rows = _extras.Rows;
        switch (key)
        {
            case RemoteKey.Down: if (_xRow + 1 < rows.Count) FocusExtras(_xRow + 1, _xLink); return true;
            case RemoteKey.Up:
                if (_xRow > 0) { FocusExtras(_xRow - 1, _xLink); return true; }
                SetExtraRing(false); _xRow = -1;
                { var last = (_items.Count - 1) / Columns; SetFocus(Math.Min(_items.Count - 1, last * Columns + (_xLink ? 0 : Columns - 1))); }
                return true;
            case RemoteKey.Left:
                if (!_xLink && rows[_xRow].LibraryWork is not null) FocusExtras(_xRow, true);
                else { SetExtraRing(false); _xRow = -1; SetFocus(-1); } // nothing further left: as from the first result column, back to the query
                return true;
            case RemoteKey.Right: if (_xLink) FocusExtras(_xRow, false); return true;
            case RemoteKey.Select:
                var row = rows[_xRow];
                if (_xLink && row.LibraryWork is { } wid)
                    _env.Navigate(HomeScreen.DetailRoute(new WorkCard(wid, row.Title.Kind == "series" ? WorkKind.Series : row.Title.Kind == "artist" ? WorkKind.Artist : WorkKind.Movie, row.Title.Title, "", "", "", null, null, null, 0, false)));
                else _ = _extras.ToggleAsync(row, Toast, () => { });
                return true;
            case RemoteKey.Back: SetExtraRing(false); _xRow = -1; SetFocus(-1); return true;
        }
        return true;
    }

    private void AddResult(WorkCard card, SearchResultTarget target, int index)
    {
        _items.Add(card); _targets.Add(target);
        var mediaCard = MediaCard.Search(_env, card, ColXAt(index % Columns), FirstRowY + (index / Columns) * RowPitch, _layout);
        _results.Add(mediaCard.Box); _cards.Add(mediaCard);
    }

    private static string CleanProviderReason(string reason) =>
        System.Text.RegularExpressions.Regex.Replace(reason, @"\s*\(task\s+\d+\)\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant).Trim();

    private static string DiscoveryCaption(DiscoveryTitle title)
    {
        var parts = new List<string>();
        if (title.Year is { } year) parts.Add(year.ToString(System.Globalization.CultureInfo.InvariantCulture));
        parts.AddRange(title.Sources.Select(source => source.Label).Where(label => !string.IsNullOrWhiteSpace(label)).Distinct(StringComparer.CurrentCultureIgnoreCase));
        return parts.Count == 0 ? "Game" : string.Join(" · ", parts);
    }

    private void SetFocus(int index)
    {
        if (_focus >= 0) _cards[_focus].SetFocused(false);
        _focus = index;
        if (index < 0) { SetFieldFocus(true); return; }
        SetFieldFocus(false);
        FocusManager.Instance.SetCurrentFocusView(_cards[index].Box);
        var row = index / Columns;
        _scroll = Math.Clamp(_scroll, row * RowPitch - (FocusedRowMaxY - FirstRowY), row * RowPitch);
        _results.PositionY = -_scroll;
        UpdateFades();
        _cards[index].SetFocused(true);
        if (_targets[index].Work is not null)
        {
            _panel.Show(_items[index], kickerOverride: _items[index].Sub, metaLead: HomeModel.MetaLead(_items[index]));
            _keyArt.Set(_items[index].BackdropUrl);
        }
        else if (SearchResults.PlaylistPreview(_targets[index]) is { } playlistPreview)
        {
            _panel.ShowPlaylistPreview(playlistPreview);
            _keyArt.Set(null);
        }
        else
        {
            _panel.Root.Show(false);
            _keyArt.Set(null);
        }
    }

    public bool OnKey(RemoteKey key)
    {
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right) _keyArt.Arm();
        if (_filters is not null) return _filters.OnKey(key);
        if (_sideFocus >= 0) return SideKey(key);
        if (_xRow >= 0) return ExtrasKey(key);
        if (_focus < 0)
        {
            switch (key)
            {
                case RemoteKey.Right: EnterSide(); return true;
                case RemoteKey.Down: if (_items.Count > 0) SetFocus(0); return true;
                case RemoteKey.Left: case RemoteKey.Back: return false;
                case RemoteKey.Select: FocusManager.Instance.SetCurrentFocusView(_field); _field.EnableEditing = true; return true;
            }
            return true;
        }
        var col = _focus % Columns;
        switch (key)
        {
            case RemoteKey.Right: if (col < Columns - 1 && _focus + 1 < _items.Count) SetFocus(_focus + 1); else EnterSide(); return true;
            case RemoteKey.Left: if (col > 0) { SetFocus(_focus - 1); return true; } SetFocus(-1); return true;
            case RemoteKey.Down:
                if (_focus + Columns < _items.Count) SetFocus(_focus + Columns);
                else if (_extras is { Rows.Count: > 0 }) FocusExtras(0, col == 0);
                return true;
            case RemoteKey.Up: if (_focus >= Columns) SetFocus(_focus - Columns); else SetFocus(-1); return true;
            case RemoteKey.Select:
                var target = _targets[_focus];
                if (target.Work is not null) _env.Navigate(HomeScreen.DetailRoute(_items[_focus]));
                else if (target.Playlist is { } playlist)
                    _env.Navigate(PlaylistDirectoryModel.RouteForSelection(_playlists, playlist.Id).ToRoute());
                else if (target.Game is not null) Toast("Game actions are not available in this app yet.");
                return true;
            case RemoteKey.Back: SetFocus(-1); return true;
        }
        return false;
    }

    private void EnterSide()
    {
        if (_focus >= 0) _cards[_focus].SetFocused(false);
        SetFieldFocus(false);
        if (_filterTile is not null) FocusManager.Instance.SetCurrentFocusView(_filterTile);
        _sideFocus = 0; _side[_sideFocus].Style(true);
    }

    private bool SideKey(RemoteKey key)
    {
        if (key == RemoteKey.Select) { _side[_sideFocus].Select?.Invoke(); return true; }
        if (key is RemoteKey.Left or RemoteKey.Back)
        {
            var cy = _side[_sideFocus].Rect().CentreY;
            _side[_sideFocus].Style(false); _sideFocus = -1;
            if (_items.Count == 0) { SetFocus(-1); return true; }
            var candidates = Enumerable.Range(0, _items.Count).Where(i => i % Columns == Columns - 1 || i == _items.Count - 1);
            var best = candidates.OrderBy(i => Math.Abs(FirstRowY - _scroll + (i / Columns) * RowPitch + _layout.ArtHeight / 2 - cy)).First();
            SetFocus(best);
            return true;
        }
        return true;
    }
}
