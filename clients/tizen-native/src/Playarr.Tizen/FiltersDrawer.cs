using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>One section of the Filters drawer: a segmented choice, a select (display only for now) or a toggle.</summary>
internal sealed record FilterSection(string Heading, string[] Options, int Selected, Action<int> Changed, bool IsSelect = false, bool IsToggle = false);

/// <summary>Web .tv-filter-drawer: a 360 px right panel (kicker, title, close, sections). Measured at 1920x1080.</summary>
internal sealed class FiltersDrawer
{
    private readonly FocusSet _focus = new();
    private readonly Action _close;
    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    public FiltersDrawer(AppEnv env, string kicker, FilterSection[] sections, Action close, Action<string> toast)
    {
        var t = env.Theme; _close = close;
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.Box(1560, 0, 360, 1080, t.Surface);
        panel.BorderlineWidth = 1; panel.BorderlineColor = Ui.C(t.Line);
        Root.Add(panel);
        Root.Add(Ui.Text(kicker, 1606, 54, 9.6f, 800, t.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Ui.Text("Filters", 1606, 71.6f, 38.4f, 600, t.Ink, 200, 57.6f, spacing: -2.1f));
        var x = Ui.Box(1826, 54, 48, 50, t.SurfaceSoft, 25);
        x.Add(Ui.Icon("close", 17, 18, 14, t.Ink));
        var xr = Ring.Make(48, 50, 25, new Rgba(1, 1, 1)); xr.Show(false); x.Add(xr);
        Root.Add(x);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Select = _close, Style = f => xr.Show(f) });

        var y = 163.4f;
        foreach (var s in sections)
        {
            Root.Add(Ui.Text(s.Heading, 1606, y, 9.6f, 800, t.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
            var top = y + 26.4f;
            if (s.IsSelect)
            {
                var box = Ui.Box(1606, top, 268, 58.8f, t.SurfaceSoft, 12);
                box.BorderlineWidth = 1; box.BorderlineColor = Ui.C(t.Line);
                box.Add(Ui.Text(s.Options[s.Selected], 19.4f, 20.5f, 11.84f, 700, t.Ink, 200, 17.76f));
                box.Add(Ui.Text("⌄", 238.6f, 20.5f, 11.84f, 700, t.InkMuted, 12, 17.76f));
                var ring = Ring.Make(268, 58.8f, 12, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
                Root.Add(box);
                var yy = top;
                _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy, 268, 58.8f), Label = s.Heading.ToLowerInvariant(), Style = f => ring.Show(f), Select = () => toast("Language filters are not available in this app yet.") });
                y += 115.2f;
            }
            else if (s.IsToggle)
            {
                var row = new View { PositionX = 1606, PositionY = top, Size = new Size(268, 40) };
                var track = Ui.Box(0, 6, 36, 22, s.Selected == 1 ? t.Ink : t.SurfaceSoft, 11);
                track.Add(Ui.Box(s.Selected == 1 ? 16 : 2, 2, 18, 18, s.Selected == 1 ? t.OnAccent : t.InkMuted, 9));
                row.Add(track);
                row.Add(Ui.Text(s.Options[0], 49, 5.6f, 19.2f, 400, t.Ink, 220, 28.8f));
                var ring = Ring.Make(268, 40, 12, new Rgba(1, 1, 1)); ring.Show(false); row.Add(ring);
                Root.Add(row);
                var yy = top; var cur = s;
                _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy, 268, 40), Label = s.Heading.ToLowerInvariant(), Style = f => ring.Show(f), Select = () => { cur.Changed(cur.Selected == 1 ? 0 : 1); _focus.Set(0); } });
                y += 115f;
            }
            else
            {
                var n = s.Options.Length; var gap = 8f; var w = (268 - gap * (n - 1)) / n;
                for (var i = 0; i < n; i++)
                {
                    var idx = i; var bx = 1606 + i * (w + gap); var active = i == s.Selected;
                    var b = Ui.Box(bx, top, w, 56, active ? t.Ink : t.SurfaceSoft, 12);
                    b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(t, 0.15f);
                    b.Add(Ui.Text(s.Options[i], 0, n == 3 ? 33 : 22.2f, 10.56f, 800, active ? t.OnAccent : t.InkMuted, w, 11.6f, HorizontalAlignment.Center));
                    var ring = Ring.Make(w, 56, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
                    Root.Add(b);
                    var yy = top; var ww = w; var sec = s;
                    _focus.Items.Add(new Focusable { Rect = () => new Box(bx, yy, ww, 56), Label = $"{s.Heading} {s.Options[i]}".ToLowerInvariant(), Style = f => ring.Show(f), Select = () => { sec.Changed(idx); _focus.Set(0); } });
                }
                y += 112.6f;
            }
        }
        _focus.Set(0); // web opens with the close button focused
    }

    public bool OnKey(RemoteKey key)
    {
        switch (key)
        {
            case RemoteKey.Back: _close(); return true;
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            default: _focus.Move(key); return true;
        }
    }
}
