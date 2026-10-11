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
    private readonly ImageView _playIcon;
    private readonly FocusSet _focus = new();
    private readonly global::Tizen.NUI.Timer _tick, _hide;
    private Player? _player;
    private PlaybackInfoResponse? _info;
    private bool _controlsVisible = true, _stopped;
    private int _sinceReport;

    public View Root => _root;
    public string Route => $"/player/{_file}";
    public string? FocusedLabel => _focus.Item?.Label;
    public bool Fullscreen => true;
    public float FocusCentreY => 990;

    public PlayerScreen(AppEnv env, Guid file, long startMs = 0)
    {
        _env = env; _t = env.Theme; _file = file; _startMs = startMs;
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
        var playRing = Ring.Make(64, 64, 32, white); playRing.Show(false); play.Add(playRing);
        _controls.Add(play);
        _focus.Items.Add(new Focusable { Rect = () => new Box(147.6f, 958, 64, 64), Label = "pause", Select = TogglePause, Style = f => playRing.Show(f) });
        AddIcon("next", 247.2f, 980, "next", dim: true);
        _now = Ui.Text("0:00", 302.8f, 981.8f, 10.88f, 400, white, 60, 16.32f);
        _controls.Add(_now);
        _controls.Add(Ui.Text("/", 331.4f, 981.8f, 10.88f, 400, new Rgba(0.647f, 0.588f, 0.62f), 10, 16.32f));
        _total = Ui.Text("0:00", 340, 981.8f, 10.88f, 400, white, 80, 16.32f);
        _controls.Add(_total);

        // tools
        AddIcon("volume", 1318.3f, 980, "volume", dim: false);
        AddIcon("captions", 1395.9f, 980, "subtitles", dim: false);
        AddIcon("queue", 1473.5f, 980, "queue", dim: false);
        _controls.Add(Ui.Text("HD", 1543.5f, 984.5f, 7.68f, 800, white, 28, 11.52f, spacing: 0.3f));
        _controls.Add(Ui.Text("Original", 1580.3f, 982.1f, 10.56f, 700, white, 100, 15.84f, spacing: 0.1f));
        AddIcon("info", 1730.4f, 980, "info", dim: false);
        AddIcon("cast", 1808, 980, "play on another device", dim: false);

        _tick = new global::Tizen.NUI.Timer(500); _tick.Tick += (_, _) => { OnTick(); return !_stopped; };
        _hide = new global::Tizen.NUI.Timer(5000); _hide.Tick += (_, _) => { if (_player?.State == PlayerState.Playing) SetControls(false); return false; };
        _focus.Set(_focus.Items.FindIndex(i => i.Label == "pause")); // play button
        _ = StartAsync();
    }

    private void AddTopButton(float x, float w, string icon, string? text, string label, Action select)
    {
        var box = Ui.Box(x, 37.8f, w, 48, new Rgba(0.047f, 0.039f, 0.043f, 0.7f), 24);
        box.BorderlineWidth = 1; box.BorderlineColor = new Color(1, 1, 1, 0.28f);
        box.Add(Ui.Icon(icon, text is null ? 14 : 23.2f, text is null ? 14 : 14, text is null ? 20 : 20, new Rgba(1, 1, 1)));
        if (text is not null) box.Add(Ui.Text(text, 52, 13, 11.2f, 700, new Rgba(1, 1, 1), 70, 22, spacing: 0.22f));
        var ring = Ring.Make(w, 48, 24, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        _controls.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 37.8f, w, 48), Label = label, Select = select, Style = f => ring.Show(f) });
    }

    private void AddIcon(string icon, float x, float y, string label, bool dim)
    {
        _controls.Add(Ui.Icon(icon, x, y, 20, new Rgba(1, 1, 1, dim ? 0.4f : 0.8f)));
        var ring = Ring.Make(36, 36, 18, new Rgba(1, 1, 1)); ring.PositionX = x - 12; ring.PositionY = y - 12; ring.Show(false);
        _controls.Add(ring);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x - 8, y - 8, 36, 36), Label = label, Select = () => { }, Style = f => ring.Show(f) });
    }

    private async Task StartAsync()
    {
        try
        {
            var client = new PlaybackClient(_env.Api, new HttpClient());
            var start = _startMs;
            if (start == 0) try { start = PlaybackResume.FromProgress(await _env.Api.GetWatchProgressAsync(_file)) ?? 0; } catch (Exception) { /* no saved position */ }
            var info = await client.GetInfoAsync(_file, start);
            Dbg.Log($"PLAY mode={info.Mode} dur={info.DurationMs} offset={info.SourceOffsetMs} start={start}");
            SynchronizationContextHolder.Post(() => Begin(info, start));
        }
        catch (Exception e) { Dbg.Log("PLAY info failed: " + e.Message); }
    }

    private async void Begin(PlaybackInfoResponse info, long start)
    {
        try
        {
            _info = info;
            _total.Text = DetailModel.Clock(info.DurationMs);
            _player = new Player();
            if (info.SessionId is { } sid) _player.Cookie = PlaybackClient.SessionCookie(sid);
            _player.ErrorOccurred += (_, e) => Dbg.Log("PLAY error " + e.Error);
            _player.PlaybackCompleted += (_, _) => SynchronizationContextHolder.Post(OnCompleted);
            _player.SetSource(new MediaUriSource(_env.Abs(info.Url)));
            _player.Display = new Display(Window.Default);
            Window.Default.BackgroundColor = Color.Transparent;
            await _player.PrepareAsync();
            if (_stopped || _player is null) return;
            if (start > info.SourceOffsetMs && info.Mode != PlaybackMode.Hls) await _player.SetPlayPositionAsync((int)start, false);
            _player.Start();
            Dbg.Log("PLAY started");
            _tick.Start(); _hide.Start();
        }
        catch (Exception e) { Dbg.Log("PLAY begin failed: " + e); }
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

    private void TogglePause()
    {
        if (_player is null) return;
        try
        {
            if (_player.State == PlayerState.Playing) { _player.Pause(); _playIcon.ResourceUrl = Ui.ResPath("icons/play.svg"); }
            else { _player.Start(); _playIcon.ResourceUrl = Ui.ResPath("icons/pause.svg"); _hide.Restart(); }
        }
        catch (Exception e) { Dbg.Log("PLAY toggle failed: " + e.Message); }
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
