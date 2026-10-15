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
    /// <summary>The app data directory (also holds downloads.json and the downloaded files).</summary>
    public string DataDirectory => directory;

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
        // the file is flushed before the rename, so the pair is never half written; the rename itself is not fsynced to the directory,
        // so a power cut right after could bring back the previous pair, which the server still accepts for 120 s after a rotation
        using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = new System.Text.UTF8Encoding(false).GetBytes(Playarr.Core.Networking.JsonCoding.Serialize(session));
            fs.Write(bytes, 0, bytes.Length);
            fs.Flush(true);
        }
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

    private string PrefsFile => Path.Combine(directory, "appearance.json");
    /// <summary>Settings > Appearance: the Home view ("thumbnail" or "cover") and the artwork size ("small", "medium", "large"); device-local like web's playarr home-view and artwork-size keys.</summary>
    public (string HomeView, string ArtworkSize) Appearance()
    {
        try
        {
            var o = Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(PrefsFile));
            var view = (string?)o["home_view"]; var size = (string?)o["artwork_size"];
            return (view == "cover" ? "cover" : "thumbnail", size is "small" or "large" ? size : "medium");
        }
        catch (Exception) { return ("thumbnail", "medium"); }
    }

    public void SaveAppearance(string homeView, string artworkSize)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllText(PrefsFile, new Newtonsoft.Json.Linq.JObject { ["home_view"] = homeView, ["artwork_size"] = artworkSize }.ToString());
    }

    private string LibraryViewFile => Path.Combine(directory, "libraryview.json");
    /// <summary>The Library view per kind ("screen" default, "cover"), as web's playarr.libraryView.&lt;kind&gt;.</summary>
    public string LibraryView(string kind)
    {
        try { return (string?)Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(LibraryViewFile))[kind] == "cover" ? "cover" : "screen"; }
        catch (Exception) { return "screen"; }
    }

    public void SaveLibraryView(string kind, string view)
    {
        Directory.CreateDirectory(directory);
        Newtonsoft.Json.Linq.JObject o;
        try { o = Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(LibraryViewFile)); } catch (Exception) { o = new Newtonsoft.Json.Linq.JObject(); }
        o[kind] = view;
        File.WriteAllText(LibraryViewFile, o.ToString());
    }

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
