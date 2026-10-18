using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>Port of web WorkDetail relatedWorkScore and the genre fallback ranking behind the Similar Titles rail.</summary>
public static class SimilarModel
{
    public const int Limit = 20;

    /// <summary>The web only shows movies and episodic titles (never artists or authors).</summary>
    public static bool Shown(Work w) => w.Kind is WorkKind.Movie or WorkKind.Series;

    public static double Score(Work target, Work candidate)
    {
        var genres = target.Genres.Select(g => g.Trim().ToLowerInvariant()).ToHashSet();
        var shared = candidate.Genres.Count(g => genres.Contains(g.Trim().ToLowerInvariant()));
        var sameKind = target.Kind == candidate.Kind ? 1 : 0;
        var a = Year(target); var b = Year(candidate);
        var proximity = a is { } ya && b is { } yb ? Math.Max(0, 5 - Math.Abs(ya - yb) / 5.0) : 0;
        return shared * 100 + sameKind * 10 + proximity;
    }

    /// <summary>Candidates without the target, ranked by <see cref="Score"/> then sort title, at most <see cref="Limit"/>.</summary>
    public static IList<Work> Rank(Work target, IEnumerable<Work> candidates) =>
        candidates.Where(c => c.Id != target.Id && Shown(c)).GroupBy(c => c.Id).Select(g => g.First())
            .OrderByDescending(c => Score(target, c)).ThenBy(c => c.SortTitle, StringComparer.CurrentCulture).Take(Limit).ToList();

    private static int? Year(Work w) => w.ReleaseDate is { Length: >= 4 } d && int.TryParse(d.AsSpan(0, 4), out var y) && y > 0 ? y : null;
}
