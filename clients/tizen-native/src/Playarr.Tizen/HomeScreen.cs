using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Web Home: key art, the details panel for the focused title, and the rails (measured from web at 1920x1080).</summary>
internal sealed class HomeScreen : IPage
{
    private const float RailX = 881.6f, Pitch = 352f, FocusedHeadingY = 402f, RailPitchY = 365.9f, StackedExtra = 5f, ClipX = 729.6f;

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    private readonly View _root = new();
    private readonly View _stack = new();   // all rails, moved vertically so the focused rail's heading sits at 402
    private readonly KeyArt _keyArt;
    private readonly DetailsPanel _panel;
    private readonly List<RailView> _rails = new();
    private int _rail, _card;

    private (int Rail, int Card)? _restore;
    public object? SaveState() => _rails.Count > 0 ? (_rail, _card) : null;
    public void RestoreState(object state) => _restore = ((int, int))state;

    public bool IsReady => _rails.Count > 0;
    public View Root => _root;
    public string Route => "/";
    public string? FocusedLabel => _rails.Count == 0 ? null : (_rails[_rail].Model.Cards[_card].Title + _rails[_rail].Model.Cards[_card].Sub).ToLowerInvariant(); // web exposes the card text
    public bool HasFocusTarget => _rails.Count > 0;
    public (int Rail, int Index)? FocusPosition => _rails.Count == 0 ? null : (_rail, _card);

    private sealed class RailView
    {
        public RailModel Model = null!;
        public View Row = new();
        public List<MediaCard> Cards = new();
        public float Scroll;
        public float Y;
    }

