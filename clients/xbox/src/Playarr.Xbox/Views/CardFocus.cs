using System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Animation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's media-card focus (docs/design/page-layout.md section 5, item 1a): the card lifts and its art gets the
    /// brand-pink glow ring that follows its corners; no fill. Cards are StackPanels whose first child is the art Grid
    /// (<see cref="CatalogTileFactory"/>, episode cards). One shared behaviour for every card list.
    /// </summary>
    internal static class CardFocus
    {
        private const double Lift = -7;
        private static readonly TimeSpan Duration = TimeSpan.FromMilliseconds(260);

        public static void Attach(ListViewBase list)
        {
            list.GotFocus += (s, e) => Apply(e.OriginalSource, true);
            list.LostFocus += (s, e) => Apply(e.OriginalSource, false);
        }

        private static DispatcherTimer? _firstFocus;

        /// <summary>
        /// Web TV puts focus on the first card when a page opens. The first container is realised a few layout passes
        /// after the items appear and is replaced when the list first becomes visible (which drops focus to the nav
        /// rail), so keep claiming it until focus has stayed inside the list for half a second. One claim at a time.
        /// </summary>
        public static void FocusFirstWhenReady(ListViewBase list)
        {
            _firstFocus?.Stop();
            var tries = 0;
            var stable = 0;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            _firstFocus = timer;
            timer.Tick += (s, e) =>
            {
                if (++tries > 60 || (FocusManager.GetFocusedElement() is DependencyObject focused && IsInside(list, focused) && ++stable >= 4))
                {
                    timer.Stop();
                    return;
                }

                if (!(FocusManager.GetFocusedElement() is DependencyObject now && IsInside(list, now)))
                {
                    stable = 0;
                    (list.ContainerFromIndex(0) as Control)?.Focus(FocusState.Keyboard);
                }
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

        private static void Apply(object source, bool focused)
        {
            if (!(source is SelectorItem { ContentTemplateRoot: Panel card }) || card.Children.Count == 0 || !(card.Children[0] is Grid art))
            {
                return;
            }

            // Dark theme --card-glow-color is --brand-ink; the ring is 3 px (WCAG 2.4.13).
            art.BorderThickness = new Thickness(focused ? 3 : 0);
            art.BorderBrush = focused ? (Brush)Application.Current.Resources["PlayarrBrandInk"] : null;

            if (!(card.RenderTransform is TranslateTransform move))
            {
                move = new TranslateTransform();
                card.RenderTransform = move;
            }

            // --card-lift-ease: cubic-bezier(0.2, 0.8, 0.2, 1) over --card-lift-duration.
            var animation = new DoubleAnimationUsingKeyFrames();
            animation.KeyFrames.Add(new SplineDoubleKeyFrame
            {
                Value = focused ? Lift : 0,
                KeyTime = KeyTime.FromTimeSpan(Duration),
                KeySpline = new KeySpline { ControlPoint1 = new Windows.Foundation.Point(0.2, 0.8), ControlPoint2 = new Windows.Foundation.Point(0.2, 1) },
            });
            Storyboard.SetTarget(animation, move);
            Storyboard.SetTargetProperty(animation, "Y");
            var story = new Storyboard();
            story.Children.Add(animation);
            story.Begin();
        }
    }
}
