using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Native playlist creation drawer with a TV-friendly media and parent selector.</summary>
internal sealed class PlaylistCreateDrawer : IDisposable
{
    private readonly AppEnv _env;
    private readonly IReadOnlyList<PlaylistTreeEntry> _entries;
    private readonly Guid? _excludedPlaylistId;
    private readonly Action<string, string, Guid?> _submit;
    private readonly Action _close;
    private readonly FocusSet _focus = new();
    private readonly TextField _name;
    private readonly TextLabel _parentValue;
    private readonly TextLabel _error;
    private readonly View _video;
    private readonly View _audio;
    private readonly TextLabel _videoLabel;
    private readonly TextLabel _audioLabel;
    private readonly View _create;
    private readonly TextLabel _createLabel;
    private readonly List<PlaylistTreeEntry> _parents = new();
    private string _mediaType = "video";
    private int _parentIndex = -1;
    private bool _submitting;
    private bool _disposed;

    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;
    public bool IsNameEditing => !_disposed && _focus.Current == 1 && _name.EnableEditing;

    public PlaylistCreateDrawer(
        AppEnv env,
        IReadOnlyList<PlaylistTreeEntry> entries,
        Guid? excludedPlaylistId,
        Action<string, string, Guid?> submit,
        Action close)
    {
        _env = env;
        _entries = entries;
        _excludedPlaylistId = excludedPlaylistId;
        _submit = submit;
        _close = close;
        var theme = env.Theme;
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.DrawerPanel(theme);
        panel.BorderlineWidth = 1;
        panel.BorderlineColor = Ui.C(theme.Line);
        Root.Add(panel);
        Root.Add(Ui.Text("PERSONAL PLAYLIST", 1606, 54, 9.6f, 800, theme.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Ui.Text("Create playlist", 1606, 71.6f, 31.2f, 600, theme.Ink, 268, 46.8f, spacing: -1.6f));

        var closeView = Ui.Box(1826, 54, 48, 50, theme.SurfaceSoft, 25);
        closeView.Add(Ui.Icon("close", 17, 18, 14, theme.Ink));
        var closeRing = Ring.Make(48, 50, 25, new Rgba(1, 1, 1));
        closeRing.Show(false);
        closeView.Add(closeRing);
        Root.Add(closeView);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Style = focused => closeRing.Show(focused), Select = _close });

