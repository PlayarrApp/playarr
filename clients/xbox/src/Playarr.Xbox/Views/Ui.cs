using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>Small shared builders for code-built screens, in the web TV look (tokens from App.xaml).</summary>
    internal static class Ui
    {
        /// <summary>The web's en-GB short date ("19 Sept 2011": current ICU writes September as Sept).</summary>
        public static string GbDate(DateTimeOffset date) =>
            date.ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB")).Replace(" Sep ", " Sept ");

        public static Brush Res(string key) => (Brush)Application.Current.Resources[key];

        public static TextBlock Text(string text, double size, FontWeight weight, string brushKey, Thickness margin = default) =>
            new TextBlock { Text = text, FontSize = size, FontFamily = WebFont.Face(weight.Weight), FontWeight = WebFont.Weight(weight.Weight), Foreground = Res(brushKey), Margin = margin };

        /// <summary>The web page header: round Back button, title and an optional pink count line, at the shell content edge.</summary>
        public static PageHeaderParts PageHeader(Panel host, string title, string? subtitle, Action back)
        {
            var backButton = BackButton(back);
            host.Children.Add(backButton);
            var titles = new StackPanel { Margin = new Thickness(226.63, 58.16, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            var titleText = new TextBlock { Text = title, Style = (Style)Application.Current.Resources["PlayarrPageTitle"], FontSize = 33.6, FontFamily = WebFont.Face(580), FontWeight = WebFont.Weight(580), LineHeight = 46, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, CharacterSpacing = -52 };
            LayoutExport.Heading(titleText);
            var subtitleText = new TextBlock { Text = subtitle ?? string.Empty };
            LayoutHeader(titles, titleText, subtitleText);
            host.Children.Add(titles);
            return new PageHeaderParts(backButton, titles, titleText, subtitleText);
        }

        /// <summary>The header's live parts: pages that change the title or subtitle later call <see cref="LayoutHeader"/> again.</summary>
        internal sealed class PageHeaderParts
        {
            public PageHeaderParts(Button back, StackPanel titles, TextBlock title, TextBlock subtitle)
            {
                Back = back;
                Titles = titles;
                Title = title;
                Subtitle = subtitle;
            }

            public Button Back { get; }

            public StackPanel Titles { get; }

            public TextBlock Title { get; }

            public TextBlock Subtitle { get; }
        }

        /// <summary>
        /// The web page header: the subtitle sits beside the title after a thin vertical divider (not pink); it drops under
        /// the title, over a thin line, only when the clock leaves no room (title + divider + subtitle wider than 250 px).
        /// </summary>
        public static void LayoutHeader(Panel titles, TextBlock title, TextBlock subtitle)
        {
            foreach (var part in new FrameworkElement[] { title, subtitle })
            {
                if (Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(part) is Panel parent)
                {
                    parent.Children.Remove(part);
                }
            }

            titles.Children.Clear();
            subtitle.Text = subtitle.Text.ToUpperInvariant();
            subtitle.FontSize = 11.14; // web: clamp(0.62rem, 0.58vw, 0.72rem) at 1920
            WebFont.Apply(subtitle, 680);
            subtitle.LineHeight = 15;
            subtitle.LineStackingStrategy = LineStackingStrategy.BlockLineHeight;
            subtitle.CharacterSpacing = 45; // web: 0.045em
            subtitle.Foreground = Res("PlayarrInk");
            if (string.IsNullOrEmpty(subtitle.Text))
            {
                titles.Children.Add(title);
                return;
            }

            title.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            subtitle.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            if (title.DesiredSize.Width + 47 + subtitle.DesiredSize.Width <= 250)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal };
                subtitle.VerticalAlignment = VerticalAlignment.Center;
                subtitle.Margin = new Thickness(0, -1.7, 0, 0);
                row.Children.Add(title);
                row.Children.Add(new Border { Width = 1, Height = 16, Margin = new Thickness(23.5, 8, 22.5, 0), Background = Res("PlayarrLineStrong"), VerticalAlignment = VerticalAlignment.Center });
                row.Children.Add(subtitle);
                titles.Children.Add(row);
            }
            else
            {
                subtitle.Margin = new Thickness(0, 6.99, 0, 0);
                titles.Children.Add(title);
                titles.Children.Add(new Border { Height = 1, Background = Res("PlayarrLineStrong"), Margin = new Thickness(0, 6.99, 0, 0) });
                titles.Children.Add(subtitle);
            }
        }

        /// <summary>The web's empty state: a round icon and a title with its explanation, centred in the content area.</summary>
        public static FrameworkElement EmptyState(string glyph, string title, string description)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 36, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(412, 0, 0, 0) };
            row.Children.Add(new Border
            {
                Width = 82,
                Height = 82,
                CornerRadius = new CornerRadius(41),
                BorderBrush = Res("PlayarrLine"),
                BorderThickness = new Thickness(1),
                Child = new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 26, Foreground = Res("PlayarrBrand"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            });
            var text = new StackPanel { Spacing = 10, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 340 };
            text.Children.Add(Text(title, 17, FontWeights.SemiBold, "PlayarrInk"));
            var body = Text(description, 11, FontWeights.Normal, "PlayarrInkSoft");
            body.TextWrapping = TextWrapping.WrapWholeWords;
            text.Children.Add(body);
            row.Children.Add(text);
            return row;
        }

        /// <summary>The page header's round Back button at the shell content edge.</summary>
        public static Button BackButton(Action onClick)
        {
            var button = RoundButton("", onClick);
            button.Margin = new Thickness(153.59, 56.16, 0, 0);
            LayoutExport.Named(button, "Back to Home");
            button.HorizontalAlignment = HorizontalAlignment.Left;
            button.VerticalAlignment = VerticalAlignment.Top;
            // The web draws Back as the text arrow, small and lightweight, not an icon-font arrow.
            button.Content = new TextBlock { Text = "\u2190", FontSize = 17.28, FontFamily = WebFont.Face(720), FontWeight = WebFont.Weight(720), LineHeight = 23, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, Foreground = Res("PlayarrInkSoft"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(-2, 0.6, 0, 0), CharacterSpacing = 133 };
            return button;
        }

        public static Button RoundButton(string glyph, Action onClick, bool link = false)
        {
            // Back navigates, so it is an anchor on the web: its peer reports a Hyperlink.
            Button button = link ? new LinkButton() : new Button();
            button.Width = 50;
            button.Height = 50;
            button.Padding = new Thickness(0);
            button.CornerRadius = new CornerRadius(25);
            button.Background = new SolidColorBrush(Colors.Transparent);
            button.BorderBrush = Res("PlayarrLineStrong");
            button.BorderThickness = new Thickness(1);
            button.Content = new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 14 };
            button.FocusVisualPrimaryBrush = Theme.FocusRing;
            button.FocusVisualPrimaryThickness = new Thickness(3);
            button.FocusVisualSecondaryThickness = new Thickness(0);
            button.Click += (s, e) => onClick();
            return button;
        }

        /// <summary>The web's Filters icon (icons.tsx "filters": 24 unit viewBox, 1.5 stroke, round caps, knobs filled with the strong surface).</summary>
        public static FrameworkElement FiltersIcon()
        {
            var ink = Res("PlayarrInkMuted");
            var icon = new Windows.UI.Xaml.Controls.Canvas { Width = 24, Height = 24, HorizontalAlignment = HorizontalAlignment.Center };
            icon.Children.Add(new Windows.UI.Xaml.Shapes.Path
            {
                Stroke = ink, StrokeThickness = 1.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Data = Rails(),
            });
            foreach (var (cx, cy) in new[] { (8.0, 6.0), (15.0, 12.0), (12.0, 18.0) })
            {
                var dot = new Windows.UI.Xaml.Shapes.Ellipse { Width = 3, Height = 3, Fill = Res("PlayarrSurfaceStrong"), Stroke = ink, StrokeThickness = 1.5 };
                Windows.UI.Xaml.Controls.Canvas.SetLeft(dot, cx - 1.5);
                Windows.UI.Xaml.Controls.Canvas.SetTop(dot, cy - 1.5);
                icon.Children.Add(dot);
            }

            return icon;
        }

        private static Geometry Rails()
        {
            var group = new GeometryGroup();
            foreach (var (x1, x2, y) in new[] { (4.0, 20.0, 6.0), (7.0, 17.0, 12.0), (10.0, 14.0, 18.0) })
            {
                group.Children.Add(new LineGeometry { StartPoint = new Windows.Foundation.Point(x1, y), EndPoint = new Windows.Foundation.Point(x2, y) });
            }

            return group;
        }

        /// <summary>Shell action column tile (web .tv-filter-launcher look): 58x70 at the right edge, icon over a 9 px label.</summary>
        public static Button ActionTile(FrameworkElement icon, string label, double top, Action onClick)
        {
            var tile = new StackPanel { Spacing = 5.6 };
            tile.Children.Add(icon);
            tile.Children.Add(new TextBlock { Text = label, FontSize = 8.26, FontWeight = FontWeights.Bold, CharacterSpacing = 20, Foreground = Res("PlayarrInkMuted"), HorizontalAlignment = HorizontalAlignment.Center });
            var button = new Button
            {
                Width = 62, Height = 72, Margin = new Thickness(0, top, 12.47, 0), Padding = new Thickness(0), CornerRadius = new CornerRadius(14),
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
                Background = Res("PlayarrSurfaceStrong"), BorderBrush = Res("PlayarrLine"), BorderThickness = new Thickness(1),
                Content = tile,
                FocusVisualPrimaryBrush = Theme.FocusRing, FocusVisualPrimaryThickness = new Thickness(3), FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            LayoutExport.Named(button, label);
            return button;
        }

        /// <summary>A pill action button (web header controls and action pills).</summary>
        public static Button Pill(string text, Action? onClick, double minWidth = 0)
        {
            var button = new Button
            {
                MinWidth = minWidth,
                Height = 50,
                Padding = new Thickness(20, 0, 20, 0),
                CornerRadius = new CornerRadius(25),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderBrush = Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Content = Text(text, 12, FontWeights.SemiBold, "PlayarrInk"),
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            if (onClick != null)
            {
                button.Click += (s, e) => onClick();
            }

            // The web's pills are fully round, whatever their height.
            button.SizeChanged += (s, e) => button.CornerRadius = new CornerRadius(e.NewSize.Height / 2);
            return button;
        }

        /// <summary>The detail page's secondary pill: a faint ink-tinted fill and no outline, as the web draws it.</summary>
        public static Button Filled(Button pill)
        {
            pill.Background = new SolidColorBrush(Theme.IsLight ? Windows.UI.Color.FromArgb(235, 255, 255, 255) : Windows.UI.Color.FromArgb(4, 255, 255, 255));
            pill.BorderThickness = new Thickness(0);
            return pill;
        }

        /// <summary>The web action pill's brand-pink leading glyph ahead of the label (the pill's text stays settable).</summary>
        public static Button WithIcon(Button pill, string glyph, string brushKey = "PlayarrBrandInk", string? accessibleName = null)
        {
            var label = (TextBlock)pill.Content;
            label.FontSize = 11.14;
            WebFont.Apply(label, 700);
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8.8 };
            row.Children.Add(Text(glyph, 12.81, FontWeights.Normal, brushKey));
            row.Children.Add(label);
            Windows.UI.Xaml.Automation.AutomationProperties.SetName(pill, accessibleName ?? label.Text);
            pill.Content = row;
            return pill;
        }

        public static void SetPillText(Button pill, string text) =>
            (pill.Content is StackPanel { Children: { Count: 2 } parts } ? (TextBlock)parts[1] : (TextBlock)pill.Content).Text = text;

        /// <summary>A small outlined status pill ("Available", "Missing"); <paramref name="web"/> is the calendar week's larger one with a tinted fill and ink text.</summary>
        public static Border StatusPill(string text, Color color, bool web = false) => new Border
        {
            Padding = web ? new Thickness(14, 3, 14, 4) : new Thickness(7, 1, 7, 2),
            CornerRadius = new CornerRadius(web ? 13 : 9),
            BorderBrush = new SolidColorBrush(web ? Color.FromArgb(0xB0, color.R, color.G, color.B) : color),
            Background = web ? new SolidColorBrush(Color.FromArgb(0x2E, color.R, color.G, color.B)) : null,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = new TextBlock { Text = text, FontSize = web ? 13.44 : 9, FontFamily = WebFont.Face(web ? 750 : 600), FontWeight = WebFont.Weight(web ? 750 : 600), LineHeight = web ? 19 : 0, LineStackingStrategy = web ? LineStackingStrategy.BlockLineHeight : LineStackingStrategy.MaxHeight, Foreground = web ? Res("PlayarrInk") : new SolidColorBrush(color) },
        };
    }
}
