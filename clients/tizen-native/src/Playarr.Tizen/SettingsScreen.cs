using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Settings workspace (web /settings): the option list on the left and the Appearance panel (colour theme) on the right.</summary>
internal sealed class SettingsScreen : IPage
{
    private static readonly string[] Options =
    {
        "Appearance", "Profile avatar", "Language", "Player", "Server connection", "Profile lock", "Invite a friend", "Phone remote", "Your data", "Customise Home",
    };
    private static readonly string[] Numbers = { "01", "02", "03", "04", "05", "06", "07", "09", "10", "11" };

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly View _root = new();
    private readonly FocusSet _focus = new();
    private readonly View _panel = new();
    private readonly View _list = new();
    private readonly View _listClip = new() { PositionX = 140, PositionY = 140, Size = new Size(520, 940), ClippingMode = ClippingModeType.ClipChildren }; // scrolled rows never run under the page header
    private float _scroll;
    private int _listCount;
    // web scrolls the option list so the focused row, its ring and its glow stay clear of the bottom edge (last row ends 153 px above the screen edge)
    private const float ListBottomLimit = 927f;

    private void Show(int option)
    {
        foreach (var c in _panel.Children.ToArray()) { _panel.Remove(c); c.Dispose(); }
        _focus.Items.RemoveRange(_listCount, _focus.Items.Count - _listCount);
        foreach (var k in _focus.Overrides.Keys.Where(k => k.From >= _listCount).ToList()) _focus.Overrides.Remove(k);
        if (option == 3) BuildPlayer(); else if (option == 0) BuildAppearance();
        for (var i = 0; i < _listCount; i++) _focus.Overrides[(i, RemoteKey.Right)] = _listCount;
    }

    /// <summary>Settings > Player > Advanced: the two Off/On switches (default off, stored per device, read on every negotiation).</summary>
    private void BuildPlayer()
    {
        var (video, audio) = _env.Store.ForceDirect();
        _panel.Add(Ui.Text("Advanced", 773.8f, 210, 26.4f, 600, _t.Ink, 800, 39.6f, spacing: -0.92f));
        Switch("Force direct video", "Always play the original video stream; never re-encode it.", 265.8f, video, v => _env.Store.SaveForceDirect(v, _env.Store.ForceDirect().Audio));
        Switch("Force direct audio", "Always play the original audio; never re-encode it.", 465.8f, audio, v => _env.Store.SaveForceDirect(_env.Store.ForceDirect().Video, v));
        var b0 = _listCount; // keep Up/Down inside the panel (the list rows sit at similar heights)
        for (var k = 0; k < 2; k++) { _focus.Overrides[(b0 + k, RemoteKey.Down)] = b0 + 2 + k; _focus.Overrides[(b0 + 2 + k, RemoteKey.Up)] = b0 + k; _focus.Overrides[(b0 + k, RemoteKey.Left)] = k == 0 ? 3 : b0; _focus.Overrides[(b0 + 2 + k, RemoteKey.Left)] = k == 0 ? 3 : b0 + 2; _focus.Overrides[(b0 + k, RemoteKey.Right)] = b0 + 1; _focus.Overrides[(b0 + 2 + k, RemoteKey.Right)] = b0 + 3; }
    }

