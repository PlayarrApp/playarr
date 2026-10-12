using System;
using System.IO;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Windows.Storage;

namespace Playarr.Xbox.Views
{
    /// <summary>Opt-in, content-free diagnostics for episode-card artwork, enabled only by parity.on.</summary>
    internal static class EpisodeArtworkDiagnostics
    {
        private const long MaxLogBytes = 1024 * 1024;
        private static readonly object Sync = new object();
        private static long _nextCard;

        public static long NewCard() => Enabled() ? Interlocked.Increment(ref _nextCard) : 0;

        public static void ImageLoaded(long card, double imageWidth, double imageHeight, double cardWidth, double cardHeight) =>
            Write(card, "image_loaded", new { image_width = imageWidth, image_height = imageHeight, card_width = cardWidth, card_height = cardHeight });

        public static void Viewport(long card, double x, double y, double width, double height, double imageWidth, double imageHeight,
            double cardWidth, double cardHeight, bool intersects, bool requested) =>
            Write(card, "effective_viewport", new
            {
                x,
                y,
                width,
                height,
                image_width = imageWidth,
                image_height = imageHeight,
                card_width = cardWidth,
                card_height = cardHeight,
                intersects,
                requested,
            });

        public static void RequestTransition(long card, bool previous, bool current) =>
            Write(card, "request_transition", new { from = previous, to = current });

        public static void Candidate(long card, string source) =>
            Write(card, "candidate", new { source });

        public static void Fetch(long card, string source, string result, string category, string exceptionType = "none") =>
            Write(card, "fetch", new { source, result, category, exception_type = exceptionType });

        public static void Decode(long card, string source, string result, string exceptionType = "none") =>
            Write(card, "decode_assignment", new { source, result, exception_type = exceptionType });

        public static string FailureCategory(Exception error)
        {
            if (error is Playarr.Core.Networking.ApiException api)
            {
                if (api.StatusCode is { } status)
                {
                    var code = (int)status;
                    if (code == 401 || code == 403) return "auth_4xx";
                    if (code == 404) return "not_found_4xx";
                    if (code >= 400 && code < 500) return "client_4xx";
                    if (code >= 500 && code < 600) return "server_5xx";
                    return "http_other";
                }

                return api.Kind switch
                {
                    Playarr.Core.Networking.ApiErrorKind.Unauthorized => "auth_failure",
                    Playarr.Core.Networking.ApiErrorKind.Transport => "transport_failure",
                    Playarr.Core.Networking.ApiErrorKind.InvalidResponse => "invalid_response",
                    _ => "api_failure",
                };
            }

            return "non_http_failure";
        }

        private static bool Enabled()
        {
            try
            {
                return File.Exists(Path.Combine(ApplicationData.Current.LocalFolder.Path, "parity.on"));
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void Write(long card, string eventName, object details)
        {
            if (card <= 0 || !Enabled()) return;

            try
            {
                var folder = ApplicationData.Current.LocalFolder.Path;
                var path = Path.Combine(folder, "episode-artwork-diagnostics.jsonl");
                var previousPath = Path.Combine(folder, "episode-artwork-diagnostics.previous.jsonl");
                var line = JsonConvert.SerializeObject(new
                {
                    card,
                    utc = DateTime.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
                    @event = eventName,
                    details,
                }) + Environment.NewLine;
                var lineBytes = Encoding.UTF8.GetByteCount(line);
                if (lineBytes > MaxLogBytes) return;

                lock (Sync)
                {
                    var currentBytes = File.Exists(path) ? new FileInfo(path).Length : 0;
                    if (currentBytes > MaxLogBytes) return;
                    if (currentBytes + lineBytes > MaxLogBytes)
                    {
                        if (!File.Exists(path) || File.Exists(previousPath)) return;
                        File.Move(path, previousPath);
                    }

                    File.AppendAllText(path, line, Encoding.UTF8);
                }
            }
            catch (Exception)
            {
                // Diagnostics must never affect artwork loading or the UI.
            }
        }
    }
}
