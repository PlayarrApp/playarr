using System.Net;
using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public class DownloadTests
{
    private sealed class FakeApi(byte[] data) : IDownloadsApi
    {
        public long LastFrom = -1; public bool Cancelled; public HttpStatusCode Status = HttpStatusCode.OK;
        public Task<DownloadTicket> CreateAsync(Guid f, string q, CancellationToken ct = default) => Task.FromResult(new DownloadTicket("t1", DownloadState.Ready, "mp4", data.Length, null));
        public Task<DownloadTicket> GetAsync(string id, CancellationToken ct = default) => Task.FromResult(new DownloadTicket(id, DownloadState.Ready, "mp4", data.Length, null));
        public Task CancelAsync(string id, CancellationToken ct = default) { Cancelled = true; return Task.CompletedTask; }
        public Task<HttpResponseMessage> FileAsync(string id, long from, CancellationToken ct = default)
        {
            LastFrom = from;
            return Task.FromResult(new HttpResponseMessage(from > 0 ? HttpStatusCode.PartialContent : Status) { Content = new ByteArrayContent(data[(int)from..]) });
        }
    }

    private static async Task WaitAsync(Func<bool> done) { for (var i = 0; i < 200 && !done(); i++) await Task.Delay(25); }

    [Fact]
    public async Task Original_download_completes_and_is_playable_then_delete_removes_file_and_ticket()
    {
        var dir = Directory.CreateTempSubdirectory().FullName; var data = Enumerable.Range(0, 5000).Select(i => (byte)i).ToArray();
        var api = new FakeApi(data); var engine = new DownloadEngine(api, new DownloadStore(dir));
        var r = await engine.StartAsync(new DownloadRecord { Title = "Test Movie A" }, Guid.NewGuid(), KeepUntil.Forever);
        await WaitAsync(() => r.State == DownloadState.Ready);
        Assert.Equal(DownloadState.Ready, r.State);
        Assert.Equal(data, File.ReadAllBytes(engine.PlayablePath("t1")!));
        Assert.Single(new DownloadStore(dir).Load());
        await engine.RemoveAsync("t1");
        Assert.Null(engine.PlayablePath("t1")); Assert.True(api.Cancelled); Assert.Empty(new DownloadStore(dir).Load());
    }

    [Fact]
    public async Task Resume_continues_from_the_partial_file_with_a_range_request()
    {
        var dir = Directory.CreateTempSubdirectory().FullName; var data = Enumerable.Range(0, 4000).Select(i => (byte)(i % 251)).ToArray();
        var store = new DownloadStore(dir); var api = new FakeApi(data);
        var rec = new DownloadRecord { Id = "t1", Container = "mp4", TotalBytes = data.Length, State = DownloadState.Paused, QualityId = "original" };
        Directory.CreateDirectory(Path.Combine(dir, "files")); File.WriteAllBytes(store.FilePath(rec), data[..1500]);
        store.Save([rec]);
        var engine = new DownloadEngine(api, store); engine.Recover();
        engine.Resume("t1");
        await WaitAsync(() => engine.Records[0].State == DownloadState.Ready);
        Assert.Equal(1500, api.LastFrom); Assert.Equal(data, File.ReadAllBytes(store.FilePath(rec)));
    }

    [Fact]
    public void Keep_until_due_rules_and_edit()
    {
        var now = new DateTime(2026, 10, 11);
        Assert.False(DownloadEngine.Due(new DownloadRecord(), now));
        Assert.True(DownloadEngine.Due(new DownloadRecord { Keep = new("date", "2026-10-10") }, now));
        Assert.False(DownloadEngine.Due(new DownloadRecord { Keep = new("after-watched", Amount: 2, Unit: "days") }, now));
        Assert.True(DownloadEngine.Due(new DownloadRecord { Keep = new("after-watched", Amount: 1, Unit: "weeks"), WatchedAt = now.AddDays(-8) }, now));
    }

    [Fact]
    public void Parses_options_and_tickets()
    {
        var (c, o) = DownloadsApi.ParseOptions("""{"container":"mkv","options":[{"id":"original","label":"Original","estimated_size_bytes":100,"size_is_estimate":false},{"id":"h264-720p","label":"720p","size_is_estimate":true}]}""");
        Assert.Equal("mkv", c); Assert.Equal(2, o.Count); Assert.True(o[1].Estimate); Assert.Null(o[1].Bytes);
        Assert.Equal(DownloadState.Processing, DownloadTicket.Parse("""{"id":"x","status":"processing","container":"mp4"}""").State);
    }

    private sealed class SlowApi : IDownloadsApi
    {
        public int Now, Max;
        private int _n;
        public Task<DownloadTicket> CreateAsync(Guid f, string q, CancellationToken ct = default) => Task.FromResult(new DownloadTicket("t" + Interlocked.Increment(ref _n), DownloadState.Ready, "mp4", 10, null));
        public Task<DownloadTicket> GetAsync(string id, CancellationToken ct = default) => Task.FromResult(new DownloadTicket(id, DownloadState.Ready, "mp4", 10, null));
        public Task CancelAsync(string id, CancellationToken ct = default) => Task.CompletedTask;
        public async Task<HttpResponseMessage> FileAsync(string id, long from, CancellationToken ct = default)
        {
            var now = Interlocked.Increment(ref Now); lock (this) Max = Math.Max(Max, now);
            await Task.Delay(150, ct); Interlocked.Decrement(ref Now);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[10]) };
        }
    }

    [Fact]
    public async Task A_season_of_tickets_runs_two_transfers_at_a_time()
    {
        var api = new SlowApi(); var engine = new DownloadEngine(api, new DownloadStore(Directory.CreateTempSubdirectory().FullName));
        for (var i = 0; i < 5; i++) await engine.StartAsync(new DownloadRecord { Title = "Test Episode " + i }, Guid.NewGuid(), KeepUntil.Forever);
        await WaitAsync(() => engine.Records.All(r => r.State == DownloadState.Ready));
        Assert.All(engine.Records, r => Assert.Equal(DownloadState.Ready, r.State));
        Assert.Equal(2, api.Max);
    }
}