    private void Switch(string title, string help, float y, bool on, Action<bool> save)
    {
        _panel.Add(Ui.Text(title, 773.8f, y, 19.2f, 700, _t.Ink, 700, 28.8f));
        _panel.Add(Ui.Text(help, 773.8f, y + 30, 13.12f, 400, _t.InkMuted, 900, 20.3f));
        var current = on;
        var labels = new List<(View Box, TextLabel Text)>();
        for (var i = 0; i < 2; i++)
        {
            var idx = i; var x = 773.8f + i * 349.9f; var active = (i == 1) == current;
            var b = Ui.Box(x, y + 62, 342.1f, 56, active ? _t.Ink : _t.SurfaceSoft, 12);
            b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(_t, 0.153f);
            var tl = Ui.Text(i == 0 ? "Off" : "On", 0, 22.2f, 10.56f, 800, active ? _t.OnAccent : _t.InkMuted, 342.1f, 11.6f, HorizontalAlignment.Center);
            b.Add(tl);
            var ring = Ring.Make(342.1f, 56, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
            _panel.Add(b); labels.Add((b, tl));
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x, y + 62, 342.1f, 56), Label = $"{title} {(i == 0 ? "off" : "on")}".ToLowerInvariant(), Style = f => ring.Show(f),
                Select = () =>
                {
                    current = idx == 1; save(current);
                    for (var k = 0; k < 2; k++) { var a = (k == 1) == current; labels[k].Box.BackgroundColor = Ui.C(a ? _t.Ink : _t.SurfaceSoft); labels[k].Text.TextColor = Ui.C(a ? _t.OnAccent : _t.InkMuted); }
                },
            });
        }
    }

    public View Root => _root;
    public string Route => "/settings";
    public string? FocusedLabel => _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public SettingsScreen(AppEnv env)
    {
        _env = env; _t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(_t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, _t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text("Preferences", 226.6f, 56.2f, 33.6f, 600, _t.Ink, 400, 50, spacing: -1.51f));
        _root.Add(Ui.Box(226.6f, 112f, Ui.TextWidth("Preferences", 33.6f, 600, -1.51f), 1, new Rgba(_t.Ink.R, _t.Ink.G, _t.Ink.B, 0.2f)));
        _root.Add(Ui.Text("Appearance", 226.6f, 119f, 10.56f, 600, _t.Ink, 400, 16, upper: true, spacing: 0.85f));
        BuildList();
        _root.Add(_panel);
        _listCount = _focus.Items.Count;
        BuildAppearance();
        for (var i = 0; i < _listCount; i++) _focus.Overrides[(i, RemoteKey.Right)] = _listCount;
        _focus.Set(0);
    }

    private void BuildList()
    {
        _list.PositionX = -140; _list.PositionY = -140;
        _listClip.Add(_list); _root.Add(_listClip);
        for (var i = 0; i < Options.Length; i++)
        {
            var y = 162 + i * 91.9f; var idx = i;
            var card = Ui.Box(153.6f, y, 480.4f, 91.9f, i == 0 ? _t.SurfaceSoft : new Rgba(_t.SurfaceSoft.R, _t.SurfaceSoft.G, _t.SurfaceSoft.B, 0.0f), 18);
            card.Add(Ui.Text(Numbers[i], 32, 23.8f, 9.92f, 800, _t.Ink, 40, 14.88f));
            card.Add(Ui.Text(Options[i], 92, 23.8f, 29.6f, 500, _t.Ink, 307.6f, 44.4f, spacing: -1.04f));
            card.Add(Ui.Text("→", 432.6f, 30.3f, 20.8f, 400, i == 0 ? _t.Ink : _t.InkMuted, 30, 31.2f));
            var ring = Ring.Make(480.4f, 91.9f, 18, new Rgba(1, 1, 1)); ring.Show(false); card.Add(ring);
            _list.Add(card);
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(153.6f, y - _scroll, 480.4f, 91.9f), Label = Options[i].ToLowerInvariant(),
                Style = f => ring.Show(f),
                Select = () => { if (idx is 0 or 3) Show(idx); else Toast(Options[idx] + " is not available in this app yet."); },
            });
        }
    }

    private void BuildAppearance()
    {
        var themes = new[] { "system", "light", "dark" };
        var current = _env.Store.Theme();
        _panel.Add(Ui.Text("Colour theme", 773.8f, 210, 26.4f, 600, _t.Ink, 800, 39.6f, spacing: -0.92f));
        for (var i = 0; i < themes.Length; i++)
        {
            var name = themes[i]; var x = 773.8f + i * 349.9f; var active = name == current || (name == "system" && false);
            var b = Ui.Box(x, 265.8f, 342.1f, 56, active ? _t.Ink : _t.SurfaceSoft, 12);
            b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(_t, 0.153f);
            b.Add(Ui.Text(char.ToUpper(name[0]) + name[1..], 0, 22.2f, 10.56f, 800, active ? _t.OnAccent : _t.InkMuted, 342.1f, 11.6f, HorizontalAlignment.Center));
            var ring = Ring.Make(342.1f, 56, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
            _panel.Add(b);
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x, 265.8f, 342.1f, 56), Label = $"theme {name}",
                Style = f => ring.Show(f),
                Select = () => { if (name != "system") _env.SetTheme(name); else Toast("Following the system theme is not available on this TV yet."); },
            });
        }
        var (homeView, artworkSize) = _env.Store.Appearance();
        AppearanceSection(402, "Home screen artwork", "Show portrait covers instead of wide media thumbnails on the home screen.", new[] { "Thumbnails", "Covers" }, homeView == "cover" ? 1 : 0,
            i => _env.Store.SaveAppearance(i == 1 ? "cover" : "thumbnail", _env.Store.Appearance().ArtworkSize), "Home screen view saved.");
        AppearanceSection(600, "Artwork size", "Sets the size of posters and thumbnails everywhere: Home, Library, Search and more.", new[] { "Small", "Medium", "Large" }, artworkSize == "small" ? 0 : artworkSize == "large" ? 2 : 1,
            i => _env.Store.SaveAppearance(_env.Store.Appearance().HomeView, i == 0 ? "small" : i == 2 ? "large" : "medium"), "Artwork size saved.");
    }

    /// <summary>Web Appearance sections below the theme: a heading, a description and a segmented control, each under a hairline (measured at 1920x1080).</summary>
    private void AppearanceSection(float top, string title, string description, string[] labels, int selected, Action<int> save, string saved)
    {
        _panel.Add(Ui.Box(773.8f, top - 52, 1042.1f, 1, new Rgba(_t.Line.R, _t.Line.G, _t.Line.B, _t.Line.A)));
        _panel.Add(Ui.Text(title, 773.8f, top, 26.4f, 600, _t.Ink, 800, 39.6f, spacing: -0.92f));
        _panel.Add(Ui.Text(description, 773.8f, top + 40, 11.2f, 400, _t.InkMuted, 900, 17));
        var boxes = new List<(View Box, TextLabel Text)>();
        var gap = 8f; var w = (1042.1f - gap * (labels.Length - 1)) / labels.Length; var y = top + 62;
        for (var i = 0; i < labels.Length; i++)
        {
            var idx = i; var x = 773.8f + i * (w + gap); var active = i == selected;
            var b = Ui.Box(x, y, w, 56, active ? _t.Ink : _t.SurfaceSoft, 12);
            b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(_t, 0.153f);
            var tl = Ui.Text(labels[i], 0, 22.2f, 10.56f, 800, active ? _t.OnAccent : _t.InkMuted, w, 11.6f, HorizontalAlignment.Center);
            b.Add(tl);
            var ring = Ring.Make(w, 56, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
            _panel.Add(b); boxes.Add((b, tl));
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x, y, w, 56), Label = $"{title} {labels[i]}".ToLowerInvariant(), Style = f => ring.Show(f),
                Select = () =>
                {
                    save(idx);
                    for (var k = 0; k < boxes.Count; k++) { var a = k == idx; boxes[k].Box.BackgroundColor = Ui.C(a ? _t.Ink : _t.SurfaceSoft); boxes[k].Text.TextColor = Ui.C(a ? _t.OnAccent : _t.InkMuted); }
                    Toast(saved);
                },
            });
        }
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
        switch (key)
        {
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            case RemoteKey.Back: return false;
            default:
                var moved = _focus.Move(key);
                if (_focus.Current >= 0 && _focus.Current < _listCount) { _scroll = Math.Max(0, 162 + (_focus.Current + 1) * 91.9f - ListBottomLimit); _list.PositionY = -140 - _scroll; }
                return moved || key != RemoteKey.Left;
        }
    }
}
