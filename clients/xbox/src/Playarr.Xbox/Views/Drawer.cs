using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The one right-side panel for every page (owner rule: one shared Drawer and its close button): full height from
    /// the first frame, 360 px wide at 1920x1080, eyebrow, title, round Close, then the body. Focus moves into the
    /// drawer and returns to the control that opened it; BACK closes it (<see cref="TryCloseCurrent"/>).
    /// </summary>
    internal sealed class Drawer
    {
        private const double Width = 360;

        private readonly Panel _host;
        private readonly Grid _overlay;
        private readonly Control? _opener;

        /// <summary>The drawer's title ("Filters", a title's name for card actions); read by the parity trace.</summary>
        public string Title { get; }

        private Drawer(Panel host, string eyebrow, string title, UIElement body)
        {
            _host = host;
            Title = title;
            _opener = FocusManager.GetFocusedElement() as Control;

            var panel = new Grid
            {
                Width = Width,
                HorizontalAlignment = HorizontalAlignment.Right,
                Background = Ui.Res("PlayarrSurfaceStrong"),
                BorderBrush = Ui.Res("PlayarrLine"),
                BorderThickness = new Thickness(1, 0, 0, 0),
                Padding = new Thickness(46, 54, 46, 40),
                XYFocusKeyboardNavigation = XYFocusKeyboardNavigationMode.Enabled,
                TabFocusNavigation = KeyboardNavigationMode.Cycle,
            };
            var header = new StackPanel { Margin = new Thickness(0, 0, 56, 0), VerticalAlignment = VerticalAlignment.Top };
            var eyebrowText = Ui.Text(eyebrow.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft");
            eyebrowText.CharacterSpacing = 120;
            header.Children.Add(eyebrowText);
            var titleText = Ui.Text(title, 34, FontWeights.Bold, "PlayarrInk", new Thickness(0, 10, 0, 0));
            titleText.TextWrapping = TextWrapping.WrapWholeWords;
            titleText.LineHeight = 57;
            titleText.MaxLines = 3;
            header.Children.Add(titleText);
            panel.Children.Add(header);

            var close = Ui.RoundButton("", Close);
            close.Width = close.Height = 46;
            ((FontIcon)close.Content).Glyph = "\uE8BB"; // ChromeClose: the web's bold X
            ((FontIcon)close.Content).FontSize = 13;
            close.CornerRadius = new CornerRadius(23);
            close.Background = Ui.Res("PlayarrSurfaceSoft");
            close.BorderThickness = new Thickness(0);
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.VerticalAlignment = VerticalAlignment.Top;
            close.Margin = new Thickness(0, -20, -22, 0);
            panel.Children.Add(close);

            var scroller = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
            var bodyHost = new Grid { Margin = new Thickness(0, 0, 0, 0) };
            bodyHost.Children.Add(scroller);
            header.SizeChanged += (s, e) => bodyHost.Margin = new Thickness(0, e.NewSize.Height + 28, 0, 0);
            panel.Children.Add(bodyHost);

            _overlay = new Grid();
            // A click outside the panel closes it, like the web scrim.
            var outside = new Grid { Background = new SolidColorBrush(Color.FromArgb(0x01, 0, 0, 0)) };
            outside.Tapped += (s, e) => Close();
            _overlay.Children.Add(outside);
            _overlay.Children.Add(panel);
            Grid.SetRowSpan(_overlay, 99);
            Grid.SetColumnSpan(_overlay, 99);
            host.Children.Add(_overlay);
            panel.Loaded += (s, e) =>
            {
                var first = FocusManager.FindFirstFocusableElement(scroller) as Control;
                (first ?? close).Focus(FocusState.Keyboard);
            };
        }

        public static Drawer? Current { get; private set; }

        public static Drawer Open(Panel host, string eyebrow, string title, UIElement body)
        {
            Current?.Close();
            Current = new Drawer(host, eyebrow, title, body);
            return Current;
        }

        /// <summary>BACK closes the open drawer first.</summary>
        public static bool TryCloseCurrent()
        {
            if (Current == null)
            {
                return false;
            }

            Current.Close();
            return true;
        }

        public void Close()
        {
            _host.Children.Remove(_overlay);
            if (Current == this)
            {
                Current = null;
            }

            _opener?.Focus(FocusState.Programmatic);
        }

        /// <summary>The web's unselected chip: a faint ink tint on the panel (about 7 % light, 4 % dark), not a transparent outline.</summary>
        private static Brush RestingChip()
        {
            var ink = ((SolidColorBrush)Ui.Res("PlayarrInk")).Color;
            return new SolidColorBrush(Color.FromArgb((byte)(Theme.IsLight ? 19 : 10), ink.R, ink.G, ink.B));
        }

        /// <summary>A labelled group ("SORT BY") with segmented options, the selected one filled like the web.</summary>
        public static StackPanel Segmented(string label, string[] options, int selected, Action<int> onSelect, string? automationIdPrefix = null)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var caption = Ui.Text(label.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft", new Thickness(0, 0, 0, 10));
            caption.CharacterSpacing = 120;
            group.Children.Add(caption);
            // More than four options wrap onto a second row so every label keeps room (5 options: 3 + 2).
            var perRow = options.Length > 4 ? (options.Length + 1) / 2 : options.Length;
            var row = new Grid { ColumnSpacing = 6, RowSpacing = 6 };
            for (var c = 0; c < perRow; c++)
            {
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            for (var r = 0; r < (options.Length + perRow - 1) / perRow; r++)
            {
                row.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            for (var i = 0; i < options.Length; i++)
            {
                var index = i;
                var isSelected = i == selected;
                var button = new Button
                {
                    Height = 56,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(6),
                    Background = isSelected ? Ui.Res("PlayarrInk") : RestingChip(),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = new TextBlock
                    {
                        Text = options[i],
                        FontSize = 10.5,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = isSelected ? Ui.Res("PlayarrSurfaceStrong") : Ui.Res("PlayarrInkSoft"),
                    },
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                if (!string.IsNullOrWhiteSpace(automationIdPrefix))
                {
                    AutomationProperties.SetAutomationId(button, $"{automationIdPrefix}.{i}");
                }

                button.Click += (s, e) => onSelect(index);
                Grid.SetColumn(button, i % perRow);
                Grid.SetRow(button, i / perRow);
                row.Children.Add(button);
            }

            group.Children.Add(row);
            return group;
        }

        /// <summary>A labelled select as a vertical list (many or long options), the selected row filled.</summary>
        public static StackPanel Choice(string label, string[] options, int selected, Action<int> onSelect)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var caption = Ui.Text(label.ToUpperInvariant(), 9, FontWeights.Bold, "PlayarrInkSoft", new Thickness(0, 0, 0, 10));
            caption.CharacterSpacing = 120;
            group.Children.Add(caption);
            for (var i = 0; i < options.Length; i++)
            {
                var index = i;
                var isSelected = i == selected;
                var button = new Button
                {
                    Height = 46,
                    Margin = new Thickness(0, 0, 0, 6),
                    Padding = new Thickness(18, 0, 16, 0),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    CornerRadius = new CornerRadius(6),
                    Background = isSelected ? Ui.Res("PlayarrInk") : new SolidColorBrush(Colors.Transparent),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = new TextBlock
                    {
                        Text = options[i],
                        FontSize = 12,
                        FontWeight = FontWeights.SemiBold,
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        Foreground = isSelected ? Ui.Res("PlayarrSurfaceStrong") : Ui.Res("PlayarrInkSoft"),
                    },
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                button.Click += (s, e) => onSelect(index);
                group.Children.Add(button);
            }

            return group;
        }

        /// <summary>An action row ("Play", "Mark as Watched"): icon in brand pink and label, as the web actions panel.</summary>
        public static Button Action(string glyph, string label, Action onClick)
        {
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
            content.Children.Add(new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 16, Foreground = Ui.Res("PlayarrBrand") });
            content.Children.Add(Ui.Text(label, 19, FontWeights.Bold, "PlayarrInk"));
            var button = new Button
            {
                Height = 68,
                Margin = new Thickness(0, 0, 0, 14),
                Padding = new Thickness(26, 0, 16, 0),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(12),
                Background = Ui.Res("PlayarrSurfaceSoft"),
                BorderThickness = new Thickness(0),
                Content = content,
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            return button;
        }
    }
}
