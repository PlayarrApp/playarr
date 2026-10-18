using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Xunit;

public class HomeModelTests
{
    private static Work W(string title, string added = "2026-01-01T00:00:00Z") => new()
    {
        Id = Guid.NewGuid(), Kind = WorkKind.Movie, Title = title, AddedAt = DateTimeOffset.Parse(added), ReleaseDate = "2016-03-01", Genres = { "Drama" },
    };

    private static WatchProgress P(Work w, WatchState s, long pos = 50, long dur = 100, string? at = null) => new()
    {
        MediaFileId = Guid.NewGuid(), WorkId = w.Id, State = s, PositionMs = pos, DurationMs = dur, UpdatedAt = at is null ? null : DateTimeOffset.Parse(at),
    };

    [Fact]
    public void OnDeckRowsAreNewestPartWatchedOnePerWorkMaxTen()
    {
        var a = W("A"); var b = W("B");
        var rows = new[] { P(a, WatchState.InProgress, at: "2026-10-01T00:00:00Z"), P(a, WatchState.InProgress, at: "2026-10-05T00:00:00Z"),
                           P(b, WatchState.Watched, at: "2026-10-09T00:00:00Z") };
        var deck = HomeModel.OnDeckRows(rows);
        Assert.Single(deck);
        Assert.Equal(DateTimeOffset.Parse("2026-10-05T00:00:00Z"), deck[0].UpdatedAt);
    }

    [Fact]
    public void BuildPutsOnDeckFirstWithProgressAndMarksUnseenOnRecentRails()
    {
        var a = W("A"); var b = W("B");
        var progress = HomeModel.IndexByWork(new[] { P(a, WatchState.InProgress, 25, 100) });
        var rail = new HomeRail { Id = "recent", Title = "Recently Added in Movies", Items = { a, b } };
        var rails = HomeModel.Build(new[] { rail }, new[] { a }, progress);
        Assert.Equal("On deck", rails[0].Title);
        Assert.Equal(0.25, rails[0].Cards[0].Progress);
        Assert.False(rails[1].Cards[0].Unseen); // a has progress
        Assert.True(rails[1].Cards[1].Unseen);  // b has none
        Assert.Equal("Movie · Drama", rails[0].Cards[0].Kicker);
        Assert.Equal("Movie · 2016", rails[0].Cards[0].Sub);
    }

    [Fact]
    public void OnDeckSeriesIsItsLeadEpisodeCard()
    {
        var series = new Work { Id = Guid.NewGuid(), Kind = WorkKind.Series, Title = "Show", Genres = { "Drama" } };
        var file = Guid.NewGuid();
        var children = new WorkChildren { ParentKind = WorkKind.Series };
        var season = new SeasonDetail { Season = new Season { SeasonNumber = 2 } };
        season.Episodes.Add(new EpisodeDetail { MediaFileId = Guid.NewGuid(), Episode = new Episode { EpisodeNumber = 1, Title = "Other" } });
        season.Episodes.Add(new EpisodeDetail { MediaFileId = file, Episode = new Episode { EpisodeNumber = 5, Title = null, Overview = "About it" } });
        children.Seasons.Add(season);
        var ep = HomeModel.FindEpisode(children, file)!;
        Assert.Equal(2, ep.SeasonNumber);
        Assert.Null(HomeModel.FindEpisode(children, Guid.NewGuid()));
        var rails = HomeModel.Build(Array.Empty<HomeRail>(), new[] { series }, HomeModel.IndexByWork(Array.Empty<WatchProgress>()), new Dictionary<Guid, OnDeckEpisode> { [series.Id] = ep });
        var card = rails[0].Cards[0];
        Assert.Equal("Episode 5", card.Title);
        Assert.Equal("Show \u00b7 S02 E05", card.Sub);
        Assert.Equal("About it", card.Overview);
        Assert.Equal($"/api/v1/media/{file:D}/thumbnail", card.ThumbUrl);
        Assert.Equal(series.Id, card.WorkId);
    }

    [Fact]
    public void StackedPlanLeadsOtherwiseTheLastPlayedFile()
    {
        var row = new WatchProgress { MediaFileId = Guid.NewGuid() };
        var lead = Guid.NewGuid();
        var stacked = new ResumePlan { NeedsChoice = true, Target = new ResumeOption { MediaFileId = lead }, Options = { new ResumeOption(), new ResumeOption() } };
        Assert.Equal(lead, HomeModel.LeadFile(row, stacked));
        Assert.Equal(row.MediaFileId, HomeModel.LeadFile(row, new ResumePlan { Target = new ResumeOption { MediaFileId = lead } }));
        Assert.Equal(row.MediaFileId, HomeModel.LeadFile(row, null));
    }

    [Fact]
    public void WithoutOnDeckTheFirstRailIsStartWatching()
    {
        var a = W("A");
        var rails = HomeModel.Build(new[] { new HomeRail { Id = "r", Title = "R", Items = { a } } }, Array.Empty<Work>(), HomeModel.IndexByWork(Array.Empty<WatchProgress>()));
        Assert.Equal("Start watching", rails[0].Title);
    }
}

