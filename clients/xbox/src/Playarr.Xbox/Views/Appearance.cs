using Windows.Storage;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's Settings > Appearance artwork choices (<c>lib/homeView.ts</c>, <c>lib/artworkSize.tsx</c>), kept in local settings.
    /// The artwork size shifts every card column count (small +1, large -1); Covers shows portrait art on the Home rails.
    /// </summary>
    internal static class Appearance
    {
        private const string HomeViewKey = "playarr-home-view";
        private const string ArtworkSizeKey = "playarr-artwork-size";

        // The web's right-hand rail at 1920 px, split into 3 columns with a 25 px gap gives the 328 px card.
        private const double RailWidth = 1034;
        private const double Gap = 25;
        private const double CoverGap = 19.2;

        public static readonly string[] Sizes = { "small", "medium", "large" };

        private static string Read(string key, string fallback) =>
            ApplicationData.Current.LocalSettings.Values.TryGetValue(key, out var v) && v is string s ? s : fallback;

        public static bool HomeCover
        {
            get => Read(HomeViewKey, "thumbnail") == "cover";
            set => ApplicationData.Current.LocalSettings.Values[HomeViewKey] = value ? "cover" : "thumbnail";
        }

        /// <summary>0 small, 1 medium (default), 2 large.</summary>
        public static int SizeIndex
        {
            get => System.Math.Max(0, System.Array.IndexOf(Sizes, Read(ArtworkSizeKey, "medium")));
            set => ApplicationData.Current.LocalSettings.Values[ArtworkSizeKey] = Sizes[value];
        }

        private static int Step => 1 - SizeIndex;

        public static double CardWidth => System.Math.Round((RailWidth - (2 + Step) * Gap) / (3 + Step), 1);

        public static double CardHeight => System.Math.Floor(CardWidth * 9 / 16);

        public static double CoverWidth => System.Math.Round((RailWidth - (4 + Step) * CoverGap) / (5 + Step), 1);

        public static double CoverHeight => System.Math.Round(CoverWidth * 3 / 2, 1);
    }
}
