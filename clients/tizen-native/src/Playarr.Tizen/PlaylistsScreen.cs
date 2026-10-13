using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Native playlist directory and root/child detail route.</summary>
internal sealed class PlaylistsScreen : IPage
{
    private const float ClipX = 729.6f, DirectoryFirstRowY = 162f, DetailFirstRowY = 421.719f, RowPitch = 251.2f, FocusedRowMaxY = 926.4f;
    private static readonly float[] DirectoryColX = { 783.36f, 1136.46f, 1489.56f };
    private static readonly float[] DetailColX = { 881.609f, 1234.709f, 1587.809f };
    private static readonly HttpClient PlaylistHttp = new();
    private static readonly SemaphoreSlim CoverLoadLimit = new(3);
    private sealed record SavedState(Guid? DirectorySelection, int Focus, float Scroll);

    private readonly AppEnv _env;
    private readonly PlayarrTheme _theme;
    private readonly View _root = new();
    private readonly View _results = new();
    private readonly TextLabel _title;
    private readonly TextLabel _count;
    private readonly TextLabel _eyebrow;
    private readonly TextLabel _featureTitle;
    private readonly TextLabel _featureCopy;
    private readonly TextLabel _status;
    private readonly FocusSet _focus = new();
    private readonly List<MediaCard> _cards = new();
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

