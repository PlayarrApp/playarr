using System.Security.Cryptography;
using System.Text;
using Playarr.Core.Networking;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Downloads images that need the bearer token (media frame thumbnails) into the app cache and returns the file path.</summary>
internal sealed class AuthImage(IPlayarrApiClient api)
{
    /// <summary>Adds the image at <paramref name="path"/> to <paramref name="parent"/> when it has downloaded.</summary>
    public void Apply(View parent, string? path, float w, float h)
    {
        if (path is null) return;
        _ = Task.Run(async () =>
        {
            var file = await GetAsync(path).ConfigureAwait(false);
            if (file is null) return;
            SynchronizationContextHolder.Post(() => { try { parent.Add(Ui.Remote(file, w, h)); } catch (ObjectDisposedException) { /* page already gone */ } });
        });
    }

    private static readonly HttpClient Http = new();
    private readonly string _dir = global::Tizen.Applications.Application.Current.DirectoryInfo.Data + "cache/";
    private readonly Dictionary<string, Task<string?>> _inflight = new();

    public Task<string?> GetAsync(string pathAndQuery)
    {
        lock (_inflight)
        {
            if (!_inflight.TryGetValue(pathAndQuery, out var t)) _inflight[pathAndQuery] = t = LoadAsync(pathAndQuery);
            return t;
        }
    }

    private async Task<string?> LoadAsync(string pathAndQuery)
    {
        try
        {
            Directory.CreateDirectory(_dir);
            var stem = _dir + "img-" + Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(pathAndQuery)))[..20];
            foreach (var ext in new[] { ".jpg", ".png", ".webp" }) if (File.Exists(stem + ext)) return stem + ext;
            using var req = new HttpRequestMessage(HttpMethod.Get, api.ResolveUrl(pathAndQuery));
            foreach (var h in await api.GetPlaybackRequestHeadersAsync().ConfigureAwait(false)) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using var res = await Http.SendAsync(req).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            if (bytes.Length == 0) return null;
            var file = stem + (bytes.Length > 3 && bytes[0] == 0x89 && bytes[1] == 0x50 ? ".png" : bytes.Length > 11 && bytes[8] == 0x57 && bytes[9] == 0x45 ? ".webp" : ".jpg");
            File.WriteAllBytes(file, bytes);
            return file;
        }
        catch (Exception) { return null; }
    }
}
