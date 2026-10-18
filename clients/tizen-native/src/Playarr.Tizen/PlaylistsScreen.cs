using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Native playlist directory and root/child detail route.</summary>
internal sealed class PlaylistsScreen : IPage
{
    private const float ClipX = 729.6f, DirectoryFirstRowY = 162f, DetailHeadingY = 341f, DetailFirstRowY = 421.719f, FocusedRowMaxY = 819f;
    private const float DetailFirstCardX = 881.609f;
    private CardLayout _layout;
    private float RowPitch => _layout.CardHeight + 37.8f;
    private float DetailTrackPitch => _layout.CardHeight + 134.6f;
    private float DetailCardPitch => _layout.LibraryPitchX;
    private int Cols => _layout.Columns;
    private float DirectoryColXAt(int c) => 783.36f + c * _layout.LibraryPitchX;
    private static readonly HttpClient PlaylistHttp = new();
    private static readonly SemaphoreSlim CoverLoadLimit = new(3);
    private sealed record SavedState(Guid? DirectorySelection, int Focus, float Scroll, PlaylistItemFocus? ItemFocus);
    private sealed class DetailTrackState(PlaylistTreeEntry entry, TextLabel heading, TextLabel meta, View empty)
    {
        public PlaylistTreeEntry Entry { get; } = entry;
        public TextLabel Heading { get; } = heading;
        public TextLabel Meta { get; } = meta;
        public View Empty { get; } = empty;
        public List<Work> Works { get; } = new();
        public List<MediaCard> Cards { get; } = new();
        public int Selected { get; set; }
        public float ScrollX { get; set; }
    }
    private sealed record ActionControl(View Parent, View View, Focusable Target);

    private readonly AppEnv _env;
    private readonly PlayarrTheme _theme;
    private readonly View _root = new();
    private readonly View _results = new();
    private readonly TextLabel _title;
    private readonly PageSubtitle _count;
    private readonly TextLabel _eyebrow;
    private readonly TextLabel _featureTitle;
    private readonly TextLabel _featureCopy;
    private readonly TextLabel _status;
    private readonly KeyArt _keyArt;
    private readonly DetailsPanel _detailPanel;
    private readonly FocusSet _focus = new();
    private readonly List<MediaCard> _cards = new();
    private View? _fadeTop, _fadeBottom;
    private readonly List<DetailTrackState> _detailTracks = new();
    private readonly List<(int Track, int Work)> _focusLocations = new();
    private readonly List<ActionControl> _actionControls = new();
    private PlaylistRouteState _route;
    private IReadOnlyList<PlaylistTreeEntry> _entries = Array.Empty<PlaylistTreeEntry>();
    private Guid? _directorySelection;
    private SavedState? _restore;
    private CancellationTokenSource? _loadRequest;
    private CancellationTokenSource? _detailRequest;
    private CancellationTokenSource? _coverRequest;
    private float _scroll;
    private bool _ready;
    private bool _failed;
    private bool _removed;
    private bool _itemsLoaded;
    private bool _attached;
    private bool _focusIndicatorWasEnabled;
    private int _activeTrack = -1;
    private int _actionFocus = -1;
    private string? _restoreActionLabel;
    private PlaylistManagementDrawer? _management;

    public View Root => _root;
    public string Route => _route.ToRoute();
    public bool IsReady => _ready;
    public string? FocusedLabel => _management?.FocusedLabel ?? (_actionFocus >= 0 ? _actionControls[_actionFocus].Target.Label : _focus.Item?.Label);
    public float FocusCentreY => _management is not null ? 79 : _actionFocus >= 0 ? _actionControls[_actionFocus].Target.Rect().CentreY : _focus.CurrentRect is { Height: > 0 } rect ? rect.CentreY : 210.8f;

