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
                Padding = new Thickness(45, 54, 46, 40),
                XYFocusKeyboardNavigation = XYFocusKeyboardNavigationMode.Enabled,
                TabFocusNavigation = KeyboardNavigationMode.Cycle,
            };
            var header = new StackPanel { Margin = new Thickness(0), VerticalAlignment = VerticalAlignment.Top };
            var eyebrowText = Ui.Text(eyebrow.ToUpperInvariant(), 9.6, new FontWeight { Weight = 720 }, "PlayarrInkMuted");
            eyebrowText.CharacterSpacing = 120;
            header.Children.Add(eyebrowText);
            var titleText = Ui.Text(title, 38.4, new FontWeight { Weight = 590 }, "PlayarrInk", new Thickness(0, 6, 0, 0));
            LayoutExport.SetRole(titleText, "heading");
            titleText.TextWrapping = TextWrapping.WrapWholeWords;
            titleText.LineHeight = 57.6;
            titleText.LineStackingStrategy = LineStackingStrategy.BaselineToBaseline;
            titleText.MaxLines = 3;
            header.Children.Add(titleText);
            panel.Children.Add(header);

            var close = Ui.RoundButton("", Close);
            close.Width = 48;
            close.CornerRadius = new CornerRadius(24);
            close.Height = 50;
            close.Content = new TextBlock { Text = "\u00d7", FontSize = 26.88, FontFamily = WebFont.Face(720), FontWeight = WebFont.Weight(720), LineHeight = 36, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, Foreground = Ui.Res("PlayarrInk"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            LayoutExport.Tag(close, "button", eyebrow == "Title actions" ? "Close" : "Close filters"); // the web labels every drawer's close this way
            LayoutExport.SetSplit(close, true);
            close.Background = Ui.Res("PlayarrSurfaceStrong");
            close.HorizontalAlignment = HorizontalAlignment.Right;
            close.VerticalAlignment = VerticalAlignment.Top;
            close.Margin = new Thickness(0);
            panel.Children.Add(close);

            var scroller = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden };
            var bodyHost = new Grid { Margin = new Thickness(0, 0, 0, 0) };
            bodyHost.Children.Add(scroller);
            header.SizeChanged += (s, e) => bodyHost.Margin = new Thickness(0, e.NewSize.Height + 36.9, 0, 0);
            panel.Children.Add(bodyHost);

            LayoutExport.SetRole(panel, "dialog");
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
                // The web opens the Filters panel with its Close button focused; action drawers focus their first row.
                var first = title == "Filters" ? null : FocusManager.FindFirstFocusableElement(scroller) as Control;
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
        private static Brush RestingChip(bool drawer = true)
        {
            var ink = ((SolidColorBrush)Ui.Res("PlayarrInk")).Color;
            // The Settings page's segments sit on the page surface, the drawer's on its own panel: the web tints them differently.
            var alpha = Theme.IsLight ? (drawer ? 27 : 24) : (drawer ? 12 : 16);
            return new SolidColorBrush(Color.FromArgb((byte)alpha, ink.R, ink.G, ink.B));
        }

        /// <summary>The web's view glyph (<c>.tv-view-icon</c>): three outlined boxes, 20 by 13 px (16 wide for Cover), 2 px apart.</summary>
        private static FrameworkElement ViewIcon(string kind, Brush brush)
        {
            var width = kind == "cover" ? 16.0 : 20.0;
            var canvas = new Canvas { Width = width, Height = 13 };
            for (var n = 0; n < 3; n++)
            {
                var box = kind == "list"
                    ? new Border { Width = width, Height = 3 }
                    : new Border { Width = (width - 4) / 3, Height = 13 };
                box.BorderBrush = brush;
                box.BorderThickness = new Thickness(1);
                box.CornerRadius = new CornerRadius(1);
                Canvas.SetLeft(box, kind == "list" ? 0 : n * ((width - 4) / 3 + 2));
                Canvas.SetTop(box, kind == "list" ? n * 5 : 0);
                canvas.Children.Add(box);
            }

            return canvas;
        }

        /// <summary>A labelled group ("SORT BY") with segmented options, the selected one filled like the web.</summary>
        public static StackPanel Segmented(string label, string[] options, int selected, Action<int> onSelect, string? automationIdPrefix = null, string[]? icons = null)
        {
            // A labelled group is a drawer's (web filter section); the unlabelled one is the Settings page's own control.
            var drawer = label.Length > 0;
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, drawer ? 28.8 : 24) };
            var caption = LayoutExport.Tag(Ui.Text(label.ToUpperInvariant(), 9.6, new FontWeight { Weight = 720 }, "PlayarrInkMuted", new Thickness(0, 0, 0, drawer ? 14 : 10)), "heading");
            caption.CharacterSpacing = 120;
            if (drawer)
            {
                group.Children.Add(caption);
            }

            // More than four options wrap onto a second row so every label keeps room (5 options: 3 + 2).
            var perRow = options.Length > 4 ? (options.Length + 1) / 2 : options.Length;
            var row = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
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
                var tint = isSelected ? Ui.Res("PlayarrBg") : Ui.Res("PlayarrInkMuted");
                var labelText = new TextBlock { Text = options[i], FontSize = 10.56, Foreground = tint, HorizontalAlignment = HorizontalAlignment.Center };
                // The sort and order chips are their own text (680); the view chips and the Settings segments carry a box and a 900 label.
                WebFont.Apply(labelText, icons != null || !drawer ? 900 : 680);
                UIElement content = labelText;
                if (icons != null && i < icons.Length)
                {
                    var stack = new StackPanel { Spacing = 5.8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
                    var viewIcon = ViewIcon(icons[i], tint);
                    viewIcon.Margin = new Thickness(0, 1.8, 0, 0);
                    stack.Children.Add(viewIcon);
                    stack.Children.Add(labelText);
                    content = stack;
                }

                var button = new Button
                {
                    Height = 56,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(12),
                    Background = isSelected ? Ui.Res("PlayarrInk") : RestingChip(drawer),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = content,
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                if (isSelected)
                {
                    // The web scales the active choice by 1.025.
                    button.RenderTransform = new ScaleTransform { ScaleX = 1.025, ScaleY = 1.025 };
                    button.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
                }

                LayoutExport.Tag(button, "button", options[i]);
                // The Settings page's segments are a box with a separate label (web), the drawer's are their own text.
                LayoutExport.SetSplit(button, true);
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

        /// <summary>The language's name as the web shows it (<c>languageDisplayName</c>): the culture's display name, else the server's name, else the upper-cased code.</summary>
        public static string LanguageLabel(string code, string? fallbackName = null)
        {
            try
            {
                var name = new System.Globalization.CultureInfo(code).DisplayName;
                if (!string.IsNullOrEmpty(name) && !string.Equals(name, code, StringComparison.OrdinalIgnoreCase))
                {
                    return name;
                }
            }
            catch (System.Globalization.CultureNotFoundException)
            {
            }

            return string.IsNullOrEmpty(fallbackName) ? code.ToUpperInvariant() : fallbackName!;
        }

        /// <summary>
        /// The web's language select: a tinted box showing the current choice and a chevron; Enter lists "Any language" and
        /// the languages <paramref name="load"/> returns in a flyout. Each language toggles in <paramref name="onSelect"/>
        /// (several per type, as on the web); the ones in <paramref name="selected"/> are ticked.
        /// </summary>
        public static StackPanel Dropdown(string label, string current, Func<System.Threading.Tasks.Task<System.Collections.Generic.IList<Playarr.Core.Models.LanguageFacet>>> load, Action<string?> onSelect, System.Collections.Generic.ICollection<string> selected)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 30) };
            var caption = LayoutExport.Tag(Ui.Text(label.ToUpperInvariant(), 9.6, new FontWeight { Weight = 720 }, "PlayarrInkMuted", new Thickness(0, 0, 0, 14)), "heading");
            caption.CharacterSpacing = 120;
            group.Children.Add(caption);
            var content = new Grid();
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var currentText = Ui.Text(current, 11.84, new FontWeight { Weight = 680 }, "PlayarrInk");
            currentText.VerticalAlignment = VerticalAlignment.Center;
            content.Children.Add(currentText);
            var chevron = new TextBlock { Text = "\u2304", FontSize = 11.84, FontWeight = new FontWeight { Weight = 680 }, VerticalAlignment = VerticalAlignment.Center, Foreground = Ui.Res("PlayarrInkMuted") };
            Grid.SetColumn(chevron, 1);
            content.Children.Add(chevron);
            var button = new Button
            {
                Height = 44,
                Margin = new Thickness(6.39),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Padding = new Thickness(12, 0, 12, 0),
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderThickness = new Thickness(0),
                Content = content,
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += async (s, e) =>
            {
                var flyout = new MenuFlyout();
                var any = new MenuFlyoutItem { Text = "Any language" };
                any.Click += (a, b) => onSelect(null);
                flyout.Items.Add(any);
                try
                {
                    foreach (var facet in await load())
                    {
                        var code = facet.Code;
                        var item = new ToggleMenuFlyoutItem { Text = LanguageLabel(code, facet.Name), IsChecked = selected.Contains(code) };
                        item.Click += (a, b) => onSelect(code);
                        flyout.Items.Add(item);
                    }
                }
                catch (Exception)
                {
                    // Only "Any language" is offered when the facets cannot load.
                }

                flyout.ShowAt(button);
            };
            LayoutExport.Tag(button, "button", current + " \u2304");
            LayoutExport.SetSplit(button, true);
            var frame = new Border
            {
                CornerRadius = new CornerRadius(12),
                Background = RestingChip(),
                BorderBrush = Ui.Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Child = button,
            };
            LayoutExport.Tag(frame, "group", label);
            group.Children.Add(frame);
            return group;
        }

        /// <summary>A labelled select as a vertical list (many or long options), the selected row filled.</summary>
        public static StackPanel Choice(string label, string[] options, int selected, Action<int> onSelect)
        {
            var group = new StackPanel { Margin = new Thickness(0, 0, 0, 24) };
            var caption = LayoutExport.Tag(Ui.Text(label.ToUpperInvariant(), 9.6, new FontWeight { Weight = 720 }, "PlayarrInkMuted", new Thickness(0, 0, 0, 10)), "heading");
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
            // The web draws the row's glyph as text in the brand colour, 42 px before the label.
            var content = new Grid();
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(42) });
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var icon = new TextBlock { Text = glyph, FontSize = 19.52, Foreground = Ui.Res("PlayarrBrand"), VerticalAlignment = VerticalAlignment.Center };
            if (glyph.Length > 0 && glyph[0] >= '\ue000')
            {
                icon.FontFamily = new FontFamily("Segoe MDL2 Assets"); // the app's own rows keep their icon-font glyphs
            }
            content.Children.Add(icon);
            var text = Ui.Text(label, 19.2, new FontWeight { Weight = 700 }, "PlayarrInk");
            Grid.SetColumn(text, 1);
            content.Children.Add(text);
            var button = new Button
            {
                Height = 68,
                Margin = new Thickness(0, 0, 0, 14),
                Padding = new Thickness(18, 0, 16, 0),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(14),
                Background = Ui.Res("PlayarrSurfaceSoft"),
                BorderThickness = new Thickness(0),
                Content = content,
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            button.Click += (s, e) => onClick();
            LayoutExport.Tag(button, "button", glyph + " " + label);
            LayoutExport.SetSplit(button, true);
            return button;
        }
    }
}
