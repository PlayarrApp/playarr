using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

internal enum PlaylistManagementMode
{
    Create,
    Edit,
    Delete,
}

/// <summary>Authenticated playlist create, rename and delete actions in the web right-side drawer pattern.</summary>
internal sealed class PlaylistManagementDrawer
{
    private readonly FocusSet _focus = new();
    private readonly Action _close;
    private readonly Action _completed;
    private readonly PlaylistDirectoryApi _api;
    private readonly PlaylistManagementMode _mode;
    private readonly Guid? _playlistId;
    private readonly IReadOnlyList<PlaylistTreeEntry> _entries;
    private readonly List<PlaylistTreeEntry> _parentOptions = new();
    private Guid? _parentPlaylistId;
    private string _mediaType;
    private readonly TextField? _name = null;
    private readonly TextLabel _error = null!;
    private TextLabel? _parentValue;
    private int _parentFocusIndex = -1;
    private bool _busy;
    private bool _disposed;
    private bool _nameEditing;
    private bool _focusIndicatorWasEnabled;
    private CancellationTokenSource? _request;
    private int _requestVersion;

    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    public PlaylistManagementDrawer(
        AppEnv env,
        PlaylistDirectoryApi api,
        PlaylistManagementMode mode,
        string title,
        string initialName,
        string mediaType,
        Guid? playlistId,
        Guid? parentPlaylistId,
        IReadOnlyList<PlaylistTreeEntry> entries,
        Action close,
        Action completed)
    {
        var theme = env.Theme;
        _api = api;
        _mode = mode;
        _playlistId = playlistId;
        _parentPlaylistId = parentPlaylistId;
        _entries = entries;
        _mediaType = mediaType;
        _close = close;
        _completed = completed;
        _focusIndicatorWasEnabled = FocusManager.Instance.IsFocusIndicatorEnabled();
        FocusManager.Instance.EnableFocusIndicator(false);
        FocusManager.Instance.ClearFocus();
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.DrawerPanel(theme);
        panel.BorderlineWidth = 1;
        panel.BorderlineColor = Ui.C(theme.Line);
        Root.Add(panel);
        Root.Add(Ui.Text("Playlists", 1606, 54, 9.6f, 800, theme.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Ui.Text(title, 1606, 71.6f, 32f, 600, theme.Ink, 220, 48, spacing: -1.4f));
        var closeView = Ui.Box(1826, 54, 48, 50, theme.SurfaceSoft, 25);
        closeView.Add(Ui.Icon("close", 17, 18, 14, theme.Ink));
        var closeRing = Ring.Make(48, 50, 25, new Rgba(1, 1, 1));
        closeRing.Show(false);
        closeView.Add(closeRing);
        Root.Add(closeView);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Style = focused => closeRing.Show(focused), Select = _close });

        if (mode == PlaylistManagementMode.Delete)
        {
            Ui.Paragraph(Root, $"Delete {initialName} and its nested playlists? This cannot be undone.", 1606, 167, 14, 500,
                theme.InkMuted, 268, 21, 0, 4);
            _error = Ui.Text("", 1606, 278, 11.5f, 500, theme.Danger, 268, 36, multiline: true, maxLines: 2);
            Root.Add(_error);
            var deleteCancelRing = AddButton(env, 1606, 360, 128, 56, "Cancel", false);
            var deleteRing = AddButton(env, 1746, 360, 128, 56, "Delete", true);
            _focus.Items.Add(new Focusable { Rect = () => new Box(1606, 360, 128, 56), Label = "cancel delete", Style = focused => deleteCancelRing.Show(focused), Select = _close });
            _focus.Items.Add(new Focusable { Rect = () => new Box(1746, 360, 128, 56), Label = "delete", Style = focused => deleteRing.Show(focused), Select = DeleteAsync });
            _focus.Set(1);
            return;
        }

