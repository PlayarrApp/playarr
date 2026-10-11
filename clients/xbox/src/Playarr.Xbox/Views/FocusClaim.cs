using System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// A page puts focus on its primary control when it opens, as the web TV does (a title's Play button, a library's
    /// first card). The control is realised after the data loads and its container can be replaced as the page first
    /// lays out (which drops focus to the nav rail), so keep claiming it until focus has stayed inside the page for
    /// half a second. One claim at a time.
    /// </summary>
    internal static class FocusClaim
    {
        private static readonly System.Collections.Generic.Dictionary<string, Guid> Last = new System.Collections.Generic.Dictionary<string, Guid>();

        /// <summary>Remembers the title focused on a page so Back can put focus there again.</summary>
        public static void Remember(string page, Guid id) => Last[page] = id;

        public static Guid? Recall(string page) => Last.TryGetValue(page, out var id) ? id : (Guid?)null;

        private static DispatcherTimer? _active;

        public static void Start(DependencyObject scope, Func<Control?> target)
        {
            _active?.Stop();
            var tries = 0;
            var stable = 0;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            _active = timer;
            timer.Tick += (s, e) =>
            {
                var focused = FocusManager.GetFocusedElement() as DependencyObject;
                if (focused != null && IsInside(scope, focused))
                {
                    if (++stable >= 4)
                    {
                        timer.Stop();
                    }

                    return;
                }

                stable = 0;
                if (++tries > 60)
                {
                    timer.Stop();
                    return;
                }

                target()?.Focus(FocusState.Keyboard);
            };
            timer.Start();
        }

        private static bool IsInside(DependencyObject ancestor, DependencyObject node)
        {
            for (var current = node; current != null; current = VisualTreeHelper.GetParent(current))
            {
                if (ReferenceEquals(current, ancestor))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
