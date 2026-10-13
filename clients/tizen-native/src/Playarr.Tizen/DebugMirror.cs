#if PLAYARR_DEBUG
using System.Net;
using System.Text;
using Newtonsoft.Json;
using Playarr.Tizen.Logic;

namespace Playarr.Tizen;

/// <summary>
/// Debug-only control surface for the parity driver (compiled only with -p:PlayarrDebug=true, never in CI or release builds):
/// GET /state, POST /key?name=, /route?path=, /theme?name=. Reached through `sdb forward`.
/// </summary>
internal sealed class DebugMirror
{
    private readonly Func<Shell> _shell;
    private readonly Func<AppEnv> _env;
    private bool _started;

    public DebugMirror(Func<Shell> shell, Func<AppEnv> env) { _shell = shell; _env = env; }

    public void Start(int port = 8765)
    {
        if (_started) return;
        _started = true;
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://*:{port}/");
        try { listener.Start(); } catch (Exception e) { Dbg.Log("MIRROR failed to start: " + e.Message); return; }
        Dbg.Log("MIRROR listening on " + port);
        _ = Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    var ctx = await listener.GetContextAsync();
                    _ = Task.Run(() => Handle(ctx));
                }
                catch (Exception e) { Dbg.Log("MIRROR accept failed: " + e.Message); await Task.Delay(200); }
            }
        });
    }

    /// <summary>Downloads cases of the parity suite, driven through the engine: /dl/start?file=&amp;quality=&amp;title=, /dl/list, /dl/pause|resume|remove?id=, /dl/keep?id=&amp;type=.</summary>
    private async Task HandleDownload(HttpListenerContext ctx, string path, System.Collections.Specialized.NameValueCollection q)
    {
        object result;
        var engine = _env().Downloads;
        switch (path)
        {
            case "/dl/start":
                var rec = new DownloadRecord { WorkId = q["work"] ?? "", Title = q["title"] ?? "Test download", QualityId = q["quality"] ?? "original", QualityLabel = "Original", Season = int.TryParse(q["season"], out var se) ? se : null, Episode = int.TryParse(q["episode"], out var ep) ? ep : null, SeriesTitle = q["series"] };
                var started = await engine.StartAsync(rec, Guid.Parse(q["file"]!), KeepUntil.Forever);
                result = new { id = started.Id };
                break;
            case "/dl/group":
                // a whole series (or one season): action=pause|resume|delete&series=&season=
                var members = engine.Records.Where(r => r.SeriesTitle == q["series"] && (q["season"] is null || r.Season == int.Parse(q["season"]!))).Select(r => r.Id).ToList();
                if (q["action"] == "pause") engine.PauseMany(members); else if (q["action"] == "resume") engine.ResumeMany(members); else await engine.RemoveManyAsync(members);
                result = new { count = members.Count };
                break;
            case "/dl/pause": engine.Pause(q["id"]!); result = new { ok = true }; break;
            case "/dl/resume": engine.Resume(q["id"]!); result = new { ok = true }; break;
            case "/dl/remove": await engine.RemoveAsync(q["id"]!); result = new { ok = true }; break;
            case "/dl/keep": engine.EditKeep(q["id"]!, q["type"] == "after-watched" ? new KeepUntil("after-watched", Amount: 1, Unit: "weeks") : KeepUntil.Forever); result = new { ok = true }; break;
            default: result = engine.Records.Select(r => new { r.Id, state = r.State.ToString(), r.BytesDownloaded, r.TotalBytes, keep = r.Keep.Type, file = engine.PlayablePath(r.Id) != null }).ToList(); break;
        }
        var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(result));
        ctx.Response.ContentType = "application/json";
        await ctx.Response.OutputStream.WriteAsync(bytes);
        ctx.Response.Close();
    }

    private async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url!.AbsolutePath; var q = ctx.Request.QueryString;
            if (path.StartsWith("/dl/")) { await HandleDownload(ctx, path, q); return; }
            var done = new TaskCompletionSource<object>();
            SynchronizationContextHolder.Post(() =>
            {
                try
                {
                    switch (path)
                    {
                        case "/key":
                            var name = q["name"] ?? "";
                            _shell().OnKey(name switch { "up" => RemoteKey.Up, "down" => RemoteKey.Down, "left" => RemoteKey.Left, "right" => RemoteKey.Right,
                                "select" => q["long"] == "1" ? RemoteKey.SelectLong : RemoteKey.Select, "back" => RemoteKey.Back, _ => RemoteKey.None });
                            break;
                        case "/text": if (_shell().Page is SearchScreen ss) ss.SetQuery(q["value"] ?? ""); break;
                        case "/route": _shell().NavigateDeepLink(q["path"] ?? "/"); break;
                        case "/theme": _env().SetTheme(q["name"] ?? "dark"); break;
                    }
                    var st = (_shell().Page as PlayerScreen)?.Status ?? (false, 0L);
                    done.SetResult(new { playing = st.Item1, positionMs = st.Item2, route = _shell().Route, focused = _shell().FocusedLabel, nav = _shell().NavFocused, ready = _shell().Ready, pending = _env().Images.Pending, position = _shell().FocusPosition is { } fp ? new { rail = fp.Rail, index = fp.Index } : null, theme = _env().Theme.Name, emptyCoverTextMetrics = (_shell().Page as PlaylistsScreen)?.EmptyCoverTextMetrics, fontRegistration = Ui.FontRegistrationMetrics });
                }
                catch (Exception e) { done.SetException(e); }
            });
            var result = await done.Task;
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(result));
            ctx.Response.ContentType = "application/json";
            await ctx.Response.OutputStream.WriteAsync(bytes);
        }
        catch (Exception e)
        {
            ctx.Response.StatusCode = 500;
            var bytes = Encoding.UTF8.GetBytes(e.Message);
            await ctx.Response.OutputStream.WriteAsync(bytes);
        }
        finally { ctx.Response.Close(); }
    }
}
#endif
