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

        /// <summary>Marks the shell chrome (rail, clock): it sits on the page background, everything else on the page surface.</summary>
        public static readonly DependencyProperty ShellProperty = DependencyProperty.RegisterAttached("Shell", typeof(bool), typeof(LayoutExport), new PropertyMetadata(false));

        /// <summary>A button the web exports as the box plus a separate text element (round letter and arrow buttons).</summary>
        public static readonly DependencyProperty SplitProperty = DependencyProperty.RegisterAttached("Split", typeof(bool), typeof(LayoutExport), new PropertyMetadata(false));

        public static void SetSplit(DependencyObject element, bool value) => element.SetValue(SplitProperty, value);

        /// <summary>Export a text block's runs as separate elements at this separator (the web's meta line is one span per part).</summary>
        public static readonly DependencyProperty SplitOnProperty = DependencyProperty.RegisterAttached("SplitOn", typeof(string), typeof(LayoutExport), new PropertyMetadata(null));

        public static void SetSplitOn(DependencyObject element, string separator) => element.SetValue(SplitOnProperty, separator);

        public static void SetShell(DependencyObject element, bool shell) => element.SetValue(ShellProperty, shell);

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
            // A page that paints an opaque solid background (the player's black stage) hides the window ground behind it.
            _rootCovered = FindPage(root) is { Background: SolidColorBrush { Color.A: 255 } };
            Walk(root, root, scale, elements);
            return Newtonsoft.Json.JsonConvert.SerializeObject(new
            {
                screen,
                theme,
                viewport = new { w = 1920, h = 1080, dpr = 1 },
                probe = Probe(),
                textProbe = TextProbe(root),
                clockPinned = ParityClock.IsPinned && ParityClock.Today == new DateTime(2026, 10, 7),
                elements,
            });
        }

        /// <summary>Measured widths that show whether the font weight and tracking requests take effect (not part of the schema; for diagnosis).</summary>
        private static object Probe()
        {
            double Width(int weight, int spacing)
            {
                var block = new TextBlock { Text = "Downloads Movies", FontSize = 20, CharacterSpacing = spacing };
                WebFont.Apply(block, weight);
                block.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                return Math.Round(block.DesiredSize.Width, 2);
            }

            // How each line stacking strategy reports a line's character rectangle (y, height) for a two-line block at 20 px with LineHeight 30.
            object Strategy(LineStackingStrategy strategy)
            {
                var block = new TextBlock { Text = "Hello world\nsecond line", FontSize = 20, LineHeight = 30, LineStackingStrategy = strategy };
                WebFont.Apply(block, 400);
                var host = new Grid { Width = 400, Height = 200 };
                host.Children.Add(block);
                host.Measure(new Size(400, 200));
                host.Arrange(new Rect(0, 0, 400, 200));
                host.UpdateLayout();
                var first = block.ContentStart.GetPositionAtOffset(2, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                var second = block.ContentStart.GetPositionAtOffset(15, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                return new { strategy = strategy.ToString(), desired = Math.Round(block.DesiredSize.Height, 2), first = new[] { Math.Round(first.Y, 2), Math.Round(first.Height, 2) }, second = new[] { Math.Round(second.Y, 2), Math.Round(second.Height, 2) } };
            }

            return new
            {
                strategies = new[] { Strategy(LineStackingStrategy.MaxHeight), Strategy(LineStackingStrategy.BlockLineHeight), Strategy(LineStackingStrategy.BaselineToBaseline) },
                w400 = Width(400, 0), w600 = Width(600, 0), w680 = Width(680, 0), w700 = Width(700, 0), w720 = Width(720, 0), w760 = Width(760, 0), w800 = Width(800, 0), w900 = Width(900, 0),
                s0 = Width(400, 0), s100 = Width(400, 100), s_100 = Width(400, -100),
            };
        }

        /// <summary>Diagnosis only (not part of the schema): the platform's character rectangles and measured width for the first few visible text blocks.</summary>
        private static List<object> TextProbe(FrameworkElement root)
        {
            var found = new List<object>();
            void Visit(DependencyObject node)
            {
                if (found.Count >= 6 || node is UIElement { Visibility: not Visibility.Visible })
                {
                    return;
                }

                if (node is TextBlock { Text.Length: >= 4, ActualWidth: >= 1 } block)
                {
                    var chars = new List<double[]>();
                    for (var i = 0; i < Math.Min(block.Text.Length + 2, 24); i++)
                    {
                        var rect = block.ContentStart.GetPositionAtOffset(i, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                        chars.Add(rect.IsEmpty ? new double[0] : new[] { Math.Round(rect.X, 1), Math.Round(rect.Y, 1), Math.Round(rect.Width, 1), Math.Round(rect.Height, 1) });
                    }

                    found.Add(new { block.Text, block.ActualWidth, block.ActualHeight, advance = Advance(block, block.Text.Trim()), chars });
                }

                for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                {
                    Visit(VisualTreeHelper.GetChild(node, i));
                }
            }

            Visit(root);
            return found;
        }

        private static bool _rootCovered;

        private static Page? FindPage(DependencyObject node)
        {
            if (node is Frame { Content: Page page })
            {
                return page;
            }

            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                if (FindPage(VisualTreeHelper.GetChild(node, i)) is { } found)
                {
                    return found;
                }
            }

            return null;
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

            if (node is FrameworkElement element && element.ActualWidth >= 1 && element.ActualHeight >= 1 && (!(element is Page) || element is Page { Background: not null }))
            {
                if (!(_rootCovered && ReferenceEquals(element, root)))
                {
                    Add(element, root, scale, output);
                }
                if (GetRole(element) == "image")
                {
                    return; // a drawn icon is one image, not its strokes
                }

                if (element is Button { Content: TextBlock } && element.GetValue(SplitProperty) is not true && (GetRole(element) == null || GetRole(element) == "button"))
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
            if (element is TextBlock split && split.GetValue(SplitOnProperty) is string separator && split.Text.Contains(separator))
            {
                AddRuns(split, separator, root, scale, output);
                return;
            }

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
                fontWeight = WebFont.WeightOf(block);
                color = Hex(block.Foreground);
                AddLines(block, 0, text.Length, role, root, scale, output);
                return;
            }
            else if (element is Button { Content: TextBlock drawerLabel } && element.GetValue(SplitProperty) is not true && !string.IsNullOrWhiteSpace(drawerLabel.Text) && (role == null || role == "button"))
            {
                role = "button";
                text = string.IsNullOrEmpty(name) ? drawerLabel.Text : name;
                color = Hex(drawerLabel.Foreground);
                fontSize = Math.Round(drawerLabel.FontSize, 2);
                fontWeight = WebFont.WeightOf(drawerLabel);
                rect = TextRun(drawerLabel, root, scale) ?? rect;
            }
            else if (role != null)
            {
                text = string.IsNullOrEmpty(name) ? null : name;
            }
            else if (element is Image)
            {
                role = "image";
            }
            else if (element is Button { Content: TextBlock label } labelButton && element.GetValue(SplitProperty) is not true && !string.IsNullOrWhiteSpace(label.Text))
            {
                role = "button";
                text = string.IsNullOrEmpty(name) ? label.Text : name;
                color = Hex(label.Foreground);
                fontSize = Math.Round(label.FontSize, 2);
                fontWeight = WebFont.WeightOf(label);
                rect = TextRun(label, root, scale) ?? rect;
            }
            else if (element is Button || element is ToggleButton || element is ListViewItem || element is GridViewItem)
            {
                role = "button";
                text = string.IsNullOrEmpty(name) ? null : name;
            }
            else if (element is Page stage)
            {
                role = "container";
            }
            else if (element is Border border && (Hex(border.Background) is not null || border.Background is ImageBrush || (border.BorderBrush != null && border.BorderThickness.Left > 0)))
            {
                role = "container";
            }
            else if (element is Panel panel && Hex(panel.Background) is not null)
            {
                role = "container";
            }
            else if (element is Windows.UI.Xaml.Shapes.Shape shape && (Hex(shape.Fill) is not null || shape.Fill is GradientBrush || (shape.StrokeThickness > 0 && Hex(shape.Stroke) is not null)))
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

            var radius = element is Border b ? b.CornerRadius.TopLeft : element is Grid g ? g.CornerRadius.TopLeft : element is Control c ? c.CornerRadius.TopLeft : element is Windows.UI.Xaml.Shapes.Ellipse ? Math.Min(element.ActualWidth, element.ActualHeight) / 2 : 0;
            // A radius is drawn in the element's own units: carry it through the same transforms as the box.
            var drawn = Bounds(element, root, scale);
            var radiusScale = element.ActualWidth > 0 ? drawn.Width / (element.ActualWidth * scale) : 1.0;
            output.Add(new
            {
                text,
                role,
                rect = new { x = Math.Round(rect.X, 1), y = Math.Round(rect.Y, 1), w = Math.Round(rect.Width, 1), h = Math.Round(rect.Height, 1) },
                color,
                background = element is Page && Own(element) is null ? $"#{Theme.Surface.R:x2}{Theme.Surface.G:x2}{Theme.Surface.B:x2}" : role == "text" ? BackgroundBehind(element) : (Own(element) is { Length: 7 } opaque ? opaque : BackgroundBehind(element, includeSelf: Own(element) != null)),
                fontSize,
                fontWeight,
                radius = radius > 0 ? (double?)Math.Round(radius * scale * radiusScale, 1) : null,
                opacity = EffectiveOpacity(element) is var opacity && opacity < 0.995 ? (double?)Math.Round(opacity, 2) : null,
            });
            if (element is Border { Background: ImageBrush })
            {
                // A picture fill is a container (the plate) and the image drawn on it, as the web's avatar is.
                output.Add(new
                {
                    text,
                    role = "image",
                    rect = new { x = Math.Round(rect.X, 1), y = Math.Round(rect.Y, 1), w = Math.Round(rect.Width, 1), h = Math.Round(rect.Height, 1) },
                    color,
                    background = element is Page && Own(element) is null ? $"#{Theme.Surface.R:x2}{Theme.Surface.G:x2}{Theme.Surface.B:x2}" : role == "text" ? BackgroundBehind(element) : (Own(element) is { Length: 7 } opaqueFill ? opaqueFill : BackgroundBehind(element, includeSelf: Own(element) != null)),
                    fontSize,
                    fontWeight,
                    radius = radius > 0 ? (double?)Math.Round(radius * scale * radiusScale, 1) : null,
                    opacity = EffectiveOpacity(element) is var shown && shown < 0.995 ? (double?)Math.Round(shown, 2) : null,
                });
            }
        }

        private static void AddRuns(TextBlock block, string separator, FrameworkElement root, double scale, List<object> output)
        {
            var start = 0;
            foreach (var part in block.Text.Split(new[] { separator }, StringSplitOptions.None))
            {
                var begin = start;
                start += part.Length + separator.Length;
                if (part.Length > 0)
                {
                    AddLines(block, begin, part.Length, "text", root, scale, output);
                }
            }
        }

        /// <summary>Axis-aligned bounds of the element's layout box after every ancestor transform (scales, translations), in 1920x1080 pixels.</summary>
        private static Rect Bounds(FrameworkElement element, FrameworkElement root, double scale)
        {
            var r = element.TransformToVisual(root).TransformBounds(new Rect(0, 0, element.ActualWidth, element.ActualHeight));
            return new Rect(r.X * scale, r.Y * scale, r.Width * scale, r.Height * scale);
        }

        /// <summary>One element per laid-out line of <paramref name="length"/> characters from <paramref name="offset"/>: the union of the native character rectangles of that line (the glyph run and the platform's own line box height), transformed to the root.</summary>
        private static void AddLines(TextBlock block, int offset, int length, string role, FrameworkElement root, double scale, List<object> output)
        {
            try
            {
                var transform = block.TransformToVisual(root);
                var lines = new List<(Rect Box, int From, int To)>();
                // Text pointer offsets count the structure tokens before the first character: offsets 0 and 1 resolve to the start
                // of the run and of the first character, so character 0 is the first later offset whose rectangle starts where
                // offset 0's does.
                var shift = -1;
                var origin = block.ContentStart.GetPositionAtOffset(0, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                for (var o = 1; o < 8 && shift < 0 && !origin.IsEmpty; o++)
                {
                    var probe = block.ContentStart.GetPositionAtOffset(o, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                    shift = !probe.IsEmpty && Math.Abs(probe.X - origin.X) < 0.01 && Math.Abs(probe.Y - origin.Y) < 0.01 ? o : -1;
                }

                if (shift < 0)
                {
                    return;
                }

                for (var i = offset; i < offset + length; i++)
                {
                    var rect = block.ContentStart.GetPositionAtOffset(i + shift, LogicalDirection.Forward)?.GetCharacterRect(LogicalDirection.Forward) ?? Rect.Empty;
                    if (rect.IsEmpty || rect.Width <= 0 && block.Text[i] == ' ')
                    {
                        continue;
                    }

                    var at = lines.FindIndex(l => Math.Abs(l.Box.Y - rect.Y) < 1);
                    if (at < 0)
                    {
                        lines.Add((rect, i, i + 1));
                    }
                    else
                    {
                        var l = lines[at];
                        var union = new Rect(Math.Min(l.Box.X, rect.X), l.Box.Y, Math.Max(l.Box.Right, rect.Right) - Math.Min(l.Box.X, rect.X), Math.Max(l.Box.Height, rect.Height));
                        lines[at] = (union, l.From, i + 1);
                    }
                }

                // Each line runs from its first character to where the next line starts (the last to the end of the run).
                for (var k = 0; k < lines.Count; k++)
                {
                    var from = k == 0 ? offset : lines[k].From;
                    var to = k + 1 < lines.Count ? lines[k + 1].From : offset + length;
                    var text = block.Text.Substring(from, to - from).Trim();
                    if (text.Length == 0)
                    {
                        continue;
                    }

                    // Left edge and line box height are the platform's character rectangles; the width is the platform's own advance
                    // width of that line's text in the same face (the character rectangles do not report the full run).
                    var first = lines[k].Box;
                    var r = transform.TransformBounds(new Rect(first.X, first.Y, Advance(block, text), first.Height));
                    if (r.Right * scale <= 0 || r.Bottom * scale <= 0 || r.X * scale >= 1920 || r.Y * scale >= 1080)
                    {
                        continue;
                    }

                    output.Add(new
                    {
                        text,
                        role,
                        rect = new { x = Math.Round(r.X * scale, 1), y = Math.Round(r.Y * scale, 1), w = Math.Round(r.Width * scale, 1), h = Math.Round(r.Height * scale, 1) },
                        color = Hex(block.Foreground),
                        background = BackgroundBehind(block),
                        fontSize = Math.Round(block.FontSize, 2),
                        fontWeight = WebFont.WeightOf(block),
                    });
                }
            }
            catch (Exception)
            {
                // A block whose character rectangles cannot be read is left out rather than guessed.
            }
        }

        /// <summary>The platform's advance width of <paramref name="text"/> set in the block's face, size and spacing on one line.</summary>
        private static double Advance(TextBlock block, string text)
        {
            var probe = new TextBlock
            {
                Text = text,
                FontFamily = block.FontFamily,
                FontSize = block.FontSize,
                FontWeight = block.FontWeight,
                FontStyle = block.FontStyle,
                FontStretch = block.FontStretch,
                CharacterSpacing = block.CharacterSpacing,
                TextWrapping = TextWrapping.NoWrap,
            };
            probe.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            return probe.DesiredSize.Width;
        }

        /// <summary>The glyph run of a single-line label inside a button: first character left edge, the platform's advance width of the label, native line box height, transformed.</summary>
        private static Rect? TextRun(TextBlock block, FrameworkElement root, double scale)
        {
            try
            {
                var first = block.ContentStart.GetCharacterRect(LogicalDirection.Forward);
                var last = block.ContentEnd.GetCharacterRect(LogicalDirection.Backward);
                var r = block.TransformToVisual(root).TransformBounds(new Rect(first.X, first.Y, Advance(block, block.Text.Trim()), Math.Max(first.Height, last.Height)));
                return new Rect(r.X * scale, r.Y * scale, r.Width * scale, r.Height * scale);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The element's opacity multiplied by every ancestor's (what the web reports as the product with the ancestors).</summary>
        private static double EffectiveOpacity(DependencyObject node)
        {
            var product = 1.0;
            for (var n = node; n != null; n = VisualTreeHelper.GetParent(n))
            {
                if (n is UIElement ui)
                {
                    product *= ui.Opacity;
                }
            }

            return product;
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
        private static string BackgroundBehind(DependencyObject node, bool includeSelf = false)
        {
            var layers = new List<Color>();
            var underPage = false;
            Color? pageFill = null;
            for (var parent = includeSelf ? node : VisualTreeHelper.GetParent(node); parent != null; parent = VisualTreeHelper.GetParent(parent))
            {
                if (parent.GetValue(ShellProperty) is true)
                {
                    break; // shell chrome and the profile picker sit on the page background
                }

                if (parent is Page page)
                {
                    underPage = true; // the page stage (a gradient) is reported as the surface colour; nothing above it counts
                    if (page.Background is SolidColorBrush { Color: { A: 255, R: 0, G: 0, B: 0 } } pageBrush)
                    {
                        pageFill = pageBrush.Color; // the player's page paints an opaque black stage, unlike the pages that sit on the surface wash
                    }

                    break;
                }

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
            var result = pageFill ?? (underPage ? Theme.Surface : Theme.Bg);
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
