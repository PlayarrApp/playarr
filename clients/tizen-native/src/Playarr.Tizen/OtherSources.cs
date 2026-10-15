using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>
/// Web DiscoveryExtras ("Other sources" under the Search results): titles from beyond the library, each a 1014 x 93 row (18 px padding)
/// with the title (a link when the library has it), the year and source chips, and an Add to watchlist pill at the right. Geometry is
/// measured from the web DOM at 1920x1080; rows sit 103 px apart under a 16 px heading.
/// </summary>
internal sealed class OtherSources
{
    public const float X = 825.6f, Width = 1014f, RowH = 93f, Pitch = 103f, HeadingH = 16f, FirstRowOffset = 28f, PillH = 44f;

    public sealed class Row
    {
        public DiscoveryTitle Title = null!;
        public float Y;            // row top within the section
        public Guid? LibraryWork;
        public View? Ring;         // focus ring around the pill
        public View? LinkRing;
        public View Pill = null!;
        public TextLabel Symbol = null!, Label = null!;
        public float PillX, PillW;
        public bool Listed, Busy;
    }

    private readonly AppEnv _env;
    private readonly PlayarrTheme _t;
    public View Root { get; } = new();
    public List<Row> Rows { get; } = new();
    public float Height { get; private set; }

    public OtherSources(AppEnv env, IReadOnlyList<DiscoveryTitle> titles, float top)
    {
        _env = env; _t = env.Theme;
        Root.PositionY = top; Root.PositionX = 0;
        Root.Add(Ui.Text("Other sources", X, 0, 10.88f, 700, _t.InkMuted, Width, HeadingH, upper: true, spacing: 0.7616f));
        var y = FirstRowOffset;
        foreach (var title in titles)
        {
            var row = new Row { Title = title, Y = y, LibraryWork = DiscoverySearch.LibraryWork(title), Listed = title.InWatchlist };
            var tall = title.Editions.Count > 0 ? 24f : 0f;
            var box = Ui.Box(X, y, Width, RowH + tall, new Rgba(_t.SurfaceSoft.R, _t.SurfaceSoft.G, _t.SurfaceSoft.B, 0.45f), 14);
            Root.Add(box);
            box.Add(Ui.Text(title.Title, 18, 19, 19.2f, 700, _t.Ink, 640, 26));
            var caption = (title.Year is { } yr ? yr + " · " : "") + DiscoverySearch.SourceChips(title);
            box.Add(Ui.Text(caption, 18, 51, 16, 400, _t.InkMuted, 640, 24));
            if (tall > 0) box.Add(Ui.Text(string.Join(" · ", title.Editions), 18, 75, 16, 400, _t.InkMuted, 640, 24));
            BuildPill(row, box, y);
            Rows.Add(row);
            y += Pitch + tall;
        }
        Height = y;
    }

    private void BuildPill(Row row, View parent, float rowY)
    {
        var symbol = row.Listed ? "✓" : "+";
        var label = row.Listed ? "Remove from watchlist" : "Add to watchlist";
        var sw = Ui.TextWidth(symbol, 19.2f, 400, 0); var lw = Ui.TextWidth(label, 19.2f, 700, 0);
        row.PillW = 16 + sw + 7 + lw + 16;
        row.PillX = X + Width - 18 - row.PillW;
        var bg = new Rgba(_t.SurfaceStrong.R, _t.SurfaceStrong.G, _t.SurfaceStrong.B, 0.88f);
        row.Pill?.Dispose();
        row.Pill = Ui.Box(row.PillX - X, 25, row.PillW, PillH, bg, 22);
        row.Pill.BorderlineWidth = 1; row.Pill.BorderlineColor = Ui.LineA(_t, 0.176f);
        row.Symbol = Ui.Text(symbol, 16, 7, 19.2f, 400, _t.Ink, sw + 4, 29);
        row.Label = Ui.Text(label, 16 + sw + 7, 7, 19.2f, 700, _t.Ink, lw + 4, 29);
        row.Pill.Add(row.Symbol); row.Pill.Add(row.Label);
        // web: the focused button has a 3 px ring in the page ink
        row.Ring = new View { Size = new Size(row.PillW, PillH), CornerRadius = 22, BorderlineWidth = 3, BorderlineColor = Ui.C(_t.Ink), BorderlineOffset = -1 };
        row.Ring.Show(false); row.Pill.Add(row.Ring);
        parent.Add(row.Pill);
        if (row.LibraryWork is not null)
        {
            var tw = Ui.TextWidth(row.Title.Title, 19.2f, 700, 0);
            row.LinkRing = new View { PositionX = 18 - 3, PositionY = 19 - 1, Size = new Size(tw + 6, 29), CornerRadius = 4, BorderlineWidth = 3, BorderlineColor = Ui.C(_t.Ink), BorderlineOffset = -1 };
            row.LinkRing.Show(false); parent.Add(row.LinkRing);
        }
    }

    /// <summary>Screen-space rectangle of a row's pill or title link, for focus bookkeeping.</summary>
    public (float X, float Y, float W, float H) PillRect(Row r) => (r.PillX, Root.PositionY + r.Y + 25, r.PillW, PillH);

    public async Task ToggleAsync(Row row, Action<string> toast, Action refresh)
    {
        if (row.Busy) return;
        row.Busy = true;
        try
        {
            if (row.Listed) await _env.Api.RemoveFromWatchlistAsync(row.Title.TitleKey).ConfigureAwait(false);
            else await _env.Api.AddToWatchlistAsync(row.Title).ConfigureAwait(false);
            SynchronizationContextHolder.Post(() =>
            {
                row.Listed = !row.Listed;
                var focused = row.Ring?.Opacity > 0.5f;
                var parent = row.Pill.GetParent() as View;
                if (parent is not null) { parent.Remove(row.Pill); row.Pill.Dispose(); }
                row.LinkRing?.Dispose();
                if (parent is not null) BuildPill(row, parent, row.Y);
                row.Ring?.Show(focused);
                refresh();
            });
        }
        catch (Exception e)
        {
            Dbg.Log("WATCHLIST toggle failed: " + e.Message);
            SynchronizationContextHolder.Post(() => toast("Watchlist is unavailable right now."));
        }
        finally { row.Busy = false; }
    }
}