public class SessionStoreTests
{
    [Fact]
    public async Task SessionSurvivesAFileRoundTripWithItsTokens()
    {
        var dir = Path.Combine(Path.GetTempPath(), "playarr-test-" + Guid.NewGuid());
        try
        {
            var store = new FileSessionStore(dir);
            await store.StoreSessionAsync(new Playarr.Core.Models.StoredAuthSession("access", "refresh", "Bearer", DateTimeOffset.UtcNow.AddHours(1)));
            var back = await new FileSessionStore(dir).GetSessionAsync();
            Assert.Equal("access", back!.AccessToken.ExposeSecret());
            Assert.Equal("refresh", back.RefreshToken.ExposeSecret());
            Assert.Equal(store.DeviceId(), new FileSessionStore(dir).DeviceId());
            var previousDeviceId = store.DeviceId();
            var nextDeviceId = store.RotateDeviceId();
            Assert.NotEqual(previousDeviceId, nextDeviceId);
            Assert.Equal(nextDeviceId, new FileSessionStore(dir).DeviceId());
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}

public class DetailModelTests
{
    [Fact]
    public void ChaptersUseTheSmallestIntervalNearATenth()
    {
        // 108 min film: a tenth is 10.8 min -> 15 min chapters -> 8 chapters
        var chapters = DetailModel.GeneratedChapters(108 * 60_000L);
        Assert.Equal(8, chapters.Count);
        Assert.Equal(15 * 60_000L, chapters[1].StartMs);
        Assert.Equal(108 * 60_000L, chapters[^1].EndMs);
        Assert.Equal("Chapter 1", chapters[0].Title);
    }

    [Fact]
    public void LongFilmsCapAtThirtyMinuteChapters() =>
        Assert.Equal(14, DetailModel.GeneratedChapters(400 * 60_000L).Count);

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(688_000, "11:28")]
    [InlineData(3_723_000, "1:02:03")]
    public void Clock(long ms, string expected) => Assert.Equal(expected, DetailModel.Clock(ms));

    [Theory]
    [InlineData(6_480_000, "1h 48m")]
    [InlineData(3_600_000, "1h")]
    [InlineData(2_700_000, "45 min")]
    public void Runtime(long ms, string expected) => Assert.Equal(expected, DetailModel.Runtime(ms));
}

public class AvatarTests
{
    [Fact]
    public void DefaultIsAStableHashOfTheUserId()
    {
        var id = "0849772b-e4e8-4aaf-bc47-6b6249ed0408";
        Assert.Equal(AvatarPresets.Default(id), AvatarPresets.Default(id));
        Assert.Contains(AvatarPresets.Default(id), AvatarPresets.Ids);
        Assert.Equal("astronaut", AvatarPresets.Default("")); // hash 0 -> first preset
    }
}

public class AlphabetTests
{
    [Theory]
    [InlineData("2 Test Movie A", '#')]
    [InlineData("  the Sample Series 1", 'T')]
    [InlineData("Éclair", '#')]
    [InlineData("", '#')]
    public void LetterOf(string title, char expected) => Assert.Equal(expected, Alphabet.LetterOf(title));

    [Fact]
    public void FirstIndexOfFindsTheFirstTitleWithTheLetter() =>
        Assert.Equal(2, Alphabet.FirstIndexOf(new[] { "2 A", "9 B", "Alpha", "Beta" }, (char)65));
}

public class CatalogSearchTests
{
    private const string One = """{"id":"94199bce-b5ab-4cda-8401-35eac8a96157","kind":"movie","title":"Test Movie A","images":[]}""";

    [Fact] public void ParsesACatalogPage() => Assert.Equal("Test Movie A", CatalogSearch.Parse("{\"items\":[" + One + "],\"total\":1}")[0].Title);
    [Fact] public void ParsesABareArray() => Assert.Equal("Test Movie A", CatalogSearch.Parse("[" + One + "]")[0].Title);
    [Fact] public void EmptyPageIsEmpty() => Assert.Empty(CatalogSearch.Parse("{\"items\":[]}"));
}

public class ArtworkPathTests
{
    [Fact]
    public void VersionIsFnv1aOfTheSourceUrl()
    {
        Assert.Equal("811c9dc5", ArtworkPaths.Version(""));   // FNV offset basis
        Assert.Equal("e40c292c", ArtworkPaths.Version("a")); // known FNV-1a 32-bit value
    }

