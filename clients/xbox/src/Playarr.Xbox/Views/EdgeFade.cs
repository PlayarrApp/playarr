using System;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's scroll-edge fade (page-layout.css, <c>[data-fade-axis]</c>): where content continues past a scroller's
    /// edge it dims toward that edge down to a 30 % floor over <c>--page-edge-fade-size</c> (59 px at 1080p) on a smoothstep
    /// ramp (stops at 25, 50 and 75 % of 0.156, 0.5 and 0.844). UWP has no opacity mask, so the dimming is a page-background
    /// gradient laid over the scroller (it clips and moves nothing, so the focus effect keeps its room).
    /// shortcut: the overlay uses the flat page colour, so it differs slightly from a true mask over the key-art wash.
    /// </summary>
    internal static class EdgeFade
    {
        private const double Size = 59;
        private const double Floor = 0.3;

        /// <summary>Vertical fade for a scroller (a <see cref="ScrollViewer"/> or a list that owns one) inside <paramref name="host"/>, aligned to its left and width.</summary>
        public static void AttachVertical(Grid host, FrameworkElement scroller)
        {
            var top = Overlay(true);
            var bottom = Overlay(false);
            foreach (var overlay in new[] { top, bottom })
            {
                overlay.HorizontalAlignment = scroller.HorizontalAlignment;
                overlay.Width = scroller.Width;
                overlay.Margin = new Thickness(scroller.Margin.Left, 0, 0, 0);
                host.Children.Add(overlay);
            }

            void Update(ScrollViewer sv)
            {
                top.Visibility = sv.VerticalOffset > 1 ? Visibility.Visible : Visibility.Collapsed;
                bottom.Visibility = sv.VerticalOffset < sv.ScrollableHeight - 1 ? Visibility.Visible : Visibility.Collapsed;
            }

            void Hook()
            {
                var sv = scroller as ScrollViewer ?? Find(scroller);
                if (sv != null)
                {
                    sv.ViewChanged += (s, e) => Update(sv);
                    sv.LayoutUpdated += (s, e) => Update(sv);
                    Update(sv);
                }
            }

            if (scroller.IsLoaded)
            {
                Hook();
            }
            else
            {
                scroller.Loaded += (s, e) => Hook();
            }
        }

        private static ScrollViewer? Find(DependencyObject node)
        {
            var count = VisualTreeHelper.GetChildrenCount(node);
            for (var i = 0; i < count; i++)
            {
                var child = VisualTreeHelper.GetChild(node, i);
                if (child is ScrollViewer sv)
                {
                    return sv;
                }

                if (Find(child) is { } inner)
                {
                    return inner;
                }
            }

            return null;
        }

        private static Windows.UI.Xaml.Shapes.Rectangle Overlay(bool start)
        {
            var bg = Theme.Bg;
            // Alpha of the page colour is 1 - mask; the mask runs from the floor at the edge to 1 at Size.
            Windows.UI.Color At(double mask) => Windows.UI.Color.FromArgb((byte)Math.Round(255 * (1 - mask)), bg.R, bg.G, bg.B);
            double Mask(double s) => Floor + (1 - Floor) * s;
            var stops = new GradientStopCollection
            {
                new GradientStop { Color = At(Mask(0)), Offset = 0 },
                new GradientStop { Color = At(Mask(0.156)), Offset = 0.25 },
                new GradientStop { Color = At(Mask(0.5)), Offset = 0.5 },
                new GradientStop { Color = At(Mask(0.844)), Offset = 0.75 },
                new GradientStop { Color = At(Mask(1)), Offset = 1 },
            };
            return new Windows.UI.Xaml.Shapes.Rectangle
            {
                Height = Size,
                VerticalAlignment = start ? VerticalAlignment.Top : VerticalAlignment.Bottom,
                IsHitTestVisible = false,
                Visibility = Visibility.Collapsed,
                Fill = new LinearGradientBrush
                {
                    StartPoint = new Windows.Foundation.Point(0, start ? 0 : 1),
                    EndPoint = new Windows.Foundation.Point(0, start ? 1 : 0),
                    GradientStops = stops,
                },
            };
        }
    }
}
