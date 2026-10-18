using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class CalendarScrollTests
{
    [Fact]
    public void EnsureVisible_AdvancesHorizontalOffsetToExposeDayColumn()
    {
        var offset = CalendarScroll.EnsureVisible(0, 1660, 3205, 2760, 440, 24);

        Assert.Equal(1545, offset);
        Assert.True(2760 - offset >= 0);
        Assert.True(2760 + 440 + 5 - offset <= 1660);
    }

    [Fact]
    public void EnsureVisible_UsesIndependentVerticalOffsetAndKeepsFocusedCardVisible()
    {
        var offset = CalendarScroll.EnsureVisible(0, 880, 1840, 1440, 160, 16);

        Assert.Equal(736, offset);
        Assert.InRange(1440 - offset, 16, 880 - 16 - 160);
    }

    [Fact]
    public void EnsureVisible_ClampsAtContentBoundsAndDoesNotScrollVisibleItems()
    {
        Assert.Equal(0, CalendarScroll.EnsureVisible(0, 880, 640, 320, 100, 16));
        Assert.Equal(0, CalendarScroll.EnsureVisible(1800, 880, 1900, 0, 100, 16));
        Assert.Equal(100, CalendarScroll.EnsureVisible(100, 880, 1900, 300, 100, 16));
    }

    [Fact]
    public void GeometricFocusCanTraverseEveryDayInBothDirectionsAsTrackScrolls()
    {
        var offset = 0f;
        var day = 0;
        for (; day < 6; day++)
        {
            var rects = WeekHeadings(offset);
            Assert.Equal(day + 1, GeometricFocus.Next(rects, day, RemoteKey.Right));
            offset = CalendarScroll.EnsureVisible(offset, 1660, 3205, (day + 1) * 460, 440, 20);
        }

        for (; day > 0; day--)
        {
            var rects = WeekHeadings(offset);
            Assert.Equal(day - 1, GeometricFocus.Next(rects, day, RemoteKey.Left));
            offset = CalendarScroll.EnsureVisible(offset, 1660, 3205, (day - 1) * 460, 440, 20);
        }
    }

    [Fact]
    public void DeepDayCardRemainsTheNearestDownTargetWithDifferentNeighbourOffset()
    {
        const float clipY = 160;
        var dayOffset = CalendarScroll.EnsureVisible(500, 880, 2000, 900, 160, 16);
        var neighbourOffset = CalendarScroll.EnsureVisible(0, 880, 1400, 600, 160, 16);
        var rects = new[]
        {
            new Box(153.6f, clipY + 600 - dayOffset, 440, 160),
            new Box(613.6f, clipY + 700 - neighbourOffset, 440, 160),
            new Box(153.6f, clipY + 900 - dayOffset, 440, 160),
        };

        Assert.Equal(500, dayOffset);
        Assert.Equal(0, neighbourOffset);
        Assert.Equal(2, GeometricFocus.Next(rects, 0, RemoteKey.Down));
    }

    private static Box[] WeekHeadings(float offset) => Enumerable.Range(0, 7)
        .Select(day => new Box(153.6f + day * 460 - offset, 168, 440, 34))
        .ToArray();
}
