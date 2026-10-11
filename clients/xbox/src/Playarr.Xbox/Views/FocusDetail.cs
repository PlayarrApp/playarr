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
        private readonly TextBlock _title = new TextBlock { HorizontalAlignment = HorizontalAlignment.Left, FontSize = 69, FontWeight = FontWeights.SemiBold, CharacterSpacing = -72, LineHeight = 62, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, TextWrapping = TextWrapping.NoWrap, MaxLines = 3, Margin = new Thickness(0, 22, 0, 0) };
        private readonly TextBlock _meta = new TextBlock { FontSize = 14, Margin = new Thickness(0, 24, 0, 0) };
        private readonly TextBlock _overview = new TextBlock { Width = 346, HorizontalAlignment = HorizontalAlignment.Left, FontSize = 14, LineHeight = 22, TextWrapping = TextWrapping.WrapWholeWords, MaxLines = 5, TextTrimming = TextTrimming.WordEllipsis, Margin = new Thickness(0, 20, 0, 0) };
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
                Fill = Theme.LeftFade(),
            });
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
        /// The web wraps the title with <c>text-wrap: pretty</c>: greedy lines, but the last line never holds a single word
        /// when the line above could give one up ("2 Fast / 2 Furious", not "2 Fast 2 / Furious"). Lines are built by
        /// measuring and set with explicit breaks.
        /// </summary>
        private void WrapTitle(string title)
        {
            // The web caps the title at max-width: 9ch (nine "0" advances) at its 3.6vw font size.
            var zero = new TextBlock { Text = "0", FontSize = _title.FontSize, FontWeight = _title.FontWeight, TextWrapping = TextWrapping.NoWrap };
            zero.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            var max = zero.DesiredSize.Width * 9;
            var words = title.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var lines = new List<List<string>> { new List<string>() };
            foreach (var word in words)
            {
                var line = lines[lines.Count - 1];
                if (line.Count > 0 && Width(string.Join(" ", line.Concat(new[] { word }))) > max)
                {
                    lines.Add(new List<string>());
                    line = lines[lines.Count - 1];
                }

                line.Add(word);
            }

            if (lines.Count >= 2 && lines[lines.Count - 1].Count == 1 && lines[lines.Count - 2].Count >= 2)
            {
                var previous = lines[lines.Count - 2];
                var moved = previous[previous.Count - 1];
                if (Width(moved + " " + lines[lines.Count - 1][0]) <= max)
                {
                    previous.RemoveAt(previous.Count - 1);
                    lines[lines.Count - 1].Insert(0, moved);
                }
            }

            _title.Text = string.Join("\n", lines.Select(l => string.Join(" ", l)));
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

            Artwork.Load(_backdrop, work, 960, new[] { ImageKind.Backdrop }, requestWidth: 1280);
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
