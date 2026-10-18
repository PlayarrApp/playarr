namespace Playarr.Tizen.Logic;

public sealed record Chapter(int Index, string Title, long StartMs, long EndMs);

/// <summary>Ports of web WorkDetail.tsx helpers: generated film chapters, clock and runtime labels.</summary>
public static class DetailModel
{
    /// <summary>About ten chapters at the first of 5/10/15/20/30 minute intervals that covers runtime/10.</summary>
    public static IReadOnlyList<Chapter> GeneratedChapters(long runtimeMs)
    {
        if (runtimeMs <= 0) return Array.Empty<Chapter>();
        var target = runtimeMs / 10.0;
        var options = new[] { 5, 10, 15, 20, 30 }.Select(m => m * 60_000L).ToArray();
        var interval = options.FirstOrDefault(o => o >= target);
        if (interval == 0) interval = options[^1];
        var count = (int)Math.Max(1, Math.Ceiling(runtimeMs / (double)interval));
        return Enumerable.Range(0, count)
            .Select(i => new Chapter(i, $"Chapter {i + 1}", i * interval, Math.Min(runtimeMs, i * interval + interval))).ToList();
    }

    /// <summary>GET /api/v1/media/{id}/chapters: [{index, title, start_ms, end_ms}]; a missing title shows the clock (web: chapter.title ?? formatClock).</summary>
    public static IReadOnlyList<Chapter> ParseChapters(string json)
    {
        try
        {
            var a = Newtonsoft.Json.Linq.JArray.Parse(json);
            return a.Select((c, i) =>
            {
                var start = (long?)c["start_ms"] ?? 0;
                return new Chapter((int?)c["index"] ?? i, (string?)c["title"] is { Length: > 0 } t ? t : Clock(start), start, (long?)c["end_ms"] ?? start);
            }).ToList();
        }
        catch (Exception) { return Array.Empty<Chapter>(); }
    }

    public static string Clock(long ms)
    {
        var total = Math.Max(0, ms / 1000);
        var s = total % 60; var totalMin = total / 60; var m = totalMin % 60; var h = totalMin / 60;
        return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{totalMin}:{s:00}";
    }

    public static string Runtime(long ms)
    {
        var minutes = Math.Max(1, (int)Math.Round(ms / 60000.0));
        var h = minutes / 60; var m = minutes % 60;
        return h <= 0 ? $"{m} min" : m > 0 ? $"{h}h {m}m" : $"{h}h";
    }
}
