using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// The app shell on the 1920x1080 canvas: the nav rail, the clock and the routed page. Rail geometry is measured from the web
/// client (groups at x 42.2, 77.5 wide, items on a 73.6 pitch). Left from a page enters the rail at the item vertically
/// closest to the focused card (as web); Right returns to the page.
/// </summary>
internal sealed class Shell : View
{
    private static readonly (float Y, float H)[] Groups = { (119.1f, 153f), (285.7f, 300.2f), (599.5f, 300.2f) };
    private const float RailX = 42.2f, RailW = 77.5f, Pitch = 73.6f, Cx = 81f;

    private sealed class NavView
    {
        public NavItem Item = null!;
        public View Item64 = new();   // 64x64 tile that scales as a unit (icon, label and background)
        public View Tile = null!;
        public ImageView Icon = null!;
        public TextLabel Label = null!;
        public float CentreY;
    }

    private readonly AppEnv _env;
    private readonly PlayarrTheme _theme;
    private readonly List<NavView> _nav = new();
    private readonly Stack<string> _history = new();
    private readonly Dictionary<string, object> _saved = new();
    private readonly View _chrome = new() { Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight) };
    private TextLabel? _clockTime, _clockDate;
    private void UpdateClock()
    {
        var now = DateTime.Now;
        if (_clockTime is not null) _clockTime.Text = now.ToString("HH:mm");
        if (_clockDate is not null) _clockDate.Text = now.ToString("ddd d MMMM", System.Globalization.CultureInfo.GetCultureInfo("en-GB")).ToUpperInvariant();
    }
    private TextLabel? _profileLabel;
    private ImageView? _avatarIcon;
    public void SetAvatar(string preset) { if (_avatarIcon is not null) _avatarIcon.ResourceUrl = Ui.ResPath("avatars/" + preset + ".png"); }
    private IPage? _page;
    private int _active = -1;
    private int _navFocus = -1;     // -1 = focus is on the page
    private readonly Action _exit;

    public string Route => _page?.Route ?? "/";
    public IPage? Page => _page;
    public bool NavFocused => _navFocus >= 0;
    public bool Ready => _page?.IsReady ?? true;
    /// <summary>{ rail, index }: "nav" and the item number from the top on the nav rail, else the page's own position (Home).</summary>
    public (string Rail, int Index)? FocusPosition => _navFocus >= 0 ? ("nav", _navFocus) : _page?.FocusPosition is { } p ? (p.Rail.ToString(), p.Index) : null;
    public string? FocusedLabel => _navFocus >= 0 ? _nav[_navFocus].Item.Label.ToLowerInvariant() : _page?.FocusedLabel;

    public Shell(AppEnv env, Action exit)
    {
        _env = env; _theme = env.Theme; _exit = exit;
        env.Navigate = route => Navigate(route);
        env.SetClockX = x => { var cx = Math.Max(x, 476.1f); if (_clockTime is not null) _clockTime.PositionX = cx; if (_clockDate is not null) _clockDate.PositionX = cx + 52.7f; };
        env.NavigateBack = () => { if (_history.Count > 0) Navigate(_history.Pop(), push: false); else Navigate("/", push: false); };
        Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        BackgroundColor = Ui.C(_theme.Bg);
        BuildRail();
        _chrome.Add(new ImageView(Ui.ResPath("logo.png")) { PositionX = 60.6f, PositionY = 60.2f, Size = new Size(42, 42) });
        _clockTime = Ui.Text("", 476.1f, 68.2f, 17.28f, 800, _theme.Ink, 60, 25.92f, spacing: -0.52f);
        _clockDate = Ui.Text("", 528.8f, 75f, 11.136f, 700, _theme.Ink, 160, 12.25f, upper: true, spacing: 0.445f);
        _chrome.Add(_clockTime); _chrome.Add(_clockDate);
        UpdateClock();
        var tick = new global::Tizen.NUI.Timer(15000);
        tick.Tick += (_, _) => { UpdateClock(); return true; };
        tick.Start();
        Add(_chrome);
    }

    private void BuildRail()
    {
        var perGroup = new int[3];
        foreach (var item in NavModel.Items)
        {
            var g = Groups[item.Group];
            var idx = perGroup[item.Group]++;
            if (idx == 0) AddGroup(g.Y, g.H);
            var top = g.Y + 6.2f + idx * Pitch;
            var nv = new NavView { Item = item, CentreY = top + 33.6f };
            nv.Item64.Size = new Size(64, 64); nv.Item64.PositionX = Cx - 32; nv.Item64.PositionY = nv.CentreY - 32;
            nv.Tile = Ui.Box(0, 0, 64, 64, null, 16);
            nv.Icon = Ui.Icon(item.Icon, 22, 15.1f, 20, _theme.InkMuted);
            nv.Label = Ui.Text(item.Label, -6.75f, 39.9f, 8.832f, 700, _theme.InkMuted, RailW, 8.832f, HorizontalAlignment.Center);
            nv.Item64.Add(nv.Tile); nv.Item64.Add(nv.Icon); nv.Item64.Add(nv.Label);
            _chrome.Add(nv.Item64);
            _nav.Add(nv);
        }
        AddGroup(952.4f, 79.4f); // profile chip
        var pv = new NavView { Item = new NavItem("profile", "Profile", "/profiles", "", 3), CentreY = 992.1f };
        pv.Item64.Size = new Size(64, 64); pv.Item64.PositionX = Cx - 32; pv.Item64.PositionY = pv.CentreY - 32;
        pv.Tile = Ui.Box(0, 0, 64, 64, null, 16);
        _avatarIcon = new ImageView(Ui.ResPath("avatars/" + AvatarPresets.Default("")) + ".png") { PositionX = 22, PositionY = 15.1f, Size = new Size(20, 20), CornerRadius = 10 };
        pv.Icon = null!;
        pv.Label = Ui.Text(_env.Profile, -6.75f, 39.9f, 8.832f, 700, _theme.InkMuted, RailW, 8.832f, HorizontalAlignment.Center);
        pv.Item64.Add(pv.Tile); pv.Item64.Add(_avatarIcon); pv.Item64.Add(pv.Label);
        _chrome.Add(pv.Item64);
        _nav.Add(pv);
        _profileLabel = pv.Label;
        _chrome.Add(Ui.Text("v 0.1.0", RailX, 1037.5f, 8, 700, _theme.Ink, RailW, 8, HorizontalAlignment.Center));
    }

    private void AddGroup(float y, float h)
    {
        var box = Ui.Box(RailX, y, RailW, h, new Rgba(_theme.SurfaceStrong.R, _theme.SurfaceStrong.G, _theme.SurfaceStrong.B, 0.56f), 22);
        box.BorderlineWidth = 1;
        box.BorderlineColor = Ui.C(_theme.Line);
        _chrome.Add(box);
    }

    private void StyleNav(int i)
    {
        var nv = _nav[i];
        var focused = i == _navFocus; var active = i == _active;
        var scale = focused ? 1.1f : active ? 1.05f : 1f;
        nv.Item64.Scale = new Vector3(scale, scale, 1);
        // web: the tile is the page ink at 9 % (16 % focused); in dark the ink is the pale 244,240,241
        var tileInk = _theme.Name == "dark" ? new Color(0.957f, 0.941f, 0.945f, 1) : Ui.C(_theme.Ink);
        nv.Tile.BackgroundColor = focused ? new Color(tileInk.R, tileInk.G, tileInk.B, 0.16f) : active ? new Color(tileInk.R, tileInk.G, tileInk.B, 0.09f) : new Color(0, 0, 0, 0);
        nv.Tile.BoxShadow = focused ? new Shadow(30, new Color(0.957f, 0.941f, 0.945f, 0.07f), new Vector2(0, 12), new Vector2(0, 0)) : null;
        var tint = focused || active ? Ui.C(_theme.Ink) : Ui.C(_theme.InkMuted);
        if (nv.Icon is not null) nv.Icon.Color = tint;
        nv.Label.TextColor = tint;
    }

    public void SetProfileName(string name) { if (_profileLabel is not null) _profileLabel.Text = name; }

    // ---- routing ----

    /// <summary>
    /// A title opened by its id with no origin (a deep link, the parity runner): web's Back then goes to the title's library, so the
    /// history is that library rather than whatever page happened to be showing.
    /// </summary>
    public void NavigateDeepLink(string route)
    {
        var parent = route.StartsWith("/movies/") ? "/movies" : route.StartsWith("/series/") ? "/series" : null;
        if (parent is null) { Navigate(route); return; }
        _history.Clear(); _history.Push(parent);
        Navigate(route, push: false);
    }

    public void Navigate(string route, bool push = true)
    {
        var previousSearch = _page as SearchScreen;
        previousSearch?.OnRemoved();
        _env.SetClockX(0);
        var page = Pages.Create(_env, route);
        if (page is null) { previousSearch?.OnAdded(); return; }
        if (push && _page is not null) { _history.Push(_page.Route); if (_page.SaveState() is { } st) _saved[_page.Route] = st; }
        if (_page is PlaylistsScreen previousPlaylists) previousPlaylists.OnRemoved();
        if (_page is not null)
        {
            Remove(_page.Root); _page.Root.Dispose();
        }
        _page = page;
        if (!push && _saved.Remove(route, out var restore)) page.RestoreState(restore);
        Add(page.Root);
        if (page is SearchScreen searchPage) searchPage.OnAdded();
        if (_theme.Name == "light" && !page.HideChrome && !page.Fullscreen)
        {
            // web light: the page colour fades from #fbfaf9 to #efeeef between x 640 and 1120 (measured); text and cards sit above it
            var fade = Ui.Gradient(640, 0, 1280, 1080, true, (0, _theme.Surface), (0.375f, new Rgba(0.937f, 0.937f, 0.937f)), (1, new Rgba(0.937f, 0.937f, 0.937f)));
            page.Root.Add(fade); fade.LowerToBottom();
        }
        page.Root.LowerToBottom();
        // full-screen pages (the player) draw over a transparent window: no rail, no background
        BackgroundColor = page.Fullscreen ? new Color(0, 0, 0, 0) : Ui.C(_theme.Bg);
        _chrome.Show(!page.HideChrome);
        var prev = _active;
        var owner = route.StartsWith("/profiles") || route.StartsWith("/settings") ? "/profiles" : NavModel.Owner(route);
        _active = _nav.FindIndex(n => n.Item.Route == owner);
        if (prev >= 0) StyleNav(prev);
        if (_active >= 0) StyleNav(_active);
        FocusPage();
    }

    private void FocusPage()
    {
        var old = _navFocus; _navFocus = -1;
        if (old >= 0) StyleNav(old);
    }

    private readonly Queue<RemoteKey> _held = new();
    private global::Tizen.NUI.Timer? _holdTimer;

    public void OnKey(RemoteKey key)
    {
        // A page that is still loading keeps the keys (up to 5 s) and replays them when it is ready, so fast key sequences are not lost.
        if (_page is { IsReady: false } && _navFocus < 0 && key != RemoteKey.Back && key != RemoteKey.Left)
        {
            if (_held.Count < 20) _held.Enqueue(key);
            if (_holdTimer is null)
            {
                var waited = 0;
                _holdTimer = new global::Tizen.NUI.Timer(100);
                _holdTimer.Tick += (_, _) =>
                {
                    waited += 100;
                    if (_page is { IsReady: true } || waited >= 5000)
                    {
                        _holdTimer = null;
                        while (_held.Count > 0) Dispatch(_held.Dequeue());
                        return false;
                    }
                    return true;
                };
                _holdTimer.Start();
            }
            return;
        }
        Dispatch(key);
    }

    private void Dispatch(RemoteKey key)
    {
        if (_navFocus >= 0) { NavKey(key); return; }
        if (_page is null) return;
        if (_page.OnKey(key)) return;
        switch (key)
        {
            case RemoteKey.Left: EnterNav(_page.FocusCentreY); break;
            case RemoteKey.Back:
                if (_history.Count > 0) Navigate(_history.Pop(), push: false);
                else if (Route != "/") Navigate("/", push: false);
                else _exit();
                break;
        }
    }

    private void EnterNav(float centreY)
    {
        var best = 0;
        for (var i = 1; i < _nav.Count; i++) if (Math.Abs(_nav[i].CentreY - centreY) < Math.Abs(_nav[best].CentreY - centreY)) best = i;
        SetNavFocus(best);
    }

    private void SetNavFocus(int i)
    {
        var old = _navFocus; _navFocus = i;
        if (old >= 0) StyleNav(old);
        StyleNav(i);
    }

    private void NavKey(RemoteKey key)
    {
        switch (key)
        {
            case RemoteKey.Up: if (_navFocus > 0) SetNavFocus(_navFocus - 1); break;
            case RemoteKey.Down: if (_navFocus < _nav.Count - 1) SetNavFocus(_navFocus + 1); break;
            case RemoteKey.Right: case RemoteKey.Back: FocusPage(); break;
            case RemoteKey.Select: Navigate(_nav[_navFocus].Item.Route); break;
        }
    }
}
