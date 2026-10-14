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

        /// <param name="halo">False for a rail whose container has no room for the soft glow and the art scale (reserve it with <see cref="ReserveFocusRoom"/> instead).</param>
        public static void Attach(ListViewBase list, bool halo = true)
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
            list.GotFocus += (s, e) => Apply(e.OriginalSource, true, halo);
            list.LostFocus += (s, e) => Apply(e.OriginalSource, false, halo);
        }

        /// <summary>
        /// Web's focus overflow (docs: 48 px each side for lift, ring and glow): grows the list's clip box by
        /// <paramref name="room"/> on every side and pads its items back, so cards, rails and pages keep their layout.
        /// </summary>
        public static void ReserveFocusRoom(Control list, double left = 48, double top = 48, double right = 48, double bottom = 48)
        {
            list.Margin = new Thickness(list.Margin.Left - left, list.Margin.Top - top, list.Margin.Right - right, list.Margin.Bottom - bottom);
            list.Padding = new Thickness(list.Padding.Left + left, list.Padding.Top + top, list.Padding.Right + right, list.Padding.Bottom + bottom);
            if (!double.IsNaN(list.Height))
            {
                list.Height += top + bottom;
            }

            if (!double.IsNaN(list.Width))
            {
                list.Width += left + right;
            }
        }

        /// <summary>
        /// Expands a rail's top clip area for the focused-card lift without moving its resting cards or changing the
        /// rail's contribution to its parent layout. This mirrors the web rails' top padding and compensating margin.
        /// </summary>
        public static void ReserveTopLiftRoom(ListView list, double pixels)
        {
            list.Height += pixels;
            list.Margin = new Thickness(list.Margin.Left, list.Margin.Top - pixels, list.Margin.Right, list.Margin.Bottom);
            list.Padding = new Thickness(list.Padding.Left, list.Padding.Top + pixels, list.Padding.Right, list.Padding.Bottom);
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

        /// <summary>
        /// The glow's soft part, <c>0 0 20px 4px</c> at 45 % of the glow colour beyond the 3 px ring: stacked outward 2 px
        /// strokes fading with distance, on a zero-size canvas that is the card's last child (it never moves the art).
        /// </summary>
        private static void SetSoftGlow(Panel card, Grid art, bool focused)
        {
            Canvas? canvas = null;
            foreach (var child in card.Children)
            {
                if (child is Canvas { Tag: "glow" } existing)
                {
                    canvas = existing;
                }
            }

            if (canvas == null)
            {
                if (!focused || art.ActualWidth <= 0)
                {
                    return;
                }

                canvas = new Canvas { Tag = "glow", Height = 0, Width = 0, HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
                var radius = art.CornerRadius.TopLeft;
                // The canvas starts below the card's stacked children, so the art's top-left is that far up.
                var origin = new Windows.Foundation.Point(0, 0);
                foreach (var child in card.Children)
                {
                    origin.Y -= ((FrameworkElement)child).ActualHeight + ((FrameworkElement)child).Margin.Top + ((FrameworkElement)child).Margin.Bottom;
                }

                for (var k = 0; k < 11; k++)
                {
                    // Distance from the art edge: the spread (to 7 px) is solid, the 20 px blur fades the rest.
                    var d = 1 + k * 2; // the 3 px ring sits inside the art edge, so the halo starts at the edge
                    var fade = k < 2 ? 1 : Math.Pow(1 - (k - 1) / 11.0, 2);
                    var color = Theme.CardGlow;
                    canvas.Children.Add(new Border
                    {
                        Tag = d,
                        Width = art.ActualWidth + 2 * d,
                        Height = art.ActualHeight + 2 * d,
                        CornerRadius = new CornerRadius(radius + d),
                        BorderThickness = new Thickness(2),
                        BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb((byte)(255 * 0.45 * fade), color.R, color.G, color.B)),
                    });
                    Canvas.SetLeft((FrameworkElement)canvas.Children[canvas.Children.Count - 1], origin.X - d);
                    Canvas.SetTop((FrameworkElement)canvas.Children[canvas.Children.Count - 1], origin.Y - d);
                }

                card.Children.Add(canvas);

            }

            canvas.Visibility = focused ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>The soft glow and the art scale (<c>--card-art-scale</c>, 1.025 about the centre; the caption stays put).</summary>
        private static void ApplyHalo(Panel card, Grid art, bool focused)
        {
            SetSoftGlow(card, art, focused);
            if (!(art.RenderTransform is ScaleTransform scale))
            {
                scale = new ScaleTransform { ScaleX = 1, ScaleY = 1 };
                art.RenderTransform = scale;
                art.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
            }

            var target = focused ? 1.025 : 1;
            var grow = new Storyboard();
            foreach (var axis in new[] { "ScaleX", "ScaleY" })
            {
                var frames = new DoubleAnimationUsingKeyFrames();
                frames.KeyFrames.Add(new SplineDoubleKeyFrame { Value = target, KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(240)), KeySpline = new KeySpline { ControlPoint1 = new Windows.Foundation.Point(0.2, 0.8), ControlPoint2 = new Windows.Foundation.Point(0.2, 1) } });
                Storyboard.SetTarget(frames, scale);
                Storyboard.SetTargetProperty(frames, axis);
                grow.Children.Add(frames);
            }

            grow.Begin();

        }

        private static void Apply(object source, bool focused, bool halo)
        {
            if (!(source is SelectorItem { ContentTemplateRoot: Panel card }))
            {
                return;
            }

            // The art is the first Grid; a resting-shadow canvas may sit before it.
            Grid? art = null;
            foreach (var child in card.Children)
            {
                if (child is Grid grid)
                {
                    art = grid;
                    break;
                }
            }

            if (art == null)
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
                    BorderBrush = new SolidColorBrush(Theme.CardGlow),
                    CornerRadius = art.CornerRadius,
                    IsHitTestVisible = false,
                    Visibility = Visibility.Collapsed,
                };
                art.Children.Add(ring);
            }

            ring.Visibility = focused ? Visibility.Visible : Visibility.Collapsed;
            if (halo)
            {
                ApplyHalo(card, art, focused);
            }

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
