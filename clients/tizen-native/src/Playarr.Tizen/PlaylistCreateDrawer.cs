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
    private readonly List<ImageView> _mediaIcons = new();
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
        Ui.Paragraph(Root, "Create playlist", 1606, 71.6f, 38.4f, 600, theme.Ink, 200, 57.6f, spacing: -2.1f);

        var closeView = Ui.Box(1826, 54, 48, 50, theme.SurfaceSoft, 25);
        closeView.Add(Ui.Icon("close", 14, 15, 20, theme.Ink));
        var closeRing = Ring.Make(48, 50, 25, new Rgba(1, 1, 1));
        closeRing.Show(false);
        closeView.Add(closeRing);
        Root.Add(closeView);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Style = focused => closeRing.Show(focused), Select = _close });

        Root.Add(Ui.Text("NAME", 1606, 221, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var nameBox = Ui.Box(1606, 248, 268, 62, new Rgba(theme.SurfaceSoft.R, theme.SurfaceSoft.G, theme.SurfaceSoft.B, 0.68f), 12);
        nameBox.BorderlineWidth = 1;
        nameBox.BorderlineColor = Ui.LineA(theme, 0.74f);
        _name = new TextField
        {
            PositionX = 23,
            PositionY = 11,
            Size = new Size(222, 40),
            Focusable = true,
            PixelSize = 15,
            TextColor = Ui.C(theme.Ink),
            PlaceholderText = "Playlist name",
            PlaceholderTextColor = Ui.C(theme.InkMuted),
            FontFamily = Ui.Font,
            EnableCursorBlink = true,
        };
        _name.TextChanged += (_, _) => UpdateCreateEnabled();
        nameBox.Add(_name);
        var nameRing = Ring.Make(268, 62, 12, new Rgba(1, 1, 1));
        nameRing.Show(false);
        nameBox.Add(nameRing);
        Root.Add(nameBox);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 248, 268, 62),
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

        Root.Add(Ui.Text("PLAYLIST TYPE", 1606, 323, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        (_video, _videoLabel) = MediaTypeOption(theme, "Video", "movies", 1606);
        (_audio, _audioLabel) = MediaTypeOption(theme, "Audio", "music", 1745);
        Root.Add(_video);
        Root.Add(_audio);
        AddMediaFocus(_video, _videoLabel, 1606, "video");
        AddMediaFocus(_audio, _audioLabel, 1745, "audio");

        Root.Add(Ui.Text("PARENT PLAYLIST", 1606, 437, 9.6f, 800, theme.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
        var parentBox = Ui.Box(1606, 464, 268, 62, new Rgba(theme.SurfaceSoft.R, theme.SurfaceSoft.G, theme.SurfaceSoft.B, 0.68f), 12);
        parentBox.BorderlineWidth = 1;
        parentBox.BorderlineColor = Ui.LineA(theme, 0.74f);
        parentBox.Add(Ui.Icon("playlists", 21, 23, 16, theme.InkMuted));
        _parentValue = Ui.Text("None - top level", 45, 22.5f, 11.84f, 700, theme.Ink, 190, 17.76f);
        parentBox.Add(_parentValue);
        parentBox.Add(Ui.Icon("chevron-down", 237, 25, 12, theme.InkMuted));
        var parentRing = Ring.Make(268, 62, 12, new Rgba(1, 1, 1));
        parentRing.Show(false);
        parentBox.Add(parentRing);
        Root.Add(parentBox);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 464, 268, 62),
            Label = "parent playlist",
            Style = focused => parentRing.Show(focused),
            Select = NextParent,
        });

        _error = Ui.Text("", 1606, 536, 11, 500, theme.Danger, 268, 34, multiline: true, maxLines: 2);
        _error.Show(false);
        Root.Add(_error);
        (_create, _createLabel) = FormButton(theme, "Create", true, 1606, 545, 268, 58);
        Root.Add(_create);
        var createRing = (View)_create.Children.Last();
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1606, 545, 268, 58),
            Label = "create playlist",
            Style = focused => createRing.Show(focused),
            Select = Submit,
        });
        SetMediaType("video");
        _focus.Set(0); // web opens with the close button focused; Select on the name field starts typing
        UpdateCreateEnabled();
    }

    private (View Box, TextLabel Label) MediaTypeOption(PlayarrTheme theme, string label, string icon, float x)
    {
        var box = Ui.Box(x, 350, 129, 74, theme.SurfaceSoft, 12);
        box.BorderlineWidth = 1;
        box.BorderlineColor = Ui.LineA(theme, 0.74f);
        var glyph = Ui.Icon(icon, 31, 25, 24, theme.InkMuted);
        box.Add(glyph);
        _mediaIcons.Add(glyph);
        var text = Ui.Text(label, 67, 28, 12.8f, 700, theme.InkMuted, 56, 18);
        box.Add(text);
        var ring = Ring.Make(129, 74, 12, new Rgba(1, 1, 1));
        ring.Show(false);
        box.Add(ring);
        return (box, text);
    }

    private void AddMediaFocus(View box, TextLabel label, float x, string mediaType)
    {
        var ring = (View)box.Children.Last();
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, 350, 129, 74),
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
        _video.BorderlineColor = videoSelected ? Ui.C(theme.Brand) : Ui.LineA(theme, 0.74f);
        _audio.BorderlineColor = videoSelected ? Ui.LineA(theme, 0.74f) : Ui.C(theme.Brand);
        _mediaIcons[0].Color = Ui.C(videoSelected ? theme.OnAccent : theme.InkMuted);
        _mediaIcons[1].Color = Ui.C(videoSelected ? theme.InkMuted : theme.OnAccent);
        _parents.Clear();
        _parents.AddRange(PlaylistDirectoryModel.EligibleParents(_entries, mediaType, _excludedPlaylistId));
        _parentIndex = -1;
        UpdateParentLabel();
    }

    /// <summary>Web: the Create button is dimmed while the name is empty.</summary>
    private void UpdateCreateEnabled() => _create.Opacity = _name.Text.Trim().Length == 0 ? 0.45f : 1f;

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

    /// <summary>Capture hook (DebugMirror /text): the emulator on-screen keyboard cannot be driven from the host, so the typed name is set directly.</summary>
    public void SetName(string value) => _name.Text = value;

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
