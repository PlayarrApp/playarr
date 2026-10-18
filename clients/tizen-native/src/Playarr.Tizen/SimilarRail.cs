using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>The Similar Titles rail of a detail page (web .tv-detail rail after the chapters or seasons and the cast): Home-sized cards. Measured at 1920x1080.</summary>
internal sealed class SimilarRail
{
    private const float RailX = 881.6f;
    public View Row { get; } = new();
    public float Scroll { get; private set; }
    public float HeadingY { get; }

    /// <summary>Web order: the server's similar list, else the genre ranking over the available catalogue (a catalogue without embeddings answers an empty list or 404).</summary>
    public static async Task<IList<Work>> LoadAsync(AppEnv env, Work target)
    {
        try
        {
            var works = (await env.Api.GetSimilarWorksAsync(target.Id)).Where(w => w.Id != target.Id && SimilarModel.Shown(w)).ToList();
            if (works.Count > 0) return works;
        }
        catch (Exception e) { Dbg.Log("SIMILAR failed: " + e.Message); }
        try
        {
            var genres = target.Genres.Take(3).ToList();
            var pages = genres.Count > 0
                ? await Task.WhenAll(genres.Select(g => env.Api.BrowseCatalogAsync(genre: g, availableOnly: true, limit: 100)))
                : [await env.Api.BrowseCatalogAsync(kind: target.Kind, availableOnly: true, sort: "date_added", order: "desc", limit: 100)];
            return SimilarModel.Rank(target, pages.SelectMany(p => p.Items));
        }
        catch (Exception e) { Dbg.Log("SIMILAR fallback failed: " + e.Message); return []; }
    }

    public SimilarRail(AppEnv env, View stack, IList<Work> works, float headingY, FocusSet focus, Func<float> stackY, Action<SimilarRail>? focused = null)
    {
        var t = env.Theme; HeadingY = headingY;
        var layout = CardLayout.From("thumbnail", "medium");
        stack.Add(Ui.Text("Similar Titles", RailX, headingY, 17.664f, 700, t.Ink, 400, 26.496f, spacing: -0.53f));
        stack.Add(Ui.Text(works.Count == 1 ? "1 title" : $"{works.Count} titles", RailX, headingY + 30.5f, 9.984f, 400, t.InkMuted, 400, 14.976f));
        Row.PositionY = headingY + 80.7f; Row.Size = new Size(9000, layout.ArtHeight + 76);
        stack.Add(Row);
        var empty = new Dictionary<Guid, WatchProgress>();
        for (var i = 0; i < works.Count; i++)
        {
            var idx = i; var x = i * layout.HomePitchX;
            var work = HomeModel.Card(works[i], empty, false) with { Sub = WorkLabels.KindLabel(works[i].Kind) }; // web caption is the kind only
            var card = MediaCard.Home(env, work, RailX + x, 0, layout);
            Row.Add(card.Box);
            focus.Items.Add(new Focusable
            {
                Rect = () => new Box(RailX + x - Scroll, headingY + 80.7f + stackY(), layout.Width, layout.ArtHeight),
                Label = work.Title.ToLowerInvariant(),
                Select = () => env.Navigate(HomeScreen.DetailRoute(work)),
                Style = f => card.SetFocused(f),
                Focused = () => { Reveal(idx, layout); focused?.Invoke(this); },
            });
        }
    }

    private void Reveal(int index, CardLayout layout)
    {
        var visible = TizenClient.DesignWidth - RailX - Widgets.RailEndInset;
        var right = (index + 1) * layout.HomePitchX - 25f;
        if (right - Scroll > visible) Scroll = right - visible;
        if (index * layout.HomePitchX < Scroll) Scroll = index * layout.HomePitchX;
        Row.PositionX = -Scroll;
    }
}
