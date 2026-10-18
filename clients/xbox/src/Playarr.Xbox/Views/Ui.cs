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
        public static Brush Res(string key) => (Brush)Application.Current.Resources[key];

        public static TextBlock Text(string text, double size, FontWeight weight, string brushKey, Thickness margin = default) =>
            new TextBlock { Text = text, FontSize = size, FontWeight = weight, Foreground = Res(brushKey), Margin = margin };

        /// <summary>The web page header: round Back button, title and an optional pink count line, at the shell content edge.</summary>
        public static void PageHeader(Panel host, string title, string? subtitle, Action back)
        {
            host.Children.Add(BackButton(back));
            var titles = new StackPanel { Margin = new Thickness(228, 57, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            LayoutHeader(titles, new TextBlock { Text = title, Style = (Style)Application.Current.Resources["PlayarrPageTitle"] }, new TextBlock { Text = subtitle ?? string.Empty });
            host.Children.Add(titles);
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
            subtitle.FontSize = 11;
            subtitle.FontWeight = FontWeights.Bold;
            subtitle.CharacterSpacing = 45; // web: 0.045em
            subtitle.Foreground = Res("PlayarrInk");
            if (string.IsNullOrEmpty(subtitle.Text))
            {
                titles.Children.Add(title);
                return;
            }

            title.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            subtitle.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            if (title.DesiredSize.Width + 25 + subtitle.DesiredSize.Width <= 250)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal };
                subtitle.VerticalAlignment = VerticalAlignment.Center;
                subtitle.Margin = new Thickness(0, 6, 0, 0);
                row.Children.Add(title);
                row.Children.Add(new Border { Width = 1, Height = 16, Margin = new Thickness(12, 8, 12, 0), Background = Res("PlayarrLineStrong"), VerticalAlignment = VerticalAlignment.Center });
                row.Children.Add(subtitle);
                titles.Children.Add(row);
            }
            else
            {
                subtitle.Margin = new Thickness(0, 6, 0, 0);
                titles.Children.Add(title);
                titles.Children.Add(new Border { Height = 1, Background = Res("PlayarrLineStrong"), Margin = new Thickness(0, 6, 0, 0) });
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
            button.Margin = new Thickness(154, 56, 0, 0);
            button.HorizontalAlignment = HorizontalAlignment.Left;
            button.VerticalAlignment = VerticalAlignment.Top;
            return button;
        }

        public static Button RoundButton(string glyph, Action onClick)
        {
            var button = new Button
            {
                Width = 50,
                Height = 50,
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(25),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderBrush = Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Content = new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 14 },
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            return button;
        }

        /// <summary>The web's three-slider Filters icon (one drawing for every page's Filters tile).</summary>
        public static FrameworkElement FiltersIcon()
        {
            var ink = Res("PlayarrInk");
            var icon = new Windows.UI.Xaml.Controls.Canvas { Width = 16, Height = 16, HorizontalAlignment = HorizontalAlignment.Center };
            icon.Children.Add(new Windows.UI.Xaml.Shapes.Path { Stroke = ink, StrokeThickness = 1.4, Data = Rails() });
            foreach (var (x, y) in new[] { (2, 1), (10, 6), (5, 11) })
            {
                var dot = new Windows.UI.Xaml.Shapes.Ellipse { Width = 4, Height = 4, Fill = ink };
                Windows.UI.Xaml.Controls.Canvas.SetLeft(dot, x);
                Windows.UI.Xaml.Controls.Canvas.SetTop(dot, y);
                icon.Children.Add(dot);
            }

            return icon;
        }

        private static Geometry Rails()
        {
            var group = new GeometryGroup();
            foreach (var y in new[] { 3.0, 8.0, 13.0 })
            {
                group.Children.Add(new LineGeometry { StartPoint = new Windows.Foundation.Point(1, y), EndPoint = new Windows.Foundation.Point(15, y) });
            }

            return group;
        }

        /// <summary>Shell action column tile (web .tv-filter-launcher look): 58x70 at the right edge, icon over a 9 px label.</summary>
        public static Button ActionTile(FrameworkElement icon, string label, double top, Action onClick)
        {
            var tile = new StackPanel { Spacing = 8 };
            tile.Children.Add(icon);
            tile.Children.Add(new TextBlock { Text = label, FontSize = 9, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
            var button = new Button
            {
                Width = 58, Height = 70, Margin = new Thickness(0, top, 14, 0), Padding = new Thickness(0), CornerRadius = new CornerRadius(12),
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
                Background = Res("PlayarrSurface"), BorderBrush = Res("PlayarrLine"), BorderThickness = new Thickness(1),
                Content = tile,
                FocusVisualPrimaryBrush = Theme.FocusRing, FocusVisualPrimaryThickness = new Thickness(3), FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
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

            return button;
        }

        /// <summary>The detail page's secondary pill: a faint ink-tinted fill and no outline, as the web draws it.</summary>
        public static Button Filled(Button pill)
        {
            pill.Background = new SolidColorBrush(Theme.IsLight ? Windows.UI.Color.FromArgb(235, 255, 255, 255) : Windows.UI.Color.FromArgb(15, 255, 255, 255));
            pill.BorderThickness = new Thickness(0);
            return pill;
        }

        public static void SetPillText(Button pill, string text) => ((TextBlock)pill.Content).Text = text;

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
            Child = new TextBlock { Text = text, FontSize = web ? 12.7 : 9, FontWeight = web ? FontWeights.Bold : FontWeights.SemiBold, Foreground = web ? Res("PlayarrInk") : new SolidColorBrush(color) },
        };
    }
}