        Root.Add(Ui.Text("NAME", 1606, 143, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var nameBox = Ui.Box(1606, 168, 268, 58, new Rgba(theme.SurfaceSoft.R, theme.SurfaceSoft.G, theme.SurfaceSoft.B, 0.68f), 12);
        nameBox.BorderlineWidth = 1;
        nameBox.BorderlineColor = Ui.LineA(theme, 0.74f);
        _name = new TextField
        {
            PositionX = 16,
            PositionY = 9,
            Size = new Size(236, 40),
            Focusable = true,
            MaxLength = int.MaxValue,
            PixelSize = 13,
            TextColor = Ui.C(theme.Ink),
            PlaceholderText = "Playlist name",
            PlaceholderTextColor = Ui.C(theme.InkMuted),
            FontFamily = Ui.Font,
            EnableCursorBlink = true,
        };
        nameBox.Add(_name);
        var nameRing = Ring.Make(268, 58, 12, new Rgba(1, 1, 1));
        nameRing.Show(false);
        nameBox.Add(nameRing);
        Root.Add(nameBox);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 168, 268, 58),
            Label = "playlist name",
            Style = focused =>
            {
                nameRing.Show(focused);
                if (!focused)
                {
                    _name.EnableEditing = false;
                    FocusManager.Instance.ClearFocus();
                }
            },
            Select = FocusName,
        });

        Root.Add(Ui.Text("MEDIA TYPE", 1606, 249, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        (_video, _videoLabel) = MediaTypeOption(theme, "Video", 1606);
        (_audio, _audioLabel) = MediaTypeOption(theme, "Audio", 1744);
        Root.Add(_video);
        Root.Add(_audio);
        AddMediaFocus(_video, _videoLabel, 1606, "video");
        AddMediaFocus(_audio, _audioLabel, 1744, "audio");

        Root.Add(Ui.Text("PARENT PLAYLIST", 1606, 341, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var parentBox = Ui.Box(1606, 366, 268, 58, new Rgba(theme.SurfaceSoft.R, theme.SurfaceSoft.G, theme.SurfaceSoft.B, 0.68f), 12);
        parentBox.BorderlineWidth = 1;
        parentBox.BorderlineColor = Ui.LineA(theme, 0.74f);
        _parentValue = Ui.Text("None - top level", 16, 19, 11.84f, 700, theme.Ink, 220, 17.76f);
        parentBox.Add(_parentValue);
        parentBox.Add(Ui.Text("‹  ›", 220, 19, 11.84f, 700, theme.InkMuted, 36, 17.76f, HorizontalAlignment.Center));
        var parentRing = Ring.Make(268, 58, 12, new Rgba(1, 1, 1));
        parentRing.Show(false);
        parentBox.Add(parentRing);
        Root.Add(parentBox);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 366, 268, 58),
            Label = "parent playlist",
            Style = focused => parentRing.Show(focused),
            Select = NextParent,
        });
        Root.Add(Ui.Text("Select to change the parent playlist.", 1606, 432, 10.5f, 400, theme.InkMuted, 268, 15));

        _error = Ui.Text("", 1606, 467, 11, 500, theme.Danger, 268, 34, multiline: true, maxLines: 2);
        _error.Show(false);
        Root.Add(_error);
        (_create, _createLabel) = FormButton(theme, "Create", true, 1606, 516, 268, 56);
        Root.Add(_create);
        var createRing = (View)_create.Children.Last();
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 516, 268, 56),
            Label = "create playlist",
            Style = focused => createRing.Show(focused),
            Select = Submit,
        });
        var cancel = FormButton(theme, "Cancel", false, 1606, 584, 268, 56).Box;
        Root.Add(cancel);
        var cancelRing = (View)cancel.Children.Last();
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 584, 268, 56),
            Label = "cancel create playlist",
            Style = focused => cancelRing.Show(focused),
            Select = _close,
        });

        SetMediaType("video");
        _focus.Set(1);
    }

    private (View Box, TextLabel Label) MediaTypeOption(PlayarrTheme theme, string label, float x)
    {
        var box = Ui.Box(x, 274, 130, 54, theme.SurfaceSoft, 12);
        box.BorderlineWidth = 1;
        box.BorderlineColor = Ui.LineA(theme, 0.74f);
        var text = Ui.Text(label, 0, 17, 12, 700, theme.InkMuted, 130, 18, HorizontalAlignment.Center);
        box.Add(text);
        var ring = Ring.Make(130, 54, 12, new Rgba(1, 1, 1));
        ring.Show(false);
        box.Add(ring);
        return (box, text);
    }

    private void AddMediaFocus(View box, TextLabel label, float x, string mediaType)
    {
        var ring = (View)box.Children.Last();
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, 274, 130, 54),
            Label = mediaType,
            Style = focused => ring.Show(focused),
            Select = () => SetMediaType(mediaType),
        });
    }

    private (View Box, TextLabel Label) FormButton(PlayarrTheme theme, string label, bool primary, float x, float y, float width, float height)
    {
        var box = Ui.Box(x, y, width, height, primary ? theme.Accent : theme.SurfaceSoft, 28);
        box.BorderlineWidth = 1;
        box.BorderlineColor = Ui.LineA(theme, 0.15f);
        var text = Ui.Text(label, 0, (height - 18) / 2, 12, 700, primary ? theme.OnAccent : theme.Ink, width, 18, HorizontalAlignment.Center);
        box.Add(text);
        var ring = Ring.Make(width, height, 28, new Rgba(1, 1, 1));
        ring.Show(false);
        box.Add(ring);
        return (box, text);
    }

    private void SetMediaType(string mediaType)
    {
        _mediaType = mediaType;
        var theme = _env.Theme;
        var videoSelected = mediaType == "video";
        _video.BackgroundColor = Ui.C(videoSelected ? theme.Ink : theme.SurfaceSoft);
        _videoLabel.TextColor = Ui.C(videoSelected ? theme.OnAccent : theme.InkMuted);
        _audio.BackgroundColor = Ui.C(videoSelected ? theme.SurfaceSoft : theme.Ink);
        _audioLabel.TextColor = Ui.C(videoSelected ? theme.InkMuted : theme.OnAccent);
        _parents.Clear();
        _parents.AddRange(PlaylistDirectoryModel.EligibleParents(_entries, mediaType, _excludedPlaylistId));
        _parentIndex = -1;
        UpdateParentLabel();
    }

    private void NextParent()
    {
        _parentIndex = PlaylistDirectoryModel.CycleParentIndex(_parentIndex, _parents.Count, 1);
        UpdateParentLabel();
    }

    private void UpdateParentLabel()
    {
        _parentValue.Text = _parentIndex < 0 ? "None - top level" : _parents[_parentIndex].Playlist.Name;
    }

    private void Submit()
    {
        if (_submitting) return;
        var name = _name.Text.Trim();
        if (name.Length == 0)
        {
            SetError("Enter a name for the playlist.");
            _focus.Set(1);
            FocusName();
            return;
        }
        _error.Show(false);
        _submit(name, _mediaType, _parentIndex < 0 ? null : _parents[_parentIndex].Playlist.Id);
    }

    public void SubmitFromTextInput()
    {
        if (IsNameEditing) Submit();
    }

    private void FocusName()
    {
        if (!_name.Focusable)
        {
            Dbg.Log("PLAYLISTS create: name field is not focusable");
            return;
        }
        FocusManager.Instance.SetCurrentFocusView(_name);
        _name.EnableEditing = true;
    }

    public void FocusNameInput() => FocusName();

    public void SetSubmitting(bool submitting)
    {
        if (_disposed) return;
        _submitting = submitting;
        _createLabel.Text = submitting ? "Creating…" : "Create";
    }

    public void SetError(string message)
    {
        if (_disposed) return;
        SetSubmitting(false);
        _error.Text = message;
        _error.Show(true);
    }

    public bool OnKey(RemoteKey key)
    {
        if (_disposed) return true;
        if (key == RemoteKey.Back) { _close(); return true; }
        if (key == RemoteKey.Select) { _focus.Item?.Select?.Invoke(); return true; }
        if (key is RemoteKey.Up or RemoteKey.Down or RemoteKey.Left or RemoteKey.Right)
        {
            if (_focus.Current == 4 && (key is RemoteKey.Left or RemoteKey.Right))
            {
                _parentIndex = PlaylistDirectoryModel.CycleParentIndex(_parentIndex, _parents.Count, key == RemoteKey.Right ? 1 : -1);
                UpdateParentLabel();
                return true;
            }
            _focus.Move(key);
            return true;
        }
        return false;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _focus.Clear();
    }
}
