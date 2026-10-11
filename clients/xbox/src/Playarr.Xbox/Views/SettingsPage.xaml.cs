using System.ComponentModel;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
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
            ShowSection(appearance: true);
        }

        private void AppearanceTab_Click(object sender, RoutedEventArgs e) => ShowSection(appearance: true);

        private void ServerTab_Click(object sender, RoutedEventArgs e) => ShowSection(appearance: false);

        /// <summary>The web's numbered section list: the open section is filled and its controls show on the right.</summary>
        private void ShowSection(bool appearance)
        {
            AppearanceSection.Visibility = appearance ? Visibility.Visible : Visibility.Collapsed;
            ServerSection.Visibility = appearance ? Visibility.Collapsed : Visibility.Visible;
            SectionText.Text = appearance ? "APPEARANCE" : "SERVER CONNECTION";
            AppearanceTab.Background = appearance ? Ui.Res("PlayarrSurfaceSoft") : new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent);
            ServerTab.Background = appearance ? new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent) : Ui.Res("PlayarrSurfaceSoft");
            if (appearance)
            {
                RenderAppearance();
            }
        }

        /// <summary>Colour theme as on the web (System, Light, Dark); the choice applies at once and is kept.</summary>
        private void RenderAppearance()
        {
            AppearancePanel.Children.Clear();
            var choices = new[] { Theme.System, Theme.Light, Theme.Dark };
            var selected = System.Array.IndexOf(choices, Theme.Choice);
            AppearancePanel.Children.Add(Drawer.Segmented("Colour theme", new[] { "System", "Light", "Dark" }, selected < 0 ? 0 : selected, i =>
            {
                Theme.Set(choices[i]);
                // Rebuild this page so the controls it built in code pick the new tokens up.
                App.Navigation.NavigateReplacingCurrent(typeof(SettingsPage), null!);
            }));
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
            _viewModel.SignOut();
            Avatars.Reset();
            App.Navigation.Navigate(typeof(LoginPage));
        }
    }
}
