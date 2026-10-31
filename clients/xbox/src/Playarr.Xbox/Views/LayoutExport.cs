using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.UI;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Automation.Peers;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;
using Windows.UI.Xaml.Documents;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;

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
        /// <summary>Names a control the way a screen reader reads it (the automation name the native peer reports).</summary>
        public static T Named<T>(T element, string name) where T : DependencyObject
        {
            Windows.UI.Xaml.Automation.AutomationProperties.SetName(element, name);
            return element;
        }

        /// <summary>Marks a text block as a heading the way the platform does (automation heading level); the peer reports it.</summary>
        public static T Heading<T>(T element) where T : DependencyObject
        {
            Windows.UI.Xaml.Automation.AutomationProperties.SetHeadingLevel(element, Windows.UI.Xaml.Automation.Peers.AutomationHeadingLevel.Level1);
            return element;
        }

        private static AutomationPeer? PeerOf(FrameworkElement element) => FrameworkElementAutomationPeer.FromElement(element) ?? FrameworkElementAutomationPeer.CreatePeerForElement(element);

        /// <summary>The role the native automation peer reports for the element (UIA control type, heading level); null for plain layout and paint containers.</summary>
        private static string? NativeRole(FrameworkElement element)
        {
            if (Windows.UI.Xaml.Automation.AutomationProperties.GetHeadingLevel(element) != Windows.UI.Xaml.Automation.Peers.AutomationHeadingLevel.None)
            {
                return "heading";
            }

            return PeerOf(element)?.GetAutomationControlType() switch
            {
                AutomationControlType.Button => "button",
                AutomationControlType.Hyperlink => "link",
                AutomationControlType.Text => "text",
                AutomationControlType.Image => "image",
                AutomationControlType.Edit => "textbox",
                AutomationControlType.Slider => "slider",
                AutomationControlType.TabItem => "tab",
                AutomationControlType.ListItem => "listitem",
                AutomationControlType.DataItem => "listitem",
                AutomationControlType.CheckBox => "checkbox",
                _ => null,
            };
        }

        /// <summary>The accessible name: the automation name the app set, else what the peer derives (content text).</summary>
        private static string NameOf(FrameworkElement element)
        {
            var name = Windows.UI.Xaml.Automation.AutomationProperties.GetName(element);
            return string.IsNullOrEmpty(name) ? PeerOf(element)?.GetName() ?? string.Empty : name;
        }

        public static async Task<string> BuildAsync(string screen, string theme)
        {
            var root = (FrameworkElement)Window.Current.Content;
            var scale = root.ActualWidth > 0 ? 1920.0 / root.ActualWidth : 1.0;
            var elements = new List<object>();
            // A page that paints an opaque solid background (the player's black stage) hides the window ground behind it.
            _rootCovered = FindPage(root) is { Background: SolidColorBrush { Color.A: 255 } };
            Candidates.Clear();
            // Images arrive and fade in on their own clock: read the layout only once the rendered frame has been identical
            // for three looks in a row, so the walk, the visibility pass and the screenshot all describe the same screen.
            for (var look = 0; look < 80 && !await SettledAsync(); look++)
            {
                await Task.Delay(400);
            }

            Walk(root, root, scale, elements);
            var frame = await FrameHashAsync();
            var (kept, occluded) = await KeepVisibleAsync(root, elements);
            elements = kept;
            return Newtonsoft.Json.JsonConvert.SerializeObject(new
            {
                screen,
                theme = Theme.IsLight ? "light" : "dark", // the app's own state, not the request's label
                viewport = new { w = 1920, h = 1080, dpr = 1 },
                probe = Probe(),
                textProbe = TextProbe(root),
                occluded,
                visibility = VisibilityLog,
                clockPinned = ParityClock.IsPinned && ParityClock.Today == new DateTime(2026, 10, 7),
                frame,
                elements,
            });
        }

        private static async Task<bool> SettledAsync()
        {
            var first = await FrameHashAsync();
            for (var i = 0; i < 2; i++)
            {
                await Task.Delay(500);
                if (await FrameHashAsync() != first)
                {
                    return false;
                }
            }

            return true;
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
                arrows = new[] { "Segoe UI", "Segoe UI Symbol", "Arial", "Cambria Math", "Consolas", "Calibri", "Times New Roman", "Segoe MDL2 Assets", "Verdana", "Tahoma" }.Select(face =>
                {
                    var arrow = new TextBlock { Text = "\u2192", FontSize = 20.8, FontFamily = new FontFamily(face) };
                    arrow.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                    return new { face, width = Math.Round(arrow.DesiredSize.Width, 2) };
                }).ToList(),
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

                    found.Add(new { block.Text, block.ActualWidth, block.ActualHeight, chars });
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

        /// <summary>The visible part of a box: its bounds cut by every scrolling ancestor's viewport; empty when scrolled away.</summary>
        private static Rect Clipped(FrameworkElement element, Rect rect, FrameworkElement root, double scale)
        {
            for (var n = VisualTreeHelper.GetParent(element); n != null; n = VisualTreeHelper.GetParent(n))
            {
                if (n is ScrollViewer sv && sv.ActualWidth > 0)
                {
                    var view = sv.TransformToVisual(root).TransformBounds(new Rect(0, 0, sv.ActualWidth, sv.ActualHeight));
                    rect.Intersect(new Rect(view.X * scale, view.Y * scale, view.Width * scale, view.Height * scale));
                    if (rect.IsEmpty)
                    {
                        return rect;
                    }
                }
            }

            return rect;
        }

        /// <summary>A candidate element with the thing to hide and the pixel box to compare when it is hidden.</summary>
        private sealed class Candidate
        {
            public Candidate(FrameworkElement owner, Rect box, object item) { Owner = owner; Box = box; Item = item; }

            public FrameworkElement Owner { get; }

            public Rect Box { get; }

            public object Item { get; }
        }

        private static readonly List<Candidate> Candidates = new();

        private static void Emit(List<object> output, FrameworkElement owner, Rect box, object item)
        {
            output.Add(item);
            Candidates.Add(new Candidate(owner, box, item));
        }

        private static async Task<(byte[] Pixels, int Width, int Height)> GrabAsync(FrameworkElement root)
        {
            var bitmap = new RenderTargetBitmap();
            await bitmap.RenderAsync(root, 1920, 1080);
            var buffer = await bitmap.GetPixelsAsync();
            return (buffer.ToArray(), bitmap.PixelWidth, bitmap.PixelHeight);
        }

        /// <summary>Hides only what the element itself draws (its fill, or the element for a leaf) and returns the undo.</summary>
        private static Action Hide(FrameworkElement owner)
        {
            switch (owner)
            {
                case Border border:
                    var (borderFill, borderStroke) = (border.Background, border.BorderBrush);
                    border.Background = null;
                    border.BorderBrush = null;
                    return () => { border.Background = borderFill; border.BorderBrush = borderStroke; };
                case Panel { Background: { } fill } panel:
                    panel.Background = null;
                    return () => panel.Background = fill;
                case Windows.UI.Xaml.Shapes.Shape shape:
                    var (f, s) = (shape.Fill, shape.Stroke);
                    shape.Fill = null;
                    shape.Stroke = null;
                    return () => { shape.Fill = f; shape.Stroke = s; };
                default:
                    var opacity = owner.Opacity;
                    owner.Opacity = 0;
                    return () => owner.Opacity = opacity;
            }
        }

        /// <summary>
        /// Visible on the rendered screen: the app renders itself with and without the element's own paint and compares the
        /// pixels inside its box. An element whose removal changes nothing is covered (or paints nothing) and is not exported.
        /// </summary>
        private static async Task<(List<object> Kept, int Occluded)> KeepVisibleAsync(FrameworkElement root, List<object> elements)
        {
            // The whole pass must start and end on the same rendered frame: a changed final frame means something animated
            // or loaded mid-pass, so the pass runs again (and fails if the screen never settles).
            var last = string.Empty;
            for (var attempt = 0; attempt < 2; attempt++)
            {
                var (hidden, stable, diff) = await ToggleAllAsync(root);
                if (stable)
                {
                    Candidates.Clear();
                    return (elements.Where(e => !hidden.Contains(e)).ToList(), hidden.Count);
                }

                last = diff;
                await Task.Delay(400);
            }

            Candidates.Clear();
            throw new InvalidOperationException("The rendered frame did not settle during the visibility pass: " + last);
        }

        /// <summary>A control the user can focus is exported even when it paints nothing, unless something else is drawn over it.</summary>
        private static bool IsFocusableAndOnTop(FrameworkElement owner, Rect box)
        {
            if (owner is not Control { IsTabStop: true, IsEnabled: true })
            {
                return false;
            }

            var point = new Windows.Foundation.Point(box.X + box.Width / 2, box.Y + box.Height / 2);
            foreach (var hit in VisualTreeHelper.FindElementsInHostCoordinates(point, Window.Current.Content, false))
            {
                for (DependencyObject? n = hit; n != null; n = VisualTreeHelper.GetParent(n))
                {
                    if (ReferenceEquals(n, owner))
                    {
                        return true;
                    }
                }

                return false;
            }

            return false;
        }

        /// <summary>Per-element evidence of the last visibility pass (diagnosis only, not part of the schema).</summary>
        private static List<string> VisibilityLog = new();

        private static bool PixelEqual(byte[] a, byte[] b, int i) => a[i] == b[i] && a[i + 1] == b[i + 1] && a[i + 2] == b[i + 2];

        // Video needs no mask: a pixel that changes between the base and re-show frames (a playing picture) is never evidence,
        // and the player's video surface spans the whole screen, so a box mask would blind every control on it.

        private static async Task<(HashSet<object> Hidden, bool Stable, string Diff)> ToggleAllAsync(FrameworkElement root)
        {
            var (before, width, height) = await GrabAsync(root);
            var hidden = new HashSet<object>();
            var log = new List<string>();
            foreach (var candidate in Candidates)
            {
                var x0 = Math.Max(0, (int)Math.Floor(candidate.Box.X));
                var y0 = Math.Max(0, (int)Math.Floor(candidate.Box.Y));
                var x1 = Math.Min(width, (int)Math.Ceiling(candidate.Box.Right));
                var y1 = Math.Min(height, (int)Math.Ceiling(candidate.Box.Bottom));
                if (x1 <= x0 || y1 <= y0)
                {
                    hidden.Add(candidate.Item);
                    continue;
                }

                // Evidence, not a threshold: with the element hidden a pixel counts only if it differs from both the frame before
                // and the frame after the element is shown again while those two agree exactly. Two rounds must both find paint.
                var rounds = new int[2];
                var baseline = before;
                for (var round = 0; round < 2; round++)
                {
                    var undo = Hide(candidate.Owner);
                    byte[] hiddenFrame;
                    try
                    {
                        await Task.Delay(16);
                        hiddenFrame = (await GrabAsync(root)).Pixels;
                    }
                    finally
                    {
                        undo();
                    }

                    await Task.Delay(16);
                    var shown = (await GrabAsync(root)).Pixels;
                    var proven = 0;
                    for (var y = y0; y < y1; y++)
                    {
                        for (var x = x0; x < x1; x++)
                        {
                            var i = (y * width + x) * 4;
                            if (PixelEqual(baseline, shown, i) && !PixelEqual(hiddenFrame, baseline, i))
                            {
                                proven++;
                            }
                        }
                    }

                    rounds[round] = proven;
                    baseline = shown;
                }

                var changed = rounds[0] > 0 && rounds[1] > 0;
                var focusable = !changed && IsFocusableAndOnTop(candidate.Owner, candidate.Box);
                log.Add($"#{log.Count} {Math.Round(candidate.Box.X)},{Math.Round(candidate.Box.Y)} {Math.Round(candidate.Box.Width)}x{Math.Round(candidate.Box.Height)} r1={rounds[0]} r2={rounds[1]} {(changed ? "visible" : focusable ? "focusable" : "covered")}");
                if (!changed && !focusable)
                {
                    hidden.Add(candidate.Item);
                }
            }

            VisibilityLog = log;
            var final = (await GrabAsync(root)).Pixels;
            if (final.SequenceEqual(before))
            {
                return (hidden, true, string.Empty);
            }

            int minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
            for (var i = 0; i < before.Length; i += 4)
            {
                if (before[i] != final[i] || before[i + 1] != final[i + 1] || before[i + 2] != final[i + 2])
                {
                    var px = (i / 4) % width;
                    var py = (i / 4) / width;
                    minX = Math.Min(minX, px); maxX = Math.Max(maxX, px); minY = Math.Min(minY, py); maxY = Math.Max(maxY, py); count++;
                }
            }

            // The rasteriser leaves a few stray pixels after paint is restored; a settled screen drifts by far less than a thousandth of the frame.
            return (hidden, count <= width * height / 1000, $"{count} pixels differ in x {minX}-{maxX}, y {minY}-{maxY}");
        }

        /// <summary>A hash of the app's own render of the screen: the same value before and after a screenshot shows the layout export belongs to the frame that was captured.</summary>
        public static async Task<string> FrameHashAsync()
        {
            var root = (FrameworkElement)Window.Current.Content;
            using var sha = System.Security.Cryptography.SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash((await GrabAsync(root)).Pixels)).Replace("-", string.Empty).ToLowerInvariant();
        }

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

            if (node is FrameworkElement element && element.ActualWidth >= 1 && element.ActualHeight >= 1 && (!(element is Page) || element is Page { Background: not null }))
            {
                if (!(_rootCovered && ReferenceEquals(element, root)))
                {
                    Add(element, root, scale, output);
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
            string? role = NativeRole(element);
            string? text = null;
            string? color = null;
            double? fontSize = null;
            int? fontWeight = null;
            var rect = Bounds(element, root, scale);
            FrameworkElement owner = element;
            var name = NameOf(element);
            if (element is TextBlock block)
            {
                if (string.IsNullOrWhiteSpace(block.Text))
                {
                    return;
                }

                AddLines(block, 0, block.Text.Length, role ?? "text", root, scale, output);
                return;
            }
            else if (role != null)
            {
                text = string.IsNullOrEmpty(name) ? null : name;
            }
            else if (element is Page stage)
            {
                role = "container";
            }
            else if (element is Border border && (Hex(border.Background) is not null || border.Background is ImageBrush || border.Background is GradientBrush || (border.BorderBrush != null && border.BorderThickness.Left > 0)))
            {
                role = "container";
            }
            else if (element is Panel panel && (Hex(panel.Background) is not null || panel.Background is GradientBrush))
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

            if (Clipped(element, rect, root, scale).IsEmpty)
            {
                return;
            }

            var radius = element is Border b ? b.CornerRadius.TopLeft : element is Grid g ? g.CornerRadius.TopLeft : element is Control c ? c.CornerRadius.TopLeft : element is Windows.UI.Xaml.Shapes.Ellipse ? Math.Min(element.ActualWidth, element.ActualHeight) / 2 : 0;
            // A radius is drawn in the element's own units: carry it through the same transforms as the box.
            var drawn = Bounds(element, root, scale);
            var radiusScale = element.ActualWidth > 0 ? drawn.Width / (element.ActualWidth * scale) : 1.0;
            Emit(output, owner, rect, new
            {
                text,
                role,
                rect = new { x = Math.Round(rect.X, 1), y = Math.Round(rect.Y, 1), w = Math.Round(rect.Width, 1), h = Math.Round(rect.Height, 1) },
                color,
                background = BackgroundBehind(element, includeSelf: role != "text" && element is not TextBlock),
                fontSize,
                fontWeight,
                radius = radius > 0 ? (double?)Math.Round(radius * scale * radiusScale, 1) : null,
                opacity = EffectiveOpacity(element) is var opacity && opacity < 0.995 ? (double?)Math.Round(opacity, 2) : null,
            });
            if (element is Border { Background: ImageBrush })
            {
                // A picture fill is a container (the plate) and the image drawn on it, as the web's avatar is.
                Emit(output, owner, rect, new
                {
                    text,
                    role = "image",
                    rect = new { x = Math.Round(rect.X, 1), y = Math.Round(rect.Y, 1), w = Math.Round(rect.Width, 1), h = Math.Round(rect.Height, 1) },
                    color,
                    background = BackgroundBehind(element, includeSelf: true),
                    fontSize,
                    fontWeight,
                    radius = radius > 0 ? (double?)Math.Round(radius * scale * radiusScale, 1) : null,
                    opacity = EffectiveOpacity(element) is var shown && shown < 0.995 ? (double?)Math.Round(shown, 2) : null,
                });
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
                var rights = new List<double>();
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

                    // A character rectangle has no width: a glyph's right edge is the trailing caret edge of that character,
                    // read looking back from the position after it (the end of the text for the last one), also at a wrap.
                    var after = i + 1 < block.Text.Length ? block.ContentStart.GetPositionAtOffset(i + shift + 1, LogicalDirection.Backward) : block.ContentEnd;
                    var trailing = after?.GetCharacterRect(LogicalDirection.Backward) ?? Rect.Empty;
                    var edge = !trailing.IsEmpty && Math.Abs(trailing.Y - rect.Y) < 1 && trailing.X >= rect.X ? trailing.X : rect.Right;
                    var at = lines.FindIndex(l => Math.Abs(l.Box.Y - rect.Y) < 1);
                    if (at < 0)
                    {
                        lines.Add((rect, i, i + 1));
                        rights.Add(block.Text[i] == ' ' ? rect.X : edge);
                    }
                    else
                    {
                        var l = lines[at];
                        var union = new Rect(Math.Min(l.Box.X, rect.X), l.Box.Y, Math.Max(l.Box.Right, rect.Right) - Math.Min(l.Box.X, rect.X), Math.Max(l.Box.Height, rect.Height));
                        lines[at] = (union, l.From, i + 1);
                        if (block.Text[i] != ' ') { rights[at] = Math.Max(rights[at], edge); }
                    }
                }

                // Each line runs from its first character to where the next line starts (the last to the end of the run).
                for (var k = 0; k < lines.Count; k++)
                {
                    var from = k == 0 ? offset : lines[k].From;
                    var to = k + 1 < lines.Count ? lines[k + 1].From : offset + length;
                    // The platform draws a trimmed block's last line with an ellipsis and exposes neither the cut nor the
                    // ellipsis bounds. That line is left out (LAYOUT.md); the lines above it are untouched layout.
                    if (block.IsTextTrimmed && k == lines.Count - 1)
                    {
                        continue;
                    }

                    var text = block.Text.Substring(from, to - from).Trim();
                    if (text.Length == 0)
                    {
                        continue;
                    }

                    // Left edge, line box height and right edge are all read from the displayed block's own character rectangles.
                    var first = lines[k].Box;
                    var r = transform.TransformBounds(new Rect(first.X, first.Y, Math.Max(0, rights[k] - first.X), first.Height));
                    if (r.Right * scale <= 0 || r.Bottom * scale <= 0 || r.X * scale >= 1920 || r.Y * scale >= 1080)
                    {
                        continue;
                    }

                    if (Clipped(block, new Rect(r.X * scale, r.Y * scale, r.Width * scale, r.Height * scale), root, scale).IsEmpty)
                    {
                        continue;
                    }

                    Emit(output, block, new Rect(r.X * scale, r.Y * scale, r.Width * scale, r.Height * scale), new
                    {
                        text,
                        role,
                        rect = new { x = Math.Round(r.X * scale, 1), y = Math.Round(r.Y * scale, 1), w = Math.Round(r.Width * scale, 1), h = Math.Round(r.Height * scale, 1) },
                        color = Hex(block.Foreground),
                        background = BackgroundBehind(block, includeSelf: false),
                        fontSize = Math.Round(block.FontSize * Math.Abs(transform.TransformBounds(new Rect(0, 0, 1, 1)).Height) * scale, 2),
                        fontWeight = WebFont.WeightOf(block),
                        opacity = EffectiveOpacity(block) is var seen && seen < 0.995 ? (double?)Math.Round(seen, 2) : null,
                    });
                }
            }
            catch (Exception)
            {
                // A block whose character rectangles cannot be read is left out rather than guessed.
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

        /// <summary>
        /// The colour behind an element, read from the app's own paint: every ancestor's background (solid colour, or a gradient
        /// sampled where the element sits) composited from the window ground down, each at its effective opacity, over white.
        /// </summary>
        private static string BackgroundBehind(DependencyObject node, bool includeSelf = false)
        {
            var chain = new List<DependencyObject>();
            for (var n = includeSelf ? node : VisualTreeHelper.GetParent(node); n != null; n = VisualTreeHelper.GetParent(n))
            {
                chain.Add(n);
            }

            Point? at = null;
            if (node is FrameworkElement self && self.ActualWidth > 0)
            {
                var host = self.TransformToVisual(null).TransformBounds(new Rect(0, 0, self.ActualWidth, self.ActualHeight));
                at = new Point(host.X + host.Width / 2, host.Y + host.Height / 2);
            }

            double r = 255, g = 255, b = 255;
            for (var i = chain.Count - 1; i >= 0; i--)
            {
                var parent = chain[i];
                var brush = parent switch
                {
                    Border border => border.Background,
                    Panel panel => panel.Background,
                    Control control => control.Background,
                    Windows.UI.Xaml.Shapes.Shape shape => shape.Fill,
                    _ => null,
                };
                var colour = brush switch
                {
                    SolidColorBrush solid => (Color?)solid.Color,
                    LinearGradientBrush gradient when parent is FrameworkElement host && at is { } p => Sample(gradient, host, p),
                    _ => null,
                };
                if (colour is not { } c || c.A == 0)
                {
                    continue;
                }

                var a = c.A / 255.0 * (brush?.Opacity ?? 1) * EffectiveOpacity(parent);
                r = c.R * a + r * (1 - a);
                g = c.G * a + g * (1 - a);
                b = c.B * a + b * (1 - a);
            }

            return $"#{(byte)Math.Round(r):x2}{(byte)Math.Round(g):x2}{(byte)Math.Round(b):x2}";
        }

        /// <summary>A linear gradient's colour at a point in host coordinates (the brush's start and end are fractions of the painted box).</summary>
        private static Color? Sample(LinearGradientBrush brush, FrameworkElement host, Point hostPoint)
        {
            if (host.ActualWidth <= 0 || host.ActualHeight <= 0 || brush.GradientStops.Count == 0)
            {
                return null;
            }

            var local = host.TransformToVisual(null).Inverse.TransformPoint(hostPoint);
            var start = new Point(brush.StartPoint.X * host.ActualWidth, brush.StartPoint.Y * host.ActualHeight);
            var end = new Point(brush.EndPoint.X * host.ActualWidth, brush.EndPoint.Y * host.ActualHeight);
            var dx = end.X - start.X;
            var dy = end.Y - start.Y;
            var length = dx * dx + dy * dy;
            var t = length <= 0 ? 0 : Math.Max(0, Math.Min(1, ((local.X - start.X) * dx + (local.Y - start.Y) * dy) / length));
            var stops = brush.GradientStops.OrderBy(x => x.Offset).ToList();
            if (t <= stops[0].Offset)
            {
                return stops[0].Color;
            }

            for (var i = 1; i < stops.Count; i++)
            {
                if (t <= stops[i].Offset)
                {
                    var k = (t - stops[i - 1].Offset) / Math.Max(1e-9, stops[i].Offset - stops[i - 1].Offset);
                    byte Mix(byte x, byte y) => (byte)Math.Round(x + (y - x) * k);
                    return Color.FromArgb(Mix(stops[i - 1].Color.A, stops[i].Color.A), Mix(stops[i - 1].Color.R, stops[i].Color.R), Mix(stops[i - 1].Color.G, stops[i].Color.G), Mix(stops[i - 1].Color.B, stops[i].Color.B));
                }
            }

            return stops[stops.Count - 1].Color;
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
