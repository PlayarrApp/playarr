using System;
using System.Collections.Generic;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web keeps layout in fractional 1/64 px units but paints a card's art on whole device pixels: the left and top edges
    /// are rounded and the size is rounded on its own (a 327.17 px wide box at x 783.36 paints as 327 px from x 783). A WinUI
    /// element at a fractional offset instead blends its edge pixels with the page. The snap is a render transform on the
    /// art, so the layout box stays what the CSS gives; the layout export reads it with the snap lifted (<see cref="Suspend"/>).
    /// A card that carries a focus scale or lift is drawn transformed in the web too, and is left as it is.
    /// </summary>
    internal static class PaintSnap
    {
        private static readonly List<WeakReference<Grid>> Registered = new List<WeakReference<Grid>>();

        /// <summary>Gives <paramref name="art"/> its scale (the focus scale, first) and snap transforms; keeps both in one group.</summary>
        internal static void Attach(Grid art)
        {
            if (art.RenderTransform is TransformGroup)
            {
                return;
            }

            art.RenderTransform = new TransformGroup { Children = { new ScaleTransform { ScaleX = 1, ScaleY = 1 }, new CompositeTransform() } };
            art.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
            Registered.Add(new WeakReference<Grid>(art));
            art.Loaded += (s, e) => Update(art);
            art.LayoutUpdated += (s, e) => Update(art);
        }

        /// <summary>The art's focus scale transform, whichever way it was attached.</summary>
        internal static ScaleTransform? FocusScale(Grid art) => art.RenderTransform is TransformGroup { Children: { Count: 2 } children } ? children[0] as ScaleTransform : art.RenderTransform as ScaleTransform;

        private static CompositeTransform? Snap(Grid art) => art.RenderTransform is TransformGroup { Children: { Count: 2 } children } ? children[1] as CompositeTransform : null;

        private sealed class GlowInfo
        {
            public Canvas Canvas = null!;
            public Windows.Foundation.Point Origin;
            public double RingOutset;
        }

        private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Grid, List<GlowInfo>> Glows = new System.Runtime.CompilerServices.ConditionalWeakTable<Grid, List<GlowInfo>>();

        /// <summary>
        /// Registers a glow or shadow canvas (zero size, its borders sized from the art) so its strokes sit on whole device pixels:
        /// a stroke edge at a fractional position is anti-aliased, and that coverage rounds differently from run to run.
        /// <paramref name="origin"/> is the art's top-left in the canvas's own space.
        /// </summary>
        internal static void AttachGlow(Grid art, Canvas canvas, Windows.Foundation.Point origin, double ringOutset)
        {
            var list = Glows.GetOrCreateValue(art);
            list.Add(new GlowInfo { Canvas = canvas, Origin = origin, RingOutset = ringOutset });
            canvas.RenderTransform = new TranslateTransform();
        }

        private static void UpdateGlows(Grid art, bool snapped)
        {
            if (!Glows.TryGetValue(art, out var list))
            {
                return;
            }

            foreach (var info in list)
            {
                try
                {
                    var canvas = info.Canvas;
                    var move = (TranslateTransform)canvas.RenderTransform;
                    var aw = art.ActualWidth;
                    var ah = art.ActualHeight;
                    if (aw <= 0 || ah <= 0)
                    {
                        continue;
                    }

                    var w = aw;
                    var h = ah;
                    double mx = 0, my = 0;
                    var ringShift = new Windows.Foundation.Point(0, 0);
                    Windows.Foundation.Point? origin = null;
                    if (snapped && canvas.Visibility == Visibility.Visible && Window.Current?.Content is FrameworkElement root && root.ActualWidth > 0)
                    {
                        var k = 1920.0 / root.ActualWidth;
                        var at = canvas.TransformToVisual(root).TransformPoint(info.Origin);
                        var cur = new Windows.Foundation.Point(at.X - move.X, at.Y - move.Y); // position without the current shift
                        mx = Math.Round(cur.X * k, MidpointRounding.AwayFromZero) / k - cur.X;
                        my = Math.Round(cur.Y * k, MidpointRounding.AwayFromZero) / k - cur.Y;
                        w = Math.Max(1, Math.Round(aw * k, MidpointRounding.AwayFromZero) / k);
                        h = Math.Max(1, Math.Round(ah * k, MidpointRounding.AwayFromZero) / k);
                        origin = at;
                    }

                    move.X = mx;
                    move.Y = my;
                    foreach (var child in canvas.Children)
                    {
                        if (child is not Border border)
                        {
                            continue;
                        }

                        if (border.Tag is int d)
                        {
                            SetIfChanged(border, w + 2 * d, h + 2 * d);
                        }
                        else if (border.Tag is "ring")
                        {
                            const double artScale = 1.025;
                            var rw = aw * artScale + 2 * info.RingOutset;
                            var rh = ah * artScale + 2 * info.RingOutset;
                            var left = info.Origin.X + (aw - rw) / 2;
                            var top = info.Origin.Y + (ah - rh) / 2;
                            if (origin != null)
                            {
                                // The ring's edges land on whole pixels too: the size is rounded and the offset from the art rounded on its own.
                                rw = Math.Round(rw, MidpointRounding.AwayFromZero);
                                rh = Math.Round(rh, MidpointRounding.AwayFromZero);
                                left = info.Origin.X + Math.Round((w - rw) / 2, MidpointRounding.AwayFromZero);
                                top = info.Origin.Y + Math.Round((h - rh) / 2, MidpointRounding.AwayFromZero);
                            }

                            SetIfChanged(border, rw, rh);
                            if (Math.Abs(Canvas.GetLeft(border) - left) > 1e-6)
                            {
                                Canvas.SetLeft(border, left);
                            }

                            if (Math.Abs(Canvas.GetTop(border) - top) > 1e-6)
                            {
                                Canvas.SetTop(border, top);
                            }
                        }
                    }
                }
                catch (Exception)
                {
                    // not in the visual tree yet
                }
            }
        }

        /// <summary>Assigns a size only when it differs: a size set from a LayoutUpdated handler would otherwise start another layout pass forever.</summary>
        private static void SetIfChanged(Border border, double width, double height)
        {
            if (Math.Abs(border.Width - width) > 1e-6)
            {
                border.Width = width;
            }

            if (Math.Abs(border.Height - height) > 1e-6)
            {
                border.Height = height;
            }
        }

        internal static void Update(Grid art)
        {
            UpdateArt(art);
            UpdateGlows(art, true);
        }

        private static void UpdateArt(Grid art)
        {
            if (Snap(art) is not { } snap || FocusScale(art) is not { } focus)
            {
                return;
            }

            snap.ScaleX = snap.ScaleY = 1;
            snap.TranslateX = snap.TranslateY = 0;
            if (Window.Current?.Content is not FrameworkElement root || art.ActualWidth <= 0 || art.ActualHeight <= 0 || root.ActualWidth <= 0)
            {
                return;
            }

            if (Math.Abs(focus.ScaleX - 1) > 1e-6 || Math.Abs(focus.ScaleY - 1) > 1e-6)
            {
                return;
            }

            try
            {
                var map = art.TransformToVisual(root);
                var origin = map.TransformPoint(new Windows.Foundation.Point(0, 0));
                var far = map.TransformPoint(new Windows.Foundation.Point(art.ActualWidth, art.ActualHeight));
                var k = 1920.0 / root.ActualWidth; // device pixels per layout unit
                // A lifted or scaled card (a transformed ancestor) is not snapped.
                if (Math.Abs((far.X - origin.X) - art.ActualWidth) > 0.01 || Math.Abs((far.Y - origin.Y) - art.ActualHeight) > 0.01)
                {
                    return;
                }

                var left = Math.Round(origin.X * k, MidpointRounding.AwayFromZero);
                var top = Math.Round(origin.Y * k, MidpointRounding.AwayFromZero);
                var width = Math.Max(1, Math.Round(art.ActualWidth * k, MidpointRounding.AwayFromZero));
                var height = Math.Max(1, Math.Round(art.ActualHeight * k, MidpointRounding.AwayFromZero));
                var sx = width / (art.ActualWidth * k);
                var sy = height / (art.ActualHeight * k);
                var dx = left / k - origin.X;
                var dy = top / k - origin.Y;
                // The group maps about the centre: p' = s * p + c * (1 - s) + t, and p' must be p + d at the top-left, so t = d - c * (1 - s).
                snap.ScaleX = sx;
                snap.ScaleY = sy;
                snap.TranslateX = dx - art.ActualWidth / 2 * (1 - sx);
                snap.TranslateY = dy - art.ActualHeight / 2 * (1 - sy);
            }
            catch (Exception)
            {
                // not in the visual tree yet
            }
        }

        /// <summary>Recomputes every snap (a scroll or a focus change moves the art without a layout pass).</summary>
        internal static void RefreshAll() => ForEach(Update);

        /// <summary>Lifts every snap so the layout export reads the CSS boxes; <see cref="RefreshAll"/> puts them back.</summary>
        internal static void Suspend() => ForEach(art =>
        {
            if (Snap(art) is { } snap)
            {
                snap.ScaleX = snap.ScaleY = 1;
                snap.TranslateX = snap.TranslateY = 0;
            }

            UpdateGlows(art, false);
        });

        private static void ForEach(Action<Grid> action)
        {
            Registered.RemoveAll(w => !w.TryGetTarget(out _));
            foreach (var weak in Registered.ToArray())
            {
                if (weak.TryGetTarget(out var art))
                {
                    action(art);
                }
            }
        }
    }
}
