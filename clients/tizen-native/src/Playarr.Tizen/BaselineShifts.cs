namespace Playarr.Tizen;

// How far (px, up) a single-line label moves so its glyphs land where Chromium's do for the same text: per size, the median offset between the drawn
// ink of this app and of the web reference (scripts/parity/tizen-native/ink-offsets.py). It moves the real label; the layout export reads the result.
internal static class BaselineShifts
{
    private static readonly SortedDictionary<float, float> Table = new()
    {
        [8f] = 2.5f, [8.256f] = 1f, [8.832f] = 1f, [9.216f] = 1.5f, [9.6f] = 0.5f, [9.92f] = 0.25f, [9.984f] = 1.5f, [11.136f] = 2.25f, [11.52f] = 1f,
        [11.84f] = 0.25f, [11.904f] = 1f, [12.288f] = 0.5f, [12.8f] = 1f, [13.824f] = 1.25f, [14.72f] = 0.5f, [17.664f] = 0.5f, [18.4f] = 0.5f, [19.2f] = 1f,
    };

    public static float Up(float size)
    {
        var best = Table.Keys.OrderBy(k => Math.Abs(k - size)).First();
        return Math.Abs(best - size) <= 0.01f ? Table[best] : 0;
    }
}
