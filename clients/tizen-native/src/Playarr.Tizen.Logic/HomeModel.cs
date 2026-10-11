using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>One card on Home or a library grid, reduced to what the screens draw.</summary>
public sealed record WorkCard(Guid WorkId, WorkKind Kind, string Title, string Sub, string Kicker, string Overview,
    string? ThumbUrl, string? PosterUrl, string? BackdropUrl, double Progress, bool Unseen, string? Year = null, IReadOnlyList<string>? Genres = null);

public sealed record RailModel(string Id, string Title, IReadOnlyList<WorkCard> Cards);

/// <summary>Port of web pages/Home.tsx rail composition plus lib/onDeck.ts (without stacked resume plans).</summary>
public static class HomeModel
{
    public static IReadOnlyDictionary<Guid, WatchProgress> IndexByWork(IEnumerable<WatchProgress> rows)
    {
        static int Priority(WatchState s) => s == WatchState.InProgress ? 2 : s == WatchState.Watched ? 1 : 0;
        var map = new Dictionary<Guid, WatchProgress>();
        foreach (var p in rows)
            if (!map.TryGetValue(p.WorkId, out var cur) || Priority(p.State) > Priority(cur.State)) map[p.WorkId] = p;
        return map;
    }

    /// <summary>Work ids to resolve for On Deck: part-watched, newest first, one per work, at most ten.</summary>
    public static IReadOnlyList<WatchProgress> OnDeckRows(IEnumerable<WatchProgress> rows) =>
        rows.Where(p => p.State == WatchState.InProgress)
            .OrderByDescending(p => p.UpdatedAt ?? DateTimeOffset.MinValue)
            .GroupBy(p => p.WorkId).Select(g => g.First()).Take(10).ToList();

    /// <summary>The library meta row: year, then up to two genres joined with a middle dot (web .tv-preview-meta spans).</summary>
    public static string MetaLead(WorkCard c) => string.Join("   ", new[] { c.Year, c.Genres is { Count: > 0 } g ? string.Join(" \u00b7 ", g.Take(2)) : null }.Where(x => !string.IsNullOrEmpty(x)));

    public static WorkCard Card(Work w, IReadOnlyDictionary<Guid, WatchProgress> progress, bool showUnwatched)
    {
        progress.TryGetValue(w.Id, out var p);
        var kind = WorkLabels.KindLabel(w.Kind);
        var kicker = w.Genres.Count > 0 ? (kind.Length > 0 ? kind + " · " + w.Genres[0] : w.Genres[0]) : kind;
        return new WorkCard(w.Id, w.Kind, w.Title, WorkLabels.KindWithYear(w), kicker, w.Overview ?? "",
            ArtworkPaths.First(w, ImageKind.Thumb, ImageKind.Backdrop, ImageKind.Banner, ImageKind.Poster), ArtworkPaths.Path(w, ImageKind.Poster), ArtworkPaths.Path(w, ImageKind.Backdrop),
            p is { State: WatchState.InProgress } ? p.Fraction : 0,
            p is { State: WatchState.Unwatched } || (p is null && showUnwatched), WorkLabels.YearRange(w), w.Genres.ToList());
    }

    public static IReadOnlyList<RailModel> Build(IReadOnlyList<HomeRail> serverRails, IReadOnlyList<Work> onDeck,
        IReadOnlyDictionary<Guid, WatchProgress> progress)
    {
        var used = new HashSet<Guid>();
        var all = serverRails.SelectMany(r => r.Items).OrderByDescending(w => w.AddedAt).ToList();
        var primary = (onDeck.Count > 0 ? onDeck : all).Where(w => used.Add(w.Id)).Take(onDeck.Count > 0 ? 10 : 8).ToList();
        var rails = new List<RailModel> { new("primary", onDeck.Count > 0 ? "On deck" : "Start watching", primary.Select(w => Card(w, progress, onDeck.Count == 0)).ToList()) };
        rails.AddRange(serverRails.Select(r => new RailModel(r.Id, r.Title, r.Items.Select(w => Card(w, progress, true)).ToList())));
        return rails.Where(r => r.Cards.Count > 0).ToList();
    }
}
