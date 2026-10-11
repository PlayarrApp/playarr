namespace Playarr.Tizen.Logic;

public readonly record struct Box(float X, float Y, float Width, float Height)
{
    public float CentreX => X + Width / 2f;
    public float CentreY => Y + Height / 2f;
}

/// <summary>
/// D-pad focus search shared by every screen (owner rule: vertical moves between rails are GEOMETRIC).
/// Up/Down choose, in the nearest row above or below, the item whose horizontal centre is closest;
/// Left/Right stay in the current row. Scrolling to unclip the winner is the caller's job.
/// </summary>
public static class GeometricFocus
{
    private const float RowTolerance = 0.5f; // items whose vertical centres differ by less than half the current height share a row

    /// <returns>The index of the next focus target, or -1 when there is none in that direction.</returns>
    public static int Next(IReadOnlyList<Box> items, int current, RemoteKey direction)
    {
        if (current < 0 || current >= items.Count) return items.Count > 0 ? 0 : -1;
        var from = items[current];
        var tol = Math.Max(1f, from.Height * RowTolerance);
        var best = -1;
        var bestKey = (float.MaxValue, float.MaxValue);
        for (var i = 0; i < items.Count; i++)
        {
            if (i == current) continue;
            var c = items[i];
            var sameRow = Math.Abs(c.CentreY - from.CentreY) < tol;
            (float, float) key;
            switch (direction)
            {
                case RemoteKey.Left when sameRow && c.CentreX < from.CentreX:
                    key = (from.CentreX - c.CentreX, 0); break;
                case RemoteKey.Right when sameRow && c.CentreX > from.CentreX:
                    key = (c.CentreX - from.CentreX, 0); break;
                case RemoteKey.Up when c.CentreY < from.CentreY - tol:
                    key = (from.CentreY - c.CentreY, Math.Abs(c.CentreX - from.CentreX)); break;
                case RemoteKey.Down when c.CentreY > from.CentreY + tol:
                    key = (c.CentreY - from.CentreY, Math.Abs(c.CentreX - from.CentreX)); break;
                default: continue;
            }
            if (key.CompareTo(bestKey) < 0) { bestKey = key; best = i; }
        }
        return best;
    }
}
