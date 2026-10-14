using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Shapes;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's left detail column for the focused title (Home and library pages): its backdrop faded into the page,
    /// then genre eyebrow, large title, year and genres, synopsis. One shared component for every page that has it.
    /// </summary>
    internal sealed class FocusDetail : Grid
    {
        private readonly Grid _backdropLayer = new Grid
        {
            Width = 998.4,
            Height = 1144.8,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
            RenderTransform = new ScaleTransform { ScaleX = 1.04, ScaleY = 1.04 },
        };
        private readonly Image _backdrop = new Image { Stretch = Stretch.UniformToFill };
        private readonly Rectangle _imageMaskWash = new Rectangle
        {
            Width = 998.4,
            Height = 1144.8,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            IsHitTestVisible = false,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
            RenderTransform = new ScaleTransform { ScaleX = 1.04, ScaleY = 1.04 },
        };
        private readonly Rectangle _horizontalWash = new Rectangle { Width = 960, HorizontalAlignment = HorizontalAlignment.Left };
        private readonly Rectangle _verticalWash = new Rectangle
        {
            Width = 1920,
            Height = 1080,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        private readonly Rectangle _stageWashLeft = new Rectangle { IsHitTestVisible = false };
        private readonly Rectangle _stageWashRight = new Rectangle { IsHitTestVisible = false };
        private readonly TextBlock _eyebrow = new TextBlock { FontSize = 12, FontWeight = FontWeights.Bold, CharacterSpacing = 120 };
        private readonly TextBlock _title = new TextBlock { HorizontalAlignment = HorizontalAlignment.Left, FontSize = 69, FontWeight = FontWeights.SemiBold, CharacterSpacing = -72, LineHeight = 62, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, TextWrapping = TextWrapping.NoWrap, MaxLines = 3, Margin = new Thickness(0, 34, 0, 0) };
        private readonly TextBlock _meta = new TextBlock { FontSize = 14, Margin = new Thickness(0, 12, 0, 0) };
        private readonly TextBlock _overview = new TextBlock { Width = 346, HorizontalAlignment = HorizontalAlignment.Left, FontSize = 14, LineHeight = 22, TextWrapping = TextWrapping.WrapWholeWords, MaxLines = 5, TextTrimming = TextTrimming.WordEllipsis, Margin = new Thickness(0, 26, 0, 0) };
        private readonly StackPanel _panel;

        public FocusDetail()
        {
            IsHitTestVisible = false;
            var soft = (Brush)Application.Current.Resources["PlayarrInkSoft"];
            _eyebrow.Foreground = (Brush)Application.Current.Resources["PlayarrBrandInk"];
            _meta.Foreground = soft;
            _overview.Foreground = soft;
            _backdropLayer.Opacity = Theme.KeyArtGroupOpacity;
            _backdropLayer.Children.Add(_backdrop);
            Children.Add(_backdropLayer);
            _imageMaskWash.Fill = Theme.KeyArtImageMaskWash();
            Children.Add(_imageMaskWash);
            _horizontalWash.Fill = Theme.KeyArtStageHorizontalWash();
            Children.Add(_horizontalWash);
            _verticalWash.Fill = Theme.KeyArtVerticalWash();
            Children.Add(_verticalWash);
            _stageWashRight.Fill = Theme.KeyArtStageWashRight();
            Children.Add(_stageWashRight);
            _stageWashLeft.Fill = Theme.KeyArtStageWashLeft();
            Children.Add(_stageWashLeft);
            _panel = new StackPanel
            {
                Width = 380,
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
        /// The web balances the title (<c>text-wrap: balance</c>); the shared rule measured against Chrome (android/balance/NOTES.md):
        /// keep the greedy line count at the 9ch box, then among the break sets with that many lines (each fitting the box)
        /// take the smallest sum of squared line widths, plus 5000 when the last line is one word. Breaks are after spaces only.
        /// </summary>
        private void WrapTitle(string title)
        {
            // The web caps the title at max-width: 9ch (nine "0" advances) at its 3.6vw font size.
            var zero = new TextBlock { Text = "0", FontSize = _title.FontSize, FontWeight = _title.FontWeight, TextWrapping = TextWrapping.NoWrap };
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

            _title.Text = string.Join("\n", bestLines);
        }

        private double Width(string text)
        {
            var probe = new TextBlock { Text = text, FontSize = _title.FontSize, FontWeight = _title.FontWeight, CharacterSpacing = _title.CharacterSpacing, TextWrapping = TextWrapping.NoWrap };
            probe.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            return probe.DesiredSize.Width;
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

            _backdropLayer.Opacity = Theme.KeyArtGroupOpacity;
            Artwork.Load(_backdrop, work, 999, new[] { ImageKind.Backdrop }, requestWidth: withKind ? 1920 : 780, applyKeyArtFilter: true);
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
            WrapTitle(work.Title);
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
            _meta.Tag = string.Join("   ", meta);
            _ = ShowRuntimeAsync(work.Id, withKind);
        }

        private static readonly Dictionary<Guid, string> Runtimes = new Dictionary<Guid, string>();
        private Guid _runtimeFor;

        /// <summary>
        /// The web's runtime ("1h 48m"), read from the title's detail once focus has dwelt on it: Home's hero shows it
        /// alone; the library appends it to the year and genres.
        /// </summary>
        private async System.Threading.Tasks.Task ShowRuntimeAsync(Guid id, bool homeHero)
        {
            _runtimeFor = id;
            if (!Runtimes.TryGetValue(id, out var label))
            {
                await System.Threading.Tasks.Task.Delay(300);
                if (_runtimeFor != id)
                {
                    return;
                }

                try
                {
                    var detail = await App.Environment.ApiClient.GetWorkAsync(id);
                    var minutes = detail.RuntimeMs is { } ms && ms > 0 ? Math.Max(1, (int)Math.Round(ms / 60000.0)) : 0;
                    label = minutes == 0 ? string.Empty : minutes < 60 ? $"{minutes}m" : minutes % 60 == 0 ? $"{minutes / 60}h" : $"{minutes / 60}h {minutes % 60}m";
                }
                catch (Exception)
                {
                    label = string.Empty;
                }

                Runtimes[id] = label;
            }

            if (_runtimeFor == id)
            {
                var basis = homeHero ? string.Empty : (string)(_meta.Tag ?? string.Empty);
                _meta.Text = basis.Length == 0 ? label : label.Length == 0 ? basis : basis + "   " + label;
            }
        }
    }
}
