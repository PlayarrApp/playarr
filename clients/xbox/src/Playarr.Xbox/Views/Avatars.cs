using System;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Windows.Storage.Streams;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The signed-in profile's avatar as the web draws it: the account's server-side preference (one of the six shared
    /// preset plates, or a custom JPEG data URL), or the preset picked by a hash of the profile id when none is set.
    /// The preset plates are the shared <c>clients/shared/profile-avatars/plates</c> art.
    /// </summary>
    internal static class Avatars
    {
        private static readonly string[] Presets = { "astronaut", "cat", "dinosaur", "robot", "pirate", "alien" };
        private static Task<ImageSource?>? _current;

        /// <summary>The current profile's avatar; one fetch per sign-in (call <see cref="Reset"/> on sign-out).</summary>
        public static Task<ImageSource?> CurrentAsync() => _current ??= LoadAsync();

        public static void Reset() => _current = null;

        private static async Task<ImageSource?> LoadAsync()
        {
            try
            {
                var api = App.Environment.ApiClient;
                var profile = (await api.ListProfilesAsync()).FirstOrDefault(p => p.IsCurrent);
                var preference = (await api.GetProfileAvatarAsync()).Preference;
                if (preference != null && preference.Kind == "custom" && preference.Value.StartsWith("data:", StringComparison.Ordinal))
                {
                    var comma = preference.Value.IndexOf(',');
                    if (comma > 0)
                    {
                        var bytes = Convert.FromBase64String(preference.Value.Substring(comma + 1));
                        using (var stream = new InMemoryRandomAccessStream())
                        {
                            await stream.WriteAsync(bytes.AsBuffer());
                            stream.Seek(0);
                            var bitmap = new BitmapImage();
                            await bitmap.SetSourceAsync(stream);
                            return bitmap;
                        }
                    }
                }

                var preset = preference != null && preference.Kind == "preset" && Presets.Contains(preference.Value)
                    ? preference.Value
                    : DefaultPreset(profile?.Id.ToString("D") ?? string.Empty);
                return new BitmapImage(new Uri($"ms-appx:///Assets/Avatars/{preset}.png"));
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The web's <c>defaultProfileAvatarPreset</c>: hash = hash * 31 + code, over the profile id.</summary>
        private static string DefaultPreset(string userId)
        {
            uint hash = 0;
            unchecked
            {
                foreach (var character in userId)
                {
                    hash = (hash * 31) + character;
                }
            }

            return Presets[(int)(hash % (uint)Presets.Length)];
        }
    }
}
