namespace Playarr.Tizen.Logic;

public enum SearchFocusTargetKind
{
    Query,
    Result,
    Side,
}

/// <summary>The Search selection and scroll position to restore after a routed page returns.</summary>
public sealed record SearchFocusSnapshot(int ResultIndex, int SideIndex, float Scroll);

public sealed record SearchFocusRestoration(SearchFocusTargetKind Target, int Index, float Scroll);

public static class SearchFocusState
{
    public static SearchFocusRestoration Restore(SearchFocusSnapshot snapshot, int resultCount, int sideCount)
    {
        var scroll = float.IsFinite(snapshot.Scroll) ? Math.Max(0, snapshot.Scroll) : 0;
        if (snapshot.SideIndex >= 0 && snapshot.SideIndex < sideCount)
            return new SearchFocusRestoration(SearchFocusTargetKind.Side, snapshot.SideIndex, scroll);
        if (snapshot.ResultIndex >= 0 && snapshot.ResultIndex < resultCount)
            return new SearchFocusRestoration(SearchFocusTargetKind.Result, snapshot.ResultIndex, scroll);
        return new SearchFocusRestoration(SearchFocusTargetKind.Query, -1, scroll);
    }
}
