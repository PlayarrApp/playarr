using System;
using System.IO;
using System.Net.Http;
using System.Net;
using System.Threading.Tasks;
using Windows.ApplicationModel.DataTransfer;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Shapes;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Xbox.Services;

namespace Playarr.Xbox.Views
{
    /// <summary>The web Calendar link drawer. Opening follows its status-first, non-rotating flow.</summary>
    internal sealed class CalendarLinkPanel
    {
        private readonly StackPanel _body = new StackPanel { Spacing = 12 };
        private readonly TextBlock _state = new TextBlock
        {
            Text = "Getting your link\u2026",
            FontSize = 11,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = Ui.Res("PlayarrInkSoft"),
        };
        private readonly TextBlock _error = new TextBlock
        {
            Visibility = Visibility.Collapsed,
            FontSize = 11,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = new SolidColorBrush(Theme.BrandInk),
        };
        private readonly TextBox _url = new TextBox
        {
            Visibility = Visibility.Collapsed,
            IsReadOnly = true,
            FontSize = 10,
            TextWrapping = TextWrapping.NoWrap,
            Background = Ui.Res("PlayarrSurface"),
            BorderBrush = Ui.Res("PlayarrLineStrong"),
            Foreground = Ui.Res("PlayarrInk"),
            FontFamily = (FontFamily)Application.Current.Resources["PlayarrMonoFont"],
        };
        private readonly Border _qr = new Border
        {
            Visibility = Visibility.Collapsed,
            Width = 168,
            Height = 168,
            Padding = new Thickness(10),
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Colors.White),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        private readonly TextBlock _qrLabel = new TextBlock
        {
            Visibility = Visibility.Collapsed,
            Text = "Scan to add to your phone's calendar",
            FontSize = 10,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = Ui.Res("PlayarrInkSoft"),
        };
        private readonly Button _copy = new Button
        {
            Visibility = Visibility.Collapsed,
            Content = "Copy link",
            MinWidth = 110,
            Height = 42,
            CornerRadius = new CornerRadius(21),
            Background = Ui.Res("PlayarrInk"),
            Foreground = Ui.Res("PlayarrSurfaceStrong"),
        };
        private readonly Button _retry = new Button
        {
            Visibility = Visibility.Collapsed,
            Content = "Try again",
            MinWidth = 100,
            Height = 42,
            CornerRadius = new CornerRadius(21),
            Background = Ui.Res("PlayarrSurface"),
            Foreground = Ui.Res("PlayarrInk"),
            BorderBrush = Ui.Res("PlayarrLineStrong"),
            BorderThickness = new Thickness(1),
        };
        private readonly TextBlock _otherDevice = new TextBlock
        {
            Visibility = Visibility.Collapsed,
            Text = "Your link was created on another device and is not stored here. Reset it to get a new link to copy.",
            FontSize = 10.5,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = Ui.Res("PlayarrInkSoft"),
        };
        private readonly Button _reset = new Button
        {
            Visibility = Visibility.Collapsed,
            Content = "Reset link",
            MinWidth = 110,
            Height = 42,
            CornerRadius = new CornerRadius(21),
            Background = Ui.Res("PlayarrSurface"),
            Foreground = Ui.Res("PlayarrInk"),
            BorderBrush = Ui.Res("PlayarrLineStrong"),
            BorderThickness = new Thickness(1),
        };
        private readonly StackPanel _confirmation = new StackPanel { Visibility = Visibility.Collapsed, Spacing = 8 };
        private readonly TextBlock _confirmText = new TextBlock
        {
            Text = "Resetting makes a new link and the current link stops working straight away. Calendars using it will need the new link.",
            FontSize = 10.5,
            TextWrapping = TextWrapping.WrapWholeWords,
            Foreground = Ui.Res("PlayarrInkSoft"),
        };
        private readonly Button _confirmReset = new Button
        {
            Content = "Confirm reset",
            MinWidth = 110,
            Height = 42,
            CornerRadius = new CornerRadius(21),
            Background = Ui.Res("PlayarrInk"),
            Foreground = Ui.Res("PlayarrSurfaceStrong"),
        };
        private readonly Button _cancelReset = new Button
        {
            Content = "Cancel",
            MinWidth = 90,
            Height = 42,
            CornerRadius = new CornerRadius(21),
            Background = Ui.Res("PlayarrSurface"),
            Foreground = Ui.Res("PlayarrInk"),
            BorderBrush = Ui.Res("PlayarrLineStrong"),
            BorderThickness = new Thickness(1),
        };
        private string? _link;
        private bool _needsReset;
        private bool _busy;

