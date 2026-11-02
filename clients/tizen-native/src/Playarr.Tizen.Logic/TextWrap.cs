namespace Playarr.Tizen.Logic;

/// <summary>Browser-like word wrapping over an injected single-line width measure, so it is testable without the UI toolkit.</summary>
public static class TextWrap
{
    /// <summary>Greedy word wrap like the browser's, using measured widths; the last line gets an ellipsis when text is cut at maxLines.</summary>
    public static List<string> WrapLines(string text, Func<string, float> measure, float width, int maxLines = int.MaxValue, bool balance = false)
    {
        var greedy = Wrap(text, measure, width, maxLines);
        return balance && !text.Contains('\u200B') && greedy.Count > 1 && greedy.Count <= maxLines ? Balanced(text, measure, width, greedy.Count) ?? greedy : greedy;
    }

    /// <summary>
    /// CSS text-wrap: balance as Blink lays it out (ParagraphLineBreaker): find the narrowest available width, searched in 1/64 px LayoutUnits, at which the
    /// ordinary greedy breaker still produces the same number of lines, then break greedily at that width. Breaks fall only after spaces here.
    /// </summary>
    private static List<string>? Balanced(string text, Func<string, float> measure, float width, int lineCount)
    {
        const float unit = 1f / 64f;
        long lo = 0, hi = (long)MathF.Floor(width / unit);
        List<string>? best = null;
        while (lo <= hi)
        {
            var mid = (lo + hi) / 2;
            var lines = Wrap(text, measure, mid * unit, int.MaxValue);
            if (lines.Count <= lineCount) { best = lines; hi = mid - 1; } else lo = mid + 1;
        }
        return best is { } b && b.Count == lineCount ? b : null;
    }

    private static List<string> Wrap(string text, Func<string, float> measure, float width, int maxLines)
    {
        var lines = new List<string>(); var cur = "";
        if (!text.Contains('\u200B'))
        {
            foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var next = cur.Length == 0 ? word : cur + " " + word;
                if (cur.Length > 0 && measure(next) > width) { lines.Add(cur); cur = word; } else cur = next;
            }
        }
        else
        {
            foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = word.Split('\u200B');
                for (var i = 0; i < parts.Length; i++)
                {
                    var part = parts[i];
                    if (part.Length == 0) continue;
                    var separator = i == 0 && cur.Length > 0 ? " " : "";
                    var next = cur + separator + part;
                    if (cur.Length > 0 && measure(next) > width)
                    {
                        lines.Add(cur);
                        cur = part;
                    }
                    else cur = next;
                }
            }
        }
        if (cur.Length > 0) lines.Add(cur);
        if (lines.Count > maxLines)
        {
            lines.RemoveRange(maxLines, lines.Count - maxLines);
            var last = lines[^1];
            while (last.Length > 0 && measure(last + "\u2026") > width) last = last[..^1].TrimEnd();
            lines[^1] = last + "\u2026";
        }
        return lines;
    }
}