    [Fact]
    public void PathUsesTheKindDefaultWidthAndFallsBack()
    {
        var w = new Playarr.Core.Models.Work { Id = Guid.Parse("94199bce-b5ab-4cda-8401-35eac8a96157") };
        w.Images.Add(new Playarr.Core.Models.ImageAsset { Kind = Playarr.Core.Models.ImageKind.Backdrop, Url = "a" });
        Assert.Equal("/api/v1/artwork/work/94199bce-b5ab-4cda-8401-35eac8a96157/backdrop?w=780&v=e40c292c", ArtworkPaths.First(w, Playarr.Core.Models.ImageKind.Thumb, Playarr.Core.Models.ImageKind.Backdrop));
        Assert.Null(ArtworkPaths.First(w, Playarr.Core.Models.ImageKind.Logo));
    }
}

public class CreditsTests
{
    [Fact]
    public void CastKeepsCharacterThenJobAsTheCaptionAndBuildsInitials()
    {
        var json = """{"cast":[{"id":"c1","person":{"id":"p1","name":"Test Person One","headshot_url":"https://x.example/a.jpg"},"character":"Role A"},{"id":"c2","person":{"id":"p2","name":"Solo","headshot_url":null},"job":"Writer"}],"crew":[]}""";
        var cast = Credits.ParseCast(json);
        Assert.Equal("TP", cast[0].Initials);
        Assert.Equal("Role A", cast[0].Subtitle);
        Assert.True(cast[0].HasHeadshot);
        Assert.Equal("Writer", cast[1].Subtitle);
        Assert.False(cast[1].HasHeadshot);
        Assert.Equal("S", cast[1].Initials);
    }
}

public class DeviceCapsTests
{
    [Fact]
    public void ForceFlagsAreOnlySentWhenOn()
    {
        var caps = DeviceCaps.Tv();
        Assert.DoesNotContain("force_direct_video", caps.ToQuery().Keys);
        Assert.DoesNotContain("force_direct_audio", caps.ToQuery().Keys);
        Assert.Equal("true", caps.ToQuery(forceDirectVideo: true)["force_direct_video"]);
        Assert.DoesNotContain("force_direct_audio", caps.ToQuery(forceDirectVideo: true).Keys);
        Assert.Equal("true", caps.ToQuery(forceDirectAudio: true)["force_direct_audio"]);
    }

    [Fact]
    public void DepthWithoutHdrSendsAnEmptyHdrSoTheServerToneMaps()
    {
        var q = DeviceCaps.Tv().ToQuery();
        Assert.Equal("10", q["max_bit_depth"]);
        Assert.Equal("", q["hdr"]);
        Assert.Equal("hevc:main 10", q["video_profiles"]);
        Assert.DoesNotContain("dv_profiles", q.Keys); // DV 5 is only copied when listed
    }

    [Fact]
    public void HdrDisplaysAndDolbyVisionAreReportedWhenKnown()
    {
        var q = (DeviceCaps.Tv() with { Hdr = new[] { "hdr10", "hlg", "dolby_vision" }, DvProfiles = new[] { 5, 8 } }).ToQuery();
        Assert.Equal("hdr10,hlg,dolby_vision", q["hdr"]);
        Assert.Equal("5,8", q["dv_profiles"]);
    }

    [Fact]
    public void UnknownFieldsAreOmitted()
    {
        var q = new DeviceCaps(new[] { "mp4" }, new[] { "h264" }, new[] { "aac" }).ToQuery();
        Assert.Equal(3, q.Count);
    }

    [Fact]
    public void A422BodyBecomesARefusalWithTheServersMessage()
    {
        var e = PlaybackClient.Refusal("{\"error\":\"unsupported_colour_format\",\"message\":\"This title's colour format can't be converted for this device.\"}");
        Assert.Equal("unsupported_colour_format", e.Code);
        Assert.Equal("This title's colour format can't be converted for this device.", e.Message);
        Assert.Equal("This title can't be played on this device.", PlaybackClient.Refusal("not json").Message);
    }
}

public class CardLayoutTests
{
    [Theory]
    [InlineData(false, "medium", 3, 327.2f, 184f)]
    [InlineData(false, "small", 4, 238.9f, 134.4f)]
    [InlineData(false, "large", 2, 503.7f, 283.3f)]
    [InlineData(true, "medium", 5, 191.3f, 286.9f)]
    [InlineData(true, "small", 6, 156.2f, 234.3f)]
    [InlineData(true, "large", 4, 243.9f, 365.9f)]
    public void MatchesTheWebCardAtEachSetting(bool cover, string size, int cols, float width, float artH)
    {
        var l = new CardLayout(cover, size);
        Assert.Equal(cols, l.Columns);
        Assert.Equal(width, l.Width, 0.15f);
        Assert.Equal(artH, l.ArtHeight, 0.3f);
    }

    [Fact]
    public void HomeRailsStayCentredAndSpaceByTheArtHeight()
    {
        var c = CardLayout.From("cover", "medium");
        Assert.Equal(468.7f, c.HomeRailPitch, 0.3f);
        Assert.Equal(-51.4f, c.HomeHeadingShift, 0.2f);
        Assert.Equal(348.7f, c.LibraryPitchY, 0.3f);
        Assert.Equal(240.4f, CardLayout.Library(false, "medium").LibraryPitchY, 0.2f);
    }
}