    public PlaylistsScreen(AppEnv env, string route)
    {
        _env = env; _layout = CardLayout.Library(false, env.Store.Appearance().ArtworkSize);
        _theme = env.Theme;
        _route = PlaylistRouteState.Parse(route);
        _directorySelection = _route.PlaylistId;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_theme.Surface);
        _keyArt = new KeyArt(env, armed: true);
        _root.Add(_keyArt.Root);
        _detailPanel = new DetailsPanel(env, library: true, includeRuntime: false, useWebNoMetaOverviewGap: true);
        _detailPanel.Root.Show(false);
        _root.Add(_detailPanel.Root);

        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_theme.SurfaceStrong.R, _theme.SurfaceStrong.G, _theme.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1;
        back.BorderlineColor = Ui.LineA(_theme, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _theme.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _title = Ui.Text("Playlists", 226.6f, 56.2f, 33.6f, 600, _theme.Ink, 600, 50, spacing: -1.51f);
        _root.Add(_title);
        _count = new PageSubtitle(env, _root, "Playlists");
        _eyebrow = Ui.Text("YOUR COLLECTION", 153.6f, 259.2f, 12.288f, 800, _theme.BrandInk, 455, 18.432f, upper: true, spacing: 0.98f);
        _root.Add(_eyebrow);
        _featureTitle = Ui.Text("Playlists", 153.6f, 303.5f, 49.92f, 600, _theme.Ink, 455, 56, spacing: -2.4f, maxLines: 3);
        _root.Add(_featureTitle);
        _featureCopy = Ui.Text("Choose a playlist to view its contents.", 153.6f, 485, 13.824f, 500, _theme.InkMuted, 336, 110, multiline: true, maxLines: 5);
        _root.Add(_featureCopy);
        _status = Ui.Text("", 153.6f, 620, 13.5f, 500, _theme.InkMuted, 500, 58, multiline: true, maxLines: 3);
        _status.Show(false);
        _root.Add(_status);

        var clip = new View { PositionX = ClipX, Size = new Size(TizenClient.DesignWidth - ClipX, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        _results.PositionX = -ClipX;
        clip.Add(_results);
        _root.Add(clip);
        _fadeTop = Ui.EdgeFade(ClipX, 0, TizenClient.DesignWidth - ClipX, _theme.Surface, true);
        _fadeBottom = Ui.EdgeFade(ClipX, TizenClient.DesignHeight, TizenClient.DesignWidth - ClipX, _theme.Surface, false);
        _fadeTop.Show(false); _fadeBottom.Show(false); _root.Add(_fadeTop); _root.Add(_fadeBottom);
        _ = LoadAsync();
    }

    public object? SaveState()
    {
        PlaylistItemFocus? itemFocus = null;
        if (_focus.Current >= 0 && _focus.Current < _focusLocations.Count)
        {
            var location = _focusLocations[_focus.Current];
            itemFocus = new PlaylistItemFocus(_detailTracks[location.Track].Entry.Playlist.Id, _detailTracks[location.Track].Works[location.Work].Id);
        }
        return new SavedState(_directorySelection, _focus.Current, _scroll, itemFocus);
    }

    public void RestoreState(object state)
    {
        if (state is SavedState saved) _restore = saved;
    }

    private async Task LoadAsync()
    {
        _loadRequest?.Cancel();
        _loadRequest?.Dispose();
        var loadRequest = _loadRequest = new CancellationTokenSource();
        _ready = false;
        _failed = false;
        _status.Text = "Loading playlists…";
        _status.Show(true);
        try
        {
            var entries = await new PlaylistDirectoryApi(_env.Api, PlaylistHttp).LoadAsync(loadRequest.Token);
            if (_removed) return;
            SynchronizationContextHolder.Post(() =>
            {
                if (_removed) return;
                _entries = entries;
                _route = PlaylistDirectoryModel.NormalizeRoute(_entries, _route);
                if (_route.PlaylistId is { } selected) _directorySelection = PlaylistDirectoryModel.RouteForSelection(_entries, selected).PlaylistId;
                _ready = true;
                Render();
            });
        }
        catch (OperationCanceledException) { }
        catch (Exception error)
        {
            if (loadRequest.IsCancellationRequested || _removed) return;
            Dbg.Log("PLAYLISTS load failed: " + error.Message);
            SynchronizationContextHolder.Post(() =>
            {
                if (_removed) return;
                _ready = true;
                _failed = true;
                _status.Text = "Couldn't load playlists. Press Select to try again.";
                _status.Show(true);
                _count.Set("", _title.Text);
            });
        }
    }

    private void Render()
    {
        ClearActionControls();
        if (_attached) FocusManager.Instance.ClearFocus();
        _detailRequest?.Cancel();
        _detailRequest?.Dispose();
        _detailRequest = null;
        _coverRequest?.Cancel();
        _coverRequest?.Dispose();
        _coverRequest = null;
        _focus.Clear();
        _focusLocations.Clear();
        foreach (var track in _detailTracks)
        {
            _results.Remove(track.Heading);
            _results.Remove(track.Meta);
            _results.Remove(track.Empty);
            track.Heading.Dispose();
            track.Meta.Dispose();
            track.Empty.Dispose();
        }
        _detailTracks.Clear();
        foreach (var card in _cards) { _results.Remove(card.Box); card.Box.Dispose(); }
        _cards.Clear();
        _scroll = 0;
        _itemsLoaded = _route.PlaylistId is null;
        _activeTrack = -1;
        _results.PositionY = 0;
        _status.Show(false);
        _failed = false;

        if (_route.PlaylistId is not { } rootId)
        {
            _detailPanel.Root.Show(false);
            _keyArt.Set(null);
            _eyebrow.Show(true);
            _featureTitle.Show(true);
            _featureCopy.Show(true);
            var roots = PlaylistDirectoryModel.Roots(_entries);
            _coverRequest = new CancellationTokenSource();
            _title.Text = "Playlists";
            _count.Set($"{roots.Count} PLAYLISTS", _title.Text);
            _eyebrow.Text = "YOUR COLLECTION";
            _featureTitle.Text = "Playlists";
            _featureCopy.Text = roots.Count == 0 ? "Playlists you create on any device show up here." : "Choose a playlist to view its contents.";
            for (var i = 0; i < roots.Count; i++)
            {
                var root = roots[i];
                AddPlaylistCard(root, i, () => OpenRoot(root.Playlist.Id));
            }
            AddCreateAction(_root, () => OpenCreate(null, "video"));
            RestoreFocus(directory: true);
            return;
        }

        var current = _entries.FirstOrDefault(entry => entry.Playlist.Id == rootId);
        if (current is null)
        {
            _detailPanel.Root.Show(false);
            _keyArt.Set(null);
            _eyebrow.Show(true);
            _featureTitle.Show(true);
            _featureCopy.Show(true);
            _title.Text = "Playlists";
            _count.Set("", _title.Text);
            _eyebrow.Text = "PLAYLIST UNAVAILABLE";
            _featureTitle.Text = "This playlist isn't available.";
            _featureCopy.Text = "Return to Playlists and choose another playlist.";
            return;
        }

        _directorySelection = rootId;
        _title.Text = current.Playlist.Name;
        var tracks = PlaylistDirectoryModel.DetailTracks(_entries, rootId);
        _count.Set($"{MediaTypeLabel(current.Playlist.MediaType)} · {tracks.Count} {(tracks.Count == 1 ? "TRACK" : "TRACKS")}", _title.Text);
        _eyebrow.Show(false);
        _featureTitle.Show(false);
        _featureCopy.Show(false);
        _detailPanel.Root.Show(true);
        _keyArt.Set(null);
        if (!current.Playlist.IsSystem)
            AddCreateAction(_root, () => OpenCreate(current.Playlist.Id, current.Playlist.MediaType));
        BuildDetailTracks(tracks);
        _detailRequest = new CancellationTokenSource();
        _ = LoadDetailTracksAsync(tracks, _route, _detailRequest.Token);
        RestoreFocus(directory: false);
    }

    private void AddPlaylistCard(PlaylistTreeEntry entry, int index, Action select)
    {
        var directory = _route.PlaylistId is null;
        var row = index / Cols;
        var x = DirectoryColXAt(index % Cols);
        var y = DirectoryFirstRowY + row * RowPitch;
        var cardModel = new WorkCard(entry.Playlist.Id, WorkKind.Unknown, entry.Playlist.Name,
            entry.Playlist.IsSystem ? "System playlist" : "Playlist", "Playlist", "", null, null, null, 0, false);
        var card = MediaCard.PlaylistDirectory(_env, cardModel, x, y, _layout);
        AddCard(card, index, entry.Playlist.Name.ToLowerInvariant(), select, x, y);
        if (directory && _coverRequest is { } coverRequest)
            _ = LoadDirectoryCoversAsync(entry, card, coverRequest.Token);
    }

    private async Task LoadDirectoryCoversAsync(PlaylistTreeEntry playlist, MediaCard card, CancellationToken cancellationToken)
    {
        var acquired = false;
        try
        {
            await CoverLoadLimit.WaitAsync(cancellationToken).ConfigureAwait(false);
            acquired = true;
            var selected = new PlaylistCoverSelection.Collector();
            var requestedWorks = new HashSet<Guid>();
            var playlistIds = new[] { playlist.Playlist.Id }.Concat(
                PlaylistDirectoryModel.Descendants(_entries, playlist.Playlist.Id).Select(entry => entry.Playlist.Id));
            foreach (var playlistId in playlistIds)
            {
                IList<PlaylistItem> items;
                try
                {
                    items = await _env.Api.ListPlaylistItemsAsync(playlistId, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception error)
                {
                    Dbg.Log("PLAYLISTS covers: items failed: " + error.Message);
                    continue;
                }

                foreach (var item in items.OrderBy(item => item.Position))
                {
                    if (cancellationToken.IsCancellationRequested) return;
                    if (selected.IsComplete) break;
                    if (!requestedWorks.Add(item.WorkId)) continue;
                    try
                    {
                        var detail = await _env.Api.GetWorkAsync(item.WorkId, cancellationToken).ConfigureAwait(false);
                        selected.Add(detail.Work);
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception error)
                    {
                        Dbg.Log("PLAYLISTS covers: work failed: " + error.Message);
                    }
                }
                if (selected.IsComplete) break;
            }

            if (cancellationToken.IsCancellationRequested || _removed) return;
            SynchronizationContextHolder.Post(() =>
            {
                if (cancellationToken.IsCancellationRequested || _removed) return;
                card.SetPlaylistCovers(_env, playlist.Playlist.Name, selected.Works);
            });
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { Dbg.Log("PLAYLISTS covers failed: " + error.Message); }
        finally
        {
            if (acquired) CoverLoadLimit.Release();
        }
    }

    private void AddWorkCard(DetailTrackState track, int trackIndex, int itemIndex, Work work)
    {
        var baseCard = HomeModel.Card(work, new Dictionary<Guid, WatchProgress>(), true);
        var kind = WorkLabels.KindLabel(work.Kind);
        var cardModel = baseCard with { Sub = kind };
        var x = DetailFirstCardX + itemIndex * DetailCardPitch;
        var y = DetailFirstRowY + trackIndex * DetailTrackPitch;
        var card = MediaCard.PlaylistDetail(_env, cardModel, x, y, _layout);
        card.Box.Focusable = true;
        track.Cards.Add(card);
        _cards.Add(card);
        _results.Add(card.Box);
        var target = new Focusable
        {
            Rect = () => card.FocusRect(x - track.ScrollX, y - _scroll),
            Label = (work.Title + " " + kind).Trim().ToLowerInvariant(),
            Style = card.SetFocused,
            Select = () => _env.Navigate(HomeScreen.DetailRoute(cardModel)),
            Focused = () => SelectDetailWork(trackIndex, itemIndex),
        };
        _focus.Items.Add(target);
        _focusLocations.Add((trackIndex, itemIndex));
    }

    private void AddCard(MediaCard card, int index, string label, Action select, float x, float y)
    {
        card.Box.Focusable = true;
        _cards.Add(card);
        _results.Add(card.Box);
        var target = new Focusable
        {
            Rect = () => card.FocusRect(x, y - _scroll),
            Label = label,
            Style = card.SetFocused,
            Select = select,
        };
        _focus.Items.Add(target);
    }

    private void BuildDetailTracks(IReadOnlyList<PlaylistTreeEntry> entries)
    {
        _detailTracks.Clear();
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            var title = entry.Playlist.Name;
            var heading = Ui.Text(title, DetailFirstCardX, DetailHeadingY + index * DetailTrackPitch, 17.664f, 610,
                _theme.InkMuted, 700, 24.7296f, spacing: -0.53f);
            var meta = Ui.Text(MediaTypeWord(entry.Playlist.MediaType), DetailFirstCardX, DetailHeadingY + 25f + index * DetailTrackPitch,
                9.984f, 500, _theme.InkMuted, 700, 13.9776f);
            var empty = Ui.Box(DetailFirstCardX, DetailFirstRowY + 35f + index * DetailTrackPitch, 560, 84);
            empty.Add(Ui.Text("This playlist is empty.", 0, 0, 16f, 600, _theme.Ink, 560, 22.4f));
            empty.Add(Ui.Text("Add titles to see them in this track.", 0, 31f, 12.8f, 400, _theme.InkMuted, 560, 18f));
            empty.Show(false);
            _results.Add(heading);
            _results.Add(meta);
            _results.Add(empty);
            _detailTracks.Add(new DetailTrackState(entry, heading, meta, empty));
        }
        SetDetailPositions();
    }

    private async Task LoadDetailTracksAsync(IReadOnlyList<PlaylistTreeEntry> entries, PlaylistRouteState route, CancellationToken cancellationToken)
    {
        using var limit = new SemaphoreSlim(4);
        var tasks = entries.Select(async entry =>
        {
            var works = new List<Work>();
            var failed = false;
            try
            {
                var items = await _env.Api.ListPlaylistItemsAsync(entry.Playlist.Id, cancellationToken).ConfigureAwait(false);
                var ordered = items.OrderBy(item => item.Position).ToList();
                var workTasks = ordered.Select(async item =>
                {
                    await limit.WaitAsync(cancellationToken).ConfigureAwait(false);
                    try
                    {
                        var detail = await _env.Api.GetWorkAsync(item.WorkId, cancellationToken).ConfigureAwait(false);
                        return (item.Position, Work: detail.Work);
                    }
                    catch (Exception error) when (error is not OperationCanceledException)
                    {
                        return (item.Position, Work: (Work?)null);
                    }
                    finally { limit.Release(); }
                }).ToList();
                var resolved = await Task.WhenAll(workTasks).ConfigureAwait(false);
                works.AddRange(resolved.Where(result => result.Work is not null).OrderBy(result => result.Position).Select(result => result.Work!));
                failed = resolved.Any(result => result.Work is null);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception error)
            {
                Dbg.Log("PLAYLISTS track failed: " + error.Message);
                failed = true;
            }
            return (Entry: entry, Works: works, Failed: failed);
        }).ToList();

        try
        {
            var loaded = await Task.WhenAll(tasks).ConfigureAwait(false);
            if (cancellationToken.IsCancellationRequested) return;
            SynchronizationContextHolder.Post(() =>
            {
                if (cancellationToken.IsCancellationRequested || _removed || _route != route) return;
                _itemsLoaded = true;
                _status.Show(false);
                for (var trackIndex = 0; trackIndex < _detailTracks.Count; trackIndex++)
                {
                    var track = _detailTracks[trackIndex];
                    var result = loaded.First(item => item.Entry.Playlist.Id == track.Entry.Playlist.Id);
                    track.Works.AddRange(result.Works);
                    track.Empty.Show(track.Works.Count == 0);
                    var count = track.Works.Count == 0 ? "" : $"{(trackIndex == 0 ? "Direct items · " : "")}{track.Works.Count} {(track.Works.Count == 1 ? "title" : "titles")}";
                    track.Meta.Text = string.Join(" · ", new[] { MediaTypeWord(track.Entry.Playlist.MediaType), count }.Where(value => value.Length > 0));
                    track.Heading.TextColor = trackIndex == _activeTrack ? Ui.C(_theme.Ink) : Ui.C(_theme.InkMuted);
                    for (var itemIndex = 0; itemIndex < track.Works.Count; itemIndex++)
                        AddWorkCard(track, trackIndex, itemIndex, track.Works[itemIndex]);
                }
                if (loaded.Any(item => item.Failed))
                {
                    _status.Text = "Some playlist titles couldn't be loaded.";
                    _status.Show(true);
                }
                var requestedTrack = route.TrackId is { } trackId
                    ? _detailTracks.FindIndex(track => track.Entry.Playlist.Id == trackId)
                    : -1;
                _activeTrack = requestedTrack >= 0
                    ? requestedTrack
                    : Math.Max(0, _detailTracks.FindIndex(track => track.Works.Count > 0));
                SetDetailPositions();
                RestoreFocus(directory: false);
            });
        }
        catch (OperationCanceledException) { }
        catch (Exception error)
        {
            Dbg.Log("PLAYLISTS items failed: " + error.Message);
            SynchronizationContextHolder.Post(() =>
            {
                if (cancellationToken.IsCancellationRequested || _removed || _route != route) return;
                _itemsLoaded = true;
                _status.Text = "Couldn't load this playlist. Press Back to return to Playlists.";
                _status.Show(true);
            });
        }
    }

    private static string MediaTypeWord(string? mediaType) => string.Equals(mediaType, "audio", StringComparison.OrdinalIgnoreCase) ? "Audio" : "Video";
    private static string MediaTypeLabel(string? mediaType) => string.Equals(mediaType, "audio", StringComparison.OrdinalIgnoreCase) ? "AUDIO" : "VIDEO";

    private void SetDetailPositions()
    {
        _scroll = _activeTrack > 0 ? _activeTrack * DetailTrackPitch : 0;
        _results.PositionY = -_scroll;
        var contentH = DetailFirstRowY + _detailTracks.Count * DetailTrackPitch;
        _fadeTop?.Show(_scroll > 0.5f); _fadeBottom?.Show(_scroll + TizenClient.DesignHeight < contentH - 1);
        for (var index = 0; index < _detailTracks.Count; index++)
            _detailTracks[index].Heading.TextColor = Ui.C(index == _activeTrack ? _theme.Ink : _theme.InkMuted);
    }

    private void SelectDetailWork(int trackIndex, int workIndex)
    {
        if (trackIndex < 0 || trackIndex >= _detailTracks.Count) return;
        var track = _detailTracks[trackIndex];
        if (workIndex < 0 || workIndex >= track.Works.Count) return;
        track.Selected = workIndex;
        _activeTrack = trackIndex;
        SetDetailPositions();
        var work = track.Works[workIndex];
        var cardX = DetailFirstCardX + workIndex * DetailCardPitch;
        track.ScrollX = Math.Max(0, cardX + _layout.Width - 1820f);
        if (cardX - track.ScrollX < DetailFirstCardX) track.ScrollX = cardX - DetailFirstCardX;
        for (var index = 0; index < track.Cards.Count; index++)
            track.Cards[index].Box.PositionX = DetailFirstCardX + index * DetailCardPitch - track.ScrollX;
        var card = HomeModel.Card(work, new Dictionary<Guid, WatchProgress>(), true);
        var kicker = $"{MediaTypeLabel(track.Entry.Playlist.MediaType)} · {(track.Entry.Playlist.IsSystem ? "SHARED PLAYLIST" : "YOUR PLAYLIST")}";
        ClearActionControls();
        _detailPanel.Show(card, kickerOverride: kicker);
        _keyArt.Set(card.BackdropUrl);
        RefreshDetailActions();
    }

    private void ClearActionControls()
    {
        if (_actionFocus >= 0 && _actionFocus < _actionControls.Count)
            _actionControls[_actionFocus].Target.Style(false);
        _actionFocus = -1;
        foreach (var control in _actionControls)
        {
            control.Parent.Remove(control.View);
            control.View.Dispose();
        }
        _actionControls.Clear();
    }

    private void AddCreateAction(View parent, Action select)
    {
        const float x = 1845.5f, y = 151.2f, width = 62f, height = 72f;
        var tile = Ui.Box(x, y, width, height, new Rgba(_theme.SurfaceStrong.R, _theme.SurfaceStrong.G, _theme.SurfaceStrong.B, 0.78f), 14);
        tile.Focusable = true;
        tile.BorderlineWidth = 1;
        tile.BorderlineColor = Ui.LineA(_theme, 0.075f);
        tile.Add(Ui.Icon("add", 19, 15, 24, _theme.InkMuted));
        tile.Add(Ui.Text("Create", 0, 44.6f, 8.256f, 700, _theme.InkMuted, width, 12.384f, HorizontalAlignment.Center, spacing: 0.165f));
        var ring = Ring.Make(width, height, 14, new Rgba(1, 1, 1));
        ring.Show(false);
        tile.Add(ring);
        parent.Add(tile);
        var target = new Focusable
        {
            Rect = () => new Box(x, y, width, height),
            Label = "create",
            Style = focused => ring.Show(focused),
            Select = select,
        };
        _actionControls.Add(new ActionControl(parent, tile, target));
    }

    private void AddActionControl(View parent, float x, float y, float width, float height, string label, Action select, bool primary, bool danger = false)
    {
        var dangerSoft = _theme.Name == "dark" ? Rgba.Hex(0x392326) : Rgba.Hex(0xf2dfe1);
        var background = primary ? _theme.Ink : danger ? dangerSoft : _theme.Surface;
        var button = Ui.Box(x, y, width, height, background, height / 2);
        button.Focusable = true;
        button.BorderlineWidth = 1;
        button.BorderlineColor = primary ? Ui.LineA(_theme, 0.15f) : danger ? new Color(_theme.Danger.R, _theme.Danger.G, _theme.Danger.B, 0.35f) : Ui.C(_theme.LineStrong);
        button.Add(Ui.Text(label, 0, height / 2 - 9, 12, 700, primary ? _theme.OnAccent : danger ? _theme.Danger : _theme.InkSoft, width, 18, HorizontalAlignment.Center));
        var ring = Ring.Make(width, height, height / 2, new Rgba(1, 1, 1));
        ring.Show(false);
        button.Add(ring);
        parent.Add(button);
        var target = new Focusable
        {
            Rect = () => new Box(x, y, width, height),
            Label = label.ToLowerInvariant(),
            Style = focused => ring.Show(focused),
            Select = select,
        };
        _actionControls.Add(new ActionControl(parent, button, target));
    }

    private void RefreshDetailActions()
    {
        ClearActionControls();
        if (_route.PlaylistId is not { } rootId) return;
        var root = _entries.FirstOrDefault(entry => entry.Playlist.Id == rootId);
        if (root is not null && !root.Playlist.IsSystem)
            AddCreateAction(_root, () => OpenCreate(root.Playlist.Id, root.Playlist.MediaType));
        if (_activeTrack < 0 || _activeTrack >= _detailTracks.Count) return;
        var track = _detailTracks[_activeTrack].Entry;
        if (track.Playlist.IsSystem) return;
        var y = Math.Min(840, _detailPanel.ContentBottom + 18);
        AddActionControl(_detailPanel.Root, 153.6f, y, 178f, 58f, "Edit name or parent", () => OpenEdit(track), primary: false);
        AddActionControl(_detailPanel.Root, 341.6f, y, 88f, 58f, "Delete", () => OpenDelete(track), primary: false, danger: true);
    }

    private void FocusAction(int index)
    {
        if (index < 0 || index >= _actionControls.Count) return;
        if (_actionFocus < 0) _focus.Item?.Style(false);
        if (_actionFocus >= 0 && _actionFocus < _actionControls.Count)
            _actionControls[_actionFocus].Target.Style(false);
        _actionFocus = index;
        _actionControls[index].Target.Style(true);
        if (_attached) SetNativeFocus(_actionControls[index].View);
    }

    private bool MoveActionFocus(RemoteKey key)
    {
        if (_actionFocus < 0 || _actionControls.Count == 0) return false;
        var rects = _actionControls.Select(control => control.Target.Rect()).ToList();
        var next = GeometricFocus.Next(rects, _actionFocus, key);
        if (next < 0)
        {
            if (key == RemoteKey.Down && _focus.Items.Count > 0)
            {
                _actionControls[_actionFocus].Target.Style(false);
                _actionFocus = -1;
                FocusAt(Math.Max(0, _focus.Current));
                return true;
            }
            return false;
        }
        FocusAction(next);
        return true;
    }

    private void OpenCreate(Guid? parentId, string mediaType)
    {
        OpenManagement(PlaylistManagementMode.Create, "Create playlist", "", mediaType, null, parentId);
    }

    private void OpenEdit(PlaylistTreeEntry entry) =>
        OpenManagement(PlaylistManagementMode.Edit, "Edit playlist", entry.Playlist.Name, entry.Playlist.MediaType, entry.Playlist.Id, entry.ParentPlaylistId);

    private void OpenDelete(PlaylistTreeEntry entry) =>
        OpenManagement(PlaylistManagementMode.Delete, "Delete playlist", entry.Playlist.Name, entry.Playlist.MediaType, entry.Playlist.Id, entry.ParentPlaylistId);

    private void OpenManagement(PlaylistManagementMode mode, string title, string name, string mediaType, Guid? playlistId, Guid? parentId)
    {
        if (_management is not null) return;
        ClearUnderlyingFocusStyle();
        var drawer = new PlaylistManagementDrawer(_env, new PlaylistDirectoryApi(_env.Api, PlaylistHttp), mode, title, name, mediaType,
            playlistId, parentId, _entries, CloseManagement, () => CompleteManagement(mode, playlistId));
        _management = drawer;
        _root.Add(drawer.Root);
    }

    private void CloseManagement()
    {
        if (_management is null) return;
        var drawer = _management;
        _management = null;
        _root.Remove(drawer.Root);
        drawer.Dispose();
        drawer.Root.Dispose();
        if (_attached && !_removed) RestoreNativeFocus();
    }

    private void SetNativeFocus(View view)
    {
        if (!FocusManager.Instance.SetCurrentFocusView(view))
            Dbg.Log("PLAYLISTS NUI focus rejected");
    }

    private void ClearUnderlyingFocusStyle()
    {
        if (_actionFocus >= 0 && _actionFocus < _actionControls.Count)
            _actionControls[_actionFocus].Target.Style(false);
        else if (_focus.Item is { } item)
            item.Style(false);
    }

    private void RestoreNativeFocus()
    {
        if (_actionFocus >= 0 && _actionFocus < _actionControls.Count)
        {
            _actionControls[_actionFocus].Target.Style(true);
            SetNativeFocus(_actionControls[_actionFocus].View);
        }
        else if (_focus.Current >= 0 && _focus.Current < _cards.Count)
        {
            _focus.Item?.Style(true);
            SetNativeFocus(_cards[_focus.Current].Box);
        }
    }

    internal void OnAdded()
    {
        if (_attached) return;
        _attached = true;
        var focusManager = FocusManager.Instance;
        _focusIndicatorWasEnabled = focusManager.IsFocusIndicatorEnabled();
        focusManager.EnableFocusIndicator(false);
        focusManager.ClearFocus();
        RestoreNativeFocus();
    }

    private void CompleteManagement(PlaylistManagementMode mode, Guid? playlistId)
    {
        CloseManagement();
        if (mode == PlaylistManagementMode.Delete && playlistId == _route.PlaylistId)
        {
            _route = new PlaylistRouteState();
            _restore = null;
            _restoreActionLabel = "create";
        }
        else if (mode == PlaylistManagementMode.Create)
        {
            _restore = null;
            _restoreActionLabel = "create";
        }
        else
        {
            _restore = SaveState() as SavedState;
            _restoreActionLabel = null;
        }
        _ = LoadAsync();
    }

    private void OpenRoot(Guid id)
    {
        _directorySelection = id;
        SetRoute(new PlaylistRouteState(id));
    }

    private void OpenChild(Guid id)
    {
        var selected = PlaylistDirectoryModel.RouteForSelection(_entries, id);
        _directorySelection = selected.PlaylistId;
        SetRoute(selected);
    }

    private void SetRoute(PlaylistRouteState route)
    {
        _route = route;
        Render();
    }

    private void RestoreFocus(bool directory)
    {
        if (_restoreActionLabel is { } actionLabel)
        {
            var actionIndex = _actionControls.FindIndex(control => control.Target.Label == actionLabel);
            _restoreActionLabel = null;
            if (actionIndex >= 0) { FocusAction(actionIndex); return; }
        }
        if (_focus.Items.Count == 0)
        {
            if (_actionControls.Count > 0) FocusAction(0);
            return;
        }
        if (!directory && _restore is not null && !_itemsLoaded) return;
        if (_restore is { } restored)
        {
            _restore = null;
            _directorySelection = restored.DirectorySelection;
            _scroll = restored.Scroll;
            _results.PositionY = -_scroll;
            var restoredFocus = restored.Focus;
            if (!directory && restored.ItemFocus is { } itemFocus)
            {
                var items = _focusLocations.Select(location => new PlaylistItemFocus(
                    _detailTracks[location.Track].Entry.Playlist.Id,
                    _detailTracks[location.Track].Works[location.Work].Id)).ToList();
                restoredFocus = PlaylistDirectoryModel.ResolveFocusIndex(items, itemFocus, restored.Focus);
            }
            if (!directory && restoredFocus >= 0 && restoredFocus < _focus.Items.Count)
            {
                FocusAt(restoredFocus);
                return;
            }
        }
        if (directory && _directorySelection is { } selected)
        {
            var index = PlaylistDirectoryModel.Roots(_entries).ToList().FindIndex(entry => entry.Playlist.Id == selected);
            if (index >= 0) { FocusAt(index); return; }
        }
        if (!directory)
        {
            var target = _focusLocations.FindIndex(location => location.Track == _activeTrack && location.Work == 0);
            if (target < 0) target = _focusLocations.FindIndex(location => location.Work == 0);
            if (target >= 0) { FocusAt(target); return; }
        }
        FocusAt(0);
    }

    private void FocusAt(int index)
    {
        if (index < 0 || index >= _focus.Items.Count) return;
        if (_actionFocus >= 0 && _actionFocus < _actionControls.Count)
        {
            _actionControls[_actionFocus].Target.Style(false);
            _actionFocus = -1;
        }
        if (_route.PlaylistId is not null && index < _focusLocations.Count)
        {
            var location = _focusLocations[index];
            _activeTrack = location.Track;
            _detailTracks[location.Track].Selected = location.Work;
            SetDetailPositions();
            _focus.Set(index);
            if (_attached) SetNativeFocus(_cards[index].Box);
            return;
        }
        var row = index / Cols;
        var firstRowY = _route.PlaylistId is null ? DirectoryFirstRowY : DetailFirstRowY;
        _scroll = Math.Clamp(_scroll, firstRowY + row * RowPitch - FocusedRowMaxY, row * RowPitch);
        _results.PositionY = -_scroll;
        // web scroll-edge fades: at the start once scrolled, at the end while rows remain
        var firstY = _route.PlaylistId is null ? DirectoryFirstRowY : DetailFirstRowY;
        var contentH = firstY + (float)Math.Ceiling(_focus.Items.Count / (float)Cols) * RowPitch + 80;
        _fadeTop?.Show(_scroll > 0.5f); _fadeBottom?.Show(_scroll + TizenClient.DesignHeight < contentH - 1);
        _focus.Set(index);
        if (_attached) SetNativeFocus(_cards[index].Box);
    }

    private bool MoveDetailFocus(RemoteKey key)
    {
        if (_focus.Current < 0 || _focus.Current >= _focusLocations.Count) return false;
        var location = _focusLocations[_focus.Current];
        var track = _detailTracks[location.Track];
        if (key == RemoteKey.Left)
        {
            if (location.Work == 0) return false;
            FocusAt(_focus.Current - 1);
            return true;
        }
        if (key == RemoteKey.Right)
        {
            if (location.Work + 1 >= track.Works.Count) return false;
            FocusAt(_focus.Current + 1);
            return true;
        }
        var direction = key == RemoteKey.Down ? 1 : -1;
        for (var nextTrack = location.Track + direction; nextTrack >= 0 && nextTrack < _detailTracks.Count; nextTrack += direction)
        {
            var candidate = _focusLocations.FindIndex(candidate => candidate.Track == nextTrack && candidate.Work == Math.Min(location.Work, _detailTracks[nextTrack].Works.Count - 1));
            if (candidate >= 0) { FocusAt(candidate); return true; }
        }
        return false;
    }

    public bool OnKey(RemoteKey key)
    {
        if (_management is not null) return _management.OnKey(key);
        if (!_ready) return key is not (RemoteKey.Left or RemoteKey.Back);
        if (_failed && key == RemoteKey.Select) { _ = LoadAsync(); return true; }
        if (key == RemoteKey.Back)
        {
            if (_actionFocus >= 0)
            {
                _actionControls[_actionFocus].Target.Style(false);
                _actionFocus = -1;
            }
            var previous = _route.Back();
            if (previous == _route)
            {
                if (_focus.Current >= 0) FocusAt(_focus.Current);
                return false;
            }
            SetRoute(previous);
            return true;
        }
        if (_actionFocus >= 0)
        {
            if (key == RemoteKey.Select) { _actionControls[_actionFocus].Target.Select?.Invoke(); return true; }
            if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right)
                return MoveActionFocus(key) || key != RemoteKey.Left;
        }
        if (_focus.Items.Count == 0)
        {
            if (key == RemoteKey.Select && _actionControls.Count > 0) { FocusAction(0); return true; }
            return key is not RemoteKey.Left;
        }
        if (key == RemoteKey.Select) { _focus.Item?.Select?.Invoke(); return true; }
        if (_route.PlaylistId is not null && (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right))
        {
            if (MoveDetailFocus(key)) return true;
            if (_actionControls.Count > 0 && (key is RemoteKey.Up or RemoteKey.Right)) { FocusAction(0); return true; }
            return key != RemoteKey.Left;
        }
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right)
        {
            if (!_focus.Move(key))
            {
                if (key == RemoteKey.Right && _actionControls.Count > 0) { FocusAction(0); return true; }
                return key != RemoteKey.Left;
            }
            if (_focus.Current >= 0) FocusAt(_focus.Current);
            return true;
        }
        return false;
    }

    internal void OnRemoved()
    {
        _removed = true;
        CloseManagement();
        if (_attached) FocusManager.Instance.ClearFocus();
        ClearActionControls();
        _loadRequest?.Cancel();
        _detailRequest?.Cancel();
        _coverRequest?.Cancel();
        _focus.Clear();
        if (_attached)
        {
            var focusManager = FocusManager.Instance;
            focusManager.EnableFocusIndicator(_focusIndicatorWasEnabled);
            _attached = false;
        }
    }
}
