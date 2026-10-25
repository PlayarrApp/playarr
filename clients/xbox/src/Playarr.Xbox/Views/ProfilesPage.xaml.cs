using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using Playarr.Core.Localization;
using Windows.UI.Xaml.Shapes;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Profile picker shown right after a successful sign-in (see
    /// <c>Views/LoginPage.xaml.cs</c>, whose <c>SignedIn</c> case now
    /// navigates here instead of straight to <see cref="HomePage"/>) and
    /// reached from nowhere else today.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Structurally follows <c>Views/LoginPage.xaml.cs</c>'s six-point
    /// pattern with one deliberate simplification: picking a profile is a
    /// synchronous, one-shot user action, not an async state machine like
    /// pairing is, so there is no ViewModel state to watch for it and no
    /// one-shot "has navigated" guard field here -- <see cref="ProfileTile_Click"/>
    /// navigates to <see cref="HomePage"/> directly, exactly once per click,
    /// the same way <c>CancelPairingButton_Click</c> forwards straight into
    /// a ViewModel method with no <c>Render()</c> involvement. See
    /// <see cref="ProfilesViewModel"/>'s own remarks for the full reasoning.
    /// </para>
    /// <para>
    /// Profile tiles are plain <see cref="Button"/> controls built in
    /// <see cref="BuildProfileTile"/> from <see cref="ProfilesViewModel.Profiles"/>
    /// -- real focusable controls (not bare <see cref="Image"/>/<see cref="TextBlock"/>),
    /// so UWP's built-in XY gamepad focus navigation can reach each one
    /// directly (unlike <see cref="HomePage"/>/<see cref="LibraryPage"/>'s
    /// tiles, a handful of profiles fits comfortably as plain buttons in a
    /// <see cref="StackPanel"/> without needing a <see cref="GridView"/>/
    /// <see cref="ListView"/>'s virtualization).
    /// </para>
    /// </remarks>
    public sealed partial class ProfilesPage : Page
    {
        private readonly ProfilesViewModel _viewModel;

        public ProfilesPage()
        {
            InitializeComponent();
            LayoutExport.SetShell(Root, true);
            WebFont.Apply(EyebrowText, 820);
            WebFont.Apply(TitleText, 500);
            LayoutExport.SetRole(TitleText, "heading");
            _viewModel = new ProfilesViewModel(App.Environment);
            CardFocus.ReserveFocusRoom(ProfilesScrollViewer);
            BuildTopControls();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See <c>Views/LoginPage.xaml.cs</c>'s type-level remarks
        /// for why this is one unconditional method rather than a
        /// per-property handler.
        /// </summary>
        private void Render()
        {
            LoadingRing.IsActive = _viewModel.IsLoading;
            LoadingRing.Visibility = _viewModel.IsLoading ? Visibility.Visible : Visibility.Collapsed;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            ProfilesScrollViewer.Visibility =
                _viewModel.IsLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            // No per-property diffing -- rebuilt on every notification, same
            // simplicity call as Views/LoginPage.xaml.cs's Render(). Profile
            // counts are small enough that this is cheap.
            ProfilesPanel.Children.Clear();
            _tiles.Clear();
            foreach (var profile in _viewModel.Profiles)
            {
                ProfilesPanel.Children.Add(BuildProfileTile(profile));
            }

            if (!hasError && !_viewModel.IsLoading)
            {
                ProfilesPanel.Children.Add(BuildAddTile());
                // Web starts on the current profile (else the first): the selected look shows from the first frame.
                var start = _tiles.FirstOrDefault(t => t.Actions != null).Owner ?? _tiles.FirstOrDefault().Owner;
                if (start != null)
                {
                    start.Loaded += (s, e) => ((Control)s).Focus(FocusState.Programmatic);
                }
            }
        }

        /// <summary>The web picker shows the profile's avatar plate, not an initial; the letter stays until it loads.</summary>
        private static async void ApplyAvatar(Border avatar)
        {
            if (await Avatars.CurrentAsync() is { } source)
            {
                avatar.Child = null;
                avatar.Background = new Windows.UI.Xaml.Media.ImageBrush { ImageSource = source, Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill };
            }
        }

        // Web .profile-avatar: 244 px circle; the selected tile lifts 8 px and scales 1.08 (tile 1.045 times avatar 1.035) with a ring.
        private const double AvatarSize = 244;

        private readonly List<(FrameworkElement Owner, FrameworkElement? Actions, Grid Plate, Ellipse Ring, Canvas Halo, TextBlock Name)> _tiles =
            new List<(FrameworkElement, FrameworkElement?, Grid, Ellipse, Canvas, TextBlock)>();

        /// <summary>Shows the web's selected look (lift, ring, the gear and Sign out row) on the tile that owns <paramref name="owner"/>.</summary>
        private void Select(FrameworkElement owner)
        {
            foreach (var (tile, actions, plate, ring, halo, name) in _tiles)
            {
                var on = ReferenceEquals(tile, owner) || (actions != null && ReferenceEquals(actions, owner));
                // Web: the selected tile lifts 8 px and scales 1.045 about its centre; its avatar scales a further 1.035.
                var move = (CompositeTransform)tile.RenderTransform;
                move.TranslateY = on ? -8 : 0;
                move.ScaleX = move.ScaleY = on ? 1.045 : 1;
                var grow = (CompositeTransform)plate.RenderTransform;
                grow.ScaleX = grow.ScaleY = on ? 1.035 : 1;
                name.Foreground = (Brush)Application.Current.Resources[on ? "PlayarrInk" : "PlayarrInkSoft"];
                ring.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
                halo.Visibility = ring.Visibility;
                if (actions != null)
                {
                    actions.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
                }
            }
        }

        private static Button ChromeButton(UIElement content, double width, double height, double radius)
        {
            return new Button
            {
                Content = content,
                Width = width,
                Height = height,
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(radius),
                HorizontalContentAlignment = HorizontalAlignment.Center,
                Background = new SolidColorBrush(Theme.IsLight ? Color.FromArgb(0xE6, 0xFF, 0xFF, 0xFF) : Color.FromArgb(0xA3, 0x21, 0x1D, 0x21)),
                BorderBrush = (Brush)Application.Current.Resources["PlayarrLineStrong"],
                BorderThickness = new Thickness(1),
                UseSystemFocusVisuals = false,
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
        }

        /// <summary>An icon drawn centred in a <paramref name="box"/> px square, which is the box the web's SVG occupies (exported as the image).</summary>
        private static Grid Glyph(string glyph, double size, string brushKey, double? box = null)
        {
            var side = box ?? size;
            var icon = new FontIcon { Glyph = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = size, Foreground = (Brush)Application.Current.Resources[brushKey], HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            return LayoutExport.Tag(new Grid { Width = side, Height = side, VerticalAlignment = VerticalAlignment.Center, Children = { icon } }, "image");
        }

        /// <summary>The web's gear (Settings) and Sign out pills under the selected profile.</summary>
        private StackPanel BuildActions()
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8.8, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 20, 0, 0), Visibility = Visibility.Collapsed };
            var gear = ChromeButton(Glyph("\uE713", 18, "PlayarrBrandInk"), 44, 44, 22);
            gear.Click += (s, e) => App.Navigation.Navigate(typeof(SettingsPage));
            LayoutExport.Tag(gear, "button", (ShellChrome.ProfileName.Length == 0 ? "Profile" : ShellChrome.ProfileName) + " settings");
            LayoutExport.SetSplit(gear, true);
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7.2, Padding = new Thickness(0) };
            label.Children.Add(Glyph("\uE7E8", 14, "PlayarrInkSoft", 18));
            label.Children.Add(new TextBlock { Text = "Sign out", FontSize = 10.75, FontFamily = WebFont.Face(720), FontWeight = WebFont.Weight(720), Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            var signOut = ChromeButton(label, 101, 44, 22);
            signOut.Click += (s, e) => SignOut();
            LayoutExport.Tag(signOut, "button", "Sign out " + (ShellChrome.ProfileName.Length == 0 ? "Profile" : ShellChrome.ProfileName));
            LayoutExport.SetSplit(signOut, true);
            row.Children.Add(gear);
            row.Children.Add(signOut);
            gear.GotFocus += (s, e) => Select(row);
            signOut.GotFocus += (s, e) => Select(row);
            return row;
        }

        /// <summary>
        /// This app holds one paired account, so adding a profile means signing out and pairing another; the viewer
        /// confirms first, and Cancel leaves the current session untouched.
        /// shortcut: pairing alongside the live session (swap only on success) needs a login mode and shell-state work; add it if owners ask.
        /// </summary>
        private async void ConfirmAddProfile()
        {
            var dialog = new ContentDialog
            {
                Title = "Sign in with another account?",
                Content = new TextBlock { Text = "You will be signed out of this profile on this device until you sign in again.", TextWrapping = TextWrapping.WrapWholeWords, MaxWidth = 480 },
                PrimaryButtonText = "Sign out and continue",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Close,
            };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
            {
                SignOut();
            }
        }

        private void SignOut()
        {
            Services.RemoteHostService.Instance.Stop();
            App.Environment.SignOut();
            Avatars.Reset();
            App.Navigation.Navigate(typeof(LoginPage));
        }

        /// <summary>One web profile column: avatar plate, name, status and (selected tile only) the action pills.</summary>
        private FrameworkElement BuildTile(UIElement plate, string name, string status, bool nameLock, RoutedEventHandler click, bool withActions, object? tag)
        {
            var ring = new Ellipse { Width = AvatarSize, Height = AvatarSize, Stroke = (Brush)Application.Current.Resources["PlayarrBrandInk"], StrokeThickness = 4, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            // The glow beyond the ring (UWP has no radial brush): stacked, fading outward strokes on a zero-size canvas.
            var halo = new Canvas { Width = 0, Height = 0, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            for (var k = 0; k < 5; k++)
            {
                var grow = 2 + k * 1.2; // inside the tile button's 8 px padding, or its bounds clip the glow
                var glow = new Ellipse
                {
                    Width = AvatarSize + 2 * grow,
                    Height = AvatarSize + 2 * grow,
                    Stroke = new SolidColorBrush(Color.FromArgb((byte)(0x38 - k * 10), 0xEA, 0xA6, 0xB6)),
                    StrokeThickness = 1.6,
                };
                Canvas.SetLeft(glow, -grow);
                Canvas.SetTop(glow, -grow);
                halo.Children.Add(glow);
            }

            var avatarHost = new Grid { Width = AvatarSize, Height = AvatarSize, RenderTransform = new CompositeTransform(), RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5) };
            avatarHost.Children.Add(halo);
            avatarHost.Children.Add(plate);
            avatarHost.Children.Add(ring);

            var nameBlock = LayoutExport.Tag(new TextBlock { Text = name, FontSize = 17.28, FontFamily = WebFont.Face(680), FontWeight = WebFont.Weight(680), Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"], HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 9.8, 0, 0) }, "text");
            var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
            nameRow.Children.Add(nameBlock);
            if (nameLock)
            {
                // Segoe MDL2 Assets's lock glyph: a built-in PIN-lock indicator with no image asset.
                nameRow.Children.Add(new TextBlock { Text = "\uE72E", FontFamily = new FontFamily("Segoe MDL2 Assets"), Opacity = 0.8, VerticalAlignment = VerticalAlignment.Center });
            }

            var content = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            content.Children.Add(avatarHost);
            content.Children.Add(nameRow);
            content.Children.Add(new TextBlock
            {
                Text = status,
                FontSize = 9.41,
                FontFamily = WebFont.Face(690), FontWeight = WebFont.Weight(690),
                CharacterSpacing = 60,
                Foreground = (Brush)Application.Current.Resources["PlayarrInkMuted"],
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 10.72, 0, 0),
            });

            // The web tile is the link: 244 x 301.63, lifted and scaled as a whole when selected.
            var tile = new Button
            {
                Content = content,
                Tag = tag,
                Width = AvatarSize,
                Height = 301.63,
                Background = new SolidColorBrush(Colors.Transparent),
                BorderThickness = new Thickness(0),
                Padding = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                VerticalAlignment = VerticalAlignment.Top,
                UseSystemFocusVisuals = false,
                RenderTransform = new CompositeTransform(),
                RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
            };
            tile.Click += click;
            LayoutExport.Tag(tile, "button", status == "WATCHING NOW" ? name + ", current profile" : "+ " + name + " " + status);
            LayoutExport.SetSplit(tile, true);
            tile.GotFocus += (s, e) => Select(tile);

            var column = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
            column.Children.Add(tile);
            StackPanel? actions = null;
            if (withActions)
            {
                actions = BuildActions();
                column.Children.Add(actions);
            }

            _tiles.Add((tile, actions, avatarHost, ring, halo, nameBlock));
            return column;
        }

        private FrameworkElement BuildProfileTile(AvailableProfile profile)
        {
            var initial = string.IsNullOrEmpty(profile.DisplayName)
                ? "?"
                : profile.DisplayName.Substring(0, 1).ToUpperInvariant();

            var avatar = new Border
            {
                Width = AvatarSize,
                Height = AvatarSize,
                CornerRadius = new CornerRadius(AvatarSize / 2),
                Background = new LinearGradientBrush
                {
                    StartPoint = new Windows.Foundation.Point(0, 0),
                    EndPoint = new Windows.Foundation.Point(1, 1),
                    GradientStops =
                    {
                        new GradientStop { Color = Color.FromArgb(0xFF, 0x8A, 0x6F, 0xC4), Offset = 0 },
                        new GradientStop { Color = Color.FromArgb(0xFF, 0x4F, 0x4B, 0x8C), Offset = 1 },
                    },
                },
                Child = new TextBlock
                {
                    Text = initial,
                    FontSize = 96,
                    FontWeight = FontWeights.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            };

            if (profile.IsCurrent)
            {
                ApplyAvatar(avatar);
            }

            return BuildTile(avatar, profile.DisplayName, profile.IsCurrent ? "WATCHING NOW" : string.Empty, profile.PinLocked, ProfileTile_Click, profile.IsCurrent, profile);
        }

        /// <summary>Web's "Sign in / Add another profile" tile: a dashed rose circle with a plus.</summary>
        private FrameworkElement BuildAddTile()
        {
            var plate = new Grid { Width = AvatarSize, Height = AvatarSize };
            plate.Children.Add(new Ellipse
            {
                Fill = new LinearGradientBrush
                {
                    StartPoint = new Windows.Foundation.Point(0.3, 0),
                    EndPoint = new Windows.Foundation.Point(0.7, 1),
                    GradientStops =
                    {
                        new GradientStop { Color = Theme.IsLight ? Color.FromArgb(0xFF, 0xE9, 0xB4, 0xC2) : Color.FromArgb(0xFF, 0x6C, 0x28, 0x3E), Offset = 0 },
                        new GradientStop { Color = Theme.IsLight ? Color.FromArgb(0xFF, 0xBA, 0x4A, 0x6C) : Color.FromArgb(0xFF, 0x9E, 0x29, 0x4E), Offset = 1 },
                    },
                },
            });
            // The web's soft top-left highlight, as concentric faint discs (no radial brush in UWP).
            var spot = new Canvas { Width = 0, Height = 0, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false };
            for (var k = 0; k < 6; k++)
            {
                var d = 30 + k * 14;
                var disc = new Ellipse { Width = d, Height = d, Fill = new SolidColorBrush(Color.FromArgb(10, 0xFF, 0xFF, 0xFF)) };
                Canvas.SetLeft(disc, AvatarSize * 0.34 - d / 2);
                Canvas.SetTop(disc, AvatarSize * 0.26 - d / 2);
                spot.Children.Add(disc);
            }

            plate.Children.Add(spot);
            plate.Children.Add(new Ellipse { Stroke = (Brush)Application.Current.Resources["PlayarrLineStrong"], StrokeThickness = 1, StrokeDashArray = new DoubleCollection { 3, 3 } });
            plate.Children.Add(new TextBlock
            {
                Text = "+",
                FontSize = 76.8,
                FontFamily = WebFont.Face(300), FontWeight = WebFont.Weight(300),
                Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            });

            return BuildTile(plate, "Sign in", "ADD ANOTHER PROFILE", false, (s, e) => ConfirmAddProfile(), false, null);
        }

        private Button BuildSelector(string glyph, string text, IEnumerable<(string Label, System.Action Pick)> options, double width, string accessibleName)
        {
            // Web selector: a 16 px icon 19.4 px in, the label 45 px in, a 12 px chevron 19.4 px from the right edge.
            var layout = new Grid { Width = width - 2, Height = 46 };
            var icon = Glyph(glyph, 14, "PlayarrInkSoft", 16);
            icon.HorizontalAlignment = HorizontalAlignment.Left;
            icon.Margin = new Thickness(18.39, 0, 0, 0);
            layout.Children.Add(icon);
            var label = new TextBlock { Text = text, FontSize = 11.52, FontFamily = WebFont.Face(720), FontWeight = WebFont.Weight(720), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(44, 0, 0, 0) };
            layout.Children.Add(label);
            var chevron = Glyph("\uE70D", 8, "PlayarrInkMuted", 12);
            chevron.HorizontalAlignment = HorizontalAlignment.Right;
            chevron.Margin = new Thickness(0, 0, 18.4, 0);
            layout.Children.Add(chevron);
            var button = ChromeButton(layout, width, 48, 0);
            button.Background = new SolidColorBrush(Colors.Transparent);
            LayoutExport.Tag(button, "button", accessibleName);
            LayoutExport.SetSplit(button, true);
            var flyout = new MenuFlyout();
            foreach (var (optionLabel, pick) in options)
            {
                var item = new MenuFlyoutItem { Text = optionLabel };
                item.Click += (s, e) => pick();
                flyout.Items.Add(item);
            }

            button.Flyout = flyout;
            return button;
        }

        /// <summary>Web TvStageChrome controls: Theme and Language selectors at the top right.</summary>
        private void BuildTopControls()
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 49.67, 42.23, 0) };
            var themes = new[] { (Theme.System, "System"), (Theme.Light, "Light"), (Theme.Dark, "Dark") };
            var themeName = themes.First(t => t.Item1 == Theme.Choice).Item2;
            panel.Children.Add(BuildSelector("\uE706", themeName, themes.Select(t => (t.Item2, (System.Action)(() =>
            {
                Theme.Set(t.Item1);
                App.Navigation.NavigateReplacingCurrent(typeof(ProfilesPage), null!);
            }))), 144, "Theme: " + themeName));
            var langChoices = new[] { Lang.SystemChoice }.Concat(Lang.Supported.Select(l => l.Key)).ToArray();
            panel.Children.Add(BuildSelector("\uE774", Lang.NameOf(Lang.Preference), langChoices.Select(c => (Lang.NameOf(c), (System.Action)(() =>
            {
                LanguageSetting.Save(c);
                App.Navigation.NavigateReplacingCurrent(typeof(ProfilesPage), null!);
            }))), 168, Lang.NameOf(Lang.Preference)));
            Root.Children.Add(panel);

            var arrow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 9 };
            arrow.Children.Add(new TextBlock { Text = "Clients", FontSize = 11.5, FontWeight = FontWeights.Bold, Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            arrow.Children.Add(new TextBlock { Text = "\u2192", FontSize = 12, Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"], VerticalAlignment = VerticalAlignment.Center });
            var clients = ChromeButton(arrow, 90, 44, 22);
            clients.HorizontalAlignment = HorizontalAlignment.Right;
            clients.VerticalAlignment = VerticalAlignment.Bottom;
            clients.Margin = new Thickness(0, 0, 48, 36);
            // The public Clients page lists the apps for every platform; it only exists on playarr.app.
            clients.Click += (s, e) => _ = Windows.System.Launcher.LaunchUriAsync(new System.Uri("https://playarr.app/clients"));
            Root.Children.Add(clients);
        }

        private void ProfileTile_Click(object sender, RoutedEventArgs e)
        {
            // Synchronous, one-shot: nothing to await, nothing to persist
            // server-side yet (see ProfilesViewModel's remarks) -- just move
            // on to HomePage.
            ShellChrome.ProfileName = ((AvailableProfile)((Button)sender).Tag).DisplayName;
            App.Navigation.Navigate(typeof(HomePage));
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();
    }
}
