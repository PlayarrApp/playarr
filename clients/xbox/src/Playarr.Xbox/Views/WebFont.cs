using System.Text.RegularExpressions;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's exact font weights. UWP snaps the weights of one family to its named faces, so each other weight is its own
    /// family ("Nunito Sans W680", built by tools/make-fonts.py); the named weights (400, 600, 700, 800) use the shared family.
    /// </summary>
    internal static class WebFont
    {
        private static readonly Regex Own = new Regex(@"#Nunito Sans W(\d+)$");

        // The weights tools/make-fonts.py builds as their own families (the web's weights); anything else uses the shared family and snaps.
        private static readonly System.Collections.Generic.HashSet<int> Built = new System.Collections.Generic.HashSet<int> { 300, 480, 500, 560, 570, 580, 590, 610, 640, 650, 680, 690, 720, 750, 760, 820, 860, 900 };

        private static bool Named(int weight) => !Built.Contains(weight);

        public static FontFamily Face(int weight) => Named(weight)
            ? (FontFamily)Application.Current.Resources["PlayarrFont"]
            : new FontFamily("ms-appx:///Assets/Fonts/NunitoSans.ttc#Nunito Sans W" + weight);

        public static FontWeight Weight(int weight) => Named(weight) ? new FontWeight { Weight = (ushort)weight } : FontWeights.Normal;

        public static void Apply(TextBlock block, int weight)
        {
            block.FontFamily = Face(weight);
            block.FontWeight = Weight(weight);
        }

        /// <summary>The weight a text block really asks for (what the layout export reports).</summary>
        public static int WeightOf(TextBlock block) =>
            block.FontFamily?.Source is string source && Own.Match(source) is { Success: true } match ? int.Parse(match.Groups[1].Value) : block.FontWeight.Weight;
    }
}
