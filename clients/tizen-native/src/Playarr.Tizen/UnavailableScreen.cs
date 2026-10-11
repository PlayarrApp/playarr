using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>A nav section that the native app does not have yet: an honest page, never a silent no-op.</summary>
internal sealed class UnavailableScreen : IPage
{
    private readonly View _root = new();
    public View Root => _root;
    public string Route { get; }
    public string? FocusedLabel => null;
    public float FocusCentreY => 540;

    public UnavailableScreen(AppEnv env, string title, string route)
    {
        Route = route;
        var t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(t.Surface);
        var back = Ui.Box(153.6f, 56.2f, 50, 50, new Rgba(t.SurfaceStrong.R, t.SurfaceStrong.G, t.SurfaceStrong.B, 0.7f), 25);
        back.BorderlineWidth = 1; back.BorderlineColor = Ui.LineA(t, 0.153f);
        back.Add(Ui.Text("←", 0, 12, 17.28f, 700, t.InkSoft, 50, 25.92f, HorizontalAlignment.Center));
        _root.Add(back);
        _root.Add(Ui.Text(title, 226.6f, 56.2f, 33.6f, 700, t.Ink, 600, 50, spacing: -1.51f));
        _root.Add(Ui.Text($"{title} is not available in this app yet.", 480, 480, 22, 600, t.InkSoft, 960, 33, HorizontalAlignment.Center));
        _root.Add(Ui.Text("Use the Playarr web app or another client for it.", 480, 520, 14, 400, t.InkMuted, 960, 21, HorizontalAlignment.Center));
    }

    public bool OnKey(RemoteKey key) => key is not (RemoteKey.Left or RemoteKey.Back);
}
