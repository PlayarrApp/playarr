using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Tizen.Logic;

namespace Playarr.Tizen;

/// <summary>Everything a signed-in screen needs: the API client, the store and the current theme.</summary>
internal sealed class AppEnv
{
    public const string Version = "0.1.0";
    public FileSessionStore Store { get; }
    public IPlayarrApiClient Api { get; }
    public AuthImage Images { get; }
    /// <summary>Set by the shell: opens a route (detail pages, the player).</summary>
    public Action<string> Navigate { get; set; } = _ => { };
    /// <summary>Set by the shell: the same as Back on the remote (previous page).</summary>
    public Action NavigateBack { get; set; } = () => { };
    /// <summary>Set by the app: switches the theme and rebuilds the shell on the same route.</summary>
    public Action<string> SetTheme { get; set; } = _ => { };
    /// <summary>Set by the app: forgets the session and returns to QR sign-in.</summary>
    public Action SignOut { get; set; } = () => { };
    /// <summary>This device's real decoder and output capabilities (the emulator decodes in software and claims less).</summary>
    public DeviceCaps Caps { get; } = DetectCaps();

    private static DeviceCaps DetectCaps()
    {
        try
        {
            if (global::Tizen.System.Information.TryGetValue("http://tizen.org/system/model_name", out string model) && model.Contains("emulator", StringComparison.OrdinalIgnoreCase))
                return DeviceCaps.Emulator();
        }
        catch (Exception e) { Dbg.Log("CAPS model probe failed: " + e.Message); }
        return DeviceCaps.Tv();
    }

    /// <summary>Offline downloads: server tickets fetched into the app data directory (single profile per device, so no per-profile scoping).</summary>
    public DownloadEngine Downloads { get; }
    public DownloadsApi DownloadsServer { get; }

    public string? CurrentAvatar { get; private set; }
    public string Profile { get; set; } = "Profile";
    public PlayarrTheme Theme { get; set; }

    public string Abs(string url) => Api.ResolveUrl(url)?.ToString() ?? url;

    /// <summary>The signed-in profile's avatar preset (GET /api/v1/users/me/profile-avatar); null for a custom image or on failure.</summary>
    public async Task<string?> LoadAvatarPresetAsync()
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Api.ResolveUrl("/api/v1/users/me/profile-avatar"));
            foreach (var h in await Api.GetPlaybackRequestHeadersAsync().ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using var res = await new HttpClient().SendAsync(req).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            var pref = Newtonsoft.Json.Linq.JObject.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(false))["preference"];
            return pref?["kind"]?.ToString() == "preset" && pref["value"]?.ToString() is { } v && AvatarPresets.Ids.Contains(v) ? v : null;
        }
        catch (Exception) { return null; }
    }

    /// <summary>The current profile's first name for the nav chip (web shows e.g. "Device" for "Device Test").</summary>
    public async Task LoadProfileNameAsync(Action<string> set)
    {
        try
        {
            var current = (await Api.ListProfilesAsync()).FirstOrDefault(p => p.IsCurrent);
            if (current is not null) SynchronizationContextHolder.Post(() => set(current.DisplayName.Split(' ')[0]));
            CurrentAvatar = await LoadAvatarPresetAsync() ?? (current is null ? null : AvatarPresets.Default(current.Id.ToString()));
        }
        catch (Exception e) { Dbg.Log("PROFILE load failed: " + e.Message); }
    }

    /// <summary>Plays a title: a film's file, or a series' resume/first episode.</summary>
    public async Task PlayWorkAsync(Guid workId)
    {
        try
        {
            var d = await Api.GetWorkAsync(workId);
            var file = d.MediaFileId ?? d.Children.Seasons.SelectMany(s => s.Episodes).FirstOrDefault(e => e.MediaFileId is not null)?.MediaFileId;
            if (file is { } f) SynchronizationContextHolder.Post(() => Navigate($"/player/{f}"));
        }
        catch (Exception e) { Dbg.Log("PLAYWORK failed: " + e.Message); }
    }

    private AppEnv(FileSessionStore store, IPlayarrApiClient api) { Store = store; Api = api; Images = new AuthImage(api); Theme = PlayarrTheme.ByName(store.Theme());
        DownloadsServer = new DownloadsApi(api, new HttpClient { Timeout = Timeout.InfiniteTimeSpan });
        Downloads = new DownloadEngine(DownloadsServer, new DownloadStore(store.DataDirectory));
        Downloads.Recover();
        _ = Downloads.SweepAsync(DateTime.UtcNow);
    }

    public static AppEnv? Create(FileSessionStore store)
    {
        var server = store.ServerUrl();
        if (server is null || !Uri.TryCreate(server, UriKind.Absolute, out var url)) return null;
        var cfg = new ApiClientConfiguration(url, store.DeviceId())
        {
            ClientPlatform = ClientPlatform.TizenNative,
            ClientVersion = Version,
            DeviceName = TizenClient.DeviceName,
        };
        return new AppEnv(store, new PlayarrApiClient(cfg, store, new InMemoryKnownServerGroupStore()));
    }
}
