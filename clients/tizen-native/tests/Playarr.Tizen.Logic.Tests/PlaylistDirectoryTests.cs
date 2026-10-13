using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class PlaylistDirectoryTests
{
    [Fact]
    public void ParseResponseKeepsPlaylistFieldsAndParentFromTheSameRow()
    {
        var rootId = Guid.NewGuid();
        var childId = Guid.NewGuid();
        var json = $"[{{\"id\":\"{rootId:D}\",\"name\":\"Root List\",\"is_system\":true,\"media_type\":\"video\",\"parent_playlist_id\":null}},{{\"id\":\"{childId:D}\",\"name\":\"Child List\",\"is_system\":false,\"media_type\":\"audio\",\"parent_playlist_id\":\"{rootId:D}\"}}]";

        var entries = PlaylistDirectoryApi.ParseResponse(json);

        Assert.Collection(entries,
            root =>
            {
                Assert.Equal(rootId, root.Playlist.Id);
                Assert.Equal("Root List", root.Playlist.Name);
                Assert.True(root.Playlist.IsSystem);
                Assert.Equal("video", root.Playlist.MediaType);
                Assert.Null(root.ParentPlaylistId);
            },
            child =>
            {
                Assert.Equal(childId, child.Playlist.Id);
                Assert.Equal("Child List", child.Playlist.Name);
                Assert.False(child.Playlist.IsSystem);
                Assert.Equal("audio", child.Playlist.MediaType);
                Assert.Equal(rootId, child.ParentPlaylistId);
            });
    }

    [Fact]
    public void RootsIncludeOnlyTopLevelAndOrphansInNaturalCaseInsensitiveOrder()
    {
        var parent = Entry("root", null);
        var child = Entry("child", parent.Playlist.Id);
        var entries = new[]
        {
            Entry("mix 10", null), child, Entry("Mix 2", null), parent,
            Entry("orphan", Guid.NewGuid()),
        };

        var roots = PlaylistDirectoryModel.Roots(entries);

        Assert.Equal(new[] { "Mix 2", "mix 10", "orphan", "root" }, roots.Select(entry => entry.Playlist.Name));
    }

    [Fact]
    public void NestedSelectionResolvesRootAndKeepsSelectedChildInRoute()
    {
        var root = Entry("Root", null);
        var child = Entry("Child", root.Playlist.Id);
        var nested = Entry("Nested", child.Playlist.Id);
        var entries = new[] { root, child, nested };

        var route = PlaylistDirectoryModel.RouteForSelection(entries, nested.Playlist.Id);

        Assert.Equal(root.Playlist.Id, route.PlaylistId);
        Assert.Equal(nested.Playlist.Id, route.TrackId);
        Assert.Equal(route, PlaylistRouteState.Parse(route.ToRoute()));
        Assert.Equal(new PlaylistRouteState(root.Playlist.Id), route.Back());
        Assert.Equal(new PlaylistRouteState(), route.Back().Back());
    }

    [Fact]
    public void MissingParentMakesPlaylistARootAndRouteTarget()
    {
        var orphan = Entry("Orphan", Guid.NewGuid());

        Assert.Equal(orphan.Playlist.Id, Assert.Single(PlaylistDirectoryModel.Roots(new[] { orphan })).Playlist.Id);
        Assert.Equal(new PlaylistRouteState(orphan.Playlist.Id), PlaylistDirectoryModel.RouteForSelection(new[] { orphan }, orphan.Playlist.Id));
    }

    [Fact]
    public void NormalizeRouteKeepsValidRootWhenRequestedTrackIsMissing()
    {
        var root = Entry("Root", null);
        var route = PlaylistDirectoryModel.NormalizeRoute(
            new[] { root }, new PlaylistRouteState(root.Playlist.Id, Guid.NewGuid()));

        Assert.Equal(new PlaylistRouteState(root.Playlist.Id), route);
    }

    [Fact]
    public void CyclicParentsDoNotLoopAndRouteRemainsParseable()
    {
        var first = Entry("First", Guid.NewGuid());
        var second = new PlaylistTreeEntry(
            new PlaylistInfo { Id = first.ParentPlaylistId!.Value, Name = "Second" },
            first.Playlist.Id);
        first = first with { ParentPlaylistId = second.Playlist.Id };
        var entries = new[] { first, second };

        var route = PlaylistDirectoryModel.RouteForSelection(entries, first.Playlist.Id);

        Assert.Equal(second.Playlist.Id, route.PlaylistId);
        Assert.Equal(first.Playlist.Id, route.TrackId);
        Assert.Equal(route, PlaylistRouteState.Parse(route.ToRoute()));
        Assert.Empty(PlaylistDirectoryModel.Roots(entries));
    }

    [Fact]
    public void CoverSelectionUsesOwnItemsThenDepthFirstChildrenAndDeduplicatesWorks()
    {
        var root = Entry("Root", null);
        var secondFolder = Entry("Folder 2", root.Playlist.Id);
        var firstFolder = Entry("Folder 1", root.Playlist.Id);
        var nestedFolder = Entry("Nested", firstFolder.Playlist.Id);
        var noPosterOrBackdrop = CoverWork(ImageKind.Thumb);
        var first = CoverWork(ImageKind.Poster);
        var second = CoverWork(ImageKind.Backdrop);
        var third = CoverWork(ImageKind.Poster);
        var fourth = CoverWork(ImageKind.Poster);
        var entries = new[] { secondFolder, nestedFolder, root, firstFolder };
        var works = new Dictionary<Guid, IReadOnlyList<Work>>
        {
            [root.Playlist.Id] = new[] { noPosterOrBackdrop, first, first },
            [firstFolder.Playlist.Id] = new[] { first, second },
            [nestedFolder.Playlist.Id] = new[] { third },
            [secondFolder.Playlist.Id] = new[] { fourth },
        };

        var covers = PlaylistCoverSelection.Select(entries, root.Playlist.Id, works);

        Assert.Equal(new[] { first.Id, second.Id, third.Id }, covers.Select(work => work.Id));
    }

    [Fact]
    public void CoverSelectionReturnsEmptyWhenPlaylistTreeHasNoArtwork()
    {
        var root = Entry("Empty", null);
        var child = Entry("Empty child", root.Playlist.Id);
        var works = new Dictionary<Guid, IReadOnlyList<Work>>
        {
            [root.Playlist.Id] = new[] { CoverWork(ImageKind.Thumb) },
            [child.Playlist.Id] = Array.Empty<Work>(),
        };

        Assert.Empty(PlaylistCoverSelection.Select(new[] { root, child }, root.Playlist.Id, works));
    }

    private static PlaylistTreeEntry Entry(string name, Guid? parent) =>
        new(new PlaylistInfo { Id = Guid.NewGuid(), Name = name }, parent);

    private static Work CoverWork(ImageKind kind)
    {
        var id = Guid.NewGuid();
        return new Work
        {
            Id = id,
            Images = new List<ImageAsset> { new() { Kind = kind, Url = "/artwork/" + id.ToString("D") } },
        };
    }
}
