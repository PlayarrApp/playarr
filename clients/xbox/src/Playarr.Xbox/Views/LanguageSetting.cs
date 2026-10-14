using System.Linq;
using Playarr.Core.Localization;
using Windows.Storage;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's Settings > Language choice (<c>playarr-language</c>: system, en, th or ja), kept in local settings.
    /// "System" follows the device's first UI language and is stored as the absence of a value, as on the web.
    /// </summary>
    internal static class LanguageSetting
    {
        private const string SettingsKey = "playarr-language";

        public static void Load()
        {
            var stored = ApplicationData.Current.LocalSettings.Values.TryGetValue(SettingsKey, out var v) ? v as string : null;
            Lang.Configure(stored, Windows.Globalization.ApplicationLanguages.Languages.FirstOrDefault());
        }

        /// <summary>Saves a choice and relabels the nav rail; the Settings page redraws itself.</summary>
        public static void Save(string preference)
        {
            if (preference == Lang.SystemChoice)
            {
                ApplicationData.Current.LocalSettings.Values.Remove(SettingsKey);
            }
            else
            {
                ApplicationData.Current.LocalSettings.Values[SettingsKey] = preference;
            }

            Lang.SetPreference(preference);
            ShellChrome.Instance?.Relabel();
        }
    }
}
