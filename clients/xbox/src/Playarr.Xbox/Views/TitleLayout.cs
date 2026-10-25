using System;
using System.Collections.Generic;
using System.Linq;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Playarr.Xbox.Views
{
    /// <summary>The detail title as the web sets it: balanced onto lines, one heading block per line stacked at the web's pitch.</summary>
    internal static class TitleLayout
    {
        /// <summary>
        /// The web balances the title (<c>text-wrap: balance</c>); the shared rule measured against Chrome (android/balance/NOTES.md):
        /// keep the greedy line count at the 9ch box, then among the break sets with that many lines (each fitting the box)
        /// take the smallest sum of squared line widths, plus 5000 when the last line is one word. Breaks are after spaces only.
        /// </summary>
        public static void Build(StackPanel host, string title, TextBlock template)
        {
            double Width(string text) => MeasureWidth(text, template);
            // The web caps the title at max-width: 9ch (nine "0" advances) at its 3.6vw font size.
            var zero = new TextBlock { Text = "0", FontSize = template.FontSize, FontWeight = template.FontWeight, TextWrapping = TextWrapping.NoWrap };
            zero.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            var max = zero.DesiredSize.Width * 9;
            var words = title.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var lineCount = 1;
            var current = string.Empty;
            var greedy = new List<string>();
            foreach (var word in words)
            {
                var next = current.Length == 0 ? word : current + " " + word;
                if (current.Length > 0 && Width(next) > max)
                {
                    lineCount++;
                    greedy.Add(current);
                    current = word;
                }
                else
                {
                    current = next;
                }
            }

            greedy.Add(current);

            // Best break set with exactly lineCount lines: recursion over where each line ends (titles have few words).
            var best = double.MaxValue;
            var bestLines = greedy; // kept when a single word is wider than the box and no break set fits
            void Search(int start, List<string> lines, double cost)
            {
                if (lines.Count == lineCount - 1)
                {
                    var last = string.Join(" ", words.Skip(start));
                    var w = Width(last);
                    if (words.Length - start == 0 || w > max)
                    {
                        return;
                    }

                    var total = cost + w * w + (lineCount > 1 && words.Length - start == 1 ? 5000 : 0);
                    if (total < best)
                    {
                        best = total;
                        bestLines = lines.Concat(new[] { last }).ToList();
                    }

                    return;
                }

                for (var end = start + 1; end < words.Length; end++)
                {
                    var text = string.Join(" ", words.Skip(start).Take(end - start));
                    var w = Width(text);
                    if (w > max)
                    {
                        break;
                    }

                    Search(end, lines.Concat(new[] { text }).ToList(), cost + w * w);
                }
            }

            if (lineCount > 1)
            {
                Search(0, new List<string>(), 0);
            }

            host.Children.Clear();
            foreach (var line in bestLines)
            {
                var block = new TextBlock
                {
                    Text = line,
                    HorizontalAlignment = HorizontalAlignment.Left,
                    FontSize = template.FontSize,
                    FontFamily = template.FontFamily,
                    FontWeight = template.FontWeight,
                    CharacterSpacing = template.CharacterSpacing,
                    TextWrapping = TextWrapping.NoWrap,
                    Foreground = template.Foreground,
                };
                LayoutExport.SetRole(block, "heading");
                block.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
                block.Margin = new Thickness(0, host.Children.Count == 0 ? 0 : TitlePitch - block.DesiredSize.Height, 0, 0);
                host.Children.Add(block);
            }
        }

        private const double TitlePitch = 62.2;

        private static double MeasureWidth(string text, TextBlock template)
        {
            var probe = new TextBlock { Text = text, FontSize = template.FontSize, FontWeight = template.FontWeight, CharacterSpacing = template.CharacterSpacing, TextWrapping = TextWrapping.NoWrap };
            probe.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            return probe.DesiredSize.Width;
        }
    }
}
