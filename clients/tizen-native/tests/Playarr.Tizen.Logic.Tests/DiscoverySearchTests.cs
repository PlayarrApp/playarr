using Playarr.Tizen.Logic;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class DiscoverySearchTests
{
    [Fact]
    public void SearchFocusStateRestoresTheSelectedResultAndScrollAfterRouteRoundTrip()
    {
        var saved = new SearchFocusState(ResultIndex: 7, ScrollOffset: 502.4f);
        object roundTrippedState = saved;

        var restored = Assert.IsType<SearchFocusState>(roundTrippedState);
        Assert.Equal(7, restored.ResolveResultIndex(resultCount: 12));
        Assert.Equal(502.4f, restored.ScrollOffset);
        Assert.Equal(-1, restored.ResolveResultIndex(resultCount: 4));
    }

    [Fact]
    public void NestedPlaylistSearchResultOpensItsRootWithTheSelectedChild()
    {
        var root = new PlaylistTreeEntry(new PlaylistInfo { Id = Guid.NewGuid(), Name = "Root folder" }, null);
        var child = new PlaylistTreeEntry(new PlaylistInfo { Id = Guid.NewGuid(), Name = "Nested selection" }, root.Playlist.Id);
        var entries = new[] { root, child };

        var result = Assert.Single(SearchResults.Build(
            "nested", "all", Array.Empty<Work>(), entries.Select(entry => entry.Playlist), Array.Empty<DiscoveryTitle>()));
        var route = PlaylistDirectoryModel.RouteForSelection(entries, Assert.IsType<PlaylistInfo>(result.Playlist).Id);

        Assert.Equal(new PlaylistRouteState(root.Playlist.Id, child.Playlist.Id), route);
        Assert.Equal(route, PlaylistRouteState.Parse(route.ToRoute()));
    }

    [Fact]
    public void AllSearchIncludesSupportedWorksAndMatchingPlaylistsButNotGames()
    {
        var movie = new Work { Kind = WorkKind.Movie, Title = "Test Movie A" };
        var author = new Work { Kind = WorkKind.Author, Title = "Test Author A" };
        var matchingPlaylist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Late night" };
        var otherPlaylist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Morning" };
        var game = new DiscoveryTitle { Kind = "game", Title = "Test Game A" };

        var results = SearchResults.Build("night", "all", new[] { movie, author }, new[] { matchingPlaylist, otherPlaylist }, new[] { game });

        Assert.Equal(2, results.Count);
        Assert.Same(movie, results[0].Work);
        Assert.Same(matchingPlaylist, results[1].Playlist);
        Assert.All(results, result => Assert.Null(result.Game));
    }

    [Fact]
    public void PlaylistAndGameTypesReturnOnlyTheirOwnMatches()
    {
        var movie = new Work { Kind = WorkKind.Movie, Title = "Test Movie A" };
        var playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Test playlist" };
        var game = new DiscoveryTitle { Kind = "game", Title = "Test Game A" };

        var playlistResults = SearchResults.Build("test", "playlist", new[] { movie }, new[] { playlist }, new[] { game });
        var gameResults = SearchResults.Build("test", "game", new[] { movie }, new[] { playlist }, new[] { game });

        Assert.Single(playlistResults);
        Assert.Same(playlist, playlistResults[0].Playlist);
        Assert.Single(gameResults);
        Assert.Same(game, gameResults[0].Game);
    }

    [Theory]
    [InlineData(false, "Playlist")]
    [InlineData(true, "System playlist")]
    public void SelectedPlaylistMapsToTheWebPreviewCopy(bool isSystem, string expectedEyebrow)
    {
        var playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Night favourites", IsSystem = isSystem };
        var target = new SearchResultTarget(Playlist: playlist);

        var preview = SearchResults.PlaylistPreview(target);

        Assert.Equal(new SearchPlaylistPreview(expectedEyebrow, "Night favourites"), preview);
    }

    [Fact]
    public void EmptyOrNonPlaylistSelectionHasNoPlaylistPreview()
    {
        var work = new SearchResultTarget(Work: new Work { Kind = WorkKind.Movie, Title = "A film" });
        var game = new SearchResultTarget(Game: new DiscoveryTitle { Kind = "game", Title = "A game" });

        Assert.Null(SearchResults.PlaylistPreview(null));
        Assert.Null(SearchResults.PlaylistPreview(work));
        Assert.Null(SearchResults.PlaylistPreview(game));
    }

    [Fact]
    public void PlaylistPreviewKeepsRawNameAndAddsDisplayOnlyHyphenBreaks()
    {
        const string title = "archive-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet";
        var playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = title };

        var preview = SearchResults.PlaylistPreview(new SearchResultTarget(Playlist: playlist));

        Assert.NotNull(preview);
        Assert.Equal(title, playlist.Name);
        Assert.Equal(title, preview.Title);
        Assert.Equal(6, preview.MaxTitleLines);
        Assert.Equal("archive-\u200Balpha-\u200Bbravo-\u200Bcharlie-\u200Bdelta-\u200Becho-\u200Bfoxtrot-\u200Bgolf-\u200Bhotel-\u200Bindia-\u200Bjuliet", preview.DisplayTitle);
        Assert.DoesNotContain('\u200B', playlist.Name);
    }

    [Fact]
    public void ParseReadsGamesAndProviderStatusFromTheDiscoveryEnvelope()
    {
        const string json = """
        {
          "titles": [{
            "title_key": "game:test-game-a",
            "kind": "game",
            "title": "Test Game A",
            "year": 2024,
            "poster_url": null,
            "sources": []
          }],
          "providers": [{ "provider": "game", "state": "ok", "reason": null }]
        }
        """;

        var response = DiscoverySearch.Parse(json);

        Assert.Single(response.Titles);
        Assert.Equal("Test Game A", response.Titles[0].Title);
        Assert.Equal("game", response.Titles[0].Kind);
        Assert.Single(response.Providers);
        Assert.Equal("ok", response.Providers[0].State);
    }

    [Fact]
    public void ParseReturnsEmptyCollectionsForAnEmptyEnvelope()
    {
        var response = DiscoverySearch.Parse("{}");

        Assert.Empty(response.Titles);
        Assert.Empty(response.Providers);
    }
}

