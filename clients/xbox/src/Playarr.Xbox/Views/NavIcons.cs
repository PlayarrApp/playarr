using System.Collections.Generic;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Markup;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Shapes;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web nav's line icons (<c>components/NavIcons.tsx</c>): 24 x 24 artboard, 1.8 stroke, round caps and joins, drawn
    /// in the item's text colour. Circles and rounded rectangles are written as arc paths.
    /// </summary>
    internal static class NavIcons
    {
        private static readonly Dictionary<string, (string[] Lines, string[] Fills)> Icons = new Dictionary<string, (string[], string[])>
        {
            ["Home"] = (new[] { "M3,11.5 L12,4 L21,11.5", "M5.5,9.5 V20 H18.5 V9.5", "M10,20 V14 H14 V20" }, new string[0]),
            ["Search"] = (new[] { "M4,10.5 A6.5,6.5 0 1 1 17,10.5 A6.5,6.5 0 1 1 4,10.5", "M15.5,15.5 L20,20" }, new string[0]),
            ["Series"] = (new[] { "M6,4 H18 A2,2 0 0 1 20,6 V18 A2,2 0 0 1 18,20 H6 A2,2 0 0 1 4,18 V6 A2,2 0 0 1 6,4 Z", "M8,9 H16 M8,13 H16 M8,17 H13", "M10,1 L12,4 L14,1" }, new string[0]),
            ["Movies"] = (new[] { "M5,5 H19 A2,2 0 0 1 21,7 V17 A2,2 0 0 1 19,19 H5 A2,2 0 0 1 3,17 V7 A2,2 0 0 1 5,5 Z", "M7,5 L9,2 M13,5 L15,2 M19,5 L21,2" }, new[] { "M10,10 L15,12.5 L10,15 Z" }),
            ["Music"] = (new[] { "M9,18 V6 L19,4 V16", "M4,18.5 A2.5,2.5 0 1 1 9,18.5 A2.5,2.5 0 1 1 4,18.5", "M14,16.5 A2.5,2.5 0 1 1 19,16.5 A2.5,2.5 0 1 1 14,16.5", "M9,10 L19,8" }, new string[0]),
            ["Downloads"] = (new[] { "M12,3 V15", "M7,10.5 L12,15 L17,10.5", "M4.5,18.5 V20 A1,1 0 0 0 5.5,21 H18.5 A1,1 0 0 0 19.5,20 V18.5" }, new string[0]),
            ["Playlists"] = (new[] { "M5,6 H15 M5,10 H15 M5,14 H11", "M17,13.5 V19.5", "M17,13.5 L21,12 V17.5", "M14,19.5 A1.5,1.5 0 1 1 17,19.5 A1.5,1.5 0 1 1 14,19.5", "M18,17.5 A1.5,1.5 0 1 1 21,17.5 A1.5,1.5 0 1 1 18,17.5" }, new string[0]),
            ["Watchlist"] = (new[] { "M6,3.5 H18 A1,1 0 0 1 19,4.5 V21 L12,16.5 L5,21 V4.5 A1,1 0 0 1 6,3.5 Z", "M12,7.5 V12.5 M9.5,10 H14.5" }, new string[0]),
            ["Calendar"] = (new[] { "M5.5,5 H18.5 A2,2 0 0 1 20.5,7 V18 A2,2 0 0 1 18.5,20 H5.5 A2,2 0 0 1 3.5,18 V7 A2,2 0 0 1 5.5,5 Z", "M3.5,10 H20.5 M8,3 V7 M16,3 V7" }, new string[0]),
        };

        /// <summary>The icon for a nav label ("Requests" shares the Watchlist icon, as on the web), 20 px, tinted by <paramref name="brush"/>.</summary>
        public static FrameworkElement Create(string name, Brush brush)
        {
            var (lines, fills) = Icons[name == "Requests" ? "Watchlist" : name];
            var canvas = new Canvas { Width = 24, Height = 24 };
            foreach (var data in lines)
            {
                var line = Shape(data);
                line.Stroke = brush;
                line.StrokeThickness = 1.8;
                line.StrokeStartLineCap = PenLineCap.Round;
                line.StrokeEndLineCap = PenLineCap.Round;
                line.StrokeLineJoin = PenLineJoin.Round;
                canvas.Children.Add(line);
            }

            foreach (var data in fills)
            {
                var fill = Shape(data);
                fill.Fill = brush;
                canvas.Children.Add(fill);
            }

            return new Viewbox { Width = 20, Height = 20, Child = canvas };
        }

        /// <summary>A path shape from SVG-style path data; a geometry cannot be moved between shapes, so each shape parses its own.</summary>
        private static Path Shape(string data) =>
            (Path)XamlReader.Load("<Path xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Data='" + data + "'/>");
    }
}