        Root.Add(Ui.Text("Playlist name", 1606, 157, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var field = Ui.Box(1606, 185, 268, 58, theme.SurfaceSoft, 12);
        field.BorderlineWidth = 1;
        field.BorderlineColor = Ui.C(theme.Line);
        _name = new TextField
        {
            PositionX = 14,
            PositionY = 9,
            Size = new Size(240, 40),
            PixelSize = 14,
            TextColor = Ui.C(theme.Ink),
            FontFamily = Ui.Font,
            PlaceholderText = "Playlist name",
            PlaceholderTextColor = Ui.C(theme.InkMuted),
            Text = initialName,
            EnableCursorBlink = true,
            Focusable = true,
        };
        field.Add(_name);
        var fieldRing = Ring.Make(268, 58, 12, new Rgba(1, 1, 1));
        fieldRing.Show(false);
        field.Add(fieldRing);
        Root.Add(field);
        var buttonY = 340f;
        if (mode == PlaylistManagementMode.Create && parentPlaylistId is null)
        {
            Root.Add(Ui.Text("Media type", 1606, 259, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
            var choices = new List<(View Box, TextLabel Text)>();
            foreach (var (value, label, index) in new[] { ("video", "Video", 0), ("audio", "Audio", 1) })
            {
                var x = 1606 + index * 138f;
                var selected = value == _mediaType;
                var choice = Ui.Box(x, 286, 130, 44, selected ? theme.Ink : theme.SurfaceSoft, 12);
                var text = Ui.Text(label, 0, 13, 12, 700, selected ? theme.OnAccent : theme.InkMuted, 130, 18, HorizontalAlignment.Center);
                choice.Add(text);
                var ring = Ring.Make(130, 44, 12, new Rgba(1, 1, 1));
                ring.Show(false);
                choice.Add(ring);
                Root.Add(choice);
                choices.Add((choice, text));
                var option = value;
                var focusIndex = _focus.Items.Count;
                _focus.Items.Add(new Focusable
                {
                    Rect = () => new Box(x, 286, 130, 44),
                    Label = label.ToLowerInvariant(),
                    Style = focused => ring.Show(focused),
                    Select = () =>
                    {
                        var mediaChanged = !string.Equals(_mediaType, option, StringComparison.OrdinalIgnoreCase);
                        _mediaType = option;
                        for (var i = 0; i < choices.Count; i++)
                        {
                            var active = i == index;
                            choices[i].Box.BackgroundColor = Ui.C(active ? theme.Ink : theme.SurfaceSoft);
                            choices[i].Text.TextColor = Ui.C(active ? theme.OnAccent : theme.InkMuted);
                        }
                        if (mediaChanged)
                        {
                            _parentPlaylistId = null;
                            UpdateParentOptions();
                        }
                        _focus.Set(focusIndex);
                    },
                });
            }
            AddParentSelector(env, 345, 368, PlaylistDirectoryModel.EligibleParents(_entries, null, _mediaType));
            buttonY = 470;
            _error = Ui.Text("", 1606, 420, 11.5f, 500, theme.Danger, 268, 36, multiline: true, maxLines: 2);
        }
        else if (mode == PlaylistManagementMode.Edit)
        {
            AddParentSelector(env, 259, 286, PlaylistDirectoryModel.EligibleParents(_entries, playlistId, _mediaType));
            buttonY = 420;
            _error = Ui.Text("", 1606, 350, 11.5f, 500, theme.Danger, 268, 36, multiline: true, maxLines: 2);
        }
        else
        {
            _error = Ui.Text("", 1606, 259, 11.5f, 500, theme.Danger, 268, 36, multiline: true, maxLines: 2);
        }
        Root.Add(_error);
        var nameFocusIndex = _focus.Items.Count;
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 185, 268, 58),
            Label = "playlist name",
            Style = focused => fieldRing.Show(focused),
            Select = BeginNameEdit,
        });
        var cancelRing = AddButton(env, 1606, buttonY, 128, 56, "Cancel", false);
        var saveRing = AddButton(env, 1746, buttonY, 128, 56, mode == PlaylistManagementMode.Create ? "Create" : "Save", true);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1606, buttonY, 128, 56), Label = "cancel", Style = focused => cancelRing.Show(focused), Select = _close });
        _focus.Items.Add(new Focusable { Rect = () => new Box(1746, buttonY, 128, 56), Label = mode == PlaylistManagementMode.Create ? "create" : "save", Style = focused => saveRing.Show(focused), Select = SaveAsync });
        _focus.Set(nameFocusIndex);
    }

    private View AddButton(AppEnv env, float x, float y, float width, float height, string label, bool primary)
    {
        var theme = env.Theme;
        var button = Ui.Box(x, y, width, height, primary ? theme.Ink : theme.SurfaceSoft, height / 2);
        button.BorderlineWidth = 1;
        button.BorderlineColor = Ui.LineA(theme, 0.15f);
        button.Add(Ui.Text(label, 0, height / 2 - 9, 12, 700, primary ? theme.OnAccent : theme.Ink, width, 18, HorizontalAlignment.Center));
        var ring = Ring.Make(width, height, height / 2, new Rgba(1, 1, 1));
        ring.Show(false);
        button.Add(ring);
        Root.Add(button);
        return ring;
    }

    private void AddParentSelector(AppEnv env, float labelY, float buttonY, IReadOnlyList<PlaylistTreeEntry> options)
    {
        var theme = env.Theme;
        Root.Add(Ui.Text("Parent playlist", 1606, labelY, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var button = Ui.Box(1606, buttonY, 268, 44, theme.SurfaceSoft, 12);
        button.BorderlineWidth = 1;
        button.BorderlineColor = Ui.C(theme.Line);
        _parentValue = Ui.Text("", 12, 12, 12, 600, theme.Ink, 244, 19);
        button.Add(_parentValue);
        var ring = Ring.Make(268, 44, 12, new Rgba(1, 1, 1));
        ring.Show(false);
        button.Add(ring);
        Root.Add(button);
        _parentOptions.Clear();
        _parentOptions.AddRange(options);
        if (_parentPlaylistId is { } current && !_parentOptions.Any(entry => entry.Playlist.Id == current))
            _parentPlaylistId = null;
        _parentFocusIndex = _focus.Items.Count;
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, buttonY, 268, 44),
            Label = "parent playlist",
            Style = focused => ring.Show(focused),
            Select = () => MoveParent(1),
        });
        RefreshParentLabel();
    }

    private void UpdateParentOptions()
    {
        _parentOptions.Clear();
        _parentOptions.AddRange(PlaylistDirectoryModel.EligibleParents(_entries, _playlistId, _mediaType));
        if (_parentPlaylistId is { } current && !_parentOptions.Any(entry => entry.Playlist.Id == current))
            _parentPlaylistId = null;
        RefreshParentLabel();
    }

    private void MoveParent(int direction)
    {
        if (_parentValue is null) return;
        var selected = _parentPlaylistId is { } current
            ? _parentOptions.FindIndex(entry => entry.Playlist.Id == current) + 1
            : 0;
        var next = Math.Clamp(selected + direction, 0, _parentOptions.Count);
        if (next == selected) return;
        _parentPlaylistId = next == 0 ? null : _parentOptions[next - 1].Playlist.Id;
        RefreshParentLabel();
    }

    private void RefreshParentLabel()
    {
        if (_parentValue is null) return;
        _parentValue.Text = _parentPlaylistId is { } selected
            ? "Parent: " + PlaylistPath(selected)
            : "Parent: None (top level)";
    }

    private string PlaylistPath(Guid playlistId)
    {
        var byId = _entries.ToDictionary(entry => entry.Playlist.Id);
        var names = new List<string>();
        var visited = new HashSet<Guid>();
        var current = playlistId;
        while (visited.Add(current) && byId.TryGetValue(current, out var entry))
        {
            names.Add(entry.Playlist.Name);
            if (entry.ParentPlaylistId is not { } parent) break;
            current = parent;
        }
        names.Reverse();
        return string.Join(" / ", names);
    }

    private void BeginNameEdit()
    {
        if (_disposed || _name is null) return;
        _name.Focusable = true;
        _name.EnableEditing = true;
        _nameEditing = true;
        FocusManager.Instance.SetCurrentFocusView(_name);
    }

    private void LeaveNameEdit()
    {
        if (!_nameEditing || _name is null) return;
        _nameEditing = false;
        _name.EnableEditing = false;
        _name.Focusable = false;
        FocusManager.Instance.ClearFocus();
    }

    private async void SaveAsync()
    {
        if (_disposed || _busy || _name is null) return;
        var name = _name.Text.Trim();
        if (name.Length == 0)
        {
            _error.Text = "Enter a playlist name.";
            return;
        }
        _busy = true;
        var request = _request = new CancellationTokenSource();
        var requestVersion = ++_requestVersion;
        try
        {
            if (_mode == PlaylistManagementMode.Create)
                await _api.CreateAsync(name, _mediaType, _parentPlaylistId, request.Token);
            else if (_playlistId is { } playlistId)
                await _api.UpdateAsync(playlistId, name, _parentPlaylistId, request.Token);
            SynchronizationContextHolder.Post(() =>
            {
                if (_disposed || requestVersion != _requestVersion) return;
                _completed();
            });
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            Dbg.Log("PLAYLISTS save failed: " + error.Message);
            SynchronizationContextHolder.Post(() =>
            {
                if (_disposed || requestVersion != _requestVersion) return;
                _busy = false;
                _error.Text = "Couldn't save this playlist. Check the name and try again.";
            });
        }
        finally
        {
            SynchronizationContextHolder.Post(() =>
            {
                if (ReferenceEquals(_request, request)) _request = null;
                request.Dispose();
            });
        }
    }

    private async void DeleteAsync()
    {
        if (_disposed || _busy || _playlistId is not { } playlistId) return;
        _busy = true;
        var request = _request = new CancellationTokenSource();
        var requestVersion = ++_requestVersion;
        try
        {
            await _api.DeleteAsync(playlistId, request.Token);
            SynchronizationContextHolder.Post(() =>
            {
                if (_disposed || requestVersion != _requestVersion) return;
                _completed();
            });
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            Dbg.Log("PLAYLISTS delete failed: " + error.Message);
            SynchronizationContextHolder.Post(() =>
            {
                if (_disposed || requestVersion != _requestVersion) return;
                _busy = false;
                _error.Text = "Couldn't delete this playlist. Try again.";
            });
        }
        finally
        {
            SynchronizationContextHolder.Post(() =>
            {
                if (ReferenceEquals(_request, request)) _request = null;
                request.Dispose();
            });
        }
    }

    public bool OnKey(RemoteKey key)
    {
        if (_disposed) return true;
        if (_nameEditing && key == RemoteKey.Back)
        {
            LeaveNameEdit();
            return true;
        }
        if (_nameEditing && (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right))
            LeaveNameEdit();
        if (_parentFocusIndex >= 0 && _focus.Current == _parentFocusIndex && (key is RemoteKey.Left or RemoteKey.Right))
        {
            MoveParent(key == RemoteKey.Left ? -1 : 1);
            return true;
        }
        switch (key)
        {
            case RemoteKey.Back:
                _close();
                return true;
            case RemoteKey.Select:
                _focus.Item?.Select?.Invoke();
                return true;
            default:
                _focus.Move(key);
                return true;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _requestVersion++;
        _request?.Cancel();
        FocusManager.Instance.ClearFocus();
        FocusManager.Instance.EnableFocusIndicator(_focusIndicatorWasEnabled);
    }
}
