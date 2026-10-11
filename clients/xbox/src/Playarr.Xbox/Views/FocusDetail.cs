using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's left detail column for the focused title (Home and library pages): its backdrop faded into the page,
    /// then genre eyebrow, large title, year and genres, synopsis. One shared component for every page that has it.
    /// </summary>
    internal sealed class FocusDetail : Grid
    {
        private readonly Image _backdrop = new Image { Width = 960, HorizontalAlignment = HorizontalAlignment.Left, Stretch = Stretch.UniformToFill, Opacity = 0.35 };
        private readonly TextBlock _eyebrow = new TextBlock { FontSize = 12, FontWeight = FontWeights.Bold, CharacterSpacing = 120 };
        private readonly TextBlock _title = new TextBlock { HorizontalAlignment = HorizontalAlignment.Left, FontSize = 64, FontWeight = FontWeights.SemiBold, CharacterSpacing = -30, LineHeight = 64, TextWrapping = TextWrapping.WrapWholeWords, MaxLines = 3, Margin = new Thickness(0, 22, 0, 0) };
        private readonly TextBlock _meta = new TextBlock { FontSize = 14, Margin = new Thickness(0, 24, 0, 0) };
        private readonly TextBlock _overview = new TextBlock { FontSize = 14, LineHeight = 22, TextWrapping = TextWrapping.WrapWholeWords, MaxLines = 5, TextTrimming = TextTrimming.WordEllipsis, Margin = new Thickness(0, 20, 0, 0) };
        private readonly StackPanel _panel;

        public FocusDetail()
        {
            IsHitTestVisible = false;
            var soft = (Brush)Application.Current.Resources["PlayarrInkSoft"];
            _eyebrow.Foreground = (Brush)Application.Current.Resources["PlayarrBrandInk"];
            _meta.Foreground = soft;
            _overview.Foreground = soft;
            Children.Add(_backdrop);
            Children.Add(new Windows.UI.Xaml.Shapes.Rectangle
            {
                Width = 960,
                HorizontalAlignment = HorizontalAlignment.Left,
                Fill = new LinearGradientBrush
                {
                    StartPoint = new Windows.Foundation.Point(0, 0),
                    EndPoint = new Windows.Foundation.Point(1, 0),
                    GradientStops =
                    {
                        new GradientStop { Color = Windows.UI.Color.FromArgb(0x99, 0x15, 0x13, 0x15), Offset = 0 },
                        new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x15, 0x13, 0x15), Offset = 1 },
                    },
                },
            });
            _panel = new StackPanel
            {
                Width = 346,
                Margin = new Thickness(ShellChrome.ContentLeft, 258, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
            };
            _panel.Children.Add(_eyebrow);
            _panel.Children.Add(_title);
            _panel.Children.Add(_meta);
            _panel.Children.Add(_overview);
            Children.Add(_panel);
        }

        /// <summary>
        /// The web balances a wrapped title ("2 Fast / 2 Furious", not "2 Fast 2 / Furious"): keep the line count and
        /// narrow the title until one more word would wrap.
        /// </summary>
        private void BalanceTitle()
        {
            _title.Width = double.NaN;
            var full = LineCount(346);
            if (full < 2)
            {
                return;
            }

            // Never narrower than the longest word, or the word itself would break.
            double lo = 80, hi = 346;
            foreach (var word in _title.Text.Split(' '))
            {
                var probe = new TextBlock { Text = word, FontSize = _title.FontSize, FontWeight = _title.FontWeight, CharacterSpacing = _title.CharacterSpacing, TextWrapping = TextWrapping.NoWrap };
                probe.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
                lo = Math.Max(lo, probe.DesiredSize.Width + 2);
            }

            if (lo >= hi)
            {
                return;
            }

            while (hi - lo > 4)
            {
                var mid = (lo + hi) / 2;
                if (LineCount(mid) == full)
                {
                    hi = mid;
                }
                else
                {
                    lo = mid;
                }
            }

            _title.Width = hi;
        }

        private int LineCount(double width)
        {
            _title.Measure(new Windows.Foundation.Size(width, double.PositiveInfinity));
            return (int)Math.Round(_title.DesiredSize.Height / 64);
        }

        public void SetMeta(string text) => _meta.Text = text;

        /// <param name="withKind">Home shows "MOVIE · ACTION"; the library shows the genre alone.</param>
        public void Show(Work? work, bool withKind = false)
        {
            _panel.Visibility = work == null ? Visibility.Collapsed : Visibility.Visible;
            if (work == null)
            {
                return;
            }

            Artwork.Load(_backdrop, work, 780, ImageKind.Backdrop);
            var eyebrow = new List<string>();
            if (withKind)
            {
                eyebrow.Add(WorkLabels.KindLabel(work.Kind).ToUpperInvariant());
            }

            if (work.Genres.Count > 0)
            {
                eyebrow.Add(work.Genres[0].ToUpperInvariant());
            }

            _eyebrow.Text = string.Join(" · ", eyebrow);
            _title.Text = work.Title;
            BalanceTitle();
            var meta = new List<string>();
            if (WorkLabels.YearRange(work) is { } years)
            {
                meta.Add(years);
            }

            if (work.Genres.Count > 0)
            {
                meta.Add(string.Join(" · ", work.Genres.Take(2)));
            }

            // Home shows only the runtime, which arrives once the title's detail has loaded (SetMeta).
            _meta.Text = withKind ? string.Empty : string.Join("   ", meta);
            _overview.Text = work.Overview ?? string.Empty;
        }
    }
}
