using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Storage.Streams;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media.Imaging;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Work artwork as the web loads it: through the server's cached, resized artwork endpoint, never the source URL
    /// in <c>Work.Images</c> (some sources keep art behind a private scheme, and the server owns the cache). The
    /// endpoint needs the bearer token, so bytes are fetched with the API client and decoded into the Image.
    /// </summary>
    internal static class Artwork
    {
        private const int CacheLimit = 300;
        private static readonly SemaphoreSlim Gate = new SemaphoreSlim(6);
        private static readonly ConcurrentDictionary<string, byte[]> Cache = new ConcurrentDictionary<string, byte[]>();

        /// <summary>
        /// The width the web requests for a kind (<c>defaultArtworkWidth</c> in lib/artwork.tsx); the server snaps it to
        /// its own set of sizes.
        /// </summary>
        public static int WebWidth(ImageKind kind) => kind switch
        {
            ImageKind.Poster => 360,
            ImageKind.Thumb => 540,
            ImageKind.Logo => 540,
            ImageKind.Banner => 780,
            ImageKind.Backdrop => 780,
            _ => 540,
        };

        /// <summary>
        /// Loads <paramref name="work"/>'s first available kind of art into <paramref name="image"/>: requested at the
        /// web's width for that kind (or <paramref name="requestWidth"/>, the web's 1280 for hero backdrops) and decoded
        /// at exactly <paramref name="displayWidth"/> device pixels, so the decoder does the one resample and the
        /// compositor draws it 1:1 with the same cover crop (UniformToFill) as the web's object-fit.
        /// </summary>
        public static async void Load(Image image, Work work, int displayWidth, ImageKind[] kinds, int? requestWidth = null)
        {
            image.Source = null;
            foreach (var kind in kinds)
            {
                if (work.Image(kind) is { } asset)
                {
                    await SetAsync(image, work.Id, kind, requestWidth ?? WebWidth(kind), Version(asset.Url), displayWidth).ConfigureAwait(true);
                    return;
                }
            }
        }

        /// <summary>An episode's still: requested like a web thumb (540), decoded at the display width.</summary>
        public static async void LoadEpisode(Image image, Work series, Episode episode, int displayWidth)
        {
            image.Source = null;
            var asset = episode.Images.Count > 0 ? episode.Images[0] : null;
            if (asset != null)
            {
                await SetAsync(image, series.Id, ImageKind.Thumb, WebWidth(ImageKind.Thumb), Version(asset.Url), displayWidth, episode.Id).ConfigureAwait(true);
            }
        }

        private static async Task SetAsync(Image image, Guid id, ImageKind kind, int width, string version, int decodeWidth, Guid? episodeId = null)
        {
            var key = $"{id:N}:{episodeId:N}:{kind}:{width}:{version}";
            try
            {
                if (!Cache.TryGetValue(key, out var bytes))
                {
                    await Gate.WaitAsync().ConfigureAwait(true);
                    try
                    {
                        bytes = episodeId is { } episode
                            ? await App.Environment.ApiClient.GetEpisodeArtworkAsync(id, episode, kind, width, version).ConfigureAwait(true)
                            : await App.Environment.ApiClient.GetWorkArtworkAsync(id, kind, width, version).ConfigureAwait(true);
                    }
                    finally
                    {
                        Gate.Release();
                    }

                    if (Cache.Count >= CacheLimit)
                    {
                        Cache.Clear();
                    }

                    Cache[key] = bytes;
                }

                using (var stream = new InMemoryRandomAccessStream())
                {
                    await stream.WriteAsync(bytes.AsBuffer());
                    stream.Seek(0);
                    var bitmap = new BitmapImage { DecodePixelWidth = decodeWidth };
                    await bitmap.SetSourceAsync(stream);
                    image.Source = bitmap;
                }
            }
            catch (Exception)
            {
                // shortcut: a failed fetch leaves the placeholder; the web retries on focus, add that if it shows.
            }
        }

        /// <summary>The web's cache-busting version: FNV-1a over the source URL, 8 hex digits (lib/artwork.tsx).</summary>
        private static string Version(string sourceUrl)
        {
            var hash = 0x811c9dc5u;
            foreach (var c in sourceUrl)
            {
                hash ^= c;
                hash *= 0x01000193u;
            }

            return hash.ToString("x8");
        }
    }
}