        private CalendarLinkPanel()
        {
            ScrollViewer.SetHorizontalScrollBarVisibility(_url, ScrollBarVisibility.Auto);
            AddText("Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.", 10.5, "PlayarrInkSoft");
            _body.Children.Add(_error);
            _body.Children.Add(_state);
            _body.Children.Add(_url);
            _copy.Click += (s, e) => CopyLink();
            _body.Children.Add(_copy);
            _body.Children.Add(_qrLabel);
            _body.Children.Add(_qr);
            _body.Children.Add(_otherDevice);

            var heading = AddText("ADD IT TO YOUR CALENDAR APP", 9, "PlayarrInkSoft");
            heading.FontWeight = FontWeights.Bold;
            heading.CharacterSpacing = 120;
            AddText("Google Calendar: Other calendars (+) > From URL, then paste the link.", 10, "PlayarrInkSoft");
            AddText("Apple Calendar: File > New Calendar Subscription, then paste the link.", 10, "PlayarrInkSoft");
            AddText("Outlook: Add calendar > Subscribe from web, then paste the link.", 10, "PlayarrInkSoft");

            _reset.Click += (s, e) => ShowConfirmation(true);
            _body.Children.Add(_reset);
            _confirmation.Children.Add(_confirmText);
            var confirmationActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            _confirmReset.Click += async (s, e) => await ResetAsync();
            _cancelReset.Click += (s, e) => ShowConfirmation(false);
            confirmationActions.Children.Add(_confirmReset);
            confirmationActions.Children.Add(_cancelReset);
            _confirmation.Children.Add(confirmationActions);
            _body.Children.Add(_confirmation);

            _retry.Click += async (s, e) => await LoadAsync();
            _body.Children.Add(_retry);
        }

        public static void Open(Panel host)
        {
            var panel = new CalendarLinkPanel();
            Drawer.Open(host, "Calendar", "Calendar link", panel._body);
            _ = panel.LoadAsync();
        }

        private TextBlock AddText(string text, double size, string brushKey)
        {
            var block = new TextBlock
            {
                Text = text,
                FontSize = size,
                TextWrapping = TextWrapping.WrapWholeWords,
                Foreground = Ui.Res(brushKey),
                LineHeight = size * 1.5,
            };
            _body.Children.Add(block);
            return block;
        }

        private async Task LoadAsync()
        {
            if (_busy) return;
            _busy = true;
            SetBusy(true);
            _error.Visibility = Visibility.Collapsed;
            _retry.Visibility = Visibility.Collapsed;
            try
            {
                var profileId = await App.Environment.GetSignedInProfileIdAsync();
                var stored = CalendarFeedUrlStore.Load(App.Environment.ServerUrl, profileId);
                var result = await CalendarFeedLinkFlow.OpenAsync(App.Environment.ApiClient, stored);
                _needsReset = result.Kind == CalendarFeedOpenKind.NeedsReset;
                if (result.Url is { Length: > 0 } url)
                {
                    _link = url;
                    try { CalendarFeedUrlStore.Save(App.Environment.ServerUrl, profileId, url); } catch (Exception) { }
                    _state.Text = string.Empty;
                }
                else if (_needsReset)
                {
                    _link = null;
                    _state.Text = string.Empty;
                }
                else
                {
                    throw new InvalidDataException("The server did not return a calendar link.");
                }

                RenderLink();
            }
            catch (Exception error)
            {
                _link = null;
                _needsReset = false;
                _error.Text = FailureText(error);
                _error.Visibility = Visibility.Visible;
                _state.Text = string.Empty;
                _retry.Visibility = Visibility.Visible;
                RenderLink();
            }
            finally
            {
                SetBusy(false);
                _busy = false;
            }
        }

