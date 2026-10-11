using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>The long-press "Title actions" drawer (web MediaContextMenu): a right-hand panel over a scrim. Measured at 1920x1080.</summary>
internal sealed class ActionsDrawer
{
    private readonly FocusSet _focus = new();
    private readonly Action _close;
    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    public ActionsDrawer(AppEnv env, WorkCard card, Action close, Action<string> toast)
    {
        var t = env.Theme; _close = close;
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.Box(1560, 0, 360, 1080, t.Surface);
        panel.BorderlineWidth = 1; panel.BorderlineColor = Ui.C(t.Line);
        Root.Add(panel);
        Root.Add(Ui.Text("Title actions", 1606, 55, 9.6f, 800, t.InkMuted, 200, 14.4f, upper: true, spacing: 0.8f));
        Root.Add(Ui.Text(card.Title, 1606, 78, 36.9f, 600, t.Ink, 215, 56.8f, multiline: true, spacing: -1.5f, maxLines: 2));
        var x = Ui.Box(1826, 55, 48, 48, t.SurfaceSoft, 24);
        x.Add(Ui.Icon("close", 17, 17, 14, t.Ink));
        var xr = Ring.Make(48, 48, 24, new Rgba(1, 1, 1)); xr.Show(false); x.Add(xr);
        Root.Add(x);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 55, 48, 48), Label = "close", Select = _close, Style = f => xr.Show(f) });

        var actions = new (string Glyph, string Text, Action Do)[]
        {
            ("▶", "Play", () => { _close(); _ = env.PlayWorkAsync(card.WorkId); }),
            ("⇩", "Download", () => toast("Downloads are not available in this app yet.")),
            ("+", "Add to Playlist", () => toast("Playlists are not available in this app yet.")),
            ("✓", "Mark as Watched", () => toast("Watch state changes are not available in this app yet.")),
            ("○", "Mark as Unwatched", () => toast("Watch state changes are not available in this app yet.")),
        };
        for (var i = 0; i < actions.Length; i++)
        {
            var y = 218 + i * 82f; var a = actions[i];
            var b = Ui.Box(1606, y, 268, 68, t.SurfaceSoft, 12);
            b.Add(Ui.Text(a.Glyph, 20, 21, 20, 400, t.Brand, 24, 26));
            b.Add(Ui.Text(a.Text, 60, 19, 20, 700, t.Ink, 200, 30));
            var ring = Ring.Make(268, 68, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
            Root.Add(b);
            _focus.Items.Add(new Focusable { Rect = () => new Box(1606, y, 268, 68), Label = (a.Glyph + a.Text).ToLowerInvariant(), Select = a.Do, Style = f => ring.Show(f) });
        }
        _focus.Set(1);
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
