using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Playarr.Core.Localization;
using Playarr.Core.Models;
using Playarr.Core.Remote;
using Windows.ApplicationModel.Core;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation.Peers;
using Windows.UI.Xaml.Automation.Provider;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// Makes this console a phone-remote target (Settings > Phone remote > "Allow my other devices to control this one", on by default
    /// on a TV as on the web). Pairing requests wait for an on-screen Allow / Deny; the only command run is <c>navigate</c>
    /// (D-pad, OK, Back, Home). Text entry, playback control and handoff are not offered, so controllers never see them.
    /// </summary>
    internal sealed class RemoteHostService : IRemoteTargetHandlers
    {
        private const string SettingsKey = "playarr-remote-host";

        public static RemoteHostService Instance { get; } = new RemoteHostService();

        private readonly System.Threading.SemaphoreSlim _prompts = new System.Threading.SemaphoreSlim(1, 1);
        private RemoteTargetHost? _host;
        private ContentDialog? _open;
        private Guid _openFor;

        public bool Enabled
        {
            get => !Windows.Storage.ApplicationData.Current.LocalSettings.Values.TryGetValue(SettingsKey, out var v) || !(v is bool on) || on;
            set
            {
                Windows.Storage.ApplicationData.Current.LocalSettings.Values[SettingsKey] = value;
                Apply();
            }
        }

        /// <summary>Starts listening when allowed (and signed in); safe to call on every page change.</summary>
        public void Apply()
        {
            if (!Enabled || App.Environment.PairingState.Kind != PairingStateKind.SignedIn)
            {
                Stop();
                return;
            }

            if (_host != null)
            {
                return;
            }

            _host = new RemoteTargetHost(App.Environment.ApiClient, this, "Xbox", ClientPlatform.Xbox.WireName(), new[] { "navigate" });
            _host.Start();
        }

        public void Stop()
        {
            _host?.Stop();
            _host = null;
        }

        private static Task OnUi(Func<Task> work)
        {
            var done = new TaskCompletionSource<bool>();
            var ignored = CoreApplication.MainView.CoreWindow.Dispatcher.RunAsync(CoreDispatcherPriority.Normal, async () =>
            {
                try
                {
                    await work();
                    done.TrySetResult(true);
                }
                catch (Exception error)
                {
                    done.TrySetException(error);
                }
            });
            return done.Task;
        }

        public void OnPairingRequest(PairingRequest request) => _ = PromptAsync(request);

        public void OnPairingRevoked(Guid pairingId)
        {
            if (_openFor == pairingId)
            {
                _ = OnUi(() => { _open?.Hide(); return Task.CompletedTask; });
            }
        }

        /// <summary>The web's pairing prompt: who is asking, the code to compare with the phone, Allow and Deny.</summary>
        private async Task PromptAsync(PairingRequest request)
        {
            await _prompts.WaitAsync();
            try
            {
                await OnUi(async () =>
                {
                    var name = string.IsNullOrWhiteSpace(request.ControllerName) ? Lang.T("remote.prompt.unnamed") : request.ControllerName;
                    var body = new StackPanel { Spacing = 12 };
                    body.Children.Add(new TextBlock { Text = Lang.T("remote.prompt.code", "code", request.VerificationCode), FontSize = 24, FontWeight = Windows.UI.Text.FontWeights.Bold });
                    body.Children.Add(new TextBlock { Text = Lang.T("remote.prompt.hint"), TextWrapping = TextWrapping.WrapWholeWords, Opacity = 0.8 });
                    var dialog = new ContentDialog
                    {
                        Title = Lang.T("remote.prompt.title", "name", name),
                        Content = body,
                        PrimaryButtonText = Lang.T("remote.prompt.allow"),
                        CloseButtonText = Lang.T("remote.prompt.deny"),
                        DefaultButton = ContentDialogButton.Close,
                    };
                    _open = dialog;
                    _openFor = request.PairingId;
                    var result = await dialog.ShowAsync();
                    _open = null;
                    _openFor = Guid.Empty;
                    try
                    {
                        if (result == ContentDialogResult.Primary)
                        {
                            await App.Environment.ApiClient.ApproveRemotePairingAsync(request.PairingId);
                        }
                        else
                        {
                            await App.Environment.ApiClient.DenyRemotePairingAsync(request.PairingId);
                        }
                    }
                    catch (Exception)
                    {
                        // The request expired or was revoked meanwhile; the controller's own poll reports it.
                    }
                });
            }
            catch (Exception)
            {
                // A dialog that cannot show (another one open) leaves the request to expire on the server.
            }
            finally
            {
                _prompts.Release();
            }
        }

        public async Task<RemoteOutcome> ExecuteAsync(string kind, JObject args)
        {
            if (kind != "navigate")
            {
                return RemoteOutcome.Unsupported("capability not available");
            }

            var key = (string?)args["key"] ?? string.Empty;
            var outcome = RemoteOutcome.Unsupported("unsupported key");
            await OnUi(() =>
            {
                outcome = Navigate(key);
                return Task.CompletedTask;
            });
            return outcome;
        }

        private static RemoteOutcome Navigate(string key)
        {
            switch (key)
            {
                case "up": return Move(FocusNavigationDirection.Up);
                case "down": return Move(FocusNavigationDirection.Down);
                case "left": return Move(FocusNavigationDirection.Left);
                case "right": return Move(FocusNavigationDirection.Right);
                case "back":
                    if (!Views.Drawer.TryCloseCurrent() && App.Navigation.CanGoBack)
                    {
                        App.Navigation.GoBack();
                    }

                    return RemoteOutcome.Ok();
                case "home":
                    App.Navigation.Navigate(typeof(Views.HomePage));
                    return RemoteOutcome.Ok();
                case "select":
                    if (!(FocusManager.GetFocusedElement() is FrameworkElement focused))
                    {
                        return RemoteOutcome.Failed("nothing focused");
                    }

                    var peer = FrameworkElementAutomationPeer.FromElement(focused);
                    if (peer?.GetPattern(PatternInterface.Invoke) is IInvokeProvider invoke)
                    {
                        invoke.Invoke();
                        return RemoteOutcome.Ok();
                    }

                    if (peer?.GetPattern(PatternInterface.Toggle) is IToggleProvider toggle)
                    {
                        toggle.Toggle();
                        return RemoteOutcome.Ok();
                    }

                    return RemoteOutcome.Failed("nothing focused");
                default:
                    return RemoteOutcome.Unsupported("unsupported key");
            }
        }

        private static RemoteOutcome Move(FocusNavigationDirection direction) =>
            FocusManager.TryMoveFocus(direction) ? RemoteOutcome.Ok() : RemoteOutcome.Failed("nothing to move to");
    }
}
