using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Windows.Storage;
using Windows.UI.Xaml;
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

        public static void StartIfRequested(Frame frame)
        {
            var folder = ApplicationData.Current.LocalFolder;
            if (!System.IO.File.Exists(System.IO.Path.Combine(folder.Path, "parity.on")))
            {
                return;
            }

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            timer.Tick += (s, e) =>
            {
                PlayRequested(frame, folder.Path);
                ResizeRequested(folder.Path);
                PauseRequested(frame, folder.Path);
                Write(frame, folder.Path);
            };
            timer.Start();
        }

        /// <summary>A <c>parity.pause</c> file pauses the player on its current frame (identical-frame screenshots).</summary>
        private static void PauseRequested(Frame frame, string folder)
        {
            var file = System.IO.Path.Combine(folder, "parity.pause");
            try
            {
                if (System.IO.File.Exists(file) && frame.Content is PlayerPage player)
                {
                    var text = System.IO.File.ReadAllText(file).Trim();
                    System.IO.File.Delete(file);
                    player.PauseForTest(double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) ? seconds : (double?)null);
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

        /// <summary>The suite's playback cases pin a media file id: a <c>parity.play</c> file holding one opens the player on it.</summary>
        private static void PlayRequested(Frame frame, string folder)
        {
            var file = System.IO.Path.Combine(folder, "parity.play");
            try
            {
                if (System.IO.File.Exists(file) && Guid.TryParse(System.IO.File.ReadAllText(file).Trim(), out var id))
                {
                    System.IO.File.Delete(file);
                    frame.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(id));
                }
            }
            catch (Exception)
            {
            }
        }

        private static void Write(Frame frame, string folder)
        {
            try
            {
                var (screen, kind) = Screen(frame.Content);
                var panel = Drawer.Current?.Title ?? string.Empty;
                var focus = Describe(FocusManager.GetFocusedElement() as DependencyObject, frame.Content);
                var play = frame.Content is PlayerPage player ? player.Probe() : ("", 0.0);
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(new { screen, kind, panel, focus, play = play.Item1, pos = Math.Round(play.Item2, 1), code = (frame.Content as LoginPage)?.PairingCode });
                if (json == _last)
                {
                    return;
                }

                _last = json;
                _seq++;
                System.IO.File.WriteAllText(System.IO.Path.Combine(folder, "parity.json"), json.TrimEnd('}') + ",\"seq\":" + _seq + "}");
            }
            catch (Exception)
            {
                // A test hook never disturbs the app.
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
