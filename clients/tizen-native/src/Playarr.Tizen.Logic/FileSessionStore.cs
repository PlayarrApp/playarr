using Newtonsoft.Json;
using Playarr.Core.Auth;
using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>
/// Persists the session and device id as small JSON files in the app's private data directory (only this app can read it).
/// shortcut: tokens are stored in plain JSON, not the Tizen secure repository; upgrade when Tizen.Security.SecureRepository is wired.
/// </summary>
public sealed class FileSessionStore(string directory) : ITokenStore
{
    private readonly string _session = Path.Combine(directory, "session.json");
    private readonly string _device = Path.Combine(directory, "device.json");
    private readonly string _server = Path.Combine(directory, "server.json");

    public Task<StoredAuthSession?> GetSessionAsync(CancellationToken cancellationToken = default)
    {
        try { return Task.FromResult(File.Exists(_session) ? Playarr.Core.Networking.JsonCoding.Deserialize<StoredAuthSession>(File.ReadAllText(_session)) : null); }
        catch (JsonException) { return Task.FromResult<StoredAuthSession?>(null); }
    }

    public Task StoreSessionAsync(StoredAuthSession session, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(directory);
        var tmp = _session + ".tmp";
        File.WriteAllText(tmp, Playarr.Core.Networking.JsonCoding.Serialize(session));
        File.Move(tmp, _session, overwrite: true);
        return Task.CompletedTask;
    }

    public Task ClearSessionAsync(CancellationToken cancellationToken = default)
    {
        if (File.Exists(_session)) File.Delete(_session);
        return Task.CompletedTask;
    }

    public Guid DeviceId()
    {
        Directory.CreateDirectory(directory);
        if (File.Exists(_device) && Guid.TryParse(File.ReadAllText(_device).Trim(), out var id)) return id;
        id = Guid.NewGuid();
        File.WriteAllText(_device, id.ToString());
        return id;
    }

    private string ThemeFile => Path.Combine(directory, "theme.txt");
    /// <summary>"dark" (default) or "light"; the app's own setting, like web's playarr-theme.</summary>
    public string Theme() => File.Exists(ThemeFile) ? File.ReadAllText(ThemeFile).Trim() : "dark";
    public void SaveTheme(string name) { Directory.CreateDirectory(directory); File.WriteAllText(ThemeFile, name == "light" ? "light" : "dark"); }

    private string PlayerFile => Path.Combine(directory, "player.json");
    /// <summary>Settings > Player > Advanced: "Force direct video" and "Force direct audio" (default off, stored on the device).</summary>
    public (bool Video, bool Audio) ForceDirect()
    {
        try { var o = Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(PlayerFile)); return ((bool?)o["force_direct_video"] ?? false, (bool?)o["force_direct_audio"] ?? false); }
        catch (Exception) { return (false, false); }
    }

    public void SaveForceDirect(bool video, bool audio)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(PlayerFile, new Newtonsoft.Json.Linq.JObject { ["force_direct_video"] = video, ["force_direct_audio"] = audio }.ToString());
    }

    public string? ServerUrl() => File.Exists(_server) ? File.ReadAllText(_server).Trim() : null;

    public void SaveServerUrl(string url)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(_server, url);
    }
}
