using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Localization;
using Playarr.Core.Models;
using Playarr.Core.Navigation;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web TV app shell drawn over the root frame: the left nav rail (logo, grouped pills, profile, version)
    /// and the clock. Geometry is measured from the web TV layout at 1920x1080 (effective pixels).
    /// Pages leave <see cref="ContentLeft"/> free on the left. Hidden on sign-in, profile picker and player.
    /// </summary>
    internal sealed class ShellChrome
    {
        /// <summary>Left edge of page content (the web page header starts here).</summary>
        public const double ContentLeft = 154;

        private const double RailLeft = 42;
        private const double RailWidth = 78;
        private const double ItemHeight = 72;

        private readonly Frame _frame;
        private readonly Grid _chrome = new Grid { IsHitTestVisible = true };
        private readonly List<(Button Button, Type Page, WorkKind? Kind)> _items = new List<(Button, Type, WorkKind?)>();
        private readonly TextBlock _time = new TextBlock { FontSize = 18, FontWeight = FontWeights.Bold };
        private readonly TextBlock _date = new TextBlock { FontSize = 12.5, FontWeight = FontWeights.SemiBold, CharacterSpacing = 60, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _profileName = new TextBlock { FontSize = 10, FontWeight = FontWeights.Medium, Foreground = (Brush)Application.Current.Resources["PlayarrInkMuted"], HorizontalAlignment = HorizontalAlignment.Center };
        private readonly List<(TextBlock Label, string Key)> _labels = new List<(TextBlock, string)>();
        private Border _avatar = null!;
        private bool _avatarLoaded;
        private readonly DispatcherTimer _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };

        public ShellChrome(Frame frame)
        {
            _frame = frame;
            Instance = this;
            // The remote's D-pad is a gamepad on Xbox, but a keyboard (and the device-wall tests) must move focus the
            // same way: arrow keys move focus spatially across the nav rail, rails and grids, not only inside a list.
            Root = new Grid { XYFocusKeyboardNavigation = Windows.UI.Xaml.Input.XYFocusKeyboardNavigationMode.Enabled };
            Root.PreviewKeyDown += EnterRailLevel;
            Root.Children.Add(frame);
            Root.Children.Add(_chrome);
            Build();
            _frame.Navigated += (s, e) => Sync(e);
            _clockTimer.Tick += (s, e) => UpdateClock();
            _clockTimer.Start();
            UpdateClock();
        }

        public Grid Root { get; }

        /// <summary>The one shell, so a language change can relabel the rail in place.</summary>
        public static ShellChrome? Instance { get; private set; }

        /// <summary>Rewrites the rail labels (and the profile fallback) in the current language.</summary>
        public void Relabel()
        {
            foreach (var (label, key) in _labels)
            {
                label.Text = Lang.T("shell.nav." + key.ToLowerInvariant());
            }

            _profileName.Text = string.IsNullOrEmpty(ProfileName) ? "Profile" : ProfileName.Split(' ')[0];
        }

        /// <summary>
        /// LEFT out of the content lands on the rail item level with the focused card, as the web does (XYFocus alone
        /// picks the item with the largest edge overlap, which is a different one for a tall card).
        /// </summary>
        private void EnterRailLevel(object sender, Windows.UI.Xaml.Input.KeyRoutedEventArgs e)
        {
            if (e.Key != Windows.System.VirtualKey.Left && e.Key != Windows.System.VirtualKey.GamepadDPadLeft)
            {
                return;
            }

            if (!(Windows.UI.Xaml.Input.FocusManager.GetFocusedElement() is FrameworkElement source) || IsRailItem(source))
            {
                return;
            }

            var target = Windows.UI.Xaml.Input.FocusManager.FindNextElement(Windows.UI.Xaml.Input.FocusNavigationDirection.Left);
            if (!(target is FrameworkElement to) || !IsRailItem(to))
            {
                return;
            }

            FocusRect Rect(FrameworkElement el)
            {
                var origin = el.TransformToVisual(null).TransformPoint(new Windows.Foundation.Point(0, 0));
                return new FocusRect(origin.X, origin.Y, el.ActualWidth, el.ActualHeight);
            }

            var candidates = new System.Collections.Generic.List<Button>();
            foreach (var (button, page, _) in _items)
            {
                if (page != typeof(object))
                {
                    candidates.Add(button);
                }
            }

            var sourceRect = Rect(source);
            var targetIndex = DirectionalFocus.Best(sourceRect, candidates.Select(Rect).ToArray(), left: true);
            if (targetIndex >= 0 && candidates[targetIndex].Focus(FocusState.Keyboard))
            {
                e.Handled = true;
            }
        }

        private bool IsRailItem(FrameworkElement el) => _items.Any(i => ReferenceEquals(i.Button, el));

        /// <summary>Label under the profile avatar (the active profile's display name).</summary>
        public static string ProfileName { get; set; } = string.Empty;

        private void Build()
        {
            _chrome.Children.Add(new Image
            {
                Source = new BitmapImage(new Uri("ms-appx:///Assets/PlayarrIcon.png")),
                Width = 42,
                Height = 42,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft + (RailWidth - 42) / 2, 59, 0, 0),
            });

            var groups = new StackPanel
            {
                Spacing = 16,
                Width = RailWidth,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft, 118, 0, 0),
            };
            groups.Children.Add(Group(Item("Downloads", typeof(DownloadsPage), null), Item("Search", typeof(SearchPage), null)));
            groups.Children.Add(Group(
                Item("Home", typeof(HomePage), null),
                Item("Series", typeof(LibraryPage), WorkKind.Series),
                Item("Movies", typeof(LibraryPage), WorkKind.Movie),
                Item("Music", typeof(LibraryPage), WorkKind.Artist)));
            groups.Children.Add(Group(
                Item("Playlists", typeof(PlaylistsPage), null),
                Item("Watchlist", typeof(WatchlistPage), null),
                Item("Requests", typeof(RequestsPage), null),
                Item("Calendar", typeof(CalendarPage), null)));
            _chrome.Children.Add(groups);

            _avatar = new Border
            {
                Width = 24,
                Height = 24,
                CornerRadius = new CornerRadius(12),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            var avatar = _avatar;
            var profileContent = new StackPanel { Spacing = 6 };
            profileContent.Children.Add(avatar);
            profileContent.Children.Add(_profileName);
            var profile = RailButton(profileContent, typeof(SettingsPage), null);
            var profileGroup = Group(profile);
            profileGroup.VerticalAlignment = VerticalAlignment.Top;
            profileGroup.HorizontalAlignment = HorizontalAlignment.Left;
            profileGroup.Margin = new Thickness(RailLeft, 952, 0, 0);
            _chrome.Children.Add(profileGroup);

            _chrome.Children.Add(new TextBlock
            {
                Text = "v" + typeof(App).Assembly.GetName().Version.ToString(3),
                FontFamily = (FontFamily)Application.Current.Resources["PlayarrMonoFont"],
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                Width = RailWidth,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(RailLeft, 1034, 0, 0),
            });

            var clock = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 11,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(478, 67, 0, 0),
                IsHitTestVisible = false,
            };
            clock.Children.Add(_time);
            clock.Children.Add(_date);
            _chrome.Children.Add(clock);
        }

        private static Border Group(params Button[] items)
        {
            var stack = new StackPanel();
            foreach (var item in items)
            {
                stack.Children.Add(item);
            }

            return new Border
            {
                Child = stack,
                Width = RailWidth,
                Padding = new Thickness(4),
                CornerRadius = new CornerRadius(24),
                Background = (Brush)Application.Current.Resources["PlayarrSurface"],
                BorderBrush = (Brush)Application.Current.Resources["PlayarrLine"],
                BorderThickness = new Thickness(1),
            };
        }

        private Button Item(string label, Type? page, WorkKind? kind)
        {
            var content = new StackPanel { Spacing = 6 };
            content.Children.Add(NavIcons.Create(label, (Brush)Application.Current.Resources["PlayarrInkMuted"]));
            var text = new TextBlock { Text = Lang.T("shell.nav." + label.ToLowerInvariant()), FontSize = 10, FontWeight = FontWeights.Medium, Foreground = (Brush)Application.Current.Resources["PlayarrInkMuted"], HorizontalAlignment = HorizontalAlignment.Center };
            _labels.Add((text, label));
            content.Children.Add(text);
            return RailButton(content, page, kind);
        }

        /// <summary>The web tints the current item with the page ink and the others with the muted ink.</summary>
        private static void Tint(Button button, bool current)
        {
            if (!(button.Content is StackPanel { Children: { Count: 2 } children }) || !(children[0] is Viewbox { Child: Canvas canvas }) || !(children[1] is TextBlock label))
            {
                return;
            }

            var brush = (Brush)Application.Current.Resources[current ? "PlayarrInk" : "PlayarrInkMuted"];
            foreach (var path in canvas.Children.OfType<Windows.UI.Xaml.Shapes.Path>())
            {
                if (path.Stroke != null) { path.Stroke = brush; }
                if (path.Fill != null) { path.Fill = brush; }
            }

            label.Foreground = brush;
        }

        private Button RailButton(UIElement content, Type? page, WorkKind? kind)
        {
            var button = new Button
            {
                Content = content,
                Width = RailWidth - 10,
                Height = ItemHeight - 4,
                Margin = new Thickness(0, 2, 0, 2),
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(18),
                HorizontalContentAlignment = HorizontalAlignment.Center,
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = new SolidColorBrush(Colors.Transparent),
                BorderThickness = new Thickness(0),
                Foreground = (Brush)Application.Current.Resources["PlayarrInk"],
                // Web nav focus (global.css .app-nav-link:focus-visible): outline 0, a 14 % ink fill and scale 1.1, no ring.
                UseSystemFocusVisuals = false,
                RenderTransform = new ScaleTransform { ScaleX = 1, ScaleY = 1 },
                RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
                IsTabStop = page != null,
            };
            button.GotFocus += (s, e) => ShowRailFocus(button, true);
            button.LostFocus += (s, e) => ShowRailFocus(button, false);
            if (page != null)
            {
                button.Click += (s, e) => _frame.Navigate(page, kind);
            }

            button.Tag = "nav:" + _items.Count; // top-to-bottom order, read by the parity trace
            _items.Add((button, page ?? typeof(object), kind));
            return button;
        }

        private readonly HashSet<Button> _current = new HashSet<Button>();

        /// <summary>The focused item takes the web's 14 % ink fill at scale 1.1; the current page keeps its 9 % fill at 1.05.</summary>
        private void ShowRailFocus(Button button, bool focused)
        {
            var ink = ((SolidColorBrush)Application.Current.Resources["PlayarrInk"]).Color;
            var current = _current.Contains(button);
            button.Background = focused
                ? new SolidColorBrush(Color.FromArgb(36, ink.R, ink.G, ink.B))
                : current ? new SolidColorBrush(Color.FromArgb(23, ink.R, ink.G, ink.B)) : new SolidColorBrush(Colors.Transparent);
            var scale = (ScaleTransform)button.RenderTransform;
            scale.ScaleX = scale.ScaleY = focused ? 1.1 : current ? 1.05 : 1;
        }

        private void Sync(NavigationEventArgs e)
        {
            var shell = e.SourcePageType != typeof(LoginPage)
                && e.SourcePageType != typeof(ProfilesPage)
                && e.SourcePageType != typeof(PlayerPage);
            _chrome.Visibility = shell ? Visibility.Visible : Visibility.Collapsed;
            if (shell)
            {
                // A signed-in console listens for phone-remote pairing unless Settings > Phone remote turned it off.
                Services.RemoteHostService.Instance.Apply();
            }

            if (shell && !_avatarLoaded)
            {
                _avatarLoaded = true;
                LoadAvatar();
            }
            // The web shows the first word of the profile name under the avatar.
            _profileName.Text = string.IsNullOrEmpty(ProfileName) ? "Profile" : ProfileName.Split(' ')[0];

            var kind = e.Parameter as WorkKind?;
            foreach (var (button, page, itemKind) in _items)
            {
                var current = page == e.SourcePageType && (page != typeof(LibraryPage) || itemKind == kind);
                if (current) { _current.Add(button); } else { _current.Remove(button); }
                ShowRailFocus(button, button.FocusState != FocusState.Unfocused);
                Tint(button, current);
            }
        }

        private async void LoadAvatar()
        {
            if (await Avatars.CurrentAsync() is { } source)
            {
                _avatar.Background = new ImageBrush { ImageSource = source, Stretch = Stretch.UniformToFill };
            }
            else
            {
                _avatarLoaded = false;
            }
        }

        private void UpdateClock()
        {
            var now = DateTime.Now;
            _time.Text = now.ToString("HH:mm");
            _date.Text = now.ToString("ddd d MMMM").ToUpperInvariant();
        }
    }
}
