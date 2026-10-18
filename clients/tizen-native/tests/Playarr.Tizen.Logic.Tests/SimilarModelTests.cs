using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class SimilarModelTests
{
    private static Work W(string title, WorkKind kind, string year, params string[] genres) =>
        new() { Id = Guid.NewGuid(), Title = title, SortTitle = title.ToLowerInvariant(), Kind = kind, ReleaseDate = year + "-01-01", Genres = genres.ToList() };

    [Fact]
    public void SharedGenresOutrankKindAndYear()
    {
        var target = W("t", WorkKind.Movie, "2000", "Drama", "Crime");
        var shared = W("a", WorkKind.Series, "1950", "Drama", "Crime");
        var sameKind = W("b", WorkKind.Movie, "2000", "Comedy");
        Assert.Equal(new[] { shared, sameKind }, SimilarModel.Rank(target, new[] { sameKind, shared }));
    }

    [Fact]
    public void DropsTargetDuplicatesAndArtistsAndCaps()
    {
        var target = W("t", WorkKind.Movie, "2000", "Drama");
        var other = W("o", WorkKind.Movie, "2001", "Drama");
        var pool = new List<Work> { target, other, other, W("artist", WorkKind.Artist, "2000", "Drama") };
        pool.AddRange(Enumerable.Range(0, 30).Select(i => W("m" + i, WorkKind.Movie, "2000", "Drama")));
        var ranked = SimilarModel.Rank(target, pool);
        Assert.Equal(SimilarModel.Limit, ranked.Count);
        Assert.DoesNotContain(target, ranked);
        Assert.DoesNotContain(ranked, w => w.Kind == WorkKind.Artist);
    }
}
