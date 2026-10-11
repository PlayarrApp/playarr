using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>One D-pad target. <see cref="Rect"/> is its current on-screen box in design px (scroll offsets included).</summary>
internal sealed class Focusable
{
    public Func<Box> Rect { get; init; } = null!;
    public Action<bool> Style { get; init; } = _ => { };
    public Action? Select { get; init; }
    public string Label { get; init; } = "";
    public Action? Focused { get; init; }
}

/// <summary>Geometric focus over a flat list of targets (web rule: UP/DOWN pick the closest centre, scrolling only enough).</summary>
internal sealed class FocusSet
{
    public List<Focusable> Items { get; } = new();
    public int Current { get; private set; } = -1;
    public Focusable? Item => Current >= 0 && Current < Items.Count ? Items[Current] : null;

    public void Set(int index)
    {
        if (index < 0 || index >= Items.Count) return;
        Item?.Style(false);
        Current = index;
        Dbg.Log($"FOCUS {index} {Item!.Label}");
        Item!.Style(true);
        Item.Focused?.Invoke();
    }

    /// <returns>False when the key leaves the set (nothing in that direction).</returns>
    /// <summary>Explicit moves that beat the geometric search: (from index, key) to index.</summary>
    public Dictionary<(int From, RemoteKey Key), int> Overrides { get; } = new();

    public bool Move(RemoteKey key)
    {
        if (Items.Count == 0) return false;
        if (Current >= 0 && Overrides.TryGetValue((Current, key), out var forced)) { Set(forced); return true; }
        if (Current < 0) { Set(0); return true; }
        var next = GeometricFocus.Next(Items.Select(i => i.Rect()).ToList(), Current, key);
        if (next < 0) return false;
        Set(next);
        return true;
    }

    public void Clear() { Item?.Style(false); Items.Clear(); Current = -1; }
    public Box CurrentRect => Item?.Rect() ?? default;
}

internal static class Ring
{
    /// <summary>The web focus ring: 3 px in the theme ring colour, 2 px outside the control, following its radius.</summary>
    public static View Make(float w, float h, float radius, Rgba color) => new View
    {
        PositionX = -5, PositionY = -5, Size = new Size(w + 10, h + 10), CornerRadius = radius + 5,
        BorderlineWidth = 3, BorderlineColor = Ui.C(color), BorderlineOffset = -1,
    };
}
