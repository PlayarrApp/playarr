using System.ComponentModel;
using System.Linq;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Localization;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Server address, sign-out, and app-version display. Follows
    /// <see cref="LoginPage"/>'s established page/ViewModel/<c>Render()</c>
    /// pattern exactly -- this page takes no navigation parameter, so
    /// unlike <see cref="WorkDetailPage"/> it needs none of that page's
    /// deviation: the constructor builds <see cref="_viewModel"/> from
    /// <c>App.Environment</c> directly.
    /// </summary>
    public sealed partial class SettingsPage : Page
    {
        private readonly SettingsViewModel _viewModel;
        private bool _hasNavigatedToHomeAfterReconnect;

        public SettingsPage()
        {
            InitializeComponent();
            _viewModel = new SettingsViewModel(App.Environment);
            ServerAddressBox.Text = _viewModel.ServerConnection.ServerAddress;
            PageTitleText.Text = Lang.T("settings.index.title");
            BuildSections();
            ShowSection(0);
        }

        private int _openSection;

        /// <summary>The web's numbered section list (Settings index): number, title, and how the section fills the right-hand side.</summary>
        private sealed class SectionDef
        {
            public string Number = "";
            public string Title = "";
            public Button? Tab;
            public System.Action? Render;
            public FrameworkElement? Host;
        }

        private readonly System.Collections.Generic.List<SectionDef> _sections = new System.Collections.Generic.List<SectionDef>();

        private void BuildSections()
        {
            _sections.Add(new SectionDef { Number = "01", Title = Lang.T("settings.index.appearance.title"), Render = RenderAppearance, Host = AppearanceSection });
            _sections.Add(new SectionDef { Number = "02", Title = Lang.T("settings.index.profileAvatar.title"), Render = RenderAvatar, Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "03", Title = Lang.T("settings.index.language.title"), Render = RenderLanguage, Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "04", Title = Lang.T("settings.index.player.title"), Render = RenderPlayer, Host = PlayerSection });
            _sections.Add(new SectionDef { Number = "05", Title = Lang.T("settings.index.server.title"), Host = ServerSection });
            _sections.Add(new SectionDef { Number = "06", Title = Lang.T("settings.index.profileLock.title"), Render = () => RenderProfileLock(), Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "07", Title = Lang.T("settings.index.invite.title"), Render = RenderInvite, Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "09", Title = Lang.T("settings.index.remote.title"), Render = RenderRemote, Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "10", Title = Lang.T("settings.index.yourData.title"), Render = RenderYourData, Host = ExtraSection });
            _sections.Add(new SectionDef { Number = "11", Title = Lang.T("pages.home.customise.title"), Render = RenderCustomiseHome, Host = ExtraSection });
            foreach (var section in _sections)
            {
                var def = section;
                var row = new Grid();
                row.Children.Add(new TextBlock { Text = def.Number, FontSize = 10, FontWeight = Windows.UI.Text.FontWeights.Bold, Margin = new Thickness(0, -22, 0, 0), VerticalAlignment = VerticalAlignment.Center });
                row.Children.Add(new TextBlock { Text = def.Title, FontSize = 28, Margin = new Thickness(60, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
                row.Children.Add(new TextBlock { Text = "\u2192", FontSize = 18, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center });
                def.Tab = new Button
                {
                    Width = 470,
                    Height = 92,
                    Padding = new Thickness(32, 0, 32, 0),
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(0),
                    BorderThickness = new Thickness(0),
                    Background = new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent),
                    Content = row,
                };
                def.Tab.Click += (s, e) => ShowSection(_sections.IndexOf(def));
                TabsPanel.Children.Add(def.Tab);
            }
        }

        private void ShowSection(int section)
        {
            StopSectionWork();
            _openSection = section;
            _languageOpen = false;
            var none = new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent);
            // Several sections share one host panel: collapse every host first, then show the chosen one's.
            foreach (var def in _sections)
            {
                def.Host!.Visibility = Visibility.Collapsed;
            }

            for (var i = 0; i < _sections.Count; i++)
            {
                _sections[i].Tab!.Background = i == section ? Ui.Res("PlayarrSurfaceSoft") : none;
            }

            _sections[section].Host!.Visibility = Visibility.Visible;

            SectionText.Text = _sections[section].Title;
            Ui.LayoutHeader(HeaderTitles, PageTitleText, SectionText);
            _sections[section].Render?.Invoke();
        }

        /// <summary>Settings > Profile avatar: the six built-in avatars (a TV has no photo upload, as on the web TV app); saved to the profile.</summary>
        private async void RenderAvatar()
        {
            ExtraPanel.Children.Clear();
            string? current;
            try
            {
                current = await Avatars.CurrentPresetAsync();
            }
            catch (System.Exception)
            {
                ExtraPanel.Children.Add(Ui.Text("The profile avatar could not be loaded.", 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0)));
                return;
            }

            var grid = new Grid { ColumnSpacing = 28, RowSpacing = 28, HorizontalAlignment = HorizontalAlignment.Left };
            for (var i = 0; i < 3; i++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            }

            for (var i = 0; i < 2; i++)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            for (var i = 0; i < Avatars.Presets.Length; i++)
            {
                var preset = Avatars.Presets[i];
                var selected = preset == current;
                var button = new Button
                {
                    Width = 168,
                    Height = 168,
                    Padding = new Thickness(0),
                    CornerRadius = new CornerRadius(84),
                    BorderThickness = new Thickness(selected ? 4 : 0),
                    BorderBrush = Ui.Res("PlayarrInk"),
                    Background = new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent),
                    Content = new Windows.UI.Xaml.Controls.Image { Source = Avatars.Plate(preset), Stretch = Windows.UI.Xaml.Media.Stretch.UniformToFill, Width = 160, Height = 160 },
                };
                button.Click += async (s, e) =>
                {
                    try
                    {
                        await App.Environment.ApiClient.SetProfileAvatarPresetAsync(preset);
                        Avatars.Reset();
                        RenderAvatar();
                    }
                    catch (System.Exception)
                    {
                        ExtraPanel.Children.Add(Ui.Text("The profile avatar could not be saved to your profile.", 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 14, 0, 0)));
                    }
                };
                Grid.SetColumn(button, i % 3);
                Grid.SetRow(button, i / 3);
                grid.Children.Add(button);
            }

            ExtraPanel.Children.Add(grid);
            ExtraPanel.Children.Add(Ui.Text("Custom photo selection is not available here, but a photo already saved to your profile will still appear.", 11, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 24, 0, 0)));
        }

        /// <summary>Settings > Profile lock: a four-digit PIN required before switching to this profile (web <c>settings/ProfileLock.tsx</c>).</summary>
        private async void RenderProfileLock(string? message = null)
        {
            ExtraPanel.Children.Clear();
            bool locked;
            try
            {
                locked = (await App.Environment.ApiClient.GetProfilePinSettingAsync()).PinLocked;
            }
            catch (System.Exception error)
            {
                ExtraPanel.Children.Add(Ui.Text(error.Message, 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0)));
                return;
            }

            ExtraPanel.Children.Add(Ui.Text(locked ? "Replace PIN" : "New PIN", 17.5, Windows.UI.Text.FontWeights.SemiBold, "PlayarrInk", new Thickness(0, 0, 0, 12)));
            var row = new Grid { ColumnSpacing = 12, Margin = new Thickness(0, 0, 0, 18) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var box = new PasswordBox { MaxLength = 4, PlaceholderText = "\u2022\u2022\u2022\u2022", Height = 56 };
            var save = new Button { Content = locked ? "Replace" : "Set PIN", Height = 56, Padding = new Thickness(28, 0, 28, 0), IsEnabled = false };
            Grid.SetColumn(save, 1);
            box.PasswordChanged += (s, e) =>
            {
                var digits = new string(box.Password.Where(char.IsDigit).Take(4).ToArray());
                if (digits != box.Password)
                {
                    box.Password = digits;
                }

                save.IsEnabled = digits.Length == 4;
            };
            save.Click += async (s, e) =>
            {
                try
                {
                    await App.Environment.ApiClient.SetProfilePinAsync(box.Password);
                    RenderProfileLock(locked ? "Profile PIN replaced." : "Profile PIN set.");
                }
                catch (System.Exception error)
                {
                    RenderProfileLock(error.Message);
                }
            };
            row.Children.Add(box);
            row.Children.Add(save);
            ExtraPanel.Children.Add(row);
            ExtraPanel.Children.Add(Ui.Text(message ?? (locked ? "PIN lock is on." : "PIN lock is off."), 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 0, 0, 14)));
            if (locked)
            {
                var remove = new Button { Content = "Remove PIN", Height = 48, Padding = new Thickness(24, 0, 24, 0) };
                remove.Click += async (s, e) =>
                {
                    try
                    {
                        await App.Environment.ApiClient.SetProfilePinAsync(null);
                        RenderProfileLock("Profile PIN removed.");
                    }
                    catch (System.Exception error)
                    {
                        RenderProfileLock(error.Message);
                    }
                };
                ExtraPanel.Children.Add(remove);
            }
        }

        /// <summary>Settings > Customise Home: which Home rails show and in what order, saved on every change (web <c>settings/Home.tsx</c>).</summary>
        private async void RenderCustomiseHome()
        {
            ExtraPanel.Children.Clear();
            ExtraPanel.Children.Add(Ui.Text("Loading your rails", 11, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 0, 0, 14)));
            System.Collections.Generic.IList<Playarr.Core.Models.RailPreferenceEntry> rails;
            try
            {
                rails = (await App.Environment.ApiClient.GetRailPreferencesAsync()).Rails;
            }
            catch (System.Exception error)
            {
                ExtraPanel.Children.Clear();
                ExtraPanel.Children.Add(Ui.Text("Couldn't load your rails: " + error.Message, 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0)));
                return;
            }

            DrawRails(new System.Collections.Generic.List<Playarr.Core.Models.RailPreferenceEntry>(rails));
        }

        private void DrawRails(System.Collections.Generic.List<Playarr.Core.Models.RailPreferenceEntry> rails)
        {
            ExtraPanel.Children.Clear();
            var hint = Ui.Text("Choose which rails appear on Home and in what order.", 12, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 0, 0, 18));
            ExtraPanel.Children.Add(hint);
            for (var i = 0; i < rails.Count; i++)
            {
                var index = i;
                var rail = rails[i];
                var row = new Grid { Margin = new Thickness(0, 0, 0, 10), ColumnSpacing = 10 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var title = Ui.Text(rail.Title, 18, Windows.UI.Text.FontWeights.Normal, rail.Hidden ? "PlayarrInkSoft" : "PlayarrInk", new Thickness(0));
                title.VerticalAlignment = VerticalAlignment.Center;
                row.Children.Add(title);
                row.Children.Add(RailButton(rail.Hidden ? "Show" : "Hide", 1, true, () => { rail.Hidden = !rail.Hidden; SaveRails(rails); }));
                row.Children.Add(RailButton("\u2191", 2, index > 0, () => { Swap(rails, index, index - 1); SaveRails(rails); }));
                row.Children.Add(RailButton("\u2193", 3, index < rails.Count - 1, () => { Swap(rails, index, index + 1); SaveRails(rails); }));
                ExtraPanel.Children.Add(row);
            }

            var reset = new Button { Content = "Reset to default", Margin = new Thickness(0, 14, 0, 0), Height = 56, Padding = new Thickness(24, 0, 24, 0) };
            reset.Click += async (s, e) =>
            {
                try { await App.Environment.ApiClient.ResetRailPreferencesAsync(); } catch (System.Exception) { }
                RenderCustomiseHome();
            };
            ExtraPanel.Children.Add(reset);
        }

        private static Button RailButton(string text, int column, bool enabled, System.Action click)
        {
            var button = new Button { Content = text, Height = 48, MinWidth = 72, IsEnabled = enabled };
            Grid.SetColumn(button, column);
            button.Click += (s, e) => click();
            return button;
        }

        private static void Swap(System.Collections.Generic.List<Playarr.Core.Models.RailPreferenceEntry> rails, int a, int b)
        {
            var tmp = rails[a];
            rails[a] = rails[b];
            rails[b] = tmp;
        }

        private async void SaveRails(System.Collections.Generic.List<Playarr.Core.Models.RailPreferenceEntry> rails)
        {
            DrawRails(rails);
            try { await App.Environment.ApiClient.SaveRailPreferencesAsync(rails); } catch (System.Exception) { }
        }

        /// <summary>Settings > Player > Advanced: Force direct video and Force direct audio, per axis, Off by default (web strings).</summary>
        private void RenderPlayer()
        {
            PlayerPanel.Children.Clear();
            PlayerPanel.Children.Add(Ui.Text("Advanced", 17.5, Windows.UI.Text.FontWeights.SemiBold, "PlayarrInk", new Thickness(0, 16, 0, 0)));
            PlayerPanel.Children.Add(ForceToggle("Force direct video", "Always send the original picture, even when the device may not support its codec, bit depth or HDR format.",
                Services.DeviceCapsProvider.ForceDirectVideo, on => Services.DeviceCapsProvider.ForceDirectVideo = on));
            PlayerPanel.Children.Add(ForceToggle("Force direct audio", "Always send the original audio, even when the device may not support its codec or channel count.",
                Services.DeviceCapsProvider.ForceDirectAudio, on => Services.DeviceCapsProvider.ForceDirectAudio = on));
        }

        private StackPanel ForceToggle(string title, string description, bool isOn, System.Action<bool> set) =>
            SettingGroup(title, description, new[] { "Off", "On" }, isOn ? 1 : 0, i => { set(i == 1); RenderPlayer(); });

        /// <summary>Colour theme as on the web (System, Light, Dark); the choice applies at once and is kept.</summary>
        private void RenderAppearance()
        {
            AppearancePanel.Children.Clear();
            var choices = new[] { Theme.System, Theme.Light, Theme.Dark };
            var selected = System.Array.IndexOf(choices, Theme.Choice);
            AppearancePanel.Children.Add(SettingGroup(Lang.T("settings.appearance.colourThemeLabel"), null, new[] { "System", "Light", "Dark" }, selected < 0 ? 0 : selected, i =>
            {
                Theme.Set(choices[i]);
                // Rebuild this page so the controls it built in code pick the new tokens up.
                App.Navigation.NavigateReplacingCurrent(typeof(SettingsPage), null!);
            }, first: true));
            AppearancePanel.Children.Add(SettingGroup(Lang.T("settings.appearance.homeViewTitle"), Lang.T("settings.appearance.homeViewDescription"),
                new[] { Lang.T("settings.appearance.homeViewThumbnail"), Lang.T("settings.appearance.homeViewCover") }, Appearance.HomeCover ? 1 : 0, i => { Appearance.HomeCover = i == 1; RenderAppearance(); }));
            AppearancePanel.Children.Add(SettingGroup(Lang.T("settings.appearance.artworkSizeTitle"), Lang.T("settings.appearance.artworkSizeDescription"),
                new[] { Capitalise(Lang.T("pages.library.sizeSmall")), Capitalise(Lang.T("pages.library.sizeMedium")), Capitalise(Lang.T("pages.library.sizeLarge")) }, Appearance.SizeIndex, i => { Appearance.SizeIndex = i; RenderAppearance(); }, divider: false));
        }

        /// <summary>The web's settings group: a heading, an optional note, the segmented choice, then a divider line.</summary>
        private static StackPanel SettingGroup(string title, string? note, string[] options, int selected, System.Action<int> onSelect, bool first = false, bool divider = true)
        {
            var group = new StackPanel { Margin = new Thickness(0, first ? 16 : 38, 0, 0) };
            group.Children.Add(Ui.Text(title, 17.5, Windows.UI.Text.FontWeights.SemiBold, "PlayarrInk"));
            if (note != null)
            {
                var text = Ui.Text(note, 11, Windows.UI.Text.FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 6, 0, 0));
                text.TextWrapping = TextWrapping.WrapWholeWords;
                group.Children.Add(text);
            }

            var choice = Drawer.Segmented(string.Empty, options, selected, onSelect);
            choice.Margin = new Thickness(0, 4, 0, 30);
            group.Children.Add(choice);
            if (divider)
            {
                group.Children.Add(new Windows.UI.Xaml.Shapes.Rectangle { Height = 1, Fill = Ui.Res("PlayarrLine") });
            }

            return group;
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            Render();
            // The web opens Settings with the Back control focused.
            FocusClaim.Start(this, () => BackButton);
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            StopSectionWork();
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. Mirrors <see cref="LoginPage"/>'s pairing section
        /// almost exactly, reading through
        /// <see cref="SettingsViewModel.ServerConnection"/> instead of a
        /// ViewModel of its own -- see <see cref="LoginPage"/>'s remarks
        /// for why this is one unconditional method rather than a
        /// per-property handler.
        /// </summary>
        private void Render()
        {
            CurrentServerText.Text = _viewModel.CurrentServerAddress;
            AppVersionText.Text = $"Playarr for Xbox — version {SettingsViewModel.AppVersionText}";

            var connection = _viewModel.ServerConnection;

            ServerErrorText.Text = connection.ServerError ?? string.Empty;
            ServerErrorText.Visibility = string.IsNullOrEmpty(connection.ServerError)
                ? Visibility.Collapsed
                : Visibility.Visible;

            var state = connection.PairingState;

            var showServerPanel = state.Kind == PairingStateKind.SignedOut || state.Kind == PairingStateKind.Failed;
            ServerPanel.Visibility = showServerPanel ? Visibility.Visible : Visibility.Collapsed;
            ConnectButton.Content = state.Kind == PairingStateKind.Failed ? "Try again" : "Connect";

            var showPairingPanel =
                state.Kind == PairingStateKind.RequestingCode || state.Kind == PairingStateKind.AwaitingApproval;
            PairingPanel.Visibility = showPairingPanel ? Visibility.Visible : Visibility.Collapsed;

            ReconnectFailureText.Visibility =
                state.Kind == PairingStateKind.Failed ? Visibility.Visible : Visibility.Collapsed;

            switch (state.Kind)
            {
                case PairingStateKind.RequestingCode:
                    PairingProgressRing.IsActive = true;
                    PairingStatusText.Text = "Requesting a pairing code…";
                    DeviceCodePanel.Visibility = Visibility.Collapsed;
                    break;

                case PairingStateKind.AwaitingApproval:
                    PairingProgressRing.IsActive = true;
                    PairingStatusText.Text = "Waiting for approval…";
                    DeviceCodePanel.Visibility = Visibility.Visible;
                    VerificationUriText.Text = state.PendingCode?.VerificationUri ?? string.Empty;
                    UserCodeText.Text = state.PendingCode?.UserCode ?? string.Empty;
                    break;

                case PairingStateKind.Failed:
                    PairingProgressRing.IsActive = false;
                    ReconnectFailureText.Text = state.FailureMessage ?? "Playarr couldn't reconnect to that server.";
                    break;

                case PairingStateKind.SignedIn:
                    PairingProgressRing.IsActive = false;
                    PairingStatusText.Text = "Paired.";
                    if (!_hasNavigatedToHomeAfterReconnect)
                    {
                        _hasNavigatedToHomeAfterReconnect = true;
                        App.Navigation.Navigate(typeof(HomePage));
                    }

                    break;

                case PairingStateKind.SignedOut:
                default:
                    PairingProgressRing.IsActive = false;
                    break;
            }
        }

        private void ConnectButton_Click(object sender, RoutedEventArgs e)
        {
            _viewModel.ServerConnection.ServerAddress = ServerAddressBox.Text;
            _viewModel.ServerConnection.Connect();
        }

        private void CancelPairingButton_Click(object sender, RoutedEventArgs e) =>
            _viewModel.ServerConnection.CancelPairing();

        private void BackButton_Click(object sender, RoutedEventArgs e) => App.Navigation.GoBack();

        private void SignOutButton_Click(object sender, RoutedEventArgs e)
        {
            Services.RemoteHostService.Instance.Stop();
            _viewModel.SignOut();
            Avatars.Reset();
            App.Navigation.Navigate(typeof(LoginPage));
        }
    }
}
