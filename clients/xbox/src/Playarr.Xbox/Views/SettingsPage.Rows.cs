using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Playarr.Core.Account;
using Playarr.Core.Localization;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Shapes;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Settings > Language, Invite a friend, Phone remote and Your data: the web's four sections (<c>settings/Language.tsx</c>,
    /// <c>Invite.tsx</c>, <c>Remote.tsx</c>, <c>YourData.tsx</c>) drawn in the shared right-hand panel, with the web's translated strings.
    /// </summary>
    public sealed partial class SettingsPage
    {
        private readonly List<DispatcherTimer> _timers = new List<DispatcherTimer>();
        private int _sectionTicket;

        private static string Capitalise(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);

        private DispatcherTimer Every(TimeSpan interval, Action tick)
        {
            var timer = new DispatcherTimer { Interval = interval };
            timer.Tick += (s, e) => tick();
            _timers.Add(timer);
            timer.Start();
            return timer;
        }

        /// <summary>Leaving a section (or the page) cancels its polling.</summary>
        private void StopSectionWork()
        {
            _sectionTicket++;
            foreach (var timer in _timers)
            {
                timer.Stop();
            }

            _timers.Clear();
        }

        private static TextBlock Heading(string text) => Ui.Text(text, 17.5, FontWeights.SemiBold, "PlayarrInk", new Thickness(0, 0, 0, 8));

        private static TextBlock Para(string text, bool hint = false)
        {
            var block = Ui.Text(text, hint ? 11 : 12, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 0, 0, 12));
            block.TextWrapping = TextWrapping.WrapWholeWords;
            return block;
        }

        private static TextBlock ErrorLine(string text)
        {
            var block = Ui.Text(text, 12, FontWeights.SemiBold, "PlayarrBrandInk", new Thickness(0, 0, 0, 12));
            block.TextWrapping = TextWrapping.WrapWholeWords;
            return block;
        }

        /// <summary>The web's primary button: ink fill, surface text.</summary>
        private static Button Primary(string text, Action click, bool enabled = true)
        {
            var button = Ui.Pill(text, click);
            button.Background = Ui.Res("PlayarrInk");
            ((TextBlock)button.Content).Foreground = Ui.Res("PlayarrSurfaceStrong");
            button.IsEnabled = enabled;
            return button;
        }

        private static Button Secondary(string text, Action click, bool enabled = true)
        {
            var button = Ui.Pill(text, click);
            button.IsEnabled = enabled;
            return button;
        }

        private static StackPanel Buttons(params Button[] buttons)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 4, 0, 14) };
            foreach (var button in buttons.Where(b => b != null))
            {
                row.Children.Add(button);
            }

            return row;
        }

        private static Rectangle Divider() => new Rectangle { Height = 1, Fill = Ui.Res("PlayarrLine"), Margin = new Thickness(0, 14, 0, 26) };

        private static string LocalTime(string iso, string format) =>
            DateTimeOffset.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var at)
                ? at.ToLocalTime().ToString(format)
                : iso;

        /// <summary>The web's QR tile: black modules on white, with the 12 px edge.</summary>
        private static FrameworkElement QrTile(string text, double size)
        {
            var modules = Playarr.Core.Auth.QrMatrix.Encode(text);
            var count = modules.GetLength(0);
            var group = new GeometryGroup();
            for (var y = 0; y < count; y++)
            {
                for (var x = 0; x < count; x++)
                {
                    if (modules[y, x])
                    {
                        group.Children.Add(new RectangleGeometry { Rect = new Windows.Foundation.Rect(x, y, 1, 1) });
                    }
                }
            }

            return new Border
            {
                Width = size,
                Height = size,
                Background = new SolidColorBrush(Colors.White),
                CornerRadius = new CornerRadius(6),
                HorizontalAlignment = HorizontalAlignment.Left,
                Margin = new Thickness(0, 4, 0, 12),
                Child = new Viewbox
                {
                    Margin = new Thickness(12),
                    Child = new Windows.UI.Xaml.Shapes.Path { Data = group, Fill = new SolidColorBrush(Colors.Black), Width = count, Height = count },
                },
            };
        }

        // ------------------------------------------------------------------ Language

        private bool _languageOpen;
        private string? _languageNote;
        private Button? _languageTrigger;

        /// <summary>Settings > Language: the web's picker (globe, current choice, chevron; a list of Auto, English, Thai, Japanese) and the auto-detect hint.</summary>
        private void RenderLanguage()
        {
            ExtraPanel.Children.Clear();
            var label = new Grid { ColumnSpacing = 12 };
            label.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            label.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            label.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            label.Children.Add(new FontIcon { Glyph = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 16, Foreground = Ui.Res("PlayarrInk"), VerticalAlignment = VerticalAlignment.Center });
            var current = Ui.Text(Lang.NameOf(Lang.Preference), 14, FontWeights.SemiBold, "PlayarrInk");
            current.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(current, 1);
            label.Children.Add(current);
            var chevron = new FontIcon { Glyph = _languageOpen ? "" : "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12, Foreground = Ui.Res("PlayarrInkSoft"), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(chevron, 2);
            label.Children.Add(chevron);
            _languageTrigger = new Button
            {
                Width = 380,
                Height = 56,
                Padding = new Thickness(18, 0, 18, 0),
                HorizontalAlignment = HorizontalAlignment.Left,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(Colors.Transparent),
                BorderBrush = Ui.Res("PlayarrLineStrong"),
                BorderThickness = new Thickness(1),
                Content = label,
                FocusVisualPrimaryBrush = Theme.FocusRing,
                FocusVisualPrimaryThickness = new Thickness(3),
                FocusVisualSecondaryThickness = new Thickness(0),
            };
            _languageTrigger.Click += (s, e) =>
            {
                _languageOpen = !_languageOpen;
                RenderLanguage();
                _languageTrigger?.Focus(FocusState.Programmatic);
            };
            ExtraPanel.Children.Add(_languageTrigger);

            if (_languageOpen)
            {
                var list = new StackPanel { Width = 380, Margin = new Thickness(0, 6, 0, 6), HorizontalAlignment = HorizontalAlignment.Left };
                var choices = new[] { Lang.SystemChoice }.Concat(Lang.Supported.Select(l => l.Key)).ToArray();
                foreach (var choice in choices)
                {
                    var selected = choice == Lang.Preference;
                    var row = new Grid();
                    row.Children.Add(new TextBlock { Text = Lang.NameOf(choice), FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = Ui.Res(selected ? "PlayarrSurfaceStrong" : "PlayarrInkSoft"), VerticalAlignment = VerticalAlignment.Center });
                    if (selected)
                    {
                        row.Children.Add(new TextBlock { Text = "✓", FontSize = 13, Foreground = Ui.Res("PlayarrSurfaceStrong"), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center });
                    }

                    var option = new Button
                    {
                        Height = 46,
                        Margin = new Thickness(0, 0, 0, 6),
                        Padding = new Thickness(18, 0, 16, 0),
                        HorizontalAlignment = HorizontalAlignment.Stretch,
                        HorizontalContentAlignment = HorizontalAlignment.Stretch,
                        CornerRadius = new CornerRadius(6),
                        Background = selected ? Ui.Res("PlayarrInk") : new SolidColorBrush(Colors.Transparent),
                        BorderBrush = Ui.Res("PlayarrLineStrong"),
                        BorderThickness = new Thickness(1),
                        Content = row,
                        FocusVisualPrimaryBrush = Theme.FocusRing,
                        FocusVisualPrimaryThickness = new Thickness(3),
                        FocusVisualSecondaryThickness = new Thickness(0),
                    };
                    var pick = choice;
                    option.Click += (s, e) =>
                    {
                        var changed = pick != Lang.Preference;
                        _languageOpen = false;
                        if (changed)
                        {
                            LanguageSetting.Save(pick);
                            _languageNote = Lang.T("settings.language.savedToast");
                            ApplyLanguage();
                        }
                        else
                        {
                            RenderLanguage();
                        }

                        _languageTrigger?.Focus(FocusState.Programmatic);
                    };
                    list.Children.Add(option);
                }

                ExtraPanel.Children.Add(list);
            }

            var hint = Para(Lang.T("settings.language.autoHint", "language", Lang.NameOf(Lang.Detected)), hint: true);
            hint.Margin = new Thickness(0, 14, 0, 12);
            ExtraPanel.Children.Add(hint);
            if (_languageNote != null)
            {
                ExtraPanel.Children.Add(Para(_languageNote));
                _languageNote = null;
            }
        }

        /// <summary>A language change redraws the page title, the section list and the open section in the new language.</summary>
        private void ApplyLanguage()
        {
            PageTitleText.Text = Lang.T("settings.index.title");
            var open = _openSection;
            TabsPanel.Children.Clear();
            _sections.Clear();
            BuildSections();
            ShowSection(open);
        }

        // ------------------------------------------------------------------ Invite a friend

        private UserInviteRequest? _invite;
        private bool _inviteLoaded;
        private bool _inviteSaving;
        private string? _inviteError;
        private string _inviteMessage = string.Empty;

        /// <summary>Settings > Invite a friend: ask the admin for one invite, then show its QR code once approved (web <c>settings/Invite.tsx</c>).</summary>
        private async void RenderInvite()
        {
            _inviteLoaded = false;
            DrawInvite();
            var ticket = _sectionTicket;
            await RefreshInviteAsync(ticket);
            Every(TimeSpan.FromSeconds(30), async () => await RefreshInviteAsync(ticket));
        }

        private async Task RefreshInviteAsync(int ticket)
        {
            try
            {
                var request = await App.Environment.ApiClient.GetMyUserInviteRequestAsync();
                if (ticket != _sectionTicket)
                {
                    return;
                }

                _invite = request;
                _inviteError = null;
            }
            catch (Exception error)
            {
                if (ticket != _sectionTicket)
                {
                    return;
                }

                _inviteError = error is ApiException api ? api.DisplayMessage : error.Message;
            }

            _inviteLoaded = true;
            if (!_inviteSaving && ticket == _sectionTicket)
            {
                DrawInvite();
            }
        }

        private void DrawInvite()
        {
            ExtraPanel.Children.Clear();
            if (!_inviteLoaded)
            {
                ExtraPanel.Children.Add(Para(Lang.T("settings.invite.checkingStatus")));
                return;
            }

            var status = _invite?.Status;
            ExtraPanel.Children.Add(Para(
                status == null ? Lang.T("settings.invite.statusNone")
                : status == "pending" ? Lang.T("settings.invite.statusPending")
                : status == "approved" ? Lang.T("settings.invite.statusApproved")
                : status == "denied" ? Lang.T("settings.invite.statusDenied")
                : Lang.T("settings.invite.statusGenerated")));
            if (_inviteError != null)
            {
                ExtraPanel.Children.Add(ErrorLine(_inviteError));
            }

            if (status == null || status == "denied" || status == "generated")
            {
                ExtraPanel.Children.Add(Ui.Text(Lang.T("settings.invite.messageLabel"), 12, FontWeights.SemiBold, "PlayarrInk", new Thickness(0, 0, 0, 8)));
                var box = new TextBox
                {
                    Text = _inviteMessage,
                    AcceptsReturn = true,
                    TextWrapping = TextWrapping.Wrap,
                    MaxLength = 500,
                    Height = 130,
                    PlaceholderText = Lang.T("settings.invite.messagePlaceholder"),
                    Margin = new Thickness(0, 0, 0, 16),
                };
                box.TextChanged += (s, e) => _inviteMessage = box.Text;
                ExtraPanel.Children.Add(box);
            }

            var label = _inviteSaving ? Lang.T("settings.invite.working")
                : status == "approved" ? Lang.T("settings.invite.generateQr")
                : status == "pending" ? Lang.T("settings.invite.requestPending")
                : Lang.T("settings.invite.requestQr");
            ExtraPanel.Children.Add(Buttons(Primary(label, () => { if (status == "approved") { GenerateInvite(); } else { RequestInvite(); } }, !_inviteSaving && status != "pending")));
        }

        private async void RequestInvite()
        {
            _inviteSaving = true;
            _inviteError = null;
            DrawInvite();
            try
            {
                _invite = await App.Environment.ApiClient.CreateUserInviteRequestAsync(_inviteMessage);
                _inviteMessage = string.Empty;
            }
            catch (Exception error)
            {
                _inviteError = error is ApiException api ? api.DisplayMessage : error.Message;
            }

            _inviteSaving = false;
            DrawInvite();
        }

        private async void GenerateInvite()
        {
            _inviteSaving = true;
            _inviteError = null;
            DrawInvite();
            try
            {
                var client = App.Environment.ApiClient;
                var invite = await client.GenerateApprovedUserInviteAsync();
                var link = InviteLink.Build(await InviteAddressesAsync(client), invite.InviteToken);
                _invite = await client.GetMyUserInviteRequestAsync();
                _inviteSaving = false;
                DrawInvite();
                await ShowInviteDialogAsync(link, invite.ExpiresAt);
                return;
            }
            catch (Exception error)
            {
                _inviteError = error is ApiException api ? api.DisplayMessage : error.Message;
            }

            _inviteSaving = false;
            DrawInvite();
        }

        /// <summary>
        /// The address bundle is admin-only (403 for a household member) and empty on a node never put in a group; both fall back to
        /// this client's own address, exactly as the web does, so the link still goes through the one <c>servers=</c> path.
        /// </summary>
        private static async Task<IList<PeerAddressEntry>> InviteAddressesAsync(IPlayarrApiClient client)
        {
            try
            {
                var bundle = await client.GetPeerAddressBundleAsync();
                if (bundle.Addresses.Count > 0)
                {
                    return bundle.Addresses;
                }
            }
            catch (ApiException error) when (error.StatusCode == System.Net.HttpStatusCode.Forbidden)
            {
            }

            return InviteLink.Fallback(client.BaseUrl.ToString().TrimEnd('/'));
        }

        /// <summary>The web's "Invite a friend to Playarr" modal: QR code, the link, its expiry, Close and Copy link.</summary>
        private async Task ShowInviteDialogAsync(string link, string expiresAt)
        {
            var body = new StackPanel { Spacing = 8, Width = 480 };
            body.Children.Add(new TextBlock { Text = Lang.T("settings.invite.modalDescription"), TextWrapping = TextWrapping.WrapWholeWords, Opacity = 0.8 });
            body.Children.Add(QrTile(link, 260));
            body.Children.Add(new TextBlock { Text = Lang.T("settings.invite.linkLabel"), FontWeight = FontWeights.SemiBold });
            body.Children.Add(new TextBox { Text = link, IsReadOnly = true });
            body.Children.Add(new TextBlock { Text = Lang.T("settings.invite.expires", "expiresAt", LocalTime(expiresAt, "g")), TextWrapping = TextWrapping.WrapWholeWords, Opacity = 0.7, FontSize = 12 });
            var dialog = new ContentDialog
            {
                Title = Lang.T("settings.invite.modalTitle"),
                Content = body,
                CloseButtonText = Lang.T("settings.invite.close"),
                PrimaryButtonText = Lang.T("settings.invite.copyLink"),
            };
            dialog.PrimaryButtonClick += (s, e) =>
            {
                // Copy and keep the dialog open, as the web does.
                e.Cancel = true;
                try
                {
                    var data = new Windows.ApplicationModel.DataTransfer.DataPackage();
                    data.SetText(link);
                    Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data);
                    dialog.PrimaryButtonText = Lang.T("settings.invite.copied");
                }
                catch (Exception)
                {
                    dialog.Title = Lang.T("settings.invite.copyFailed");
                }
            };
            await dialog.ShowAsync();
        }

        // ------------------------------------------------------------------ Phone remote

        private List<RemoteTarget> _targets = new List<RemoteTarget>();
        private List<RemotePairing> _pairings = new List<RemotePairing>();
        private Guid? _controlling;
        private RemotePairing? _pendingPairing;
        private string? _remoteError;
        private Guid? _renaming;
        private string _renameText = string.Empty;
        private string? _padError;

        /// <summary>Settings > Phone remote: allow this device to be controlled, pair with another device, drive it with the pad, manage pairings (web <c>settings/Remote.tsx</c>).</summary>
        private async void RenderRemote()
        {
            _pendingPairing = null;
            _remoteError = null;
            DrawRemote();
            var ticket = _sectionTicket;
            await RefreshRemoteAsync(ticket);
            // No live event covers devices coming and going, so the lists poll gently, as on the web.
            Every(TimeSpan.FromSeconds(15), async () => await RefreshRemoteAsync(ticket));
        }

        private async Task RefreshRemoteAsync(int ticket)
        {
            try
            {
                var client = App.Environment.ApiClient;
                var targets = await client.ListRemoteTargetsAsync();
                var pairings = await client.ListRemotePairingsAsync();
                if (ticket != _sectionTicket)
                {
                    return;
                }

                _targets = targets.ToList();
                _pairings = pairings.ToList();
            }
            catch (Exception)
            {
                if (ticket != _sectionTicket)
                {
                    return;
                }

                _remoteError = Lang.T("remote.settings.loadFailed");
            }

            if (_renaming == null)
            {
                DrawRemote();
            }
        }

        private RemotePairing? ActivePairingFor(Guid deviceId) =>
            _pairings.FirstOrDefault(p => p.TargetDeviceId == deviceId && p.Status == "active" && p.IsController);

        private string NameOf(Guid deviceId) => _targets.FirstOrDefault(t => t.DeviceId == deviceId)?.Name ?? Lang.T("remote.settings.unknownDevice");

        private void DrawRemote()
        {
            ExtraPanel.Children.Clear();
            ExtraPanel.Children.Add(Heading(Lang.T("remote.host.title")));
            var host = new CheckBox { Content = Lang.T("remote.host.toggle"), IsChecked = Services.RemoteHostService.Instance.Enabled, Margin = new Thickness(0, 0, 0, 6) };
            host.Click += (s, e) => Services.RemoteHostService.Instance.Enabled = host.IsChecked == true;
            ExtraPanel.Children.Add(host);
            ExtraPanel.Children.Add(Para(Lang.T("remote.host.hint"), hint: true));
            ExtraPanel.Children.Add(Divider());

            ExtraPanel.Children.Add(Heading(Lang.T("remote.targets.title")));
            var others = _targets.Where(t => !t.IsSelf).ToList();
            if (others.Count == 0)
            {
                ExtraPanel.Children.Add(Para(Lang.T("remote.targets.empty")));
            }

            foreach (var target in others)
            {
                var existing = ActivePairingFor(target.DeviceId);
                var status = !target.Online ? Lang.T("remote.targets.offline") : existing != null ? Lang.T("remote.targets.control") : Lang.T("remote.targets.pair");
                var line = new Grid();
                line.Children.Add(Ui.Text(target.Name, 14, FontWeights.SemiBold, "PlayarrInk"));
                var state = Ui.Text(status, 12, FontWeights.Normal, "PlayarrInkSoft");
                state.HorizontalAlignment = HorizontalAlignment.Right;
                line.Children.Add(state);
                var row = new Button
                {
                    Height = 56,
                    Width = 560,
                    Margin = new Thickness(0, 0, 0, 8),
                    Padding = new Thickness(18, 0, 18, 0),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    HorizontalContentAlignment = HorizontalAlignment.Stretch,
                    CornerRadius = new CornerRadius(8),
                    Background = new SolidColorBrush(Colors.Transparent),
                    BorderBrush = Ui.Res("PlayarrLineStrong"),
                    BorderThickness = new Thickness(1),
                    Content = line,
                    IsEnabled = target.Online && _pendingPairing == null,
                    FocusVisualPrimaryBrush = Theme.FocusRing,
                    FocusVisualPrimaryThickness = new Thickness(3),
                    FocusVisualSecondaryThickness = new Thickness(0),
                };
                var picked = target;
                row.Click += (s, e) =>
                {
                    if (existing != null)
                    {
                        _controlling = picked.DeviceId;
                        DrawRemote();
                    }
                    else
                    {
                        PairWith(picked);
                    }
                };
                ExtraPanel.Children.Add(row);
            }

            if (_pendingPairing != null)
            {
                ExtraPanel.Children.Add(Para(Lang.T("remote.targets.pairing", "name", NameOf(_pendingPairing.TargetDeviceId), "code", _pendingPairing.VerificationCode ?? string.Empty)));
            }

            if (_remoteError != null)
            {
                ExtraPanel.Children.Add(ErrorLine(_remoteError));
            }

            var control = _controlling is Guid controlled ? ActivePairingFor(controlled) : null;
            if (control != null && _controlling is Guid target2)
            {
                ExtraPanel.Children.Add(Divider());
                DrawPad(control, NameOf(target2));
            }

            ExtraPanel.Children.Add(Divider());
            ExtraPanel.Children.Add(Heading(Lang.T("remote.pairings.title")));
            var live = _pairings.Where(p => p.Status == "active" || p.Status == "pending").ToList();
            if (live.Count == 0)
            {
                ExtraPanel.Children.Add(Para(Lang.T("remote.pairings.empty")));
            }

            foreach (var pairing in live)
            {
                DrawPairing(pairing);
            }
        }

        private void DrawPairing(RemotePairing pairing)
        {
            var label = pairing.IsTarget ? pairing.ControllerName : NameOf(pairing.TargetDeviceId);
            var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
            if (_renaming == pairing.Id)
            {
                var box = new TextBox { Text = _renameText, MaxLength = 60, Header = Lang.T("remote.pairings.renameLabel"), Width = 480, HorizontalAlignment = HorizontalAlignment.Left };
                box.TextChanged += (s, e) => _renameText = box.Text;
                panel.Children.Add(box);
                panel.Children.Add(Buttons(
                    Primary(Lang.T("remote.pairings.save"), () => SaveRename(pairing.Id)),
                    Secondary(Lang.T("remote.pairings.cancel"), () => { _renaming = null; DrawRemote(); })));
            }
            else
            {
                panel.Children.Add(Ui.Text(label, 14, FontWeights.SemiBold, "PlayarrInk"));
                var scopes = string.Join(", ", pairing.Scopes);
                var detail = (pairing.IsTarget ? string.Empty : pairing.ControllerName + " · ") + scopes;
                panel.Children.Add(Ui.Text(detail, 12, FontWeights.Normal, "PlayarrInkSoft"));
                var meta = pairing.Status == "pending"
                    ? Lang.T("remote.pairings.pending")
                    : Lang.T("remote.pairings.pairedOn", "date", DateTimeOffset.FromUnixTimeMilliseconds(pairing.CreatedMs).LocalDateTime.ToString("d"), "expires", DateTimeOffset.FromUnixTimeMilliseconds(pairing.ExpiresMs).LocalDateTime.ToString("d"));
                panel.Children.Add(Ui.Text(meta, 11, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 2, 0, 0)));
                panel.Children.Add(Buttons(
                    Secondary(Lang.T("remote.pairings.rename"), () => { _renaming = pairing.Id; _renameText = pairing.ControllerName; DrawRemote(); }),
                    Secondary(Lang.T("remote.pairings.revoke"), () => Revoke(pairing))));
            }

            ExtraPanel.Children.Add(panel);
        }

        private async void PairWith(RemoteTarget target)
        {
            _remoteError = null;
            try
            {
                var pairing = await App.Environment.ApiClient.RequestRemotePairingAsync(target.DeviceId, "Xbox");
                if (pairing.Status == "active")
                {
                    _controlling = target.DeviceId;
                    await RefreshRemoteAsync(_sectionTicket);
                    return;
                }

                _pendingPairing = pairing;
                DrawRemote();
                WatchPairing(pairing, _sectionTicket);
            }
            catch (Exception)
            {
                _remoteError = Lang.T("remote.settings.pairFailed");
                DrawRemote();
            }
        }

        /// <summary>While a pairing is pending, poll every 2 s until the target approves or denies it (or it expires).</summary>
        private async void WatchPairing(RemotePairing pending, int ticket)
        {
            while (ticket == _sectionTicket && _pendingPairing?.Id == pending.Id)
            {
                await Task.Delay(2000);
                if (ticket != _sectionTicket)
                {
                    return;
                }

                if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= pending.ExpiresMs)
                {
                    _pendingPairing = null;
                    _remoteError = Lang.T("remote.settings.pairingNotApproved");
                    DrawRemote();
                    return;
                }

                try
                {
                    var next = await App.Environment.ApiClient.GetRemotePairingAsync(pending.Id);
                    if (next.Status == "pending")
                    {
                        continue;
                    }

                    _pendingPairing = null;
                    if (next.Status == "active")
                    {
                        _controlling = next.TargetDeviceId;
                    }
                    else
                    {
                        _remoteError = Lang.T("remote.settings.pairingNotApproved");
                    }

                    await RefreshRemoteAsync(ticket);
                    return;
                }
                catch (Exception)
                {
                    // A transient network error keeps waiting until the pairing expires.
                }
            }
        }

        private async void Revoke(RemotePairing pairing)
        {
            try
            {
                await App.Environment.ApiClient.RevokeRemotePairingAsync(pairing.Id);
                if (pairing.TargetDeviceId == _controlling)
                {
                    _controlling = null;
                }

                await RefreshRemoteAsync(_sectionTicket);
            }
            catch (Exception)
            {
                _remoteError = Lang.T("remote.settings.revokeFailed");
                DrawRemote();
            }
        }

        private async void SaveRename(Guid id)
        {
            if (string.IsNullOrWhiteSpace(_renameText))
            {
                return;
            }

            try
            {
                await App.Environment.ApiClient.RenameRemotePairingAsync(id, _renameText.Trim());
                _renaming = null;
                await RefreshRemoteAsync(_sectionTicket);
            }
            catch (Exception)
            {
                _remoteError = Lang.T("remote.settings.renameFailed");
                DrawRemote();
            }
        }

        /// <summary>The web's remote pad for one paired target: D-pad, OK / Back / Home, then transport and text when the pairing allows them.</summary>
        private void DrawPad(RemotePairing pairing, string targetName)
        {
            ExtraPanel.Children.Add(Heading(Lang.T("remote.pad.title", "name", targetName)));
            if (pairing.Scopes.Contains("navigate"))
            {
                var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 12) };
                for (var i = 0; i < 3; i++)
                {
                    grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
                    grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                }

                void Key(int row, int column, string key, string labelKey)
                {
                    var button = Secondary(Lang.T(labelKey), () => SendRemote(pairing, "navigate", "{\"key\":\"" + key + "\"}"));
                    button.HorizontalAlignment = HorizontalAlignment.Stretch;
                    Grid.SetRow(button, row);
                    Grid.SetColumn(button, column);
                    grid.Children.Add(button);
                }

                Key(0, 1, "up", "remote.pad.up");
                Key(1, 0, "left", "remote.pad.left");
                Key(1, 1, "select", "remote.pad.select");
                Key(1, 2, "right", "remote.pad.right");
                Key(2, 0, "back", "remote.pad.back");
                Key(2, 1, "down", "remote.pad.down");
                Key(2, 2, "home", "remote.pad.home");
                ExtraPanel.Children.Add(grid);
            }

            if (pairing.Scopes.Contains("playback"))
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 12) };
                row.Children.Add(Secondary(Lang.T("remote.pad.rewind"), () => SendRemote(pairing, "playback", "{\"action\":\"seek_by\",\"delta_ms\":-10000}")));
                row.Children.Add(Secondary(Lang.T("remote.pad.playPause"), () => SendRemote(pairing, "playback", "{\"action\":\"toggle\"}")));
                row.Children.Add(Secondary(Lang.T("remote.pad.forward"), () => SendRemote(pairing, "playback", "{\"action\":\"seek_by\",\"delta_ms\":10000}")));
                row.Children.Add(Secondary(Lang.T("remote.pad.stop"), () => SendRemote(pairing, "playback", "{\"action\":\"stop\"}")));
                ExtraPanel.Children.Add(row);
            }

            if (pairing.Scopes.Contains("text"))
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 12) };
                var box = new TextBox { Width = 420, PlaceholderText = Lang.T("remote.pad.textPlaceholder") };
                row.Children.Add(box);
                row.Children.Add(Secondary(Lang.T("remote.pad.enter"), () =>
                {
                    SendRemote(pairing, "text", "{\"value\":" + Newtonsoft.Json.JsonConvert.ToString(box.Text) + ",\"mode\":\"replace\",\"submit\":true}");
                    box.Text = string.Empty;
                }));
                ExtraPanel.Children.Add(row);
            }

            if (_padError != null)
            {
                ExtraPanel.Children.Add(ErrorLine(_padError));
            }
        }

        /// <summary>Sends one pad command and surfaces a failed execution (nothing focused, no text field) without blocking the pad.</summary>
        private async void SendRemote(RemotePairing pairing, string kind, string payloadJson)
        {
            _padError = null;
            var ticket = _sectionTicket;
            try
            {
                var client = App.Environment.ApiClient;
                var accepted = await client.SendRemoteCommandAsync(pairing.Id, kind, payloadJson);
                for (var attempt = 0; attempt < 6; attempt++)
                {
                    await Task.Delay(250);
                    var status = await client.GetRemoteCommandStatusAsync(accepted.CommandId);
                    if (status.Status == "ok")
                    {
                        return;
                    }

                    if (status.Status == "failed" || status.Status == "unsupported" || status.Status == "revoked" || status.Status == "expired")
                    {
                        _padError = status.Detail ?? Lang.T("remote.pad.failed");
                        break;
                    }
                }
            }
            catch (ApiException error)
            {
                _padError = error.Body?.Error == "target_offline" ? Lang.T("remote.pad.offline") : Lang.T("remote.pad.failed");
            }
            catch (Exception)
            {
                _padError = Lang.T("remote.pad.failed");
            }

            if (ticket == _sectionTicket && _padError != null)
            {
                DrawRemote();
            }
        }

        // ------------------------------------------------------------------ Your data

        private UserDataExportJob? _exportJob;
        private bool _exportBusy;
        private string? _exportError;
        private string? _exportLinkUrl;
        private string? _exportLinkExpires;
        private bool _exportLinkBusy;
        private UserDataImportSession? _session;
        private string? _uploadUrl;
        private bool _sessionBusy;
        private bool _sessionExpired;
        private bool _includePreferences;
        private int _conflicts;
        private UserDataImportPreview? _preview;
        private UserDataImportResult? _importResult;
        private bool _importBusy;
        private string? _importError;

        private string Conflicts => _conflicts == 1 ? "keep_existing" : "newest";

        private static string ErrorText(Exception error) => error is ApiException api ? api.DisplayMessage : error.Message;

        private static string FormatBytes(long? bytes) =>
            bytes == null ? string.Empty
            : bytes < 1024 ? bytes + " B"
            : bytes < 1024 * 1024 ? (bytes.Value / 1024.0).ToString("0.0") + " KB"
            : (bytes.Value / (1024.0 * 1024)).ToString("0.0") + " MB";

        /// <summary>
        /// Settings > Your data, the television flow of web <c>settings/YourData.tsx</c> (no file picker): the export's download link and the
        /// import's upload link are one-time QR codes for a phone or computer; the uploaded package is previewed here, then applied.
        /// </summary>
        private void RenderYourData()
        {
            DrawYourData();
        }

        private void DrawYourData()
        {
            ExtraPanel.Children.Clear();
            var job = _exportJob;
            var running = job != null && job.IsRunning;
            ExtraPanel.Children.Add(Heading(Lang.T("settings.yourData.exportTitle")));
            ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.exportDescription")));
            ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.scopeNote"), hint: true));
            ExtraPanel.Children.Add(Buttons(
                Primary(running ? Lang.T("settings.yourData.exportPreparing") : Lang.T("settings.yourData.exportStart"), StartExport, !_exportBusy && !running),
                job != null && job.Status == "ready"
                    ? Secondary(_exportLinkUrl != null ? Lang.T("settings.yourData.transferNewCode") : Lang.T("settings.yourData.transferShowDownloadCode"), ShowExportLink, !_exportLinkBusy)
                    : null!));
            if (job != null)
            {
                ExtraPanel.Children.Add(Para(
                    job.Status == "ready" ? Lang.T("settings.yourData.exportReady", "watch", job.Counts.WatchProgress.ToString(), "playlists", job.Counts.Playlists.ToString())
                    : job.Status == "failed" ? Lang.T("settings.yourData.exportFailed")
                    : job.Status == "expired" ? Lang.T("settings.yourData.exportExpired")
                    : Lang.T("settings.yourData.exportProgress", "stage", job.Progress.Stage)));
                if (job.Status == "ready" && job.ExpiresAt != null)
                {
                    ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.exportExpires", "time", LocalTime(job.ExpiresAt, "T")), hint: true));
                }
            }

            if (_exportLinkUrl != null)
            {
                ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferDownloadHelp")));
                ExtraPanel.Children.Add(QrTile(_exportLinkUrl, 280));
                if (_exportLinkExpires != null)
                {
                    ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferLinkExpires", "time", LocalTime(_exportLinkExpires, "T")), hint: true));
                }
            }

            if (_exportError != null)
            {
                ExtraPanel.Children.Add(ErrorLine(_exportError));
            }

            ExtraPanel.Children.Add(Divider());
            ExtraPanel.Children.Add(Heading(Lang.T("settings.yourData.importTitle")));
            ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.importDescription")));
            ExtraPanel.Children.Add(Buttons(
                Primary(_session != null ? Lang.T("settings.yourData.transferNewCode") : Lang.T("settings.yourData.transferStartUpload"), StartSession, !_sessionBusy && _session?.Status != "uploading"),
                _session != null ? Secondary(Lang.T("settings.yourData.transferCancel"), CancelSession) : null!));
            if (_session?.Status == "waiting" && _uploadUrl != null)
            {
                ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferUploadHelp")));
                ExtraPanel.Children.Add(QrTile(_uploadUrl, 280));
                ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferLinkExpires", "time", LocalTime(_session.ExpiresAt, "T")), hint: true));
            }

            if (_session?.Status == "uploading")
            {
                ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferReceiving")));
            }

            if (_session?.Status == "uploaded")
            {
                ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.transferReceived", "size", FormatBytes(_session.SizeBytes))));
            }

            if (_sessionExpired)
            {
                ExtraPanel.Children.Add(ErrorLine(Lang.T("settings.yourData.transferExpired")));
            }

            var conflicts = Drawer.Segmented(Lang.T("settings.yourData.conflictsLabel"), new[] { Lang.T("settings.yourData.conflictsNewest"), Lang.T("settings.yourData.conflictsKeep") }, _conflicts, i =>
            {
                _conflicts = i;
                _preview = null;
                _importResult = null;
                DrawYourData();
            });
            conflicts.Margin = new Thickness(0, 6, 0, 14);
            ExtraPanel.Children.Add(conflicts);
            var prefs = new CheckBox { Content = Lang.T("settings.yourData.includePreferences"), IsChecked = _includePreferences, Margin = new Thickness(0, 0, 0, 10) };
            prefs.Click += (s, e) =>
            {
                _includePreferences = prefs.IsChecked == true;
                _preview = null;
                _importResult = null;
                DrawYourData();
            };
            ExtraPanel.Children.Add(prefs);
            ExtraPanel.Children.Add(Buttons(Secondary(Lang.T("settings.yourData.previewButton"), PreviewImport, _session?.Status == "uploaded" && !_importBusy)));
            if (_importError != null)
            {
                ExtraPanel.Children.Add(ErrorLine(_importError));
            }

            if (_preview != null)
            {
                DrawPreview(_preview);
            }

            if (_importResult != null)
            {
                ExtraPanel.Children.Add(_importResult.Completed
                    ? Para(Lang.T("settings.yourData.resultDone", "added", (_importResult.ProgressAdded + _importResult.ProgressUpdated).ToString(), "items", _importResult.PlaylistItemsAdded.ToString()))
                    : ErrorLine(Lang.T("settings.yourData.resultFailed", "failure", _importResult.Failure ?? string.Empty)));
            }
        }

        private void DrawPreview(UserDataImportPreview preview)
        {
            ExtraPanel.Children.Add(Ui.Text(Lang.T("settings.yourData.previewTitle"), 14, FontWeights.SemiBold, "PlayarrInk", new Thickness(0, 6, 0, 8)));
            foreach (var warning in preview.Warnings)
            {
                ExtraPanel.Children.Add(Para(warning, hint: true));
            }

            string N(string section, string field) => preview.Count(section, field).ToString();
            ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewProgress", "add", N("watch_progress", "will_add"), "update", N("watch_progress", "will_update"), "same", N("watch_progress", "already_present"), "kept", N("watch_progress", "conflicts_kept"))));
            ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewPlaylists", "created", N("playlists", "new"), "items", N("playlists", "items_to_add"), "present", N("playlists", "items_already_present"))));
            if (preview.HasWatchlist)
            {
                ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewWatchlist", "add", N("watchlist", "will_add"), "same", N("watchlist", "already_present"), "unmatched", N("watchlist", "unmatched"))));
            }

            ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewUnmatched", "unmatched", preview.UnmatchedTotal.ToString(), "ambiguous", N("watch_progress", "ambiguous"))));
            var language = (string?)preview.Summary["preferred_audio_language_change"];
            if (!string.IsNullOrEmpty(language))
            {
                ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewLanguage", "language", language!)));
            }

            var choices = (int?)preview.Summary["playback_preferences_not_applied"] ?? 0;
            if (choices > 0)
            {
                ExtraPanel.Children.Add(Para("• " + Lang.T("settings.yourData.previewPlaybackChoices", "count", choices.ToString())));
            }

            ExtraPanel.Children.Add(Para(Lang.T("settings.yourData.confirmNote"), hint: true));
            ExtraPanel.Children.Add(Buttons(Primary(Lang.T("settings.yourData.applyButton"), ApplyImport, !_importBusy && _importResult == null)));
        }

        private async void StartExport()
        {
            _exportLinkUrl = null;
            _exportBusy = true;
            _exportError = null;
            DrawYourData();
            var ticket = _sectionTicket;
            try
            {
                _exportJob = await App.Environment.ApiClient.StartUserDataExportAsync();
                _exportBusy = false;
                DrawYourData();
                // Poll every 0.8 s while the server prepares the package.
                while (_exportJob != null && _exportJob.IsRunning && ticket == _sectionTicket)
                {
                    await Task.Delay(800);
                    if (ticket != _sectionTicket)
                    {
                        return;
                    }

                    _exportJob = await App.Environment.ApiClient.GetUserDataExportAsync(_exportJob.Id);
                    DrawYourData();
                }
            }
            catch (Exception error)
            {
                if (ticket != _sectionTicket)
                {
                    return;
                }

                _exportError = ErrorText(error);
            }

            _exportBusy = false;
            DrawYourData();
        }

        private async void ShowExportLink()
        {
            if (_exportJob == null)
            {
                return;
            }

            _exportLinkBusy = true;
            _exportError = null;
            DrawYourData();
            try
            {
                var link = await App.Environment.ApiClient.CreateUserDataTransferLinkAsync(_exportJob.Id);
                _exportLinkUrl = link.Url ?? App.Environment.ApiClient.ResolveUrl(link.Path)?.ToString();
                _exportLinkExpires = link.ExpiresAt;
            }
            catch (Exception error)
            {
                _exportError = ErrorText(error);
            }

            _exportLinkBusy = false;
            DrawYourData();
        }

        private async void StartSession()
        {
            var ticket = _sectionTicket;
            _sessionBusy = true;
            _sessionExpired = false;
            _importError = null;
            _preview = null;
            _importResult = null;
            DrawYourData();
            try
            {
                var created = await App.Environment.ApiClient.CreateUserDataImportSessionAsync();
                _session = created;
                _uploadUrl = created.UploadUrl ?? (created.UploadPath != null ? App.Environment.ApiClient.ResolveUrl(created.UploadPath)?.ToString() : null);
                _sessionBusy = false;
                DrawYourData();
                PollSession(created.Id, ticket);
            }
            catch (Exception error)
            {
                _session = null;
                _uploadUrl = null;
                _importError = ErrorText(error);
                _sessionBusy = false;
                DrawYourData();
            }
        }

        /// <summary>Polls every 2 s until the other device has uploaded (or the session runs out), then previews.</summary>
        private async void PollSession(string id, int ticket)
        {
            var guard = ++_sessionPoll;
            while (ticket == _sectionTicket && guard == _sessionPoll)
            {
                await Task.Delay(2000);
                if (ticket != _sectionTicket || guard != _sessionPoll)
                {
                    return;
                }

                try
                {
                    var next = await App.Environment.ApiClient.GetUserDataImportSessionAsync(id);
                    if (ticket != _sectionTicket || guard != _sessionPoll)
                    {
                        return;
                    }

                    _session = next;
                    DrawYourData();
                    if (next.Status == "uploaded")
                    {
                        PreviewImport();
                        return;
                    }
                }
                catch (ApiException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound || error.StatusCode == System.Net.HttpStatusCode.Gone)
                {
                    _sessionExpired = true;
                    _uploadUrl = null;
                    DrawYourData();
                    return;
                }
                catch (Exception error)
                {
                    _importError = ErrorText(error);
                    DrawYourData();
                    return;
                }
            }
        }

        private int _sessionPoll;

        private async void CancelSession()
        {
            _sessionPoll++;
            var id = _session?.Id;
            _session = null;
            _uploadUrl = null;
            _preview = null;
            _importResult = null;
            _sessionExpired = false;
            DrawYourData();
            if (id != null)
            {
                try
                {
                    await App.Environment.ApiClient.DeleteUserDataImportSessionAsync(id);
                }
                catch (Exception)
                {
                    // The session may already have expired; nothing is left to close.
                }
            }
        }

        private async void PreviewImport()
        {
            if (_session == null)
            {
                return;
            }

            _importBusy = true;
            _importError = null;
            _importResult = null;
            DrawYourData();
            try
            {
                _preview = await App.Environment.ApiClient.PreviewUserDataImportSessionAsync(_session.Id, _includePreferences, Conflicts);
            }
            catch (Exception error)
            {
                _preview = null;
                _importError = ErrorText(error);
            }

            _importBusy = false;
            DrawYourData();
        }

        private async void ApplyImport()
        {
            if (_preview == null || _session == null)
            {
                return;
            }

            _importBusy = true;
            _importError = null;
            DrawYourData();
            try
            {
                _importResult = await App.Environment.ApiClient.ApplyUserDataImportSessionAsync(_session.Id, _preview.PackageSha256, _includePreferences, Conflicts);
                if (_importResult.Completed)
                {
                    // The server closes the session once everything applied.
                    _session = null;
                    _uploadUrl = null;
                }
            }
            catch (Exception error)
            {
                _importError = ErrorText(error);
            }

            _importBusy = false;
            DrawYourData();
        }
    }
}
