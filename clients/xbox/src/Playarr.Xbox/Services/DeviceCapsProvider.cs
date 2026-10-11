using System;
using Playarr.Core.Playback;
using Windows.Graphics.Display;
using Windows.Storage;

namespace Playarr.Xbox.Services
{
    /// <summary>Reads the display's HDR state and the player's advanced settings into the negotiation's media capabilities.</summary>
    internal static class DeviceCapsProvider
    {
        public const string ForceVideoKey = "ForceDirectVideo";
        public const string ForceAudioKey = "ForceDirectAudio";

        public static bool ForceDirectVideo
        {
            get => Read(ForceVideoKey);
            set => ApplicationData.Current.LocalSettings.Values[ForceVideoKey] = value;
        }

        public static bool ForceDirectAudio
        {
            get => Read(ForceAudioKey);
            set => ApplicationData.Current.LocalSettings.Values[ForceAudioKey] = value;
        }

        public static DeviceCaps Current(XboxPlaybackProfile profile) =>
            DeviceCaps.ForXbox(profile, DisplayIsHdr10(), ForceDirectVideo, ForceDirectAudio);

        private static bool Read(string key) =>
            ApplicationData.Current.LocalSettings.Values.TryGetValue(key, out var value) && value is bool on && on;

        /// <summary>True when the connected display is in an HDR10 (advanced colour) mode right now.</summary>
        private static bool DisplayIsHdr10()
        {
            try
            {
                var info = DisplayInformation.GetForCurrentView().GetAdvancedColorInfo();
                return info.CurrentAdvancedColorKind == AdvancedColorKind.HighDynamicRange;
            }
            catch (Exception)
            {
                return false; // cannot tell: report SDR so the server tone-maps
            }
        }
    }
}
