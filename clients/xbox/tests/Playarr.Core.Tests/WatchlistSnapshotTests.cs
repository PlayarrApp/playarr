using Newtonsoft.Json.Linq;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Core.Tests
{
    public class WatchlistSnapshotTests
    {
        [Fact]
        public void SnapshotCarriesKindTitleYearWorkIdAndRefs()
        {
            var work = new Work { Id = System.Guid.Parse("00000000-0000-0000-0000-000000000001"), Kind = WorkKind.Movie, Title = "Test Movie A", ReleaseDate = "2009-12-31" };
            work.ExternalRefs.Add(new ExternalRef { Provider = "tmdb", ExternalId = "42" });
            var json = JObject.Parse(WatchlistSnapshot.Json(work));
            Assert.Equal("movie", (string?)json["kind"]);
            Assert.Equal("Test Movie A", (string?)json["title"]);
            Assert.Equal(2009, (int?)json["year"]);
            Assert.Equal("00000000-0000-0000-0000-000000000001", (string?)json["work_id"]);
            Assert.Equal("tmdb", (string?)json["external_refs"]![0]!["provider"]);
            Assert.Equal("42", (string?)json["external_refs"]![0]!["external_id"]);
        }
    }
}
