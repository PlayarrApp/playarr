using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>One card on Home or a library grid, reduced to what the screens draw.</summary>
public sealed record WorkCard(Guid WorkId, WorkKind Kind, string Title, string Sub, string Kicker, string Overview,
    string? ThumbUrl, string? PosterUrl, string? BackdropUrl, double Progress, bool Unseen, string? Year = null, IReadOnlyList<string>? Genres = null,
    int StackOptions = 0);

/// <summary>The episode an On Deck series card stands for: its season number and the episode with its file (web OnDeckEntry.episode).</summary>
public sealed record OnDeckEpisode(int SeasonNumber, EpisodeDetail Detail, int StackOptions = 0);

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

    /// <summary>Web findOnDeckEpisode: the episode (and its season number) that plays from <paramref name="mediaFileId"/>.</summary>
    public static OnDeckEpisode? FindEpisode(WorkChildren children, Guid mediaFileId)
    {
        foreach (var season in children.Seasons)
            foreach (var e in season.Episodes)
                if (e.MediaFileId == mediaFileId) return new OnDeckEpisode(season.Season.SeasonNumber, e);
        return null;
    }

    /// <summary>The file an On Deck series continues from: a stacked resume plan's lead episode (needs a choice, several options), else the last played.</summary>
    public static Guid LeadFile(WatchProgress row, ResumePlan? plan) =>
        IsStacked(plan) && plan!.Target?.MediaFileId is { } lead ? lead : row.MediaFileId;

    /// <summary>Web isStackedPlan: the series needs a choice and has more than one way to continue (the card is stacked, with a badge).</summary>
    public static bool IsStacked(ResumePlan? plan) => plan is { NeedsChoice: true, Options.Count: > 1 };

    /// <summary>The library meta row: year, then up to two genres joined with a middle dot (web .tv-preview-meta spans).</summary>
    public static string MetaLead(WorkCard c) => string.Join("   ", new[] { c.Year, c.Genres is { Count: > 0 } g ? string.Join(" \u00b7 ", g.Take(2)) : null }.Where(x => !string.IsNullOrEmpty(x)));

    public static WorkCard Card(Work w, IReadOnlyDictionary<Guid, WatchProgress> progress, bool showUnwatched, OnDeckEpisode? episode = null)
    {
        progress.TryGetValue(w.Id, out var p);
        if (episode is not null) return EpisodeCard(w, episode, p);
        var kind = WorkLabels.KindLabel(w.Kind);
        var kicker = w.Genres.Count > 0 ? (kind.Length > 0 ? kind + " · " + w.Genres[0] : w.Genres[0]) : kind;
        return new WorkCard(w.Id, w.Kind, w.Title, WorkLabels.KindWithYear(w), kicker, w.Overview ?? "",
            ArtworkPaths.First(w, ImageKind.Thumb, ImageKind.Backdrop, ImageKind.Banner, ImageKind.Poster), ArtworkPaths.Path(w, ImageKind.Poster), ArtworkPaths.Path(w, ImageKind.Backdrop),
            p is { State: WatchState.InProgress } ? Math.Max(p.Fraction, 1e-6) : 0, // web draws the 3 px minimum even at 0
            p is { State: WatchState.Unwatched } || (p is null && showUnwatched), WorkLabels.YearRange(w), w.Genres.ToList());
    }

    /// <summary>
    /// Web Home: an On Deck series card is its episode: the episode title (or "Episode N"), "Series · S01 E02" beneath, the episode's
    /// overview, and the frame of the episode's file as the art. The card still opens the series.
    /// </summary>
    private static WorkCard EpisodeCard(Work w, OnDeckEpisode ep, WatchProgress? p)
    {
        var e = ep.Detail.Episode;
        var title = string.IsNullOrEmpty(e.Title) ? $"Episode {e.EpisodeNumber}" : e.Title!;
        var provider = $"{w.Title} \u00b7 S{ep.SeasonNumber:00} E{e.EpisodeNumber:00}";
        var frame = ep.Detail.MediaFileId is { } f ? $"/api/v1/media/{f:D}/thumbnail" : ArtworkPaths.First(w, ImageKind.Thumb, ImageKind.Backdrop, ImageKind.Banner, ImageKind.Poster);
        return new WorkCard(w.Id, w.Kind, title, provider, provider, e.Overview ?? w.Overview ?? "", frame, ArtworkPaths.Path(w, ImageKind.Poster), ArtworkPaths.Path(w, ImageKind.Backdrop),
            p is { State: WatchState.InProgress } ? Math.Max(p.Fraction, 1e-6) : 0, false, WorkLabels.YearRange(w), w.Genres.ToList(), ep.StackOptions);
    }

    public static IReadOnlyList<RailModel> Build(IReadOnlyList<HomeRail> serverRails, IReadOnlyList<Work> onDeck,
        IReadOnlyDictionary<Guid, WatchProgress> progress, IReadOnlyDictionary<Guid, OnDeckEpisode>? episodes = null)
    {
        var used = new HashSet<Guid>();
        var all = serverRails.SelectMany(r => r.Items).OrderByDescending(w => w.AddedAt).ToList();
        var primary = (onDeck.Count > 0 ? onDeck : all).Where(w => used.Add(w.Id)).Take(onDeck.Count > 0 ? 10 : 8).ToList();
        var rails = new List<RailModel> { new("primary", onDeck.Count > 0 ? "On deck" : "Start watching", primary.Select(w => Card(w, progress, true, onDeck.Count > 0 && episodes is not null && episodes.TryGetValue(w.Id, out var ep) ? ep : null)).ToList()) };
        rails.AddRange(serverRails.Select(r => new RailModel(r.Id, r.Title, r.Items.Select(w => Card(w, progress, true)).ToList())));
        return rails.Where(r => r.Cards.Count > 0).ToList();
    }
}
