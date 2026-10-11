using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Web download-quality drawer (right panel): quality choices (omitted when only editing) and keep-until, then Cancel / Download or Save.
/// shortcut: keep-until offers Forever and two after-watched presets, not the web's free date and amount pickers; upgrade when the TV has a date input.
/// </summary>
internal sealed class DownloadDrawer
{
    private static readonly KeepUntil[] Keeps = [KeepUntil.Forever, new("after-watched", Amount: 1, Unit: "weeks"), new("after-watched", Amount: 30, Unit: "days")];
    private static readonly string[] KeepNames = ["Forever", "1 week after watched", "30 days after watched"];

    private readonly FocusSet _focus = new();
    private readonly Action _close;
    private int _quality;
    private int _keep;
    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    /// <param name="qualities">null when only the keep-until is edited.</param>
    public DownloadDrawer(AppEnv env, string title, IReadOnlyList<DownloadQuality>? qualities, KeepUntil current, Action<DownloadQuality?, KeepUntil> confirm, Action close, string? loading = null)
    {
        var t = env.Theme; _close = close;
        _keep = Math.Max(0, Array.FindIndex(Keeps, k => k.Type == current.Type && k.Amount == current.Amount && k.Unit == current.Unit));
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        var panel = Ui.Box(1560, 0, 360, 1080, t.Surface);
        panel.BorderlineWidth = 1; panel.BorderlineColor = Ui.C(t.Line);
        Root.Add(panel);
        Root.Add(Ui.Text("Offline download", 1606, 54, 9.6f, 800, t.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Ui.Text(title, 1606, 71.6f, 26, 600, t.Ink, 200, 36, spacing: -1.2f));
        var x = Ui.Box(1826, 54, 48, 50, t.SurfaceSoft, 25);
        x.Add(Ui.Icon("close", 17, 18, 14, t.Ink));
        var xr = Ring.Make(48, 50, 25, new Rgba(1, 1, 1)); xr.Show(false); x.Add(xr);
        Root.Add(x);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Select = _close, Style = f => xr.Show(f) });

        var y = 150f;
        if (loading is not null) Root.Add(Ui.Text(loading, 1606, y, 14, 400, t.InkMuted, 268, 21));
        const float Pitch = 50, RowH = 44, ViewTop = 178, ViewH = 450;
        if (qualities is not null)
        {
            Root.Add(Ui.Text("Quality", 1606, y, 9.6f, 800, t.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f));
            var clip = new View { PositionX = 1590, PositionY = ViewTop, Size = new Size(300, ViewH), ClippingMode = ClippingModeType.ClipChildren };
            var inner = new View();
            clip.Add(inner); Root.Add(clip);
            var scroll = 0f;
            var marks = new List<(View Box, TextLabel Text)>();
            for (var i = 0; i < qualities.Count; i++)
            {
                var idx = i; var q = qualities[i]; var yy = i * Pitch + 4;
                var b = Ui.Box(16, yy, 268, RowH, i == _quality ? t.Ink : t.SurfaceSoft, 12);
                b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(t, 0.15f);
                var size = q.Bytes is { } n ? (q.Estimate ? "about " : "") + DownloadsScreen.Bytes(n) : "";
                var tl = Ui.Text($"{q.Label}   {size}", 16, 13, 12, 700, i == _quality ? t.OnAccent : t.InkMuted, 240, 18);
                b.Add(tl);
                var ring = Ring.Make(268, RowH, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
                inner.Add(b); marks.Add((b, tl));
                _focus.Items.Add(new Focusable
                {
                    Rect = () => new Box(1606, ViewTop + yy + scroll, 268, RowH), Label = $"quality {q.Label}".ToLowerInvariant(), Style = f => ring.Show(f),
                    Focused = () =>
                    {
                        if (yy + scroll < 0) scroll = -yy + 4; else if (yy + scroll + RowH > ViewH) scroll = ViewH - RowH - yy - 4;
                        inner.PositionY = scroll;
                    },
                    Select = () =>
                    {
                        _quality = idx;
                        for (var k = 0; k < marks.Count; k++) { marks[k].Box.BackgroundColor = Ui.C(k == idx ? t.Ink : t.SurfaceSoft); marks[k].Text.TextColor = Ui.C(k == idx ? t.OnAccent : t.InkMuted); }
                    },
                });
            }
            y = ViewTop + ViewH + 24;
        }
        Root.Add(Ui.Text("Keep until", 1606, y, 9.6f, 800, t.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f)); y += 28;
        var kmarks = new List<(View Box, TextLabel Text)>();
        for (var i = 0; i < Keeps.Length; i++)
        {
            var idx = i; var yy = y;
            var b = Ui.Box(1606, yy, 268, 44, i == _keep ? t.Ink : t.SurfaceSoft, 12);
            b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(t, 0.15f);
            var tl = Ui.Text(KeepNames[i], 16, 13, 12, 700, i == _keep ? t.OnAccent : t.InkMuted, 240, 18);
            b.Add(tl);
            var ring = Ring.Make(268, 44, 12, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
            Root.Add(b); kmarks.Add((b, tl));
            _focus.Items.Add(new Focusable { Rect = () => new Box(1606, yy, 268, 44), Label = $"keep {KeepNames[i]}".ToLowerInvariant(), Style = f => ring.Show(f), Select = () =>
            {
                _keep = idx;
                for (var k = 0; k < kmarks.Count; k++) { kmarks[k].Box.BackgroundColor = Ui.C(k == idx ? t.Ink : t.SurfaceSoft); kmarks[k].Text.TextColor = Ui.C(k == idx ? t.OnAccent : t.InkMuted); }
            } });
            y += 50;
        }
        y += 16;
        Button(t, 1606, y, 128, "Cancel", "cancel", false, _close);
        Button(t, 1746, y, 128, qualities is null ? "Save" : "Download", qualities is null ? "save" : "download", true, () => confirm(qualities is null ? null : qualities.Count == 0 ? null : qualities[_quality], Keeps[_keep]));
        _focus.Set(qualities is { Count: > 0 } ? 1 : 0);
    }

    private void Button(PlayarrTheme t, float x, float y, float w, string text, string label, bool primary, Action select)
    {
        var b = Ui.Box(x, y, w, 56, primary ? t.Ink : t.SurfaceSoft, 28);
        b.BorderlineWidth = 1; b.BorderlineColor = Ui.LineA(t, 0.15f);
        b.Add(Ui.Text(text, 0, 18, 12, 700, primary ? t.OnAccent : t.Ink, w, 18, HorizontalAlignment.Center));
        var ring = Ring.Make(w, 56, 28, new Rgba(1, 1, 1)); ring.Show(false); b.Add(ring);
        Root.Add(b);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, y, w, 56), Label = label, Style = f => ring.Show(f), Select = select });
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
