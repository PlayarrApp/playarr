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
        _root.Add(new ImageView(Ui.ResPath("logo.png")) { PositionX = 60.6f, PositionY = 60.2f, Size = new Size(42, 42) });
        _root.Add(Ui.Text("Profiles", 0, 162, 10.368f, 800, _t.BrandInk, 1920, 15.552f, HorizontalAlignment.Center, upper: true, spacing: 0.13f * 10.368f));
        _root.Add(Sem.Tag(Ui.Text("Who’s watching?", 0, 184.8f, 80.64f, 500, _t.Ink, 1920, 76.6f, HorizontalAlignment.Center, spacing: -0.072f * 80.64f), "heading"));
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
                _focus.Overrides[(currentIndex, RemoteKey.Down)] = _focus.Items.Count; // Down from the avatar reaches the settings pill first, as it did when the pills were centred under it
                AddPill(x + Circle / 2 - 22 - 52.4f / 1 - 1.6f, 704, 44, "", "settings", $"{p.DisplayName} settings", () => _env.Navigate("/settings"), round: true);
                AddPill(x + Circle / 2 - 22 - 52.4f / 1 - 1.6f + 52.8f, 704, 101.2f, "Sign out", "signout", $"{p.DisplayName} sign out", () => _env.SignOut());
            }
        }
        AddAdd(left + profiles.Count * Pitch);
        _focus.Set(Math.Max(0, currentIndex));
    }

    /// <summary>The Theme and Language selects at the top right of the picker (web .theme-dropdown-trigger).</summary>
    private void AddDropdown(float x, float w, string text, string label, Action select)
    {
        var box = Ui.Box(x, 49.7f, w, 48, _t.Bg, 0);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.23f);
        Sem.Tag(box, "button", label == "theme" ? $"Theme: {text}" : text);
        box.Add(Ui.Icon(label == "theme" ? "sun" : "sites", 19.4f, 16, 16, _t.InkMuted));
        box.Add(Ui.Text(text, 45, 15.3f, 11.52f, 700, _t.Ink, w - 80, 17.3f));
        box.Add(Ui.Icon("chevron-down", w - 32, 18, 12, _t.InkMuted));
        var ring = Ring.Make(w, 48, 0, new Rgba(1, 1, 1)); ring.Show(false); box.Add(ring);
        _body.Add(box);
        _focus.Items.Add(new Focusable { Rect = () => new Box(x, 49.7f, w, 48), Label = label, Select = select, Style = f => ring.Show(f) });
    }

    private void AddAvatar(float x, string name, string sub, string preset, string label, Action select)
    {
        var holder = new View { PositionX = x, PositionY = CircleY, Size = new Size(Circle, 301.63f) }; // web: the card is the circle and its two caption lines
        // web .profile-avatar: the circle carries the gradient plate and the border, the artwork sits inside it at 86 %
        var artSize = Circle * 0.853f;
        var art = new ImageView(Ui.ResPath($"avatars/art-{preset}.png")) { PositionX = (Circle - artSize) / 2, PositionY = (Circle - artSize) / 2, Size = new Size(artSize, artSize) };
        var cardFocused = false;
        float nameBase = 0, subBase = 0;
        var (ring, glow) = Widgets.RailRing(_t, Circle, Circle, Circle / 2);
        var nameL = Ui.Text(name, 0, Circle + 8.4f, 17.28f, 700, _t.Ink, Circle, 25.92f, HorizontalAlignment.Center);
        var subL = Ui.Text(sub, 0, Circle + 42.3f, 9.408f, 690, _t.InkMuted, Circle, 14.112f, HorizontalAlignment.Center, upper: true, spacing: 0.42f);
        var disc = new View { Size = new Size(Circle, Circle), CornerRadius = Circle / 2, BorderlineWidth = 1, BorderlineColor = Ui.LineA(_t, 0.15f), BackgroundImage = Ui.ResPath($"avatars/plate-{preset}.png") };
        Sem.Tag(disc, "container");
        disc.Add(art); disc.Add(ring);
        nameBase = nameL.PositionY; subBase = subL.PositionY;
        holder.Add(glow); holder.Add(disc); holder.Add(nameL); holder.Add(subL);
        Sem.Tag(holder, "button", label);
        _body.Add(holder);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, CircleY, Circle, Circle), Label = label.ToLowerInvariant(), Select = select,
            Style = f =>
            {
                cardFocused = f;
                // web: the whole card scales 1.045 about its centre and lifts 8 px; the circle grows a further 3.5 % inside it
                holder.Scale = f ? new Vector3(1.045f, 1.045f, 1) : new Vector3(1, 1, 1); holder.PositionY = CircleY + (f ? -8 : 0);
                disc.Scale = glow.Scale = f ? new Vector3(1.035f, 1.035f, 1) : new Vector3(1, 1, 1);
                ring.Show(f); glow.Show(f); },
        });
    }

    private void AddAdd(float x)
    {
        var holder = new View { PositionX = x, PositionY = CircleY, Size = new Size(Circle, 301.63f) };
        // web .profile-add: --profile-colour-start is color-mix(in srgb, var(--surface-strong) 84%, var(--brand)); the end is the .profile-avatar fallback #a82655;
        // the plate is linear-gradient(145deg, start, end). The soft top-left radial highlight is not drawn.
        Rgba Mix(Rgba a, Rgba b, float wa) => new(a.R * wa + b.R * (1 - wa), a.G * wa + b.G * (1 - wa), a.B * wa + b.B * (1 - wa), 1f);
        var wash = Ui.DiagonalGradient(0, 0, Circle, Circle, 145f, (0f, Mix(_t.SurfaceStrong, _t.Brand, 0.84f)), (1f, Rgba.Hex(0xa82655)));
        var disc = new View { Size = new Size(Circle, Circle), CornerRadius = Circle / 2, BorderlineWidth = 1, BorderlineColor = Ui.LineA(_t, 0.15f), BackgroundImage = ((ImageView)wash).ResourceUrl }; // web: a painted circle, the wash is its background
        Sem.Tag(disc, "container");
        disc.Add(Ui.Text("+", 0, 64.4f, 76.8f, 300, _t.InkSoft, Circle, 115.2f, HorizontalAlignment.Center));
        var (ring, glow) = Widgets.RailRing(_t, Circle, Circle, Circle / 2);
        disc.Add(ring);
        holder.Add(glow); holder.Add(disc); // the glow sits behind the painted circle (the circle is opaque, so it only shows outside)
        Sem.Tag(holder, "button", "Sign in Add another profile");
        holder.Add(Ui.Text("Sign in", 0, Circle + 8.4f, 17.28f, 700, _t.InkSoft, Circle, 25.92f, HorizontalAlignment.Center));
        holder.Add(Ui.Text("Add another profile", 0, Circle + 42.3f, 9.408f, 690, _t.InkMuted, Circle, 14.112f, HorizontalAlignment.Center, upper: true, spacing: 0.42f));
        _body.Add(holder);
        _focus.Items.Add(new Focusable
        {
            Rect = () => new Box(x, CircleY, Circle, Circle), Label = "sign in, add another profile",
            Select = () => _env.SignOut(),
            Style = f => { holder.Scale = f ? new Vector3(1.045f, 1.045f, 1) : new Vector3(1, 1, 1); holder.PositionY = CircleY + (f ? -8 : 0); disc.Scale = glow.Scale = f ? new Vector3(1.035f, 1.035f, 1) : new Vector3(1, 1, 1); ring.Show(f); glow.Show(f); },
        });
    }

    private void AddPill(float x, float y, float w, string text, string? icon, string label, Action select, bool round = false)
    {
        var box = Ui.Box(x, y, w, 44, _t.SurfaceStrong.Mixed(0.78f), 22);
        box.BorderlineWidth = 1; box.BorderlineColor = Ui.LineA(_t, 0.075f);
        if (y < 900) Sem.Tag(box, "button", icon == "signout" ? "Sign out " + label[..^" sign out".Length] : label);
        if (icon == "signout")
        {
            box.Add(Ui.Icon("log-out", 17, 13, 18, _t.InkSoft));
            box.Add(Ui.Text(text, 42, 13.9f, 10.752f, 700, _t.InkSoft, w - 42, 16.128f));
        }
        else if (text.Length > 0) { var tl = Ui.Text(text, 0, 13.9f, 10.752f, 700, _t.InkSoft, w, 16.128f, HorizontalAlignment.Center); box.Add(tl); }
        else box.Add(Ui.Icon("settings", 13, 13, 18, _t.Brand));
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
