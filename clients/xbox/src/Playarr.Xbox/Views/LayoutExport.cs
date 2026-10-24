using System;
using System.Collections.Generic;
using Windows.Foundation;
using Windows.UI;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Documents;
using Windows.UI.Xaml.Media;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Layout exporter for the parity layout score (docs/parity/LAYOUT.md): walks the live visual tree and lists leaf text
    /// (bounds of the text run), controls, images and containers with a visible fill, in 1920x1080 layout pixels. Written to
    /// LocalState by <see cref="ParityTrace"/> on a <c>parity.layout</c> request; the request names the screen, the
    /// theme and a nonce the driver waits for.
    /// </summary>
    internal static class LayoutExport
    {
        /// <summary>The web role (heading, link, button, tab, textbox, search, img, status ...) an element exports as; unset elements derive one from their type.</summary>
        public static readonly DependencyProperty RoleProperty = DependencyProperty.RegisterAttached("Role", typeof(string), typeof(LayoutExport), new PropertyMetadata(null));

        public static void SetRole(DependencyObject element, string role) => element.SetValue(RoleProperty, role);

        public static string? GetRole(DependencyObject element) => (string?)element.GetValue(RoleProperty);

        /// <summary>Tags a control the way the web's accessibility tree names it: role and accessible name (also read by screen readers).</summary>
        public static T Tag<T>(T element, string role, string? name = null) where T : DependencyObject
        {
            SetRole(element, role);
            if (name != null)
            {
                Windows.UI.Xaml.Automation.AutomationProperties.SetName(element, name);
            }

            return element;
        }

        public static string Build(string screen, string theme)
        {
            var root = (FrameworkElement)Window.Current.Content;
            var scale = root.ActualWidth > 0 ? 1920.0 / root.ActualWidth : 1.0;
            var elements = new List<object>();
            Walk(root, root, scale, elements);
            return Newtonsoft.Json.JsonConvert.SerializeObject(new
            {
                screen,
                theme,
                viewport = new { w = 1920, h = 1080, dpr = 1 },
                clockPinned = true,
                elements,
            });
        }

        private static void Walk(DependencyObject node, FrameworkElement root, double scale, List<object> output)
        {
            if (node is UIElement ui && (ui.Visibility != Visibility.Visible || ui.Opacity <= 0.01))
            {
                return;
            }

            if (node is Canvas { Width: 0, Height: 0 })
            {
                return; // shadow and glow layers hang off a zero-size canvas
            }

            if (node is FrameworkElement element && element.ActualWidth >= 1 && element.ActualHeight >= 1 && !(element is Page))
            {
                Add(element, root, scale, output);
                if (GetRole(element) == "image")
                {
                    return; // a drawn icon is one image, not its strokes
                }

                if (element is Button { Content: TextBlock })
                {
                    return; // the web's label button is one element carrying the text run and its style
                }
            }

            var count = VisualTreeHelper.GetChildrenCount(node);
            for (var i = 0; i < count; i++)
            {
                Walk(VisualTreeHelper.GetChild(node, i), root, scale, output);
            }
        }

        private static void Add(FrameworkElement element, FrameworkElement root, double scale, List<object> output)
        {
            string? role = GetRole(element);
            string? text = null;
            string? color = null;
            double? fontSize = null;
            int? fontWeight = null;
            var rect = Bounds(element, root, scale);
            var name = Windows.UI.Xaml.Automation.AutomationProperties.GetName(element);
            if (element is TextBlock block)
            {
                text = block.Text;
                if (string.IsNullOrWhiteSpace(text))
                {
                    return;
                }

                role ??= "text";
                color = Hex(block.Foreground);
                fontSize = Math.Round(block.FontSize, 2);
                fontWeight = block.FontWeight.Weight;
                rect = TextRun(block, root, scale) ?? rect;
            }
            else if (role != null)
            {
                text = string.IsNullOrEmpty(name) ? null : name;
            }
            else if (element is Image)
            {
                role = "image";
            }
            else if (element is Button { Content: TextBlock label } labelButton && !string.IsNullOrWhiteSpace(label.Text))
            {
                role = "button";
                text = string.IsNullOrEmpty(name) ? label.Text : name;
                color = Hex(label.Foreground);
                fontSize = Math.Round(label.FontSize, 2);
                fontWeight = label.FontWeight.Weight;
                rect = TextRun(label, root, scale) ?? rect;
            }
            else if (element is Button || element is ToggleButton || element is ListViewItem || element is GridViewItem)
            {
                role = "button";
                text = string.IsNullOrEmpty(name) ? null : name;
            }
            else if (element is Border border && Hex(border.Background) is not null)
            {
                role = "container";
            }
            else if (element is Panel panel && Hex(panel.Background) is not null)
            {
                role = "container";
            }
            else if (element is Windows.UI.Xaml.Shapes.Shape shape && Hex(shape.Fill) is not null)
            {
                role = "container";
            }

            if (role == null)
            {
                return;
            }

            // Only what is on screen counts: scrolled-away and virtualised items are not part of the captured state.
            if (rect.Right <= 0 || rect.Bottom <= 0 || rect.X >= 1920 || rect.Y >= 1080 || rect.Width < 1 || rect.Height < 1)
            {
                return;
            }

            var radius = element is Border b ? b.CornerRadius.TopLeft : element is Control c ? c.CornerRadius.TopLeft : 0;
            var pill = element is TextBlock && VisualTreeHelper.GetParent(element) is Border { CornerRadius.TopLeft: > 0 } pillBorder ? pillBorder : null;
            if (pill != null)
            {
                // A status pill: the web puts the radius on the text element and keeps the page colour behind it.
                radius = pill.CornerRadius.TopLeft;
            }

            if (radius > 0 && radius * 2 >= Math.Min(element.ActualWidth, element.ActualHeight) - 0.5)
            {
                // The web reports a circle as 50 and any other fully rounded pill as 999.
                radius = Math.Abs(element.ActualWidth - element.ActualHeight) < 1 ? 50 / scale : 999 / scale;
            }

            output.Add(new
            {
                text,
                role,
                rect = new { x = Math.Round(rect.X, 1), y = Math.Round(rect.Y, 1), w = Math.Round(rect.Width, 1), h = Math.Round(rect.Height, 1) },
                color,
                background = pill != null ? BackgroundBehind(pill) : role == "text" ? BackgroundBehind(element) : (Own(element) ?? BackgroundBehind(element)),
                fontSize,
                fontWeight,
                radius = radius > 0 ? (double?)Math.Round(radius * scale, 1) : null,
                opacity = element.Opacity < 1 ? (double?)Math.Round(element.Opacity, 2) : null,
            });
        }

        private static Rect Bounds(FrameworkElement element, FrameworkElement root, double scale)
        {
            var origin = element.TransformToVisual(root).TransformPoint(new Point(0, 0));
            return new Rect(origin.X * scale, origin.Y * scale, element.ActualWidth * scale, element.ActualHeight * scale);
        }

        /// <summary>Single line: the glyph run's horizontal extent on the element's line box (the web reports the line box height); wrapped text keeps the element box.</summary>
        private static Rect? TextRun(TextBlock block, FrameworkElement root, double scale)
        {
            try
            {
                var box = Bounds(block, root, scale);
                var first = block.ContentStart.GetCharacterRect(LogicalDirection.Forward);
                var last = block.ContentEnd.GetCharacterRect(LogicalDirection.Backward);
                if (last.Y > first.Y + 1)
                {
                    return box;
                }

                var transform = block.TransformToVisual(root);
                var a = transform.TransformPoint(new Point(first.X, 0));
                var z = transform.TransformPoint(new Point(last.X + last.Width, 0));
                return new Rect(a.X * scale, box.Y, Math.Max(0, (z.X - a.X) * scale), box.Height);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string? Own(FrameworkElement element) => element switch
        {
            Border border => Hex(border.Background),
            Panel panel => Hex(panel.Background),
            Control control => Hex(control.Background),
            Windows.UI.Xaml.Shapes.Shape shape => Hex(shape.Fill),
            _ => null,
        };

        /// <summary>The colour behind an element: ancestors' fills composited over the page colour.</summary>
        private static string BackgroundBehind(DependencyObject node)
        {
            var layers = new List<Color>();
            for (var parent = VisualTreeHelper.GetParent(node); parent != null; parent = VisualTreeHelper.GetParent(parent))
            {
                var brush = parent switch
                {
                    Border border => border.Background,
                    Panel panel => panel.Background,
                    Control control => control.Background,
                    _ => null,
                };
                if (brush is SolidColorBrush solid && solid.Color.A > 0)
                {
                    layers.Add(Color.FromArgb((byte)Math.Round(solid.Color.A * solid.Opacity), solid.Color.R, solid.Color.G, solid.Color.B));
                }
            }

            // The page stage is the surface colour; the shell (rail, clock) sits on the page background.
            var underPage = false;
            for (var parent = VisualTreeHelper.GetParent(node); parent != null && !underPage; parent = VisualTreeHelper.GetParent(parent))
            {
                underPage = parent is Page;
            }

            var result = underPage ? Theme.Surface : Theme.Bg;
            for (var i = layers.Count - 1; i >= 0; i--)
            {
                var l = layers[i];
                var a = l.A / 255.0;
                result = Color.FromArgb(255, (byte)Math.Round(l.R * a + result.R * (1 - a)), (byte)Math.Round(l.G * a + result.G * (1 - a)), (byte)Math.Round(l.B * a + result.B * (1 - a)));
            }

            return $"#{result.R:x2}{result.G:x2}{result.B:x2}";
        }

        private static string? Hex(Brush? brush)
        {
            if (brush is not SolidColorBrush solid || solid.Color.A == 0)
            {
                return null;
            }

            var c = solid.Color;
            var alpha = (byte)Math.Round(c.A * solid.Opacity);
            return alpha == 255 ? $"#{c.R:x2}{c.G:x2}{c.B:x2}" : $"#{c.R:x2}{c.G:x2}{c.B:x2}{alpha:x2}";
        }
    }
}
