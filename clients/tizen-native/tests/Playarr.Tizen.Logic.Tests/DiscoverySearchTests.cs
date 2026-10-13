using Playarr.Tizen.Logic;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class DiscoverySearchTests
{
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
