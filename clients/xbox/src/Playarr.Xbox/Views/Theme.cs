using System;
using System.Collections.Generic;
using Windows.Storage;
using Windows.UI;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's colour theme (Settings > Appearance: System, Light, Dark). The tokens are the web's
    /// <c>global.css</c> light and dark blocks. App.xaml holds one shared brush per token; changing the theme rewrites
    /// those brushes' colours in place, so everything that references them follows at once. The player stage stays
    /// dark in both themes, as on the web.
    /// </summary>
    internal static class Theme
    {
        public const string System = "system";
        public const string Light = "light";
        public const string Dark = "dark";

        private const string SettingsKey = "Theme";

        // key, dark, light
        private static readonly (string Key, string Dark, string Light)[] Tokens =
        {
            ("PlayarrBg", "#151315", "#F5F3F2"),
            ("ApplicationPageBackgroundThemeBrush", "#151315", "#F5F3F2"),
            ("PlayarrSurface", "#1B181B", "#FBFAF9"),
            ("PlayarrSurfaceStrong", "#211D21", "#FFFFFF"),
            ("PlayarrSurfaceSoft", "#312A30", "#DFDCDD"),
            ("PlayarrInk", "#F4F0F1", "#382621"),
            ("PlayarrInkSoft", "#CDC1C6", "#443A40"),
            ("PlayarrInkMuted", "#C2B5BB", "#4D4248"),
            ("PlayarrLine", "#1CDFDCDD", "#24382621"),
            ("PlayarrLineStrong", "#3BDFDCDD", "#47382621"),
            ("PlayarrBrandInk", "#EAA6B6", "#821E36"),
            // The focus ring is white in dark theme and a near-black ink ring in light theme (owner ruling).
            ("PlayarrFocusRing", "#FFFFFF", "#382621"),
        };

        public static bool IsLight { get; private set; }

        /// <summary>The stored choice: <see cref="System"/> (the default), <see cref="Light"/> or <see cref="Dark"/>.</summary>
        public static string Choice
        {
            get => ApplicationData.Current.LocalSettings.Values.TryGetValue(SettingsKey, out var v) && v is string s ? s : System;
            private set => ApplicationData.Current.LocalSettings.Values[SettingsKey] = value;
        }

        public static Color Bg => Parse(IsLight ? "#F5F3F2" : "#151315");

        public static Color BrandInk => Parse(IsLight ? "#821E36" : "#EAA6B6");

        public static Color InkMuted => Parse(IsLight ? "#4D4248" : "#C2B5BB");

        public static Color Success => Parse(IsLight ? "#224C3A" : "#8AC5A5");

        public static Brush FocusRing => (Brush)Application.Current.Resources["PlayarrFocusRing"];

        /// <summary>The faded edge of a backdrop beside the left column: translucent at the left, solid page colour at the right.</summary>
        public static LinearGradientBrush LeftFade() => new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 0),
            GradientStops =
            {
                new GradientStop { Color = Color.FromArgb(0x99, Bg.R, Bg.G, Bg.B), Offset = 0 },
                new GradientStop { Color = Color.FromArgb(0xFF, Bg.R, Bg.G, Bg.B), Offset = 1 },
            },
        };

        /// <summary>Applies the stored choice. Call at launch, before the first page is built.</summary>
        public static void Load() => Apply(Choice);

        /// <summary>Stores and applies a choice, then re-themes the stock controls under the window content.</summary>
        public static void Set(string choice)
        {
            Choice = choice;
            Apply(choice);
        }

        private static void Apply(string choice)
        {
            IsLight = choice == Light || (choice != Dark && SystemIsLight());
            foreach (var (key, dark, light) in Tokens)
            {
                var color = Parse(IsLight ? light : dark);
                if (Application.Current.Resources.TryGetValue(key, out var existing) && existing is SolidColorBrush brush)
                {
                    brush.Color = color;
                }
            }

            if (Window.Current?.Content is FrameworkElement root)
            {
                root.RequestedTheme = IsLight ? ElementTheme.Light : ElementTheme.Dark;
            }
        }

        private static bool SystemIsLight()
        {
            var background = new Windows.UI.ViewManagement.UISettings().GetColorValue(Windows.UI.ViewManagement.UIColorType.Background);
            return background.R > 127;
        }

        private static Color Parse(string hex)
        {
            var h = hex.TrimStart('#');
            var a = h.Length == 8 ? Convert.ToByte(h.Substring(0, 2), 16) : (byte)0xFF;
            var o = h.Length == 8 ? 2 : 0;
            return Color.FromArgb(a, Convert.ToByte(h.Substring(o, 2), 16), Convert.ToByte(h.Substring(o + 2, 2), 16), Convert.ToByte(h.Substring(o + 4, 2), 16));
        }
    }
}
