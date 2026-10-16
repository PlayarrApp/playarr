using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Playarr.Core.Playback;
using Playarr.Xbox.Services;
using Windows.Storage;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Device-parity test hook (docs/parity/SUITE.md). A device has no accessibility query a test can read, so while the
    /// marker file <c>parity.on</c> exists in the app's LocalState the app writes <c>parity.json</c> there with the
    /// screen it is on, the open panel and the label of the focused item, in the web's terms. Off by default: without
    /// the marker file nothing is written and no timer runs.
    /// </summary>
    internal static class ParityTrace
    {
        private static string _last = string.Empty;
        private static int _seq;
        private static bool _writing;
        private static string _checkedAccountKey = string.Empty;
        private static bool _checkedAccountMatches;
        private static string _playerFixtureStatus = "idle";
        private static string _playerFixtureNonce = string.Empty;

        public static void StartIfRequested(Frame frame)
        {
            var folder = ApplicationData.Current.LocalFolder;
            if (!System.IO.File.Exists(System.IO.Path.Combine(folder.Path, "parity.on")))
            {
                return;
            }

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            timer.Tick += async (s, e) =>
            {
                await TickAsync(frame, folder.Path);
            };
            timer.Start();
        }

        private static async System.Threading.Tasks.Task TickAsync(Frame frame, string folder)
        {
            if (_writing)
            {
                return;
            }

            _writing = true;
            try
            {
                var (accountProbe, accountMatchesTest) = await CheckTestAccountAsync(folder);
                if (accountMatchesTest)
                {
                    var playFile = System.IO.Path.Combine(folder, "parity.play");
                    if (System.IO.File.Exists(playFile))
                    {
                        (_, accountMatchesTest) = await CheckTestAccountAsync(folder, true);
                    }

                    if (accountMatchesTest)
                    {
                        await PlayRequestedAsync(frame, folder);
                        ResizeRequested(folder);
                        await PauseRequestedAsync(frame, folder);
                    }
                }

                Write(frame, folder, accountProbe, accountMatchesTest);
            }
            catch (Exception)
            {
                _last = string.Empty;
                // Leave any previous response in place. Its nonce cannot acknowledge the next probe.
            }
            finally
            {
                _writing = false;
            }
        }

        private static async System.Threading.Tasks.Task<(string?, bool)> CheckTestAccountAsync(string folder, bool forceRefresh = false)
        {
            var expectedUserFile = System.IO.Path.Combine(folder, "parity.expected-user");
            if (!System.IO.File.Exists(expectedUserFile))
            {
                return (null, false);
            }

            var marker = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, string>>(System.IO.File.ReadAllText(expectedUserFile));
            if (marker == null || !marker.TryGetValue("userId", out var expectedUser) || !marker.TryGetValue("nonce", out var nonce)
                || !marker.TryGetValue("serverUrl", out var expectedServer) || !Guid.TryParse(expectedUser, out var expectedUserId)
                || !Uri.TryCreate(expectedServer, UriKind.Absolute, out var expectedServerUrl) || string.IsNullOrWhiteSpace(nonce))
            {
                return (null, false);
            }

            var key = nonce + ":" + expectedUserId.ToString("N") + ":" + expectedServerUrl.AbsoluteUri;
            if (!forceRefresh && key == _checkedAccountKey)
            {
                return (nonce, _checkedAccountMatches);
            }

            var serverMatches = Uri.Compare(App.Environment.ServerUrl, expectedServerUrl, UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.SafeUnescaped, StringComparison.Ordinal) == 0;
            var currentProfiles = (await App.Environment.ApiClient.ListProfilesAsync()).Where(profile => profile.IsCurrent).ToList();
            _checkedAccountMatches = serverMatches && currentProfiles.Count == 1 && currentProfiles[0].Id == expectedUserId;
            _checkedAccountKey = key;
            return (nonce, _checkedAccountMatches);
        }

        /// <summary>A <c>parity.pause</c> file pauses the player on its current frame (identical-frame screenshots).</summary>
        private static async System.Threading.Tasks.Task PauseRequestedAsync(Frame frame, string folder)
        {
            var file = System.IO.Path.Combine(folder, "parity.pause");
            try
            {
                if (System.IO.File.Exists(file) && frame.Content is PlayerPage player)
                {
                    var text = System.IO.File.ReadAllText(file).Trim();
                    System.IO.File.Delete(file);
                    var settled = await player.PauseForTestAsync(double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) ? seconds : (double?)null);
                    if (!settled)
                    {
                        _playerFixtureStatus = "seek-timeout";
                    }
                }
            }
            catch (Exception)
            {
            }
        }

        /// <summary>Desktop-window tests: a <c>parity.resize</c> file holding "1280x720" resizes the window.</summary>
        private static void ResizeRequested(string folder)
        {
            var file = System.IO.Path.Combine(folder, "parity.resize");
            try
            {
                if (System.IO.File.Exists(file))
                {
                    var size = System.IO.File.ReadAllText(file).Trim().Split('x');
                    System.IO.File.Delete(file);
                    var view = Windows.UI.ViewManagement.ApplicationView.GetForCurrentView();
                    var ok = view.IsFullScreenMode ? view.TryResizeView(new Windows.Foundation.Size(1, 1)) : view.TryResizeView(new Windows.Foundation.Size(double.Parse(size[0]), double.Parse(size[1])));
                    System.IO.File.WriteAllText(file + ".result", $"ok={ok} fullscreen={view.IsFullScreenMode} visible={Windows.UI.Xaml.Window.Current.Bounds}");
                }
            }
            catch (Exception)
            {
            }
        }

        /// <summary>Resolves the neutral player fixture and verifies Xbox playback negotiation before opening it.</summary>
        private static async System.Threading.Tasks.Task PlayRequestedAsync(Frame frame, string folder)
        {
            var file = System.IO.Path.Combine(folder, "parity.play");
            try
            {
                if (!System.IO.File.Exists(file))
                {
                    return;
                }

                var request = System.IO.File.ReadAllText(file).Trim();
                System.IO.File.Delete(file);
                const string fixturePrefix = "fixture:";
                if (request.StartsWith(fixturePrefix, StringComparison.Ordinal))
                {
                    var requestParts = request.Substring(fixturePrefix.Length).Split(':');
                    if (requestParts.Length != 2 || !Guid.TryParse(requestParts[0], out var requestedMediaFileId) || !Guid.TryParse(requestParts[1], out _))
                    {
                        _playerFixtureStatus = "fixture-unavailable";
                        return;
                    }

                    _playerFixtureNonce = requestParts[1];
                    _playerFixtureStatus = "checking";
                    var profile = XboxPlaybackProfile.ForModel(XboxModelDetector.DetectModel());
                    var caps = DeviceCapsProvider.Current(profile);
                    var info = await App.Environment.ApiClient.GetPlaybackInfoAsync(requestedMediaFileId, profile, default, caps);
                    if (!DirectPlayFixturePolicy.IsDirect(info.Mode))
                    {
                        _playerFixtureStatus = "not-direct";
                        return;
                    }

                    _playerFixtureStatus = "direct-preflight";
                    frame.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(
                        requestedMediaFileId,
                        requireDirectPlay: true));
                    return;
                }

                // The performance suite retains its pinned-file path; parity player screens use the guarded neutral fixture above.
                if (Guid.TryParse(request, out var id))
                {
                    frame.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(id));
                }
            }
            catch (Playarr.Core.Networking.ApiException error)
            {
                _playerFixtureStatus = $"fixture-{error.SafeDiagnosticCode()}";
            }
            catch (Exception)
            {
                _playerFixtureStatus = "fixture-unexpected-error";
            }
        }

        private static void Write(Frame frame, string folder, string? accountProbe, bool accountMatchesTest)
        {
            try
            {
                var (screen, kind) = Screen(frame.Content);
                var panel = Drawer.Current?.Title ?? string.Empty;
                var focus = Describe(FocusManager.GetFocusedElement() as DependencyObject, frame.Content);
                var focusArea = FocusArea(FocusManager.GetFocusedElement() as DependencyObject);
                var initialFocusPending = frame.Content is LibraryPage library && library.InitialFocusPending;
                var play = frame.Content is PlayerPage player ? player.Probe() : ("", 0.0);
                var playerMode = frame.Content is PlayerPage playerPage ? playerPage.PlaybackMode : string.Empty;
                var themeTargets = frame.Content is SettingsPage settings ? ThemeTargets(settings) : Array.Empty<object>();
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(new { screen, kind, panel, focus, focusArea, initialFocusPending, play = play.Item1, pos = Math.Round(play.Item2, 1), playerMode, playerFixture = _playerFixtureStatus, playerFixtureNonce = _playerFixtureNonce, code = (frame.Content as LoginPage)?.PairingCode, position = Position(FocusManager.GetFocusedElement() as DependencyObject, frame.Content), themeChoice = Theme.Choice, themeIsLight = Theme.IsLight, themeTargets, accountProbe, accountMatchesTest });
                if (json == _last)
                {
                    return;
                }

                _last = json;
                _seq++;
                System.IO.File.WriteAllText(System.IO.Path.Combine(folder, "parity.json"), json.Substring(0, json.Length - 1) + ",\"seq\":" + _seq + "}");
            }
            catch (Exception)
            {
                _last = string.Empty;
                // Leave any previous response in place. Its nonce cannot acknowledge the next probe.
            }
        }

        private static object[] ThemeTargets(DependencyObject root)
        {
            var targets = new List<object>();
            if (root is FrameworkElement page)
            {
                Visit(root, page, targets);
            }

            return targets.ToArray();
        }

        /// <summary>Safe semantic focus location for capture diagnostics; never includes the focused item's label.</summary>
        private static string FocusArea(DependencyObject? element)
        {
            var withinControl = false;
            for (var node = element; node != null; node = VisualTreeHelper.GetParent(node))
            {
                if (node is Button { Tag: string tag } && tag.StartsWith("nav:", StringComparison.Ordinal))
                {
                    return "nav";
                }

                if (node is SelectorItem)
                {
                    return "grid";
                }

                if (node is Control)
                {
                    withinControl = true;
                }
            }

            return withinControl ? "control" : "none";
        }

        private static void Visit(DependencyObject node, FrameworkElement page, List<object> targets)
        {
            if (node is Button button)
            {
                var id = AutomationProperties.GetAutomationId(button);
                if (id.StartsWith("appearance.theme.", StringComparison.Ordinal)
                    && int.TryParse(id.Substring("appearance.theme.".Length), out var index)
                    && index >= 0 && index < 3
                    && page.ActualWidth > 0 && page.ActualHeight > 0 && button.ActualWidth > 0 && button.ActualHeight > 0)
                {
                    // The app's Viewbox maps the fixed design to window pixels. Return the button in that 1920x1080
                    // design space because the parity pointer contract also uses design pixels at every window size.
                    var origin = button.TransformToVisual(page).TransformPoint(new Windows.Foundation.Point(0, 0));
                    var scaleX = 1920 / page.ActualWidth;
                    var scaleY = 1080 / page.ActualHeight;
                    targets.Add(new { choice = new[] { Theme.System, Theme.Light, Theme.Dark }[index], x = Math.Round(origin.X * scaleX, 1), y = Math.Round(origin.Y * scaleY, 1), width = Math.Round(button.ActualWidth * scaleX, 1), height = Math.Round(button.ActualHeight * scaleY, 1) });
                }
            }

            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                Visit(VisualTreeHelper.GetChild(node, i), page, targets);
            }
        }

        /// <summary>Screen and kind in the suite's web terms (home, browse/movie, calendar/month, detail/series, ...).</summary>
        private static (string, string) Screen(object? page) => page switch
        {
            HomePage _ => ("home", string.Empty),
            LibraryPage lib => ("browse", lib.Kind switch { WorkKind.Movie => "movie", WorkKind.Series => "series", WorkKind.Artist => "artist", _ => "all" }),
            CalendarPage cal => ("calendar", cal.View.ToString().ToLowerInvariant()),
            SearchPage _ => ("search", string.Empty),
            SettingsPage _ => ("settings", string.Empty),
            ProfilesPage _ => ("profiles", string.Empty),
            PlayerPage _ => ("playback", string.Empty),
            WorkDetailPage detail => ("detail", detail.Kind == WorkKind.Series ? "series" : "movie"),
            LoginPage _ => ("pairing", string.Empty),
            _ => (page?.GetType().Name.Replace("Page", string.Empty).ToLowerInvariant() ?? string.Empty, string.Empty),
        };

        /// <summary>
        /// The focused item's label as the web exposes it: a Home card reads "title" + "Kind · year", a library card
        /// "open title", a button its text (the actions drawer's Play keeps the web's glyph).
        /// </summary>
        private static string? Describe(DependencyObject? element, object? page)
        {
            for (var node = element; node != null; node = VisualTreeHelper.GetParent(node))
            {
                if (node is SelectorItem { ContentTemplateRoot: Panel card } && card.Children.Count > 1)
                {
                    var texts = card.Children.OfType<TextBlock>().Select(t => t.Text).ToList();
                    return card.Children.Count >= 3 ? string.Concat(texts) : "open " + texts.FirstOrDefault();
                }

                if (node is Button button)
                {
                    // Icon glyphs live in the Segoe MDL2 private-use range: they are not part of the label.
                    var texts = Texts(button).Select(t => new string(t.Where(c => c < '\ue000' || c > '\uf8ff').ToArray()).Trim()).Where(t => t.Length > 0).ToList();
                    var label = string.Join(" ", texts);
                    return texts.Count == 1 && texts[0] == "Play" && Drawer.Current != null ? "\u25b6" + label : label;
                }
            }

            return null;
        }

        /// <summary>Where focus sits (docs/parity/SUITE.md): on the nav rail { "nav", item from the top }, on Home { rail, card }.</summary>
        private static object? Position(DependencyObject? element, object? page)
        {
            for (var node = element; node != null; node = VisualTreeHelper.GetParent(node))
            {
                if (node is Button { Tag: string tag } && tag.StartsWith("nav:", StringComparison.Ordinal))
                {
                    return new { rail = "nav", index = int.Parse(tag.Substring(4), System.Globalization.CultureInfo.InvariantCulture) };
                }

                if (page is HomePage && node is SelectorItem item && ItemsControl.ItemsControlFromItemContainer(item) is ListView list
                    && VisualTreeHelper.GetParent(list) is StackPanel section && VisualTreeHelper.GetParent(section) is StackPanel rails)
                {
                    return new { rail = rails.Children.IndexOf(section), index = list.IndexFromContainer(item) };
                }
            }

            return null;
        }

        private static IEnumerable<string> Texts(DependencyObject root)
        {
            var count = VisualTreeHelper.GetChildrenCount(root);
            for (var i = 0; i < count; i++)
            {
                var child = VisualTreeHelper.GetChild(root, i);
                if (child is TextBlock { Text: { Length: > 0 } text })
                {
                    yield return text;
                }
                else
                {
                    foreach (var inner in Texts(child))
                    {
                        yield return inner;
                    }
                }
            }
        }
    }
}
