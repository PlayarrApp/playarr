using Playarr.Core.Models;
using Playarr.Core.Playback;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;
using Display = Tizen.Multimedia.Display;
using MediaUriSource = Tizen.Multimedia.MediaUriSource;
using Player = Tizen.Multimedia.Player;
using PlayerState = Tizen.Multimedia.PlayerState;

namespace Playarr.Tizen;

/// <summary>
/// Full-screen playback on the TV's native player plane (the video sits under the transparent NUI window) with the web player's
/// controls (measured at 1920x1080): seek track, transport row, tools and the top-right close buttons. Reports watch progress
/// every 10 s and on exit, and resumes from the saved position.
/// </summary>
internal sealed class PlayerScreen : IPage
{
    private const float TrackX = 70f, TrackW = 1780f, TrackY = 933f;
    private const long SeekStepMs = 10_000;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly Guid _file;
    private readonly long _startMs;
    private readonly View _root = new();
    private readonly View _controls = new();
    private readonly View _progress;
    private readonly TextLabel _now, _total;
    private readonly TextLabel _qualityBadge, _qualityLabel;
    private readonly View _qualityRing;
    private float _qualityButtonX = 1532, _qualityButtonWidth = 180;
    private readonly ImageView _playIcon;
    private FocusSet _focus = new();
    private readonly global::Tizen.NUI.Timer _tick, _hide;
    private Player? _player;
    private PlaybackInfoResponse? _info;
    private bool _controlsVisible = true, _stopped;
    private int _sinceReport;
    // Session recovery: the viewer's play state (an error carries none), whether playback ever started, and the retry count.
    private bool _paused, _started, _recovering;
    private int _recoveries;

    public View Root => _root;
    public string Route => $"/player/{_file}";
    public string? FocusedLabel => _focus.Item?.Label;
    public bool Fullscreen => true;
    public float FocusCentreY => 990;

    private readonly string? _local;

    public PlayerScreen(AppEnv env, Guid file, long startMs = 0, string? local = null)
    {
        _env = env; _t = env.Theme; _file = file; _startMs = startMs; _local = local;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _controls.Size = _root.Size;
        _root.Add(_controls);

        var white = new Rgba(1, 1, 1);
        // seek track
        _controls.Add(Ui.Box(TrackX, TrackY, TrackW, 6, new Rgba(1, 1, 1, 0.18f), 3));
        _progress = Ui.Box(TrackX, TrackY, 0, 6, _t.Brand, 3);
        _controls.Add(_progress);

        // top-right: minimise, close
        AddTopButton(1678, 124, "minimise", "Minimise", "minimise", () => CloseSelf());
        AddTopButton(1814, 48, "close", null, "close", () => CloseSelf());

        // transport row
        AddIcon("prev", 92, 980, "previous", dim: true);
        var play = Ui.Box(147.6f, 958, 64, 64, new Rgba(1, 1, 1, 0.14f), 32);
        _playIcon = Ui.Icon("pause", 22, 22, 20, white);
        play.Add(_playIcon);
        var playRing = Ring.Make(64, 64, 32, white, themed: false); playRing.Show(false); play.Add(playRing);
        _controls.Add(play);
        _playRing = playRing;
        _focus.Items.Add(PlayFocusable("pause"));
        // web: Up from the transport row lands on the seek bar
        _focus.Items.Add(new Focusable { Rect = () => new Box(TrackX, TrackY - 14, TrackW, 34), Label = "seek", Select = () => { }, Style = f => _progress.Size = new Size(_progress.Size.Width, f ? 10 : 6) });
        AddIcon("next", 247.2f, 980, "next", dim: true);
        _now = Ui.Text("0:00", 302.8f, 981.8f, 10.88f, 400, white, 60, 16.32f);
        _controls.Add(_now);
        _controls.Add(Ui.Text("/", 331.4f, 981.8f, 10.88f, 400, new Rgba(0.647f, 0.588f, 0.62f), 10, 16.32f));
        _total = Ui.Text("0:00", 340, 981.8f, 10.88f, 400, white, 80, 16.32f);
        _controls.Add(_total);

        // tools
        AddIcon("volume", 1318.3f, 980, "audio", dim: false);
        AddIcon("captions", 1395.9f, 980, "subtitles", dim: false, select: OpenSubtitles);
        AddIcon("queue", 1473.5f, 980, "playlist", dim: false);
        _qualityBadge = Ui.Text("HD", 1543.5f, 984.5f, 7.68f, 800, white, 28, 11.52f, spacing: 0.3f);
        _qualityLabel = Ui.Text("Original", 1580.3f, 982.1f, 10.56f, 700, white, 138, 15.84f, spacing: 0.1f);
        _controls.Add(_qualityBadge);
        _controls.Add(_qualityLabel);
        _qualityRing = Ring.Make(180, 36, 18, new Rgba(1, 1, 1), themed: false); _qualityRing.PositionX = _qualityButtonX; _qualityRing.PositionY = 968; _qualityRing.Show(false); _controls.Add(_qualityRing);
        _focus.Items.Add(new Focusable { Rect = () => new Box(_qualityButtonX, 972, _qualityButtonWidth, 36), Label = "quality", Select = () => { }, Style = f => _qualityRing.Show(f) });
        AddIcon("info", 1730.4f, 980, "info", dim: false);
        AddIcon("cast", 1808, 980, "play on another device", dim: false);

        _tick = new global::Tizen.NUI.Timer(500); _tick.Tick += (_, _) => { OnTick(); return !_stopped; };
        _hide = new global::Tizen.NUI.Timer(5000); _hide.Tick += (_, _) => { if (_panel is null && _player?.State == PlayerState.Playing) SetControls(false); return false; };
        _focus.Set(_focus.Items.FindIndex(i => i.Label == "pause")); // play button
        _ = StartAsync();
    }

