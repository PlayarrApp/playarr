using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class SearchFocusStateTests
{
    [Fact]
    public void RestoreKeepsFocusedResultIndexAndScroll()
    {
        var restored = SearchFocusState.Restore(new SearchFocusSnapshot(2, -1, 74.5f), resultCount: 4, sideCount: 1);

        Assert.Equal(new SearchFocusRestoration(SearchFocusTargetKind.Result, 2, 74.5f), restored);
    }

    [Fact]
    public void RestoreKeepsValidSideFocusBeforeResultFocus()
    {
        var restored = SearchFocusState.Restore(new SearchFocusSnapshot(2, 0, 18), resultCount: 4, sideCount: 1);

        Assert.Equal(new SearchFocusRestoration(SearchFocusTargetKind.Side, 0, 18), restored);
    }

    [Fact]
    public void RestoreFallsBackToQueryWhenSavedResultNoLongerExists()
    {
        var restored = SearchFocusState.Restore(new SearchFocusSnapshot(5, -1, 12), resultCount: 2, sideCount: 1);

        Assert.Equal(new SearchFocusRestoration(SearchFocusTargetKind.Query, -1, 12), restored);
    }

    [Fact]
    public void RestoreClampsInvalidScrollToZero()
    {
        var restored = SearchFocusState.Restore(new SearchFocusSnapshot(0, -1, float.NaN), resultCount: 1, sideCount: 1);

        Assert.Equal(new SearchFocusRestoration(SearchFocusTargetKind.Result, 0, 0), restored);
    }
}
