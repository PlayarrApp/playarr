using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Web calendar subscription drawer (panel=link): the private feed link, a QR code and the calendar-app steps. Measured at 1920x1080.</summary>
internal sealed class CalendarLinkDrawer
{
    private readonly Action _close;
    private readonly FocusSet _focus = new();
    public View Root { get; } = new();
    public string? FocusedLabel => _focus.Item?.Label;

    public CalendarLinkDrawer(AppEnv env, string link, Action close, Action<string> toast)
    {
        var t = env.Theme; _close = close;
        Root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        Sem.Tag(Root, "none", backdropNow: () => FiltersDrawer.DrawerBackdrop(t));
        var panel = Ui.DrawerPanel(t);
        panel.BorderlineWidth = 1; panel.BorderlineColor = Ui.C(t.Line);
        Sem.Tag(panel, "dialog", "", backdropNow: () => FiltersDrawer.DrawerBackdrop(t));
        Root.Add(panel);
        Root.Add(Ui.Text("Calendar", 1606, 54, 9.6f, 720, t.InkMuted, 250, 14.4f, upper: true, spacing: 0.67f));
        Root.Add(Sem.Tag(Ui.Text("Calendar link", 1606, 71.6f, 38.4f, 590, t.Ink, 260, 57.6f, spacing: -2.1f), "heading"));
        var x = Ui.Box(1826, 54, 48, 50, t.SurfaceSoft, 25);
        Sem.Tag(x, "button", "Close filters", radius: 50);
        x.Add(Ui.Text("×", 0, 4.5f, 26.88f, 720, t.Ink, 48, 40, HorizontalAlignment.Center));
        var xr = Ring.Make(48, 50, 25, new Rgba(1, 1, 1)); xr.Show(false); x.Add(xr);
        Root.Add(x);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1826, 54, 48, 50), Label = "close", Select = _close, Style = f => xr.Show(f) });

        Ui.Paragraph(Root, "Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.", 1606, 163.4f, 13.824f, 400, t.InkMuted, 267, 20.3f);
        var box = Ui.Box(1606, 258.4f, 268, 44, t.Surface, 8);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.C(t.Line);
        Sem.Tag(box, "textbox", "", radius: 8, backdrop: t.Surface);
        box.Add(Ui.Text(link, 13, 12.5f, 12.8f, 400, t.Ink, 242, 19, family: Ui.Mono));
        Root.Add(box);
        var copy = Ui.Box(1606, 312.9f, 106, 58, t.Accent, 29);
        Sem.Tag(copy, "none");
        copy.Add(Sem.Tag(Ui.Text("Copy link", 21, 17.9f, 14.72f, 720, t.OnAccent, 70, 20), "button", radius: 999, backdrop: t.Accent));
        var cr = Ring.Make(106, 58, 29, new Rgba(1, 1, 1)); cr.Show(false); copy.Add(cr);
        Root.Add(copy);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1606, 312.9f, 106, 58), Label = "copy link", Select = () => toast("Copying is not available on this TV."), Style = f => cr.Show(f) });
        var qr = Ui.Box(1606, 379.6f, 240, 240, new Rgba(1, 1, 1), 18);
        Sem.Tag(qr, "img", "", radius: 18);
        var qrFile = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cal-qr.png";
        File.WriteAllBytes(qrFile, QrImage.Png(link, 4));
        qr.Add(new ImageView(qrFile) { PositionX = 20, PositionY = 20, Size = new Size(200, 200) });
        Root.Add(qr);
        Root.Add(Sem.Tag(Ui.Text("Add it to your calendar app", 1606, 631.5f, 9.6f, 720, t.InkMuted, 268, 14.4f, upper: true, spacing: 0.67f), "heading"));
        var steps = new[] { "Google Calendar: Other calendars (+) > From URL, then paste the link.", "Apple Calendar: File > New Calendar Subscription, then paste the link.", "Outlook: Add calendar > Subscribe from web, then paste the link." };
        for (var i = 0; i < steps.Length; i++)
        {
            var y = 657.9f + i * 49.5f;
            Root.Add(Ui.Box(1609.6f, y + 8, 5, 5, t.Ink, 2.5f));
            Ui.Paragraph(Root, steps[i], 1623.6f, y, 13.824f, 400, t.Ink, 250, 19.85f);
        }
        var reset = Ui.Box(1606, 812, 110, 54, new Rgba(0, 0, 0, 0), 27);
        Sem.Tag(reset, "none");
        reset.Add(Sem.Tag(Ui.Text("Reset link", 21, 17.3f, 14.72f, 720, t.Ink, 80, 20), "button", radius: 999));
        var rr = Ring.Make(110, 54, 27, new Rgba(1, 1, 1)); rr.Show(false); reset.Add(rr);
        Root.Add(reset);
        _focus.Items.Add(new Focusable { Rect = () => new Box(1606, 812, 110, 54), Label = "reset link", Select = () => toast("Resetting the link is not available on this TV."), Style = f => rr.Show(f) });
        _focus.Set(0);
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
