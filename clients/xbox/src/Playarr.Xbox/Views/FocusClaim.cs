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
        private static DependencyObject? _activeScope;
        private static Action? _activeOnStopped;

        public static void Start(DependencyObject scope, Func<Control?> target)
            => Start(scope, target, () => false, null);

        public static void Start(DependencyObject scope, Func<Control?> target, Func<bool> shouldCancel)
            => Start(scope, target, shouldCancel, null);

        public static void Start(DependencyObject scope, Func<Control?> target, Func<bool> shouldCancel, Func<bool>? isComplete)
            => Start(scope, target, shouldCancel, isComplete, null);

        public static void Start(DependencyObject scope, Func<Control?> target, Func<bool> shouldCancel, Func<bool>? isComplete, Action? onStopped)
        {
            if (_active is { } previous)
            {
                Stop(previous);
            }

            var tries = 0;
            var stable = 0;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            _active = timer;
            _activeScope = scope;
            _activeOnStopped = onStopped;
            timer.Tick += (s, e) =>
            {
                if (shouldCancel())
                {
                    Stop(timer);
                    return;
                }

                var focused = FocusManager.GetFocusedElement() as DependencyObject;
                if (focused != null && IsInside(scope, focused) && (isComplete == null || isComplete()))
                {
                    if (++stable >= 4)
                    {
                        Stop(timer);
                    }

                    return;
                }

                stable = 0;
                if (++tries > 60)
                {
                    Stop(timer);
                    return;
                }

                target()?.Focus(FocusState.Keyboard);
            };
            timer.Start();
        }

        public static void Cancel(DependencyObject scope)
        {
            if (ReferenceEquals(_activeScope, scope) && _active is { } timer)
            {
                Stop(timer);
            }
        }

        private static void Stop(DispatcherTimer timer)
        {
            timer.Stop();
            if (ReferenceEquals(_active, timer))
            {
                var onStopped = _activeOnStopped;
                _active = null;
                _activeScope = null;
                _activeOnStopped = null;
                onStopped?.Invoke();
            }
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
