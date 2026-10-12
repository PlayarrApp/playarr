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
            // No selection, hover, press or focus fill: the web card shows only the lift, the scale and the glow ring.
            list.ContainerContentChanging += (s, e) =>
            {
                if (e.ItemContainer is SelectorItem container)
                {
                    container.Loaded += (c, a) => ClearFill(container);
                    ClearFill(container);
                }
            };
            list.GotFocus += (s, e) => Apply(e.OriginalSource, true);
            list.LostFocus += (s, e) => Apply(e.OriginalSource, false);
        }

        /// <summary>
        /// Web TV puts focus on a card when a page opens: the first one, or on Back the one that was focused when the
        /// viewer left. <paramref name="target"/> returns that card's container once it is realised (see
        /// <see cref="FocusClaim"/>, which keeps claiming it until focus sticks).
        /// </summary>
        public static void FocusWhenReady(ListViewBase list, Func<Control?> target) => FocusClaim.Start(list, target);

        public static void FocusFirstWhenReady(ListViewBase list) =>
            FocusClaim.Start(list, () => list.ContainerFromIndex(0) as Control);

        private static void ClearFill(DependencyObject container)
        {
            var count = VisualTreeHelper.GetChildrenCount(container);
            for (var i = 0; i < count; i++)
            {
                var child = VisualTreeHelper.GetChild(container, i);
                if (child is ListViewItemPresenter presenter)
                {
                    var none = new SolidColorBrush(Windows.UI.Colors.Transparent);
                    presenter.SelectedBackground = presenter.SelectedPointerOverBackground = presenter.SelectedPressedBackground = none;
                    presenter.PointerOverBackground = presenter.PressedBackground = presenter.FocusBorderBrush = none;
                    presenter.FocusSecondaryBorderBrush = none;
                    presenter.PointerOverBackground = none;
                    return;
                }

                ClearFill(child);
            }
        }

        private static void Apply(object source, bool focused)
        {
            if (!(source is SelectorItem { ContentTemplateRoot: Panel card }) || card.Children.Count == 0 || !(card.Children[0] is Grid art))
            {
                return;
            }

            // Dark theme --card-glow-color is --brand-ink; the ring is 3 px (WCAG 2.4.13).
            // A rounded 3 px ring over the art's edge (the art grid clips its children to its corners, so it cannot sit outside).
            Border? ring = null;
            foreach (var child in art.Children)
            {
                if (child is Border { Tag: "ring" } existing)
                {
                    ring = existing;
                }
            }

            if (ring == null)
            {
                ring = new Border
                {
                    Tag = "ring",
                    BorderThickness = new Thickness(3),
                    BorderBrush = (Brush)Application.Current.Resources["PlayarrBrandInk"],
                    CornerRadius = art.CornerRadius,
                    IsHitTestVisible = false,
                    Visibility = Visibility.Collapsed,
                };
                art.Children.Add(ring);
            }

            ring.Visibility = focused ? Visibility.Visible : Visibility.Collapsed;

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
