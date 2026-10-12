using System;
using System.Collections.Concurrent;
using System.Linq;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Storage.Streams;
using Windows.Graphics.Imaging;
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
        private static readonly ConditionalWeakTable<Image, RequestVersion> Versions = new ConditionalWeakTable<Image, RequestVersion>();

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
        public static async void Load(Image image, Work work, int displayWidth, ImageKind[] kinds, int? requestWidth = null, bool applyKeyArtFilter = false)
        {
            var requestVersion = BeginRequest(image);
            image.Source = null;
            foreach (var kind in kinds)
            {
                if (work.Image(kind) is { } asset)
                {
                    await SetAsync(image, work.Id, kind, requestWidth ?? WebWidth(kind), Version(asset.Url), displayWidth, requestVersion,
                        applyKeyArtFilter: applyKeyArtFilter, keyArtContrast: Theme.KeyArtContrast, keyArtBrightness: Theme.KeyArtBrightness).ConfigureAwait(true);
                    return;
                }
            }
        }

        /// <summary>An episode's still: requested like a web thumb (540), decoded at the display width.</summary>
        public static async void LoadEpisode(Image image, Work series, Episode episode, int displayWidth)
        {
            var requestVersion = BeginRequest(image);
            image.Source = null;
            var asset = episode.Images.Count > 0 ? episode.Images[0] : null;
            if (asset != null)
            {
                await SetAsync(image, series.Id, ImageKind.Thumb, WebWidth(ImageKind.Thumb), Version(asset.Url), displayWidth, requestVersion, episode.Id).ConfigureAwait(true);
            }
        }

        /// <summary>Loads a detail episode card with the TV web's still, frame, then series-art fallback order.</summary>
        public static async void LoadEpisodeCard(Image image, Work series, Episode episode, Guid? mediaFileId, int displayWidth, long diagnosticCard = 0)
        {
            image.Source = null;
            var still = episode.Images.FirstOrDefault(asset => asset.Kind == ImageKind.Thumb);
            var seriesArtwork = series.Image(ImageKind.Backdrop) ?? series.Image(ImageKind.Poster);
            await EpisodeArtworkResolver.TryLoadFirstAsync(
                EpisodeArtworkResolver.Resolve(still != null, mediaFileId.HasValue, seriesArtwork != null),
                async source =>
                {
                    EpisodeArtworkDiagnostics.Candidate(diagnosticCard, source.ToString());
                    switch (source)
                    {
                        case EpisodeArtworkSource.EpisodeStill when still != null:
                            var stillVersion = Version(still.Url);
                            var stillKey = $"{series.Id:N}:{episode.Id:N}:{ImageKind.Thumb}:{WebWidth(ImageKind.Thumb)}:{stillVersion}";
                            return await SetEpisodeCardCandidateAsync(
                                image,
                                stillKey,
                                () => App.Environment.ApiClient.GetEpisodeArtworkAsync(series.Id, episode.Id, ImageKind.Thumb, WebWidth(ImageKind.Thumb), stillVersion),
                                displayWidth, diagnosticCard, source.ToString()).ConfigureAwait(true);
                        case EpisodeArtworkSource.MediaFrame when mediaFileId is { } file:
                            const long framePositionMs = 30_000;
                            return await SetEpisodeCardCandidateAsync(
                                image,
                                $"{file:N}:media-frame:{framePositionMs}",
                                () => App.Environment.ApiClient.GetMediaThumbnailAsync(file, framePositionMs),
                                displayWidth, diagnosticCard, source.ToString()).ConfigureAwait(true);
                        case EpisodeArtworkSource.SeriesArtwork when seriesArtwork != null:
                            var artworkWidth = WebWidth(seriesArtwork.Kind);
                            var artworkVersion = Version(seriesArtwork.Url);
                            return await SetEpisodeCardCandidateAsync(
                                image,
                                $"{series.Id:N}:series-art:{seriesArtwork.Kind}:{artworkWidth}:{artworkVersion}",
                                () => App.Environment.ApiClient.GetWorkArtworkAsync(series.Id, seriesArtwork.Kind, artworkWidth, artworkVersion),
                                displayWidth, diagnosticCard, source.ToString()).ConfigureAwait(true);
                        default:
                            return false;
                    }
                }).ConfigureAwait(true);
        }

        private static async Task SetAsync(Image image, Guid id, ImageKind kind, int width, string version, int decodeWidth, long requestVersion,
            Guid? episodeId = null, bool applyKeyArtFilter = false, double keyArtContrast = 1, double keyArtBrightness = 1)
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

                if (!IsCurrentRequest(image, requestVersion))
                {
                    return;
                }

                if (applyKeyArtFilter)
                {
                    var filtered = await CreateFilteredKeyArtAsync(bytes, decodeWidth, requestVersion, image, keyArtContrast, keyArtBrightness).ConfigureAwait(true);
                    if (filtered != null && IsCurrentRequest(image, requestVersion))
                    {
                        image.Source = filtered;
                    }
                }
                else
                {
                    using (var stream = new InMemoryRandomAccessStream())
                    {
                        await stream.WriteAsync(bytes.AsBuffer());
                        stream.Seek(0);
                        var bitmap = new BitmapImage { DecodePixelWidth = decodeWidth };
                        await bitmap.SetSourceAsync(stream);
                        if (IsCurrentRequest(image, requestVersion))
                        {
                            image.Source = bitmap;
                        }
                    }
                }
            }
            catch (Exception)
            {
                // shortcut: a failed fetch leaves the placeholder; the web retries on focus, add that if it shows.
            }
        }

        private static async Task<bool> SetEpisodeCardCandidateAsync(Image image, string key, Func<Task<byte[]>> fetch, int decodeWidth,
            long diagnosticCard, string source)
        {
            var inFetch = true;
            try
            {
                byte[] bytes;
                if (!Cache.TryGetValue(key, out bytes))
                {
                    EpisodeArtworkDiagnostics.Fetch(diagnosticCard, source, "started", "none");
                    await Gate.WaitAsync().ConfigureAwait(true);
                    try
                    {
                        bytes = await fetch().ConfigureAwait(true);
                    }
                    finally
                    {
                        Gate.Release();
                    }

                    if (bytes == null || bytes.Length == 0)
                    {
                        EpisodeArtworkDiagnostics.Fetch(diagnosticCard, source, "failed", "empty_response");
                        return false;
                    }

                    if (Cache.Count >= CacheLimit)
                    {
                        Cache.Clear();
                    }

                    Cache[key] = bytes;
                    EpisodeArtworkDiagnostics.Fetch(diagnosticCard, source, "success", "http_2xx");
                }
                else
                {
                    EpisodeArtworkDiagnostics.Fetch(diagnosticCard, source, "cache_hit", "cache");
                }

                inFetch = false;
                EpisodeArtworkDiagnostics.Decode(diagnosticCard, source, "started");
                using (var stream = new InMemoryRandomAccessStream())
                {
                    await stream.WriteAsync(bytes.AsBuffer());
                    stream.Seek(0);
                    var bitmap = new BitmapImage { DecodePixelWidth = decodeWidth };
                    await bitmap.SetSourceAsync(stream);
                    image.Source = bitmap;
                }

                EpisodeArtworkDiagnostics.Decode(diagnosticCard, source, "success");
                return true;
            }
            catch (Exception error)
            {
                if (inFetch)
                {
                    EpisodeArtworkDiagnostics.Fetch(diagnosticCard, source, "failed", EpisodeArtworkDiagnostics.FailureCategory(error), error.GetType().Name);
                }
                else
                {
                    EpisodeArtworkDiagnostics.Decode(diagnosticCard, source, "failed", error.GetType().Name);
                }

                // A failed source leaves the placeholder in place so the next candidate can be tried.
                return false;
            }
        }

        private static async Task<WriteableBitmap?> CreateFilteredKeyArtAsync(byte[] encoded, int decodeWidth, long requestVersion, Image image,
            double contrast, double brightness)
        {
            using (var stream = new InMemoryRandomAccessStream())
            {
                await stream.WriteAsync(encoded.AsBuffer());
                stream.Seek(0);
                var decoder = await BitmapDecoder.CreateAsync(stream);
                var width = Math.Max(1, decodeWidth);
                var height = Math.Max(1, (int)Math.Round(decoder.OrientedPixelHeight * (width / (double)decoder.OrientedPixelWidth)));
                var transform = new BitmapTransform
                {
                    ScaledWidth = (uint)width,
                    ScaledHeight = (uint)height,
                    InterpolationMode = BitmapInterpolationMode.Fant,
                };
                var pixelData = await decoder.GetPixelDataAsync(
                    BitmapPixelFormat.Bgra8,
                    BitmapAlphaMode.Straight,
                    transform,
                    ExifOrientationMode.RespectExifOrientation,
                    ColorManagementMode.ColorManageToSRgb);
                var pixels = pixelData.DetachPixelData();
                if (!IsCurrentRequest(image, requestVersion))
                {
                    return null;
                }

                await Task.Run(() => BackdropPixelFilter.Apply(pixels, contrast, brightness)).ConfigureAwait(true);

                var bitmap = new WriteableBitmap(width, height);
                using (var pixelStream = bitmap.PixelBuffer.AsStream())
                {
                    pixelStream.Write(pixels, 0, pixels.Length);
                }

                bitmap.Invalidate();
                return bitmap;
            }
        }

        private static long BeginRequest(Image image)
        {
            var request = Versions.GetValue(image, _ => new RequestVersion());
            return Interlocked.Increment(ref request.Value);
        }

        private static bool IsCurrentRequest(Image image, long version)
        {
            var request = Versions.GetValue(image, _ => new RequestVersion());
            return Interlocked.Read(ref request.Value) == version;
        }

        private sealed class RequestVersion
        {
            public long Value;
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
