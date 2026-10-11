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
        _root.Add(Ui.Text("Preferences", 226.6f, 56.2f, 33.6f, 700, _t.Ink, 400, 50, spacing: -1.51f));
        _root.Add(Ui.Text("Appearance", 226.6f, 111.8f, 12.288f, 800, _t.BrandInk, 400, 18.432f, upper: true, spacing: 0.98f));
        BuildList();
        _root.Add(_panel);
        BuildAppearance();
        _focus.Set(0);
    }

    private void BuildList()
    {
        for (var i = 0; i < Options.Length; i++)
        {
            var y = 162 + i * 91.9f; var idx = i;
            var card = Ui.Box(153.6f, y, 480.4f, 91.9f, i == 0 ? _t.SurfaceSoft : new Rgba(_t.SurfaceSoft.R, _t.SurfaceSoft.G, _t.SurfaceSoft.B, 0.0f), 18);
            card.Add(Ui.Text(Numbers[i], 32, 23.8f, 9.92f, 800, _t.Ink, 40, 14.88f));
            card.Add(Ui.Text(Options[i], 92, 23.8f, 29.6f, 500, _t.Ink, 307.6f, 44.4f, spacing: -1.04f));
            card.Add(Ui.Text("→", 432.6f, 30.3f, 20.8f, 400, i == 0 ? _t.Ink : _t.InkMuted, 30, 31.2f));
            var ring = Ring.Make(480.4f, 91.9f, 18, new Rgba(1, 1, 1)); ring.Show(false); card.Add(ring);
            _root.Add(card);
            _focus.Items.Add(new Focusable
            {
                Rect = () => new Box(153.6f, y, 480.4f, 91.9f), Label = Options[i].ToLowerInvariant(),
                Style = f => ring.Show(f),
                Select = () => { if (idx != 0) Toast(Options[idx] + " is not available in this app yet."); },
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
            default: return _focus.Move(key) || key != RemoteKey.Left;
        }
    }
}
