using Playarr.Tizen.Logic;
using Xunit;
namespace Playarr.Tizen.Logic.Tests;

public class ChapterParseTests
{
    [Fact]
    public void Real_chapters_keep_their_titles_and_fall_back_to_the_clock()
    {
        var c = DetailModel.ParseChapters("""[{"index":0,"title":"Opening","start_ms":0,"end_ms":229000},{"index":1,"title":null,"start_ms":229000,"end_ms":545000}]""");
        Assert.Equal(2, c.Count); Assert.Equal("Opening", c[0].Title); Assert.Equal("3:49", c[1].Title); Assert.Empty(DetailModel.ParseChapters("[]"));
    }
}