public class OtherSourcesTests
{
    private static DiscoveryTitle T(string kind, params string[] sources)
    {
        var t = new DiscoveryTitle { TitleKey = "k", Kind = kind, Title = "T", Year = 2026 };
        foreach (var s in sources) t.Sources.Add(new TitleSource { Source = s, WorkId = s == "library" ? Guid.Parse("94199bce-b5ab-4cda-8401-35eac8a96157") : null });
        return t;
    }

    [Fact]
    public void ExtraTitlesKeepGamesAndAnythingBeyondTheLibrary()
    {
        var extras = DiscoverySearch.ExtraTitles(new[] { T("movie", "library"), T("movie", "library", "request"), T("game", "game"), T("series", "peer") });
        Assert.Equal(3, extras.Count);
    }

    [Fact]
    public void ChipsAreDistinctAndJoinedWithAMiddleDot() =>
        Assert.Equal("Library · Requestable", DiscoverySearch.SourceChips(T("movie", "library", "request", "request")));

    [Fact]
    public void WatchlistSnapshotCarriesTheLibraryWorkAndNullYearsStayNull()
    {
        var json = Newtonsoft.Json.Linq.JObject.Parse(WatchlistSnapshot.Json(T("movie", "library", "request")));
        Assert.Equal("94199bce-b5ab-4cda-8401-35eac8a96157", (string?)json["work_id"]);
        Assert.Equal("movie", (string?)json["kind"]);
        Assert.Equal(2026, (int?)json["year"]);
        Assert.Equal(Newtonsoft.Json.Linq.JTokenType.Null, Newtonsoft.Json.Linq.JObject.Parse(WatchlistSnapshot.Json(T("game", "game")))["work_id"]!.Type);
    }
}
