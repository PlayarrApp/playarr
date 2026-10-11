using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>QR sign-in, laid out from the web's device-login screen (1920x1080 measurements, dark theme tokens).</summary>
internal sealed class LoginScreen : View
{
    private readonly PlayarrTheme _t;
    private readonly View _dynamic = new();
    private string? _shownCode;

    public LoginScreen(PlayarrTheme theme)
    {
        _t = theme;
        Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        BackgroundColor = Ui.C(theme.Bg);
        Add(new ImageView(Ui.ResPath("logo.png")) { PositionX = 60.6f, PositionY = 60.2f, Size = new Size(42, 42) });
        Add(Ui.Text("Welcome home", 680, 188, 11.84f, 800, theme.InkMuted, 560, 17.76f, HorizontalAlignment.Center, upper: true, spacing: 2.13f));
        Add(Ui.Text("Sign in to Playarr", 480, 213, 80.64f, 500, theme.Ink, 960, 76.6f, HorizontalAlignment.Center, spacing: -5.8f));
        Add(Ui.Text("Scan the QR code with your phone or another browser to sign in on this device.", 684, 305.5f, 19.2f, 400, theme.InkMuted, 552, 28.8f,
            HorizontalAlignment.Center, multiline: true));
        _dynamic.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        Add(_dynamic);
    }

    public void Show(SignInState s)
    {
        foreach (var child in _dynamic.Children.ToArray()) { _dynamic.Remove(child); child.Dispose(); }
        if (s.Code is { } code)
        {
            Dbg.Log("SIGNIN code=" + code.UserCode);
            var qr = Ui.Box(840, 395.1f, 240, 240, new Rgba(1, 1, 1), 18);
            qr.BoxShadow = new Shadow(72, new Color(0, 0, 0, 0.3f), new Vector2(0, 24), new Vector2(0, 0));
            _dynamic.Add(qr);
            var path = SaveQr(code);
            _dynamic.Add(new ImageView(path) { PositionX = 852, PositionY = 407.1f, Size = new Size(216, 216) });
            _dynamic.Add(Ui.Text("Scan the QR code, or visit", 771.7f, 667.1f, 19.2f, 400, _t.InkMuted, 376.6f, 28.8f, HorizontalAlignment.Center));
            _dynamic.Add(Ui.Text(Uri(code.VerificationUri), 771.7f, 706.3f, 24, 700, _t.Ink, 376.6f, 36, HorizontalAlignment.Center));
            _dynamic.Add(Ui.Text("and enter this code", 771.7f, 752.7f, 19.2f, 400, _t.InkMuted, 376.6f, 28.8f, HorizontalAlignment.Center));
            _dynamic.Add(Ui.Text(code.UserCode, 560, 791.9f, 56, 700, _t.Ink, 800, 84, HorizontalAlignment.Center, spacing: 7.84f, family: Ui.Mono));
            var hint = s.Stage == SignInStage.Linking ? "Signing in…" : "Waiting for approval…";
            _dynamic.Add(Ui.Text(hint, 771.7f, 886.3f, 12.48f, 400, _t.InkMuted, 376.6f, 18.72f, HorizontalAlignment.Center));
        }
        else if (s.Error is { } err)
        {
            _dynamic.Add(Ui.Text(err, 480, 500, 19.2f, 600, _t.Danger, 960, 28.8f, HorizontalAlignment.Center));
        }
        else
        {
            _dynamic.Add(Ui.Text("Getting a sign-in code…", 480, 500, 19.2f, 400, _t.InkMuted, 960, 28.8f, HorizontalAlignment.Center));
        }
    }

    /// <summary>The "Code refreshes in m:ss" line, updated once a second.</summary>
    public void Tick(DateTimeOffset expires)
    {
        var left = Math.Max(0, (int)Math.Ceiling((expires - DateTimeOffset.UtcNow).TotalSeconds));
        _timer?.Dispose();
        _timer = Ui.Text($"Code refreshes in {left / 60}:{left % 60:00}", 771.7f, 918.6f, 16, 700, _t.InkSoft, 376.6f, 24, HorizontalAlignment.Center, family: Ui.Mono);
        Add(_timer);
    }

    private TextLabel? _timer;

    private string SaveQr(HostedLinkCode code)
    {
        var dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data;
        var path = dir + "qr.png";
        if (_shownCode != code.UserCode)
        {
            File.WriteAllBytes(path, QrImage.Png(code.VerificationUriComplete, 6));
            _shownCode = code.UserCode;
        }
        return path;
    }

    private static string Uri(string uri) => uri.Replace("https://", "https://");
}