    private void AddTopButton(float x, float w, string icon, string? text, string label, Action select)
    {
        var box = Ui.Box(x, 37.8f, w, 48, new Rgba(0.047f, 0.039f, 0.043f, 0.7f), 24);
        box.BorderlineWidth = 1; box.BorderlineColor = new Color(1, 1, 1, 0.28f);
        box.Add(Ui.Icon(icon, text is null ? 14 : 23.2f, text is null ? 14 : 14, text is null ? 20 : 20, new Rgba(1, 1, 1)));
        if (text is not null) box.Add(Ui.Text(text, 52, 13, 11.2f, 700, new Rgba(1, 1, 1), 70, 22, spacing: 0.22f));
        var ring = Ring.Make(w, 48, 24, new Rgba(1, 1, 1), themed: false); ring.Show(false); box.Add(ring);
        _controls.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 37.8f, w, 48), Label = label, Select = select, Style = f => ring.Show(f) });
    }

    private void AddIcon(string icon, float x, float y, string label, bool dim, Action? select = null)
    {
        _controls.Add(Ui.Icon(icon, x, y, 20, new Rgba(1, 1, 1, dim ? 0.4f : 0.8f)));
        if (dim) return; // web: previous and next are disabled (not focusable) when nothing precedes or follows
        var ring = Ring.Make(36, 36, 18, new Rgba(1, 1, 1), themed: false); ring.PositionX = x - 12; ring.PositionY = y - 12; ring.Show(false);
        _controls.Add(ring);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x - 8, y - 8, 36, 36), Label = label, Select = select ?? (() => { }), Style = f => ring.Show(f) });
    }

    private async Task StartAsync()
    {
        try
        {
            if (_local is not null)
            {
                // downloaded copy: no session, no network; the progress report is best effort and fails quietly offline
                var path = _env.Downloads.PlayablePath(_local);
                var rec = _env.Downloads.Records.FirstOrDefault(r => r.Id == _local);
                if (path is null) { SynchronizationContextHolder.Post(() => ShowError("This download is no longer on the device.")); return; }
                var offline = new PlaybackInfoResponse { Mode = PlaybackMode.Direct, Url = path, DurationMs = rec?.RuntimeMs ?? 0 };
                SynchronizationContextHolder.Post(() => Begin(offline, _startMs));
                return;
            }
            var force = _env.Store.ForceDirect();
            var client = new PlaybackClient(_env.Api, new HttpClient(), _env.Caps, force.Video, force.Audio);
            var start = _startMs;
            if (start == 0) try { start = PlaybackResume.FromProgress(await _env.Api.GetWatchProgressAsync(_file)) ?? 0; } catch (Exception) { /* no saved position */ }
            var info = await client.GetInfoAsync(_file, start);
            Dbg.Log($"PLAY mode={info.Mode} dur={info.DurationMs} offset={info.SourceOffsetMs} start={start}");
            SynchronizationContextHolder.Post(() => Begin(info, start));
        }
        catch (PlaybackRefusedException e)
        {
            // 422 and similar refusals: show the server's message, no retry and no "server busy" wording
            Dbg.Log("PLAY refused: " + e.Code);
            SynchronizationContextHolder.Post(() => ShowError(e.Message));
        }
        catch (Exception e)
        {
            Dbg.Log("PLAY info failed: " + e.Message);
            SynchronizationContextHolder.Post(() => ShowError("This title can't be played right now."));
        }
    }

    private async void Begin(PlaybackInfoResponse info, long start, bool startPaused = false)
    {
        try
        {
            _info = info;
            UpdateQualityLabel(info);
            _total.Text = DetailModel.Clock(info.DurationMs);
            _player = new Player();
            if (info.SessionId is { } sid) _player.Cookie = PlaybackClient.SessionCookie(sid);
            _player.ErrorOccurred += (_, e) =>
            {
                Dbg.Log("PLAY error " + e.Error);
                SynchronizationContextHolder.Post(() => _ = RecoverSessionAsync());
            };
            _player.PlaybackCompleted += (_, _) => SynchronizationContextHolder.Post(OnCompleted);
            _player.SetSource(new MediaUriSource(_local is not null ? info.Url : _env.Abs(info.Url)));
            _player.Display = new Display(Window.Default);
            Window.Default.BackgroundColor = Color.Transparent;
            await _player.PrepareAsync();
            if (_stopped || _player is null) return;
            if (_info.DurationMs <= 0) { try { _info.DurationMs = _player.StreamInfo.GetDuration(); _total.Text = DetailModel.Clock(_info.DurationMs); } catch (Exception) { /* keeps the unknown length */ } }
            if (start > info.SourceOffsetMs && info.Mode != PlaybackMode.Hls) await _player.SetPlayPositionAsync((int)start, false);
            _player.Start();
            _started = true;
            // A recovered session keeps the viewer's play state: a player that was paused shows its frame and stays paused.
            if (!PlaybackRecovery.StartPlaying(startPaused)) { _player.Pause(); _paused = true; _playIcon.ResourceUrl = Ui.ResPath("icons/play.svg"); RelabelPlay("play"); }
            else { _paused = false; _playIcon.ResourceUrl = Ui.ResPath("icons/pause.svg"); }
            Dbg.Log("PLAY started");
            if (_pendingToggle) { _pendingToggle = false; TogglePause(); }
            _tick.Start(); _hide.Start();
        }
        catch (Exception e) { Dbg.Log("PLAY begin failed: " + e); }
    }

    /// <summary>
    /// The server reaped or evicted the idle on-demand session (a long pause, a full node): the HLS requests 404 and the
    /// player errors. Ask for a replacement session at the same position and keep the paused/playing state.
    /// </summary>
    private async Task RecoverSessionAsync()
    {
        if (_stopped || _recovering || _info is null) return;
        if (!PlaybackRecovery.ShouldRecover(_info.Mode, _local is not null, _started, _recoveries)) return;
        _recovering = true;
        try
        {
            var position = PositionMs;
            var wasPaused = _paused;
            var attempt = _recoveries++;
            _tick.Stop();
            try { _player?.Stop(); _player?.Unprepare(); _player?.Dispose(); } catch (Exception) { /* already stopped */ }
            _player = null;
            await Task.Delay(PlaybackRecovery.Delay(attempt)).ConfigureAwait(false);
            if (_stopped) return;
            var force = _env.Store.ForceDirect();
            var client = new PlaybackClient(_env.Api, new HttpClient(), _env.Caps, force.Video, force.Audio);
            var info = await client.GetInfoAsync(_file, position).ConfigureAwait(false);
            Dbg.Log($"PLAY recovered session at {position} ms, paused={wasPaused}");
            SynchronizationContextHolder.Post(() => { _recovering = false; if (!_stopped) Begin(info, position, wasPaused); });
        }
        catch (PlaybackRefusedException e) { SynchronizationContextHolder.Post(() => { _recovering = false; ShowError(e.Message); }); }
        catch (Exception e)
        {
            Dbg.Log("PLAY recovery failed: " + e.Message);
            SynchronizationContextHolder.Post(() => { _recovering = false; ShowError("This title can't be played right now."); });
        }
    }

    private long PositionMs
    {
        get
        {
            try { return _player is null ? 0 : _player.GetPlayPosition() + (_info?.SourceOffsetMs ?? 0); }
            catch (Exception) { return 0; }
        }
    }

    private void OnTick()
    {
        if (_player is null || _info is null) return;
        var pos = PositionMs;
        var frac = _info.DurationMs > 0 ? Math.Clamp(pos / (float)_info.DurationMs, 0, 1) : 0;
        _progress.Size = new Size(Math.Max(0, TrackW * frac), 6);
        _now.Text = DetailModel.Clock(pos);
        if (++_sinceReport >= 20) { _sinceReport = 0; Report(pos, completed: false); }
    }

    private bool _error;

    private void ShowError(string message)
    {
        _error = true;
        _controls.Show(false);
        var box = Ui.Box(560, 440, 800, 200, new Rgba(0.047f, 0.039f, 0.043f, 0.92f), 24);
        box.BorderlineWidth = 1; box.BorderlineColor = new Color(1, 1, 1, 0.28f);
        box.Add(Ui.Text("Playback problem", 40, 28, 12, 800, _t.BrandInk, 720, 18, upper: true, spacing: 0.9f));
        Ui.Paragraph(box, message, 40, 60, 20, 600, new Rgba(1, 1, 1), 720, 30, 0, 3);
        var close = Ui.Box(40, 136, 120, 44, new Rgba(1, 1, 1, 0.14f), 22);
        close.Add(Ui.Text("Close", 0, 12, 13, 700, new Rgba(1, 1, 1), 120, 20, HorizontalAlignment.Center));
        var ring = Ring.Make(120, 44, 22, new Rgba(1, 1, 1), themed: false); close.Add(ring);
        box.Add(close);
        _root.Add(box);
    }

    private void Report(long pos, bool completed)
    {
        if (_info is null || _info.DurationMs <= 0) return;
        var body = new UpdateWatchProgressRequest { PositionMs = pos, DurationMs = _info.DurationMs, Completed = completed ? true : null };
        _ = Task.Run(async () => { try { await _env.Api.UpdateWatchProgressAsync(_file, body); } catch (Exception e) { Dbg.Log("PROGRESS failed: " + e.Message); } });
    }

    private void OnCompleted()
    {
        Dbg.Log("PLAY completed event");
        Report(_info?.DurationMs ?? 0, completed: true);
        CloseSelf();
    }

    private View _playRing = null!;
    private Focusable PlayFocusable(string label) => new() { Rect = () => new Box(147.6f, 958, 64, 64), Label = label, Select = TogglePause, Style = f => _playRing.Show(f) };

    private bool _pendingToggle;

    private void TogglePause()
    {
        // a press before playback has started is kept and applied once it has (web toggles the loading video too)
        if (_player is null || !_started) { _pendingToggle = !_pendingToggle; return; }
        try
        {
            if (_player.State == PlayerState.Playing) { _player.Pause(); _paused = true; _playIcon.ResourceUrl = Ui.ResPath("icons/play.svg"); RelabelPlay("play"); }
            else { _player.Start(); _paused = false; _playIcon.ResourceUrl = Ui.ResPath("icons/pause.svg"); RelabelPlay("pause"); _hide.Restart(); }
        }
        catch (Exception e) { Dbg.Log("PLAY toggle failed: " + e.Message); }
    }

    /// <summary>web: the play button's name follows its state ("play" while paused).</summary>
    private void RelabelPlay(string label)
    {
        var i = _focus.Items.FindIndex(x => x.Label is "pause" or "play");
        if (i >= 0) _focus.Items[i] = PlayFocusable(label);
    }

    // ---- subtitles panel (web: a list over the player; Back closes it and focus returns to the subtitles button) ----
    private View? _panel;
    private FocusSet? _outer;

    private void OpenSubtitles()
    {
        if (_panel is not null) return;
        _outer = _focus;
        _hide.Stop();
        var tracks = _info?.SubtitleTracks ?? Array.Empty<PlaybackTrackOption>();
        const float top = 560;
        var panel = Ui.Box(1500, top, 340, 330, new Rgba(0.047f, 0.039f, 0.043f, 0.92f), 16);
        panel.BorderlineWidth = 1; panel.BorderlineColor = new Color(1, 1, 1, 0.2f);
        panel.Add(Ui.Text("Subtitles", 24, 20, 14, 700, new Rgba(1, 1, 1), 292, 22));
        panel.Add(Ui.Text(tracks.Count == 0 ? "No subtitle tracks" : "Track selection is unavailable on this device", 16, 42, 9, 400, new Rgba(0.8f, 0.76f, 0.78f), 308, 16));
        var selected = _info?.SelectedSubtitleTrackId;
        const float viewportTop = 64, viewportHeight = 250, rowHeight = 56;
        var viewport = new View { PositionX = 11, PositionY = viewportTop, Size = new Size(318, viewportHeight), ClippingMode = ClippingModeType.ClipChildren };
        var content = new View { Size = new Size(318, (tracks.Count + 1) * rowHeight + 10) };
        viewport.Add(content);
        panel.Add(viewport);

        var set = new FocusSet();
        var scroll = 0f;
        var initialFocus = 0;
        AddSubtitleRow(content, set, 0, "Off", selected is null, top, viewportTop, viewportHeight, rowHeight, () => scroll, value => { scroll = value; content.PositionY = -scroll; });
        for (var i = 0; i < tracks.Count; i++)
        {
            var track = tracks[i];
            var label = string.IsNullOrWhiteSpace(track.Label) ? track.Language ?? "Subtitle" : track.Label!;
            var isSelected = selected == track.Id;
            if (isSelected) initialFocus = i + 1;
            AddSubtitleRow(content, set, i + 1, label, isSelected, top, viewportTop, viewportHeight, rowHeight, () => scroll, value => { scroll = value; content.PositionY = -scroll; });
        }
        _controls.Add(panel); _panel = panel;
        _focus = set;
        set.Set(initialFocus);
    }

    private static void AddSubtitleRow(View content, FocusSet focus, int index, string label, bool selected, float panelTop, float viewportTop, float viewportHeight, float rowHeight, Func<float> getScroll, Action<float> setScroll)
    {
        var y = 5 + index * rowHeight;
        var row = Ui.Box(5, y, 308, rowHeight, new Rgba(1, 1, 1, selected ? 0.1f : 0.035f), 12);
        row.Add(Ui.Text(label, 16, 17, 12.5f, 700, new Rgba(1, 1, 1), 242, 20));
        if (selected) row.Add(Ui.Text("\u2713", 272, 16, 14, 700, new Rgba(1, 1, 1), 24, 22));
        var ring = Ring.Make(308, rowHeight, 12, new Rgba(1, 1, 1), themed: false);
        ring.Show(false);
        row.Add(ring);
        content.Add(row);
        focus.Items.Add(new Focusable
        {
            Rect = () => new Box(1516, panelTop + viewportTop + y - getScroll(), 308, rowHeight),
            Label = label,
            Select = () => { },
            Style = focused => ring.Show(focused),
            Focused = () =>
            {
                var scroll = getScroll();
                if (y - 5 < scroll) scroll = y - 5;
                else if (y + rowHeight + 5 > scroll + viewportHeight) scroll = y + rowHeight + 5 - viewportHeight;
                setScroll(Math.Clamp(scroll, 0, Math.Max(0, focus.Items.Count * rowHeight + 10 - viewportHeight)));
            },
        });
    }

    private void UpdateQualityLabel(PlaybackInfoResponse info)
    {
        var quality = info.QualityOptions.FirstOrDefault(option => option.Id == info.SelectedQualityId) ?? info.QualityOptions.FirstOrDefault();
        var display = PlaybackPresentation.Quality(quality?.Id, quality?.Label, quality?.Height, quality?.BitrateBps);
        var measuredWidth = Ui.TextWidth(display.Label, 10.56f, 700, 0.1f) + 2;
        var shift = Math.Max(0, measuredWidth - 138);
        _qualityButtonX = 1532 - shift;
        _qualityButtonWidth = 180 + shift;
        _qualityRing.PositionX = _qualityButtonX;
        _qualityRing.Size = new Size(_qualityButtonWidth + 10, 46);
        _qualityBadge.PositionX = 1543.5f - shift;
        _qualityLabel.PositionX = 1580.3f - shift;
        _qualityLabel.Size = new Size(Math.Max(138, measuredWidth), _qualityLabel.Size.Height);
        _qualityLabel.Text = display.Label;
        _qualityBadge.Text = display.Badge;
    }

    private void CloseSubtitles()
    {
        if (_panel is null || _outer is null) return;
        _controls.Remove(_panel); _panel.Dispose(); _panel = null;
        _focus = _outer; _outer = null;
    }

    private async void SeekBy(long deltaMs)
    {
        if (_player is null || _info is null) return;
        try
        {
            var target = Math.Clamp(PositionMs + deltaMs, 0, Math.Max(0, _info.DurationMs - 1000)) - _info.SourceOffsetMs;
            await _player.SetPlayPositionAsync((int)Math.Max(0, target), false);
        }
        catch (Exception e) { Dbg.Log("PLAY seek failed: " + e.Message); }
    }

    private void SetControls(bool visible)
    {
        _controlsVisible = visible;
        _controls.Show(visible);
        if (visible) _hide.Restart();
    }

    private void CloseSelf()
    {
        Dbg.Log("PLAY closing");
        Stop();
        _env.NavigateBack();
    }

    public (bool Playing, long PositionMs) Status
    {
        get
        {
            try { return _player is { State: PlayerState.Playing } ? (true, PositionMs) : (false, 0); }
            catch (Exception) { return (false, 0); }
        }
    }

    public bool OnKey(RemoteKey key)
    {
        if (_error) { if (key is RemoteKey.Select or RemoteKey.Back) CloseSelf(); return true; }
        if (_panel is not null)
        {
            if (key == RemoteKey.Back) { CloseSubtitles(); _hide.Restart(); return true; }
            if (key == RemoteKey.Select) { _focus.Item?.Select?.Invoke(); return true; }
            if (key is RemoteKey.Up or RemoteKey.Down) _focus.Move(key);
            return true;
        }
        switch (key)
        {
            case RemoteKey.Back: Stop(); return false;
            case RemoteKey.Play: case RemoteKey.PlayPause: TogglePause(); SetControls(true); return true;
            case RemoteKey.Pause: if (_player?.State == PlayerState.Playing) TogglePause(); SetControls(true); return true;
            case RemoteKey.FastForward: SeekBy(SeekStepMs); SetControls(true); return true;
            case RemoteKey.Rewind: SeekBy(-SeekStepMs); SetControls(true); return true;
            case RemoteKey.Stop: CloseSelf(); return true;
        }
        if (!_controlsVisible)
        {
            // as web: while hidden, arrows only reveal the controls; Select pauses
            if (key == RemoteKey.Select) TogglePause();
            SetControls(true);
            return true;
        }
        _hide.Restart();
        if (key == RemoteKey.Select) { _focus.Item?.Select?.Invoke(); return true; }
        _focus.Move(key);
        return true;
    }

    public void Stop()
    {
        if (_stopped) return;
        _stopped = true;
        try { if (_info is not null) Report(PositionMs, completed: false); } catch (Exception) { /* best effort */ }
        try { _hide.Stop(); _tick.Stop(); _player?.Stop(); _player?.Unprepare(); _player?.Dispose(); } catch (Exception) { /* already stopped */ }
        _player = null;
        Window.Default.BackgroundColor = Color.Black;
    }
}
