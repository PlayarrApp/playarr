using System;
using System.ComponentModel;
using Windows.Foundation;
using Windows.UI;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Shapes;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Xbox;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The reference screen every other page in Playarr.Xbox should follow
    /// structurally.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The pattern, in full, for two other agents building the remaining
    /// screens without seeing this file:
    /// </para>
    /// <list type="number">
    /// <item><description>
    /// The page's constructor calls <c>InitializeComponent()</c>, then
    /// constructs its ViewModel by hand -- <c>new FooViewModel(App.Environment)</c>
    /// -- and assigns it to a <c>private readonly FooViewModel _viewModel</c>
    /// field. No DI container resolves it; <c>App.Environment</c> is the one
    /// shared dependency every ViewModel needs, reached the same way from
    /// every page.
    /// </description></item>
    /// <item><description>
    /// <see cref="OnNavigatedTo"/> subscribes to
    /// <c>_viewModel.PropertyChanged</c> (every ViewModel is an
    /// <see cref="ObservableObject"/>, so this is always available) and
    /// calls <c>Render()</c> once immediately, so the page reflects current
    /// state right away rather than waiting for the first change.
    /// <see cref="OnNavigatedFrom"/> unsubscribes. This -- not the page
    /// constructor -- is where the subscription lives, so navigating away
    /// and back doesn't double-subscribe.
    /// </description></item>
    /// <item><description>
    /// A single private <c>Render()</c> method reads every property off the
    /// ViewModel it cares about and pushes the values onto this page's
    /// named XAML elements (<c>ElementName.Text = ...</c>,
    /// <c>ElementName.Visibility = ...</c>). It runs on every
    /// <c>PropertyChanged</c> notification regardless of which property
    /// changed -- simple, and cheap enough at this app's screen sizes that a
    /// finer-grained per-property diff isn't worth the code.
    /// </description></item>
    /// <item><description>
    /// <strong>No {x:Bind}, no {Binding}, and no IValueConverter anywhere in
    /// this project.</strong> Every dynamic value is plain imperative C# in
    /// <c>Render()</c> and every interactive control is a named element with
    /// a <c>Click="Foo_Click"</c> handler (a plain UWP routed-event hookup,
    /// not a binding) that forwards straight into a ViewModel method taking
    /// no parameters (<c>_viewModel.Connect()</c>,
    /// <c>_viewModel.CancelPairing()</c>). Keep this consistent across
    /// screens -- mixing compiled bindings into some pages and not others is
    /// the one thing that would make this pattern hard to follow file to
    /// file.
    /// </description></item>
    /// <item><description>
    /// A ViewModel's own async operations (anything that calls into
    /// <see cref="XboxAppEnvironment"/>) are fire-and-forget from the
    /// ViewModel's perspective -- see <c>LoginViewModel.BeginPairing()</c>.
    /// The page never awaits a ViewModel method; it only ever observes
    /// state transitions through <c>PropertyChanged</c> -> <c>Render()</c>.
    /// </description></item>
    /// <item><description>
    /// Navigating onward uses <c>App.Navigation.Navigate(typeof(NextPage))</c>
    /// from inside <c>Render()</c> at the point the ViewModel's state says
    /// "this screen is done" (here: <c>PairingStateKind.SignedIn</c>) --
    /// guarded by a one-shot boolean field (<c>_hasNavigated</c> here) so a
    /// state that stays constant across more than one <c>PropertyChanged</c>
    /// notification (which does happen -- see
    /// <c>LoginViewModel</c>'s relay of <c>XboxAppEnvironment.PairingState</c>)
    /// can never trigger a second, duplicate <c>Frame.Navigate</c> call.
    /// </description></item>
    /// </list>
    /// </remarks>
    public sealed partial class LoginPage : Page
    {
        private const int QrModulePixels = 6;
        private readonly LoginViewModel _viewModel;
        private readonly DispatcherTimer _countdown = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        private DeviceCodeResponse? _shownCode;
        private DateTimeOffset _shownAt;
        private bool _manual;

        // Named "ToProfiles" rather than "ToHome": the Screens phase (task
        // #5) inserted Views/ProfilesPage as the real post-sign-in
        // destination, ahead of Views/HomePage -- see ProfilesPage's own
        // remarks for why picking a profile is a separate, synchronous step
        // rather than folded into this page's async pairing state machine.
        private bool _hasNavigatedToProfiles;

        public LoginPage()
        {
            InitializeComponent();
            _viewModel = new LoginViewModel(App.Environment);
            ServerAddressBox.Text = _viewModel.ServerAddress;
            _countdown.Tick += (s, e) => RenderCountdown();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _countdown.Start();
            if (_viewModel.PairingState.Kind == PairingStateKind.SignedOut)
            {
                // QR sign-in starts on its own: the server address is delivered by the pairing, never typed.
                _viewModel.BeginPairing();
            }

            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _countdown.Stop();
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See the type-level remarks for why this is one
        /// unconditional method rather than a per-property handler.
        /// </summary>
        private void Render()
        {
            ServerErrorText.Text = _viewModel.ServerError ?? string.Empty;
            ServerErrorText.Visibility = string.IsNullOrEmpty(_viewModel.ServerError)
                ? Visibility.Collapsed
                : Visibility.Visible;

            var state = _viewModel.PairingState;
            var pairing = state.Kind == PairingStateKind.RequestingCode || state.Kind == PairingStateKind.AwaitingApproval;
            ServerPanel.Visibility = _manual && !pairing ? Visibility.Visible : Visibility.Collapsed;
            ModeButton.Content = _manual ? "Sign in with QR code" : "Sign in manually";
            PairingPanel.Visibility = pairing ? Visibility.Visible : Visibility.Collapsed;
            var failed = state.Kind == PairingStateKind.Failed;
            FailureText.Visibility = failed ? Visibility.Visible : Visibility.Collapsed;
            RetryButton.Visibility = failed && !_manual ? Visibility.Visible : Visibility.Collapsed;
            FailureText.Text = state.FailureMessage ?? string.Empty;

            switch (state.Kind)
            {
                case PairingStateKind.AwaitingApproval:
                    var code = state.PendingCode!;
                    DeviceCodePanel.Opacity = 1;
                    VerificationUriText.Text = code.VerificationUri;
                    UserCodeText.Text = code.UserCode;
                    PairingStatusText.Text = "Waiting for approval\u2026";
                    if (!ReferenceEquals(code, _shownCode))
                    {
                        _shownCode = code;
                        _shownAt = DateTimeOffset.UtcNow;
                        DrawQr(code.VerificationUriComplete);
                    }

                    RenderCountdown();
                    break;

                case PairingStateKind.SignedIn:
                    if (!_hasNavigatedToProfiles)
                    {
                        _hasNavigatedToProfiles = true;
                        App.Navigation.Navigate(typeof(ProfilesPage));
                    }

                    break;

                default:
                    // Requesting a (fresh) code: keep the layout, blank the code, never show an error.
                    _shownCode = null;
                    QrHost.Child = null;
                    DeviceCodePanel.Opacity = 0;
                    break;
            }
        }

        private void RenderCountdown()
        {
            if (_shownCode == null)
            {
                return;
            }

            var left = Math.Max(0, (int)(_shownCode.ExpiresIn - (DateTimeOffset.UtcNow - _shownAt).TotalSeconds));
            CountdownText.Text = $"Code refreshes in {left / 60}:{left % 60:00}";
        }

        /// <summary>Black modules on the white tile, drawn as one geometry: 240 px tile, 12 px edge like the web.</summary>
        private void DrawQr(string text)
        {
            var modules = QrMatrix.Encode(text);
            var size = modules.GetLength(0);
            var group = new GeometryGroup();
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    if (modules[y, x])
                    {
                        group.Children.Add(new RectangleGeometry { Rect = new Rect(x * QrModulePixels, y * QrModulePixels, QrModulePixels, QrModulePixels) });
                    }
                }
            }

            QrHost.Child = new Viewbox
            {
                Margin = new Thickness(12),
                Child = new Path
                {
                    Data = group,
                    Fill = new SolidColorBrush(Colors.Black),
                    Width = size * QrModulePixels,
                    Height = size * QrModulePixels,
                },
            };
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.BeginPairing();

        private void ModeButton_Click(object sender, RoutedEventArgs e)
        {
            _manual = !_manual;
            if (_manual)
            {
                _viewModel.CancelPairing();
            }
            else
            {
                _viewModel.BeginPairing();
            }

            Render();
        }

        private void ConnectButton_Click(object sender, RoutedEventArgs e)
        {
            _viewModel.ServerAddress = ServerAddressBox.Text;
            _viewModel.Connect();
        }
    }
}