    public HomeScreen(AppEnv env)
    {
        _env = env; _t = env.Theme;
        _root.Size = new Size(TizenClient.DesignWidth, TizenClient.DesignHeight);
        _root.BackgroundColor = Ui.C(_t.Surface);
        _keyArt = new KeyArt(env, armed: true);
        _panel = new DetailsPanel(env, library: false);
        _root.Add(_keyArt.Root);
        _root.Add(_panel.Root);
        var clip = new View { PositionX = ClipX, Size = new Size(TizenClient.DesignWidth - ClipX, TizenClient.DesignHeight), ClippingMode = ClippingModeType.ClipChildren };
        _stack.PositionX = -ClipX;
        clip.Add(_stack);
        _root.Add(clip);
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var railsTask = _env.Api.GetHomeRailsAsync();
            var progress = await _env.Api.ListWatchProgressAsync();
            var deck = new List<Work>();
            var episodes = new Dictionary<Guid, OnDeckEpisode>();
            foreach (var row in HomeModel.OnDeckRows(progress))
            {
                try
                {
                    var detail = await _env.Api.GetWorkAsync(row.WorkId);
                    if (detail.Work.Kind is WorkKind.Series or WorkKind.Site)
                    {
                        // web: a series is on deck as its lead episode (a stacked plan's target, else the last played); no episode drops the card
                        ResumePlan? plan = null;
                        try { plan = await _env.Api.GetResumePlanAsync(row.WorkId); } catch (Exception) { /* an older server has no plan */ }
                        if (HomeModel.FindEpisode(detail.Children, HomeModel.LeadFile(row, plan)) is not { } ep) continue;
                        episodes[detail.Work.Id] = HomeModel.IsStacked(plan) ? ep with { StackOptions = plan!.Options.Count } : ep;
                    }
                    deck.Add(detail.Work);
                }
                catch (Exception) { /* one bad title drops only its card */ }
            }
            var rails = await railsTask;
            var model = HomeModel.Build(rails.Rails.ToList(), deck, HomeModel.IndexByWork(progress), episodes);
            SynchronizationContextHolder.Post(() => { try { Populate(model); } catch (Exception e) { Dbg.Log("HOME populate failed: " + e); } });
        }
        catch (Exception e) { Dbg.Log("HOME load failed: " + e); }
    }

    private void Populate(IReadOnlyList<RailModel> model)
    {
        var y = 0f;
        for (var i = 0; i < model.Count; i++)
        {
            var rv = new RailView { Model = model[i], Y = y };
            _stack.Add(Ui.Text(model[i].Title, RailX, y, 17.664f, 700, _t.Ink, 800, 26.496f, spacing: -0.53f));
            rv.Row.PositionY = y + 61.8f; rv.Row.Size = new Size(4000, 260);
            for (var c = 0; c < model[i].Cards.Count; c++)
            {
                var card = MediaCard.Home(_env, model[i].Cards[c], RailX + c * Pitch, 0);
                rv.Row.Add(card.Box);
                rv.Cards.Add(card);
            }
            _stack.Add(rv.Row);
            _rails.Add(rv);
            // web: a stacked (several ways to continue) card makes its rail taller, which pushes every rail below it down
            y += RailPitchY + (model[i].Cards.Any(c => c.StackOptions > 1) ? StackedExtra : 0);
        }
        if (_restore is { } r && r.Rail < _rails.Count && r.Card < _rails[r.Rail].Cards.Count) { _restore = null; Focus(r.Rail, r.Card); } else Focus(0, 0);
    }

    public bool OnKey(RemoteKey key)
    {
        if (_rails.Count == 0) return key is not (RemoteKey.Left or RemoteKey.Back);
        switch (key)
        {
            case RemoteKey.Right: if (_card + 1 < _rails[_rail].Cards.Count) Focus(_rail, _card + 1); return true;
            case RemoteKey.Left: if (_card > 0) { Focus(_rail, _card - 1); return true; } return false;
            case RemoteKey.Down: MoveRail(_rail + 1); return true;
            case RemoteKey.Up: MoveRail(_rail - 1); return true;
            case RemoteKey.Select: _env.Navigate(DetailRoute(_rails[_rail].Model.Cards[_card])); return true;
        }
        return false;
    }

    /// <summary>Vertical moves are geometric: the card whose on-screen centre is closest to the focused card's; the rail scrolls only enough.</summary>
    private void MoveRail(int to)
    {
        if (to < 0 || to >= _rails.Count) return;
        var cx = RailX + _card * Pitch - _rails[_rail].Scroll + MediaCard.Width / 2;
        var best = 0; var bestD = float.MaxValue;
        for (var i = 0; i < _rails[to].Cards.Count; i++)
        {
            var d = Math.Abs(RailX + i * Pitch - _rails[to].Scroll + MediaCard.Width / 2 - cx);
            if (d < bestD) { bestD = d; best = i; }
        }
        Focus(to, best);
    }

    public static string DetailRoute(WorkCard c) => c.Kind switch
    {
        WorkKind.Series => $"/series/{c.WorkId}",
        WorkKind.Artist => $"/music/{c.WorkId}",
        _ => $"/movies/{c.WorkId}",
    };

    /// <summary>Screen centre of the focused card (for the nav's geometric entry).</summary>
    public float FocusCentreY => FocusedHeadingY + 61.8f + MediaCard.Height / 2;

    private void Focus(int rail, int card)
    {
        if (_rails.Count > 0) _rails[_rail].Cards[_card].SetFocused(false);
        _rail = rail; _card = card;
        var rv = _rails[rail];
        var visible = TizenClient.DesignWidth - RailX - Widgets.RailEndInset; // web keeps the focused card clear of the screen edge: room for its scale, ring and glow
        var right = (card + 1) * Pitch - 24.8f;
        if (right - rv.Scroll > visible) rv.Scroll = right - visible;
        if (card * Pitch < rv.Scroll) rv.Scroll = card * Pitch;
        rv.Row.PositionX = -rv.Scroll;
        _stack.PositionY = FocusedHeadingY - rv.Y;
        rv.Cards[card].SetFocused(true);
        var model = rv.Model.Cards[card];
        _panel.Show(model, metaLead: null);
        _keyArt.Set(model.BackdropUrl);
    }
}
