namespace Playarr.Tizen.Logic;

/// <summary>Pure scroll calculations shared by the native calendar layout and its tests.</summary>
public static class CalendarScroll
{
    public static float Clamp(float offset, float viewportSize, float contentSize) =>
        Math.Clamp(offset, 0, Math.Max(0, contentSize - viewportSize));

    /// <summary>Moves the smallest amount needed to bring an item inside a viewport.</summary>
    public static float EnsureVisible(
        float offset,
        float viewportSize,
        float contentSize,
        float itemStart,
        float itemSize,
        float margin = 0)
    {
        if (viewportSize <= 0 || contentSize <= 0 || itemSize <= 0) return 0;

        var next = offset;
        var visibleStart = offset + Math.Max(0, margin);
        var visibleEnd = offset + viewportSize - Math.Max(0, margin);
        if (itemStart < visibleStart) next = itemStart - Math.Max(0, margin);
        else if (itemStart + itemSize > visibleEnd) next = itemStart + itemSize - viewportSize + Math.Max(0, margin);

        return Clamp(next, viewportSize, contentSize);
    }
}
