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
        // The web's key-art box: the backdrop is laid out 899.97 x 1190.59 from (133.03, -22.9) and covers it.
        private readonly Grid _backdropLayer = new Grid
        {
            Width = 899.97,
            Height = 1190.59,
            Margin = new Thickness(133.03, -22.9, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        private readonly Image _backdrop = new Image { Stretch = Stretch.UniformToFill };
        private readonly Rectangle _imageMaskWash = new Rectangle
        {
            Width = 899.97,
            Height = 1190.59,
            Margin = new Thickness(133.03, -22.9, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            IsHitTestVisible = false,
        };
        // The web's right-hand ground wash: the last 1190 px of the stage.
        private readonly Rectangle _rightWash = new Rectangle { Width = 1190.39, Margin = new Thickness(729.61, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false };
        private readonly Rectangle _horizontalWash = new Rectangle { HorizontalAlignment = HorizontalAlignment.Stretch };
        private readonly Rectangle _verticalWash = new Rectangle
        {
            Width = 998.4, // the key-art box only: the web's right half is the plain tinted ground
            Height = 1080,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        private readonly Rectangle _stageWashLeft = new Rectangle { IsHitTestVisible = false };
        private readonly TextBlock _eyebrow = new TextBlock { FontSize = 12.29, FontFamily = WebFont.Face(860), FontWeight = WebFont.Weight(860), CharacterSpacing = 100, LineHeight = 16, LineStackingStrategy = LineStackingStrategy.BlockLineHeight };
        private readonly TextBlock _title = new TextBlock { HorizontalAlignment = HorizontalAlignment.Left, FontSize = 69.12, FontFamily = WebFont.Face(560), FontWeight = WebFont.Weight(560), CharacterSpacing = -72, TextWrapping = TextWrapping.NoWrap };
        // One block per title line at the font's own line height, stacked 62.2 px apart: the glyph rectangle is the platform's, the pitch the web's.
        private readonly StackPanel _titleLines = new StackPanel { Margin = new Thickness(0, 11.33, 0, 0) };
        private readonly StackPanel _metaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12.8, Margin = new Thickness(0, 11.2, 0, 0) };
        private readonly TextBlock _meta = new TextBlock { FontSize = 13.06, FontFamily = WebFont.Face(600), FontWeight = WebFont.Weight(600), LineHeight = 18, LineStackingStrategy = LineStackingStrategy.BlockLineHeight };
        private readonly TextBlock _overview = new TextBlock { Width = 346, HorizontalAlignment = HorizontalAlignment.Left, FontSize = 13.82, FontFamily = WebFont.Face(600), FontWeight = WebFont.Weight(600), LineHeight = 20, LineStackingStrategy = LineStackingStrategy.BaselineToBaseline, TextWrapping = TextWrapping.WrapWholeWords, MaxLines = 5, TextTrimming = TextTrimming.WordEllipsis, Margin = new Thickness(0, 26.2, 0, 0) };
        private readonly StackPanel _panel;

        public FocusDetail()
        {
            IsHitTestVisible = false;
            var soft = (Brush)Application.Current.Resources["PlayarrInkHero"];
            _eyebrow.Foreground = (Brush)Application.Current.Resources["PlayarrBrandInk"];
            _meta.Foreground = soft;
            _overview.Foreground = soft;
            _backdropLayer.Opacity = Theme.KeyArtGroupOpacity;
            _backdropLayer.Children.Add(_backdrop);
            Children.Add(_backdropLayer);
            _imageMaskWash.Fill = Theme.KeyArtImageMaskWash();
            Children.Add(_imageMaskWash);
            _horizontalWash.Fill = Theme.KeyArtStageHorizontalWash(0.22);
            Children.Add(_horizontalWash);
            _rightWash.Fill = Theme.KeyArtStageWashRight();
            Children.Add(_rightWash);
            _verticalWash.Fill = Theme.KeyArtVerticalWash();
            Children.Add(_verticalWash);
            _stageWashLeft.Fill = Theme.KeyArtStageWashLeft();
            Children.Add(_stageWashLeft);
            _panel = new StackPanel
            {
                Width = 380,
                Margin = new Thickness(ShellChrome.ContentLeft, 260.2, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
            };
            _panel.Children.Add(_eyebrow);
            _panel.Children.Add(_titleLines);
            _metaRow.Children.Add(_meta);
            _panel.Children.Add(_metaRow);
            _panel.Children.Add(_overview);
            Children.Add(_panel);
        }

        public void SetMeta(string text) => SetMetaParts(new[] { text });

        /// <summary>The web's meta line is one run per part (year, genres, runtime), 13 px apart.</summary>
        private void SetMetaParts(IEnumerable<string> parts)
        {
            var list = parts.Where(p => p.Length > 0).ToList();
            _metaRow.Children.Clear();
            foreach (var part in list)
            {
                var block = part == list[0] ? _meta : new TextBlock { FontSize = _meta.FontSize, FontFamily = _meta.FontFamily, FontWeight = _meta.FontWeight, LineHeight = _meta.LineHeight, LineStackingStrategy = _meta.LineStackingStrategy, Foreground = _meta.Foreground };
                block.Text = part;
                _metaRow.Children.Add(block);
            }

            if (_metaRow.Children.Count == 0)
            {
                _meta.Text = string.Empty;
                _metaRow.Children.Add(_meta);
            }
        }

        /// <param name="withKind">Home shows "MOVIE · ACTION"; the library shows the genre alone.</param>
        public void Show(Work? work, bool withKind = false)
        {
            _panel.Visibility = work == null ? Visibility.Collapsed : Visibility.Visible;
            if (work == null)
            {
                return;
            }

            // Home's hero sets its meta and synopsis a little smaller and tighter than the library's.
            _meta.FontSize = withKind ? 12.86 : 13.06;
            _overview.FontSize = withKind ? 12.86 : 13.82;
            _overview.LineHeight = withKind ? 20.31 : 21.84;
            _metaRow.Margin = new Thickness(0, withKind ? 6.8 : 11.2, 0, 0);
            _overview.Margin = new Thickness(0, withKind ? 23.9 : 24.19, 0, 0);
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
            TitleLayout.Build(_titleLines, work.Title, _title);
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
            SetMetaParts(withKind ? new string[0] : meta);
            _overview.Text = work.Overview ?? string.Empty;
            _meta.Tag = meta;
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
                    label = minutes == 0 ? string.Empty : minutes < 60 ? $"{minutes} min" : minutes % 60 == 0 ? $"{minutes / 60}h" : $"{minutes / 60}h {minutes % 60}m";
                }
                catch (Exception)
                {
                    label = string.Empty;
                }

                Runtimes[id] = label;
            }

            if (_runtimeFor == id)
            {
                var basis = homeHero ? new List<string>() : (_meta.Tag as List<string> ?? new List<string>());
                SetMetaParts(basis.Concat(new[] { label }));
            }
        }
    }
}
