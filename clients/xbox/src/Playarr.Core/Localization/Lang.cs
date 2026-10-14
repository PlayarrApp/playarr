using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Playarr.Core.Localization
{
    /// <summary>
    /// The web's UI language controller (<c>lib/i18n</c>): "system" follows the device, otherwise English, Thai or Japanese is fixed.
    /// The tables come from the web (<c>tools/make-strings.py</c>); a key missing from a language falls back to English, then to the key.
    /// </summary>
    public static class Lang
    {
        public const string SystemChoice = "system";

        /// <summary>The web's supported languages, in picker order, with each one's own name.</summary>
        public static readonly IReadOnlyList<KeyValuePair<string, string>> Supported = new[]
        {
            new KeyValuePair<string, string>("en", "English"),
            new KeyValuePair<string, string>("th", "ไทย"),
            new KeyValuePair<string, string>("ja", "日本語"),
        };

        /// <summary>"system", "en", "th" or "ja".</summary>
        public static string Preference { get; private set; } = SystemChoice;

        /// <summary>The device language the "system" choice resolves to (English when unsupported).</summary>
        public static string Detected { get; private set; } = "en";

        public static string Current => Preference == SystemChoice ? Detected : Preference;

        /// <summary>Sets the saved choice and the device language tag (for example "th-TH"); unknown values reset to system and English.</summary>
        public static void Configure(string? preference, string? deviceTag)
        {
            SetPreference(preference);
            Detected = Resolve(deviceTag);
        }

        public static void SetPreference(string? preference) => Preference = IsSupported(preference) ? preference! : SystemChoice;

        /// <summary>The base language subtag when it is one of ours, else English.</summary>
        public static string Resolve(string? tag)
        {
            var subtag = (tag ?? string.Empty).ToLowerInvariant().Split('-')[0];
            return IsSupported(subtag) && subtag != SystemChoice ? subtag : "en";
        }

        /// <summary>The picker label of a choice: the language's own name, or the translated "Auto".</summary>
        public static string NameOf(string preference)
        {
            foreach (var language in Supported)
            {
                if (language.Key == preference)
                {
                    return language.Value;
                }
            }

            return T("settings.language.optionSystem");
        }

        private static bool IsSupported(string? preference)
        {
            if (preference == SystemChoice)
            {
                return true;
            }

            foreach (var language in Supported)
            {
                if (language.Key == preference)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>The string for <paramref name="key"/> in the current language, with <c>{{name}}</c> tokens filled from <paramref name="args"/> (name, value pairs).</summary>
        public static string T(string key, params string[] args)
        {
            if (!Strings.All[Current].TryGetValue(key, out var text) && !Strings.All["en"].TryGetValue(key, out text))
            {
                return key;
            }

            if (args.Length == 0)
            {
                return text;
            }

            return Regex.Replace(text, @"\{\{(\w+)\}\}", match =>
            {
                for (var i = 0; i + 1 < args.Length; i += 2)
                {
                    if (args[i] == match.Groups[1].Value)
                    {
                        return args[i + 1];
                    }
                }

                return match.Value;
            });
        }
    }
}
