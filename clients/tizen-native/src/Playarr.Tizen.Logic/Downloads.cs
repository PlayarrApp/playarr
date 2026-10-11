using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Playarr.Core.Networking;

namespace Playarr.Tizen.Logic;

/// <summary>Keep-until choice (web: Forever, until a date, or N days/weeks after watched).</summary>
public sealed record KeepUntil(string Type, string? Date = null, int Amount = 0, string Unit = "days")
{
    public static readonly KeepUntil Forever = new("forever");
    public string Label => Type switch
    {
        "date" => $"Keep until {Date}",
        "after-watched" => $"Keep {Amount} {(Amount == 1 ? Unit.TrimEnd('s') : Unit)} after watched",
        _ => "Keep forever",
    };
}

public enum DownloadState { Queued, Processing, Downloading, Paused, Ready, Failed, Canceled, Expired }

/// <summary>One local download (web DownloadRecord): keyed by the server ticket id.</summary>
public sealed class DownloadRecord
{
    public string Id { get; set; } = "";
    public string WorkId { get; set; } = "";
    public string MediaFileId { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Subtitle { get; set; }
    public string? SeriesTitle { get; set; }
    public int? Season { get; set; }
    public int? Episode { get; set; }
    public string QualityId { get; set; } = "original";
    public string QualityLabel { get; set; } = "Original";
    public string Container { get; set; } = "mp4";
    public long? TotalBytes { get; set; }
    public long BytesDownloaded { get; set; }
    public DownloadState State { get; set; } = DownloadState.Queued;
    public KeepUntil Keep { get; set; } = KeepUntil.Forever;
    public string? Error { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? WatchedAt { get; set; }
    public long RuntimeMs { get; set; }
    [JsonIgnore] public double Fraction => TotalBytes is > 0 ? Math.Min(1, (double)BytesDownloaded / TotalBytes.Value) : 0;
}

public sealed record DownloadQuality(string Id, string Label, long? Bytes, bool Estimate);

/// <summary>Server side of downloads: options, tickets, file URL (GET /api/v1/media/{id}/download-options, /api/v1/downloads...).</summary>
public interface IDownloadsApi
{
    Task<DownloadTicket> CreateAsync(Guid mediaFileId, string qualityId, CancellationToken ct = default);
    Task<DownloadTicket> GetAsync(string id, CancellationToken ct = default);
    Task CancelAsync(string id, CancellationToken ct = default);
    Task<HttpResponseMessage> FileAsync(string id, long from, CancellationToken ct = default);
}

public sealed class DownloadsApi(Playarr.Core.Networking.IPlayarrApiClient api, HttpClient http) : IDownloadsApi
{
    private async Task<HttpRequestMessage> Req(HttpMethod m, string path, CancellationToken ct, string? body = null)
    {
        var req = new HttpRequestMessage(m, api.ResolveUrl(path)!);
        foreach (var h in await api.GetPlaybackRequestHeadersAsync(ct).ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
        req.Headers.TryAddWithoutValidation("X-Playarr-Client-Platform", TizenClient.PlatformId);
        if (body is not null) req.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        return req;
    }

    public async Task<(string Container, List<DownloadQuality> Options)> OptionsAsync(Guid mediaFileId, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(await Req(HttpMethod.Get, $"/api/v1/media/{mediaFileId:D}/download-options", ct), ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"download options failed: HTTP {(int)res.StatusCode}");
        return ParseOptions(await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
    }

    public static (string, List<DownloadQuality>) ParseOptions(string json)
    {
        var o = JObject.Parse(json);
        var list = ((JArray?)o["options"] ?? []).Select(x => new DownloadQuality((string)x["id"]!, (string?)x["label"] ?? (string)x["id"]!, (long?)x["estimated_size_bytes"], (bool?)x["size_is_estimate"] ?? false)).ToList();
        return ((string?)o["container"] ?? "mp4", list);
    }

    /// <summary>Creates a ticket; "original" is ready at once, a transcode profile starts queued.</summary>
    public async Task<DownloadTicket> CreateAsync(Guid mediaFileId, string qualityId, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(await Req(HttpMethod.Post, "/api/v1/downloads", ct, new JObject { ["media_file_id"] = mediaFileId.ToString("D"), ["quality_id"] = qualityId }.ToString()), ct).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ErrorText(body, (int)res.StatusCode));
        return DownloadTicket.Parse(body);
    }

    public async Task<DownloadTicket> GetAsync(string id, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(await Req(HttpMethod.Get, $"/api/v1/downloads/{id}", ct), ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"HTTP {(int)res.StatusCode}");
        return DownloadTicket.Parse(await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
    }

    public async Task CancelAsync(string id, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(await Req(HttpMethod.Delete, $"/api/v1/downloads/{id}", ct), ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode && (int)res.StatusCode != 404) throw new InvalidOperationException($"HTTP {(int)res.StatusCode}");
    }

    /// <summary>Range request for the ticket file; null when the file is not ready (409) or expired (410).</summary>
    public async Task<HttpResponseMessage> FileAsync(string id, long from, CancellationToken ct = default)
    {
        var req = await Req(HttpMethod.Get, $"/api/v1/downloads/{id}/file", ct);
        if (from > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(from, null);
        return await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
    }

    private static string ErrorText(string body, int status)
    {
        try { return (string?)JObject.Parse(body)["message"] ?? $"HTTP {status}"; } catch (Exception) { return $"HTTP {status}"; }
    }
}

public sealed record DownloadTicket(string Id, DownloadState State, string Container, long? SizeBytes, string? Error)
{
    public static DownloadTicket Parse(string json)
    {
        var o = JObject.Parse(json);
        return new DownloadTicket((string)o["id"]!, ((string?)o["status"]) switch
        {
            "queued" => DownloadState.Queued, "processing" => DownloadState.Processing, "ready" => DownloadState.Ready,
            "failed" => DownloadState.Failed, "expired" => DownloadState.Expired, "canceled" => DownloadState.Canceled, _ => DownloadState.Queued,
        }, (string?)o["container"] ?? "mp4", (long?)o["size_bytes"], (string?)o["error_message"]);
    }
}

/// <summary>downloads.json in the app data directory plus the media files beside it; one list per signed-in device.</summary>
public sealed class DownloadStore(string directory)
{
    private readonly object _gate = new();
    private string Index => Path.Combine(directory, "downloads.json");
    public string FilePath(DownloadRecord r) => Path.Combine(directory, "files", $"{r.Id}.{r.Container}");

    public List<DownloadRecord> Load()
    {
        lock (_gate)
        {
            try { return JsonConvert.DeserializeObject<List<DownloadRecord>>(File.ReadAllText(Index), new Newtonsoft.Json.Converters.StringEnumConverter()) ?? []; }
            catch (Exception) { return []; }
        }
    }

    public void Save(IEnumerable<DownloadRecord> all)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(directory);
            var tmp = Index + ".tmp";
            File.WriteAllText(tmp, JsonConvert.SerializeObject(all.ToList(), Formatting.Indented, new Newtonsoft.Json.Converters.StringEnumConverter()));
            File.Move(tmp, Index, overwrite: true);
        }
    }

    /// <summary>Removes the file and the row; the server ticket is cancelled by the caller.</summary>
    public void DeleteFile(DownloadRecord r) { try { File.Delete(FilePath(r)); } catch (IOException) { } }
}

/// <summary>
/// Runs downloads one at a time with Range resume: pause stops the stream and keeps the partial file, resume continues from its length.
/// Progress and state changes raise Changed (on a worker thread); the UI marshals it.
/// </summary>
public sealed class DownloadEngine(IDownloadsApi api, DownloadStore store)
{
    private readonly object _gate = new();
    // a season is many tickets: only two transfers run at once, the rest wait as Queued
    private readonly SemaphoreSlim _slots = new(2, 2);
    private readonly List<DownloadRecord> _all = store.Load();
    private readonly Dictionary<string, CancellationTokenSource> _running = new();
    public event Action? Changed;

    public IReadOnlyList<DownloadRecord> Records { get { lock (_gate) return _all.ToList(); } }

    /// <summary>On start: anything left mid-download from a previous run becomes paused (no process survives the app).</summary>
    public void Recover()
    {
        lock (_gate) foreach (var r in _all.Where(r => r.State is DownloadState.Downloading or DownloadState.Queued or DownloadState.Processing)) r.State = DownloadState.Paused;
        Persist();
    }

    public async Task<DownloadRecord> StartAsync(DownloadRecord template, Guid mediaFileId, KeepUntil keep, CancellationToken ct = default)
    {
        var t = await api.CreateAsync(mediaFileId, template.QualityId, ct).ConfigureAwait(false);
        template.Id = t.Id; template.MediaFileId = mediaFileId.ToString("D"); template.Container = t.Container; template.TotalBytes = t.SizeBytes ?? template.TotalBytes;
        template.Keep = keep; template.State = t.State == DownloadState.Ready ? DownloadState.Queued : t.State; // Ready here means the ticket, not the local copy
        lock (_gate) { _all.RemoveAll(r => r.Id == t.Id); _all.Add(template); }
        Persist();
        Run(template);
        return template;
    }

    private void Run(DownloadRecord r)
    {
        var cts = new CancellationTokenSource();
        lock (_gate) { if (_running.ContainsKey(r.Id)) return; _running[r.Id] = cts; }
        _ = Task.Run(async () =>
        {
            var held = false;
            try
            {
                await _slots.WaitAsync(cts.Token).ConfigureAwait(false); held = true;
                await RunAsync(r, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { }
            catch (Exception e) { r.State = DownloadState.Failed; r.Error = e.Message; }
            finally { if (held) _slots.Release(); lock (_gate) _running.Remove(r.Id); Persist(); }
        });
    }

    private async Task RunAsync(DownloadRecord r, CancellationToken ct)
    {
        // a transcode ticket is prepared by the server first: poll until ready
        while (true)
        {
            var t = await api.GetAsync(r.Id, ct).ConfigureAwait(false);
            if (t.State == DownloadState.Ready) { r.Container = t.Container; r.TotalBytes = t.SizeBytes ?? r.TotalBytes; break; }
            if (t.State is DownloadState.Failed or DownloadState.Canceled or DownloadState.Expired) { r.State = t.State; r.Error = t.Error; return; }
            r.State = t.State; Persist();
            await Task.Delay(2000, ct).ConfigureAwait(false);
        }
        var path = store.FilePath(r);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var have = File.Exists(path) ? new FileInfo(path).Length : 0;
        if (r.TotalBytes is { } tb && have > tb) { File.Delete(path); have = 0; }
        if (r.TotalBytes is { } total && have == total) { r.BytesDownloaded = have; r.State = DownloadState.Ready; return; }
        using var res = await api.FileAsync(r.Id, have, ct).ConfigureAwait(false);
        if ((int)res.StatusCode is 409 or 410) { r.State = (int)res.StatusCode == 410 ? DownloadState.Expired : DownloadState.Processing; return; }
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"HTTP {(int)res.StatusCode}");
        if ((int)res.StatusCode == 200 && have > 0) have = 0; // the server ignored Range: start over
        r.State = DownloadState.Downloading;
        await using var src = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var dst = new FileStream(path, have > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read);
        var buf = new byte[256 * 1024]; var last = DateTime.UtcNow; long done = have; int n;
        r.BytesDownloaded = done;
        while ((n = await src.ReadAsync(buf, ct).ConfigureAwait(false)) > 0)
        {
            await dst.WriteAsync(buf.AsMemory(0, n), ct).ConfigureAwait(false);
            done += n; r.BytesDownloaded = done;
            if (DateTime.UtcNow - last > TimeSpan.FromMilliseconds(500)) { last = DateTime.UtcNow; Changed?.Invoke(); }
        }
        r.TotalBytes ??= done;
        r.State = DownloadState.Ready;
        Changed?.Invoke();
    }

    private void Persist() { lock (_gate) store.Save(_all); Changed?.Invoke(); }

    private DownloadRecord? Find(string id) { lock (_gate) return _all.FirstOrDefault(r => r.Id == id); }

    public void Pause(string id)
    {
        if (Find(id) is not { } r) return;
        CancellationTokenSource? c; lock (_gate) _running.TryGetValue(id, out c);
        r.State = DownloadState.Paused; c?.Cancel(); Persist();
    }

    public void Resume(string id)
    {
        if (Find(id) is not { State: DownloadState.Paused or DownloadState.Failed } r) return;
        r.State = DownloadState.Queued; r.Error = null; Persist(); Run(r);
    }

    /// <summary>Stops the transfer and removes the row, the partial file and the server ticket (web Cancel / Delete are the same removal).</summary>
    public async Task RemoveAsync(string id)
    {
        if (Find(id) is not { } r) return;
        CancellationTokenSource? c; lock (_gate) _running.TryGetValue(id, out c);
        c?.Cancel();
        await Task.Delay(50).ConfigureAwait(false);
        store.DeleteFile(r);
        lock (_gate) _all.Remove(r);
        Persist();
        try { await api.CancelAsync(id).ConfigureAwait(false); } catch (Exception) { /* the server sweeps stale tickets */ }
    }

    public void EditKeep(string id, KeepUntil keep) { if (Find(id) is { } r) { r.Keep = keep; Persist(); } }

    /// <summary>Marks watched and drops downloads whose keep-until has passed (date, or N days/weeks after watched).</summary>
    public async Task SweepAsync(DateTime now)
    {
        foreach (var r in Records.Where(r => r.State == DownloadState.Ready && Due(r, now))) await RemoveAsync(r.Id).ConfigureAwait(false);
    }

    public static bool Due(DownloadRecord r, DateTime now) => r.Keep.Type switch
    {
        "date" => DateTime.TryParse(r.Keep.Date, out var d) && now.Date > d.Date,
        "after-watched" => r.WatchedAt is { } w && now >= w.AddDays(r.Keep.Unit == "weeks" ? r.Keep.Amount * 7 : r.Keep.Amount),
        _ => false,
    };

    public string? PlayablePath(string id) => Find(id) is { State: DownloadState.Ready } r && File.Exists(store.FilePath(r)) ? store.FilePath(r) : null;
}
