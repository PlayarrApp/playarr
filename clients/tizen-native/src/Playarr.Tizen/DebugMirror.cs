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

    private async Task Handle(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url!.AbsolutePath; var q = ctx.Request.QueryString;
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
                        case "/route": _shell().Navigate(q["path"] ?? "/"); break;
                        case "/theme": _env().SetTheme(q["name"] ?? "dark"); break;
                    }
                    var st = (_shell().Page as PlayerScreen)?.Status ?? (false, 0L);
                    done.SetResult(new { playing = st.Item1, positionMs = st.Item2, route = _shell().Route, focused = _shell().FocusedLabel, nav = _shell().NavFocused, theme = _env().Theme.Name });
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
