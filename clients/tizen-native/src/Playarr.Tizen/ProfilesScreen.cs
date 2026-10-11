using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Web /profiles: "Who's watching?" with the account's profiles, settings and sign out (measured at 1920x1080).</summary>
internal sealed class ProfilesScreen : IPage
{
    private const float Circle = 244f, Pitch = 286.3f, CircleY = 382.4f;
    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly View _root = new();
    private readonly View _body = new();
    private readonly FocusSet _focus = new();

    public bool IsReady => _focus.Items.Count > 0;
    public View Root => _root;
    public string Route => "/profiles";
    public bool HideChrome => true;
    public string? FocusedLabel => _focus.Item?.Label;
    public float FocusCentreY => _focus.CurrentRect is { Height: > 0 } r ? r.CentreY : 540;

    public ProfilesScreen(AppEnv env)
    {
        _env = env; _t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Bg);
        _root.Add(new ImageView(Ui.ResPath("logo.png")) { PositionX = 60.6f, PositionY = 60.2f, Size = new Size(42, 42) });
        _root.Add(Ui.Text("Profiles", 0, 162, 10.368f, 800, _t.BrandInk, 1920, 15.552f, HorizontalAlignment.Center, upper: true, spacing: 1.35f));
        _root.Add(Ui.Text("Who’s watching?", 0, 184.8f, 80.64f, 500, _t.Ink, 1920, 76.6f, HorizontalAlignment.Center, spacing: -5.8f));
        _root.Add(_body);
        AddDropdown(1551.8f, 144, _t.Name == "dark" ? "Dark" : "Light", "theme", () => _env.SetTheme(_t.Name == "dark" ? "light" : "dark"));
        AddDropdown(1709.8f, 168, "Auto", "language", () => { });
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var profiles = await _env.Api.ListProfilesAsync();
            SynchronizationContextHolder.Post(() => Build(profiles.ToList()));
        }
        catch (Exception e) { Dbg.Log("PROFILES load failed: " + e.Message); }
    }

    private void Build(List<AvailableProfile> profiles)
    {
        var count = profiles.Count + 1;
        var left = 960 - (count * Circle + (count - 1) * (Pitch - Circle)) / 2;
        var currentIndex = -1;
        for (var i = 0; i < profiles.Count; i++)
        {
            var p = profiles[i]; var x = left + i * Pitch;
            var cur = p.IsCurrent; if (cur) currentIndex = _focus.Items.Count;
            AddAvatar(x, p.DisplayName, cur ? "Watching now" : p.PinLocked ? "PIN protected" : "Switch profile", (cur ? _env.CurrentAvatar : null) ?? AvatarPresets.Default(p.Id.ToString()),
                label: cur ? $"{p.DisplayName}, current profile" : p.DisplayName, () => { if (!cur) Dbg.Log("switch profile not implemented"); });
            if (cur)
            {
                AddPill(x + Circle / 2 - 22 - 52.4f / 1 + 12.4f, 704, 44, "", "settings", $"{p.DisplayName} settings", () => _env.Navigate("/settings"), round: true);
                AddPill(x + Circle / 2 - 22 - 52.4f / 1 + 12.4f + 52.8f, 704, 101.2f, "Sign out", "signout", $"{p.DisplayName} sign out", () => _env.SignOut());
            }
        }
        AddAdd(left + profiles.Count * Pitch);
        AddPill(48, 1003.6f, 123, "Check for updates", null, "check for updates", () => { });
        AddPill(1784.5f, 1003.6f, 87.5f, "Clients  →", null, "clients", () => { });
        _focus.Set(Math.Max(0, currentIndex));
    }

    /// <summary>The Theme and Language selects at the top right of the picker (web .theme-dropdown-trigger).</summary>
    private void AddDropdown(float x, float w, string text, string label, Action select)
    {
        var box = Ui.Box(x, 49.7f, w, 48, _t.Bg, 0);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.23f);
        box.Add(Ui.Icon(label == "theme" ? "settings" : "sites", 19.4f, 16, 16, _t.InkMuted));
        box.Add(Ui.Text(text, 45, 15.3f, 11.52f, 700, _t.Ink, w - 80, 17.3f));
        box.Add(Ui.Text("\u2304", w - 27, 14.5f, 12, 400, _t.InkMuted, 12, 17));
        var ring = Ring.Make(w, 48, 0, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        _body.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 49.7f, w, 48), Label = label, Select = select, Style = f => ring.Show(f) });
    }

    private void AddAvatar(float x, string name, string sub, string preset, string label, Action select)
    {
        var holder = new View { PositionX = x, PositionY = CircleY, Size = new Size(Circle, Circle + 120) };
        var art = new ImageView(Ui.ResPath($"avatars/{preset}.png")) { Size = new Size(Circle, Circle), CornerRadius = Circle / 2 };
        art.BorderlineWidth = 1; art.BorderlineColor = Ui.LineA(_t, 0.15f);
        var ring = Ring.Make(Circle, Circle, Circle / 2, new Rgba(1, 1, 1)); ring.Show(false);
        var nameL = Ui.Text(name, 0, Circle + 11.4f, 17.28f, 700, _t.Ink, Circle, 25.92f, HorizontalAlignment.Center);
        var subL = Ui.Text(sub, 0, Circle + 44.8f, 9.408f, 800, _t.InkMuted, Circle, 14.112f, HorizontalAlignment.Center, upper: true, spacing: 0.42f);
        var disc = new View { Size = new Size(Circle, Circle) };
        disc.Add(art); disc.Add(ring);
        holder.Add(disc); holder.Add(nameL); holder.Add(subL);
        _body.Add(holder);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, CircleY, Circle, Circle), Label = label.ToLowerInvariant(), Select = select,
            Style = f => { disc.Scale = f ? new Vector3(1.08f, 1.08f, 1) : new Vector3(1, 1, 1); disc.PositionY = f ? -9.4f : 0; ring.Show(f); },
        });
    }

    private void AddAdd(float x)
    {
        var holder = new View { PositionX = x, PositionY = CircleY, Size = new Size(Circle, Circle + 120) };
        var disc = Ui.Box(0, 0, Circle, Circle, _t.SurfaceStrong, Circle / 2);
        disc.BorderlineWidth = 1; disc.BorderlineColor = Ui.LineA(_t, 0.15f);
        disc.Add(Ui.Text("+", 0, 64.4f, 76.8f, 400, _t.InkSoft, Circle, 115.2f, HorizontalAlignment.Center));
        var ring = Ring.Make(Circle, Circle, Circle / 2, new Rgba(1, 1, 1)); ring.Show(false);
        disc.Add(ring);
        holder.Add(disc);
        holder.Add(Ui.Text("Sign in", 0, Circle + 11.4f, 17.28f, 700, _t.InkSoft, Circle, 25.92f, HorizontalAlignment.Center));
        holder.Add(Ui.Text("Add another profile", 0, Circle + 44.8f, 9.408f, 800, _t.InkMuted, Circle, 14.112f, HorizontalAlignment.Center, upper: true, spacing: 0.42f));
        _body.Add(holder);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, CircleY, Circle, Circle), Label = "sign in, add another profile",
            Select = () => _env.SignOut(),
            Style = f => { disc.Scale = f ? new Vector3(1.08f, 1.08f, 1) : new Vector3(1, 1, 1); ring.Show(f); },
        });
    }

    private void AddPill(float x, float y, float w, string text, string? icon, string label, Action select, bool round = false)
    {
        var box = Ui.Box(x, y, w, 44, new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.78f), 22);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.075f);
        if (text.Length > 0) box.Add(Ui.Text(text, 0, 13.9f, 10.752f, 700, _t.InkSoft, w, 16.128f, HorizontalAlignment.Center));
        else box.Add(Ui.Text("⚙", 0, 11, 18, 400, _t.InkSoft, w, 22, HorizontalAlignment.Center));
        var ring = Ring.Make(w, 44, 22, new Rgba(1, 1, 1)); ring.Show(false);
        box.Add(ring);
        _body.Add(box);
        if (y < 900) _focus.Items.Add(new Focusable { Rect = () => new Box(x, y, w, 44), Label = label, Select = select, Style = f => ring.Show(f) }); // the footer pills are decorative here (web does not reach them from the avatar row either)
    }

    public bool OnKey(RemoteKey key)
    {
        switch (key)
        {
            case RemoteKey.Select: _focus.Item?.Select?.Invoke(); return true;
            case RemoteKey.Back: return false;
            default: return _focus.Items.Count == 0 ? key != RemoteKey.Left : (_focus.Move(key) || key != RemoteKey.Left);
        }
    }
}
