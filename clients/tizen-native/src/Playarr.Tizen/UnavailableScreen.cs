using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>A nav section that the native app does not have yet: an honest page, never a silent no-op.</summary>
internal sealed class UnavailableScreen : IPage
{
    private readonly View _root = new();
    public View Root => _root;
    private readonly BackControl _back;
    public string Route { get; }
    public string? FocusedLabel => "back";
    public float FocusCentreY => 540;

    public UnavailableScreen(AppEnv env, string title, string route)
    {
        Route = route;
        var t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(t.Surface);
        _back = new BackControl(env, t, _root, "link", "Back to Home");
        _back.Show(true);
        _root.Add(Ui.Heading(title, 226.6f, 56.2f, 33.6f, 600, t.Ink, 600, 50, spacing: -1.51f));
        _root.Add(Ui.Text($"{title} is not available in this app yet.", 480, 480, 22, 600, t.InkSoft, 960, 33, HorizontalAlignment.Center));
        _root.Add(Ui.Text("Use the Playarr web app or another client for it.", 480, 520, 14, 400, t.InkMuted, 960, 21, HorizontalAlignment.Center));
    }

    public bool OnKey(RemoteKey key) => key == RemoteKey.Select ? _back.OnKey(key, () => { }) : key is not (RemoteKey.Left or RemoteKey.Back);
}