    public View Root => _root;
    public string Route => _route.ToRoute();
    public bool IsReady => _ready;
    public string? FocusedLabel => _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } rect ? rect.CentreY : 210.8f;

    public PlaylistsScreen(AppEnv env, string route)
    {
        _env = env;
        _theme = env.Theme;
        _route = PlaylistRouteState.Parse(route);
        _directorySelection = _route.PlaylistId;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_theme.Surface);

        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_theme.SurfaceStrong.R, _theme.SurfaceStrong.G, _theme.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1;
        back.BorderlineColor = Ui.LineA(_theme, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _theme.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _title = Ui.Text("Playlists", 226.6f, 56.2f, 33.6f, 700, _theme.Ink, 600, 50, spacing: -1.51f);
        _root.Add(_title);
        _count = Ui.Text("", 226.6f, 111.8f, 12.288f, 800, _theme.BrandInk, 480, 18.432f, upper: true, spacing: 0.98f);
        _root.Add(_count);
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
        _ = LoadAsync();
    }

    public object? SaveState() => new SavedState(_directorySelection, _focus.Current, _scroll);

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
                _count.Text = "";
            });
        }
    }

    private void Render()
    {
        _detailRequest?.Cancel();
        _detailRequest?.Dispose();
        _detailRequest = null;
        _coverRequest?.Cancel();
        _coverRequest?.Dispose();
        _coverRequest = null;
        _focus.Clear();
        foreach (var card in _cards) { _results.Remove(card.Box); card.Box.Dispose(); }
        _cards.Clear();
        _scroll = 0;
        _itemsLoaded = _route.PlaylistId is null;
        _results.PositionY = 0;
        _status.Show(false);
        _failed = false;

        if (_route.PlaylistId is not { } rootId)
        {
            var roots = PlaylistDirectoryModel.Roots(_entries);
            _coverRequest = new CancellationTokenSource();
            _title.Text = "Playlists";
            _count.Text = $"{roots.Count} PLAYLISTS";
            _eyebrow.Text = "YOUR COLLECTION";
            _featureTitle.Text = "Playlists";
            _featureCopy.Text = roots.Count == 0 ? "Playlists you create on any device show up here." : "Choose a playlist to view its contents.";
            for (var i = 0; i < roots.Count; i++)
            {
                var root = roots[i];
                AddPlaylistCard(root, i, () => OpenRoot(root.Playlist.Id));
            }
            RestoreFocus(directory: true);
            return;
        }

        var currentId = _route.TrackId ?? rootId;
        var current = _entries.FirstOrDefault(entry => entry.Playlist.Id == currentId);
        if (current is null)
        {
            _title.Text = "Playlists";
            _count.Text = "";
            _eyebrow.Text = "PLAYLIST UNAVAILABLE";
            _featureTitle.Text = "This playlist isn't available.";
            _featureCopy.Text = "Return to Playlists and choose another playlist.";
            return;
        }

        _directorySelection = rootId;
        _title.Text = current.Playlist.Name;
        _count.Text = current.Playlist.IsSystem ? "SYSTEM PLAYLIST" : "PLAYLIST";
        _eyebrow.Text = current.Playlist.IsSystem ? "SYSTEM PLAYLIST" : "YOUR PLAYLIST";
        _featureTitle.Text = current.Playlist.Name;
        _featureCopy.Text = "Loading playlist contents…";
        var children = PlaylistDirectoryModel.Children(_entries, current.Playlist.Id);
        for (var i = 0; i < children.Count; i++)
        {
            var child = children[i];
            AddPlaylistCard(child, i, () => OpenChild(child.Playlist.Id));
        }
        _detailRequest = new CancellationTokenSource();
        _ = LoadItemsAsync(current, _route, _detailRequest.Token);
        RestoreFocus(directory: false);
    }

    private void AddPlaylistCard(PlaylistTreeEntry entry, int index, Action select)
    {
        var directory = _route.PlaylistId is null;
        var row = index / 3;
        var x = directory ? DirectoryColX[index % 3] : DetailColX[index % 3];
        var y = (directory ? DirectoryFirstRowY : DetailFirstRowY) + row * RowPitch;
        var cardModel = new WorkCard(entry.Playlist.Id, WorkKind.Unknown, entry.Playlist.Name,
            entry.Playlist.IsSystem ? "System playlist" : "Playlist", "Playlist", "", null, null, null, 0, false);
        var card = directory ? MediaCard.PlaylistDirectory(_env, cardModel, x, y) : MediaCard.PlaylistDetail(_env, cardModel, x, y);
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

    private void AddWorkCard(Work work, int index)
    {
        var cardModel = HomeModel.Card(work, new Dictionary<Guid, WatchProgress>(), true);
        var x = DetailColX[index % 3];
        var y = DetailFirstRowY + index / 3 * RowPitch;
        var card = MediaCard.PlaylistDetail(_env, cardModel, x, y);
        AddCard(card, index, (work.Title + " " + WorkLabels.KindWithYear(work)).Trim().ToLowerInvariant(),
            () => _env.Navigate(HomeScreen.DetailRoute(cardModel)), x, y);
    }

    private void AddCard(MediaCard card, int index, string label, Action select, float x, float y)
    {
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

    private async Task LoadItemsAsync(PlaylistTreeEntry playlist, PlaylistRouteState route, CancellationToken cancellationToken)
    {
        try
        {
            var items = await _env.Api.ListPlaylistItemsAsync(playlist.Playlist.Id, cancellationToken).ConfigureAwait(false);
            var ordered = items.OrderBy(item => item.Position).ToList();
            using var limit = new SemaphoreSlim(4);
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
            if (cancellationToken.IsCancellationRequested) return;
            var works = resolved.Where(result => result.Work is not null).OrderBy(result => result.Position).Select(result => result.Work!).ToList();
            SynchronizationContextHolder.Post(() =>
            {
                if (cancellationToken.IsCancellationRequested || _removed || _route != route) return;
                _itemsLoaded = true;
                var children = PlaylistDirectoryModel.Children(_entries, playlist.Playlist.Id);
                var index = 0;
                foreach (var child in children) index++;
                foreach (var work in works) AddWorkCard(work, index++);
                var total = children.Count + works.Count;
                _featureCopy.Text = total == 1 ? "1 item" : $"{total} items";
                _count.Text = $"{total} {(total == 1 ? "ITEM" : "ITEMS")}";
                if (resolved.Any(result => result.Work is null)) _status.Text = "Some playlist items couldn't be loaded.";
                _status.Show(resolved.Any(result => result.Work is null));
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
                _featureCopy.Text = "Couldn't load this playlist.";
                _status.Text = "Press Back to return to Playlists.";
                _status.Show(true);
            });
        }
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
        if (_focus.Items.Count == 0) return;
        if (!directory && _restore is not null && !_itemsLoaded) return;
        if (_restore is { } restored)
        {
            _restore = null;
            _directorySelection = restored.DirectorySelection;
            _scroll = restored.Scroll;
            _results.PositionY = -_scroll;
            if (!directory && restored.Focus >= 0 && restored.Focus < _focus.Items.Count)
            {
                FocusAt(restored.Focus);
                return;
            }
        }
        if (directory && _directorySelection is { } selected)
        {
            var index = PlaylistDirectoryModel.Roots(_entries).ToList().FindIndex(entry => entry.Playlist.Id == selected);
            if (index >= 0) { FocusAt(index); return; }
        }
        FocusAt(0);
    }

    private void FocusAt(int index)
    {
        if (index < 0 || index >= _focus.Items.Count) return;
        var row = index / 3;
        var firstRowY = _route.PlaylistId is null ? DirectoryFirstRowY : DetailFirstRowY;
        _scroll = Math.Clamp(_scroll, firstRowY + row * RowPitch - FocusedRowMaxY, row * RowPitch);
        _results.PositionY = -_scroll;
        _focus.Set(index);
    }

    public bool OnKey(RemoteKey key)
    {
        if (!_ready) return key is not (RemoteKey.Left or RemoteKey.Back);
        if (_failed && key == RemoteKey.Select) { _ = LoadAsync(); return true; }
        if (key == RemoteKey.Back)
        {
            var previous = _route.Back();
            if (previous == _route) return false;
            SetRoute(previous);
            return true;
        }
        if (_focus.Items.Count == 0) return key is not RemoteKey.Left;
        if (key == RemoteKey.Select) { _focus.Item?.Select?.Invoke(); return true; }
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right)
        {
            if (!_focus.Move(key)) return key != RemoteKey.Left;
            if (_focus.Current >= 0) FocusAt(_focus.Current);
            return true;
        }
        return false;
    }

    internal void OnRemoved()
    {
        _removed = true;
        _loadRequest?.Cancel();
        _detailRequest?.Cancel();
        _coverRequest?.Cancel();
        _focus.Clear();
    }
}
