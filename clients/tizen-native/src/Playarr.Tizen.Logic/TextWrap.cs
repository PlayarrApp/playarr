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
    /// Chrome's text-wrap: balance as the Android TV worker fitted it (97 % of 400 titles): keep the greedy line count at the box width, then take the break set
    /// with the smallest sum of squared line widths, plus 5000 px² when the last line is a single word. shortcut: breaks only after spaces, not hyphens.
    /// </summary>
    private static List<string>? Balanced(string text, Func<string, float> measure, float width, int lineCount)
    {
        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var memo = new Dictionary<(int, int), float>();
        float W(int a, int b) { if (!memo.TryGetValue((a, b), out var w)) memo[(a, b)] = w = measure(string.Join(' ', words[a..b])); return w; }
        var best = float.MaxValue; int[]? bestCuts = null; var cuts = new int[lineCount + 1];
        void Go(int line, int start, float cost)
        {
            if (line == lineCount - 1)
            {
                if (start >= words.Length) return;
                var w = W(start, words.Length); if (w > width) return;
                var total = cost + w * w + (words.Length - start == 1 ? 5000 : 0);
                if (total < best) { best = total; bestCuts = (int[])cuts.Clone(); bestCuts[lineCount] = words.Length; bestCuts[line] = start; }
                return;
            }
            for (var end = start + 1; end < words.Length - (lineCount - 1 - line) + 1; end++)
            {
                var w = W(start, end); if (w > width) break;
                cuts[line] = start; Go(line + 1, end, cost + w * w);
            }
        }
        Go(0, 0, 0);
        if (bestCuts is null) return null;
        var lines = new List<string>();
        for (var i = 0; i < lineCount; i++) lines.Add(string.Join(' ', words[bestCuts[i]..bestCuts[i + 1]]));
        return lines;
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
