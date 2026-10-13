using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Newtonsoft.Json.Linq;
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
    public void DirectoryFiltersSelectVisibilityAndCanonicalizeOrdering()
    {
        var personal = Entry("Personal 2", null) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Personal 2", MediaType = "video" } };
        var personal10 = Entry("Personal 10", null) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Personal 10", MediaType = "video" } };
        var shared = new PlaylistTreeEntry(new PlaylistInfo { Id = Guid.NewGuid(), Name = "Shared", IsSystem = true, MediaType = "video" }, null);
        var entries = new[] { personal10, shared, personal };

        Assert.Equal(new[] { "Personal 2", "Personal 10", "Shared" }, PlaylistDirectoryModel.DirectoryRoots(entries, PlaylistVisibility.All, PlaylistOrder.Ascending).Select(entry => entry.Playlist.Name));
        Assert.Equal(new[] { "Personal 10", "Personal 2" }, PlaylistDirectoryModel.DirectoryRoots(entries, PlaylistVisibility.Personal, PlaylistOrder.Descending).Select(entry => entry.Playlist.Name));
        Assert.Equal(new[] { "Shared" }, PlaylistDirectoryModel.DirectoryRoots(entries, PlaylistVisibility.Shared, PlaylistOrder.Ascending).Select(entry => entry.Playlist.Name));
    }

    [Fact]
    public void PlaylistRouteParsesAndOmitsCanonicalFilterDefaults()
    {
        var filtered = PlaylistRouteState.Parse("/playlists?visibility=personal&order=desc&panel=filters");
        Assert.Equal(PlaylistVisibility.Personal, filtered.Visibility);
        Assert.Equal(PlaylistOrder.Descending, filtered.Order);
        Assert.Equal("filters", filtered.Panel);
        Assert.Equal("/playlists?visibility=personal&order=desc&panel=filters", filtered.ToRoute());

        var defaults = PlaylistRouteState.Parse("/playlists?visibility=all&order=asc&panel=create");
        Assert.Equal("/playlists?panel=create", defaults.ToRoute());
        Assert.Equal("/playlists", new PlaylistRouteState().ToRoute());
        Assert.Equal(PlaylistRouteState.Parse("/playlists?panel=filters"), PlaylistRouteState.Parse("/playlists?visibility=invalid&order=invalid&panel=filters"));
    }

    [Fact]
    public void EligibleParentsArePersonalSameTypeRootsAndExcludeSelectedSubtree()
    {
        var keep = Entry("Keep", null) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Keep", MediaType = "video" } };
        var excluded = Entry("Excluded", null) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Excluded", MediaType = "video" } };
        var descendant = Entry("Descendant", excluded.Playlist.Id) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Descendant", MediaType = "video" } };
        var system = new PlaylistTreeEntry(new PlaylistInfo { Id = Guid.NewGuid(), Name = "System", IsSystem = true, MediaType = "video" }, null);
        var audio = Entry("Audio", null) with { Playlist = new PlaylistInfo { Id = Guid.NewGuid(), Name = "Audio", MediaType = "audio" } };

        var parents = PlaylistDirectoryModel.EligibleParents(new[] { keep, excluded, descendant, system, audio }, "video", excluded.Playlist.Id);

        Assert.Equal(new[] { keep.Playlist.Id }, parents.Select(entry => entry.Playlist.Id));
    }

    [Fact]
    public void ParentIndexCyclingIncludesNoneAndStaysWithinBounds()
    {
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(-1, 0, 1));
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(0, 0, -1));

        Assert.Equal(0, PlaylistDirectoryModel.CycleParentIndex(-1, 1, 1));
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(0, 1, 1));
        Assert.Equal(0, PlaylistDirectoryModel.CycleParentIndex(-1, 1, -1));
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(0, 1, -1));

        Assert.Equal(0, PlaylistDirectoryModel.CycleParentIndex(-1, 3, 1));
        Assert.Equal(1, PlaylistDirectoryModel.CycleParentIndex(0, 3, 1));
        Assert.Equal(2, PlaylistDirectoryModel.CycleParentIndex(1, 3, 1));
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(2, 3, 1));
        Assert.Equal(2, PlaylistDirectoryModel.CycleParentIndex(-1, 3, -1));
        Assert.Equal(1, PlaylistDirectoryModel.CycleParentIndex(2, 3, -1));
        Assert.Equal(-1, PlaylistDirectoryModel.CycleParentIndex(0, 3, -1));

        Assert.Equal(0, PlaylistDirectoryModel.CycleParentIndex(-2, 3, 1));
        Assert.Equal(2, PlaylistDirectoryModel.CycleParentIndex(3, 3, -1));
        Assert.InRange(PlaylistDirectoryModel.CycleParentIndex(int.MaxValue, 3, 1), -1, 2);
    }

    [Fact]
    public void ActionColumnNeighborsPairCreateAndFiltersAndLeaveOtherMovesGeometric()
    {
        Assert.Equal<int?>(PlaylistDirectoryModel.FiltersActionIndex,
            PlaylistDirectoryModel.ActionColumnNeighbor(PlaylistDirectoryModel.CreateActionIndex, moveDown: true));
        Assert.Equal<int?>(PlaylistDirectoryModel.CreateActionIndex,
            PlaylistDirectoryModel.ActionColumnNeighbor(PlaylistDirectoryModel.FiltersActionIndex, moveDown: false));

        Assert.Null(PlaylistDirectoryModel.ActionColumnNeighbor(PlaylistDirectoryModel.CreateActionIndex, moveDown: false));
        Assert.Null(PlaylistDirectoryModel.ActionColumnNeighbor(PlaylistDirectoryModel.FiltersActionIndex, moveDown: true));
        Assert.Null(PlaylistDirectoryModel.ActionColumnNeighbor(-1, moveDown: true));
        Assert.Null(PlaylistDirectoryModel.ActionColumnNeighbor(2, moveDown: false));
    }

    [Theory]
    [InlineData(0, null)]
    [InlineData(1, 0)]
    [InlineData(3, 2)]
    [InlineData(4, 2)]
    public void NearestDirectoryCardUsesEdgeDistanceAtInitialScroll(int cardCount, int? expectedIndex)
    {
        var cards = Enumerable.Range(0, cardCount).Select(index => DirectoryCardFocusBox(index, scroll: 0)).ToList();
        Assert.Equal(expectedIndex, PlaylistDirectoryModel.NearestDirectoryCardIndex(FiltersActionBox, cards));
    }

    [Fact]
    public void NearestDirectoryCardUsesCurrentScrollOffset()
    {
        var initialCards = Enumerable.Range(0, 9).Select(index => DirectoryCardFocusBox(index, scroll: 0)).ToList();
        var cards = Enumerable.Range(0, 9).Select(index => DirectoryCardFocusBox(index, scroll: 500)).ToList();

        Assert.Equal<int?>(2, PlaylistDirectoryModel.NearestDirectoryCardIndex(FiltersActionBox, initialCards));
        Assert.Equal<int?>(8, PlaylistDirectoryModel.NearestDirectoryCardIndex(FiltersActionBox, cards));
    }

    [Fact]
    public void CreatePlaylistRequestSerializesAllRequiredFieldsIncludingNullParent()
    {
        var parentId = Guid.NewGuid();
        var root = JObject.Parse(PlaylistDirectoryApi.CreateRequestJson("New list", null, "video"));
        Assert.Equal("New list", (string?)root["name"]);
        Assert.Equal(JTokenType.Null, root["parent_playlist_id"]?.Type);
        Assert.False((bool)root["is_system"]!);
        Assert.Equal("video", (string?)root["media_type"]);

        var child = JObject.Parse(PlaylistDirectoryApi.CreateRequestJson("Child", parentId, "audio"));
        Assert.Equal(parentId.ToString("D"), (string?)child["parent_playlist_id"]);
        Assert.Equal("audio", (string?)child["media_type"]);
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
    public void NormalizeRoutePreservesVisibilityOrderAndPanel()
    {
        var root = Entry("Root", null);
        var route = PlaylistDirectoryModel.NormalizeRoute(new[] { root }, new PlaylistRouteState(
            root.Playlist.Id, Visibility: PlaylistVisibility.Shared, Order: PlaylistOrder.Descending, Panel: "filters"));

        Assert.Equal(PlaylistVisibility.Shared, route.Visibility);
        Assert.Equal(PlaylistOrder.Descending, route.Order);
        Assert.Equal("filters", route.Panel);
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

    private static readonly Box FiltersActionBox = new(1845.5f, 236.2f, 62, 72);

    private static Box DirectoryCardFocusBox(int index, float scroll)
    {
        const float width = 327.2f, height = 213.4f, scale = 1.015f, lift = -5f;
        var x = new[] { 783.36f, 1136.46f, 1489.56f }[index % 3];
        var y = 162f + index / 3 * 251.2f - scroll;
        var scaledWidth = width * scale;
        var scaledHeight = height * scale;
        return new Box(
            x + (width - scaledWidth) / 2f,
            y + lift + (height - scaledHeight) / 2f,
            scaledWidth,
            scaledHeight);
    }

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