        private async Task ResetAsync()
        {
            if (_busy) return;
            _busy = true;
            SetBusy(true);
            _error.Visibility = Visibility.Collapsed;
            try
            {
                var url = await CalendarFeedLinkFlow.ResetAsync(App.Environment.ApiClient);
                var profileId = await App.Environment.GetSignedInProfileIdAsync();
                _link = url;
                _needsReset = false;
                try { CalendarFeedUrlStore.Save(App.Environment.ServerUrl, profileId, url); } catch (Exception) { }
                ShowConfirmation(false);
                RenderLink();
            }
            catch (Exception error)
            {
                _error.Text = FailureText(error);
                _error.Visibility = Visibility.Visible;
                _retry.Visibility = Visibility.Visible;
            }
            finally
            {
                SetBusy(false);
                _busy = false;
            }
        }

        private void RenderLink()
        {
            var hasLink = !string.IsNullOrEmpty(_link);
            _url.Text = _link ?? string.Empty;
            _copy.Content = "Copy link";
            _url.Visibility = hasLink ? Visibility.Visible : Visibility.Collapsed;
            _copy.Visibility = hasLink ? Visibility.Visible : Visibility.Collapsed;
            _qrLabel.Visibility = hasLink ? Visibility.Visible : Visibility.Collapsed;
            _qr.Child = hasLink ? DrawQr(_link!) : null;
            _qr.Visibility = hasLink ? Visibility.Visible : Visibility.Collapsed;
            _otherDevice.Visibility = _needsReset && !hasLink ? Visibility.Visible : Visibility.Collapsed;
            _reset.Visibility = hasLink || _needsReset ? Visibility.Visible : Visibility.Collapsed;
        }

        private void SetBusy(bool busy)
        {
            _state.Text = busy && string.IsNullOrEmpty(_link) ? "Getting your link\u2026" : _state.Text;
            _copy.IsEnabled = !busy;
            _reset.IsEnabled = !busy;
            _retry.IsEnabled = !busy;
            _confirmReset.IsEnabled = !busy;
            _cancelReset.IsEnabled = !busy;
        }

        private void ShowConfirmation(bool visible)
        {
            _confirmation.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            _reset.Visibility = visible ? Visibility.Collapsed : (_link != null || _needsReset ? Visibility.Visible : Visibility.Collapsed);
        }

        private void CopyLink()
        {
            if (string.IsNullOrEmpty(_link)) return;
            try
            {
                var package = new DataPackage();
                package.SetText(_link);
                Clipboard.SetContent(package);
                _copy.Content = "Copied";
            }
            catch (Exception)
            {
                _error.Text = "Could not copy the link. Select the address and copy it manually.";
                _error.Visibility = Visibility.Visible;
            }
        }

        private static UIElement DrawQr(string text)
        {
            var modules = QrMatrix.Encode(text);
            var size = modules.GetLength(0);
            var geometry = new GeometryGroup();
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    if (modules[y, x]) geometry.Children.Add(new RectangleGeometry { Rect = new Windows.Foundation.Rect(x, y, 1, 1) });
                }
            }

            return new Viewbox
            {
                Stretch = Stretch.Uniform,
                Child = new ShapesPath
                {
                    Data = geometry,
                    Fill = new SolidColorBrush(Colors.Black),
                    Width = size,
                    Height = size,
                },
            };
        }

        private static string FailureText(Exception error)
        {
            if (error is ApiException api)
            {
                if (api.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    return "Your sign-in has expired. Sign in again to get your calendar link.";
                var status = (int?)api.StatusCode;
                if (status is 404 or 405 or 501)
                    return "This server version does not support calendar links yet. Ask your server admin to update Playarr Server.";
                if (api.Kind == ApiErrorKind.Transport)
                    return "Could not reach your Playarr server. Check your connection and that the server is online, then try again.";
            }

            if (error is HttpRequestException)
                return "Could not reach your Playarr server. Check your connection and that the server is online, then try again.";
            return "Something went wrong getting your calendar link. Try again.";
        }

        private sealed class ShapesPath : Windows.UI.Xaml.Shapes.Path { }
    }
}
