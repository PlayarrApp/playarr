using System;
using Windows.UI;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Media.Imaging;
using Playarr.Core.Models;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Builds one catalog tile's visual tree for a <see cref="Work"/> --
    /// shared by <see cref="HomePage"/>'s recently-added row and
    /// <see cref="LibraryPage"/>'s browse grid so both screens render tiles
    /// identically instead of each re-deriving the same layout.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Returns a plain <see cref="FrameworkElement"/> (a <see cref="StackPanel"/>
    /// containing a poster <see cref="Image"/> and a title <see cref="TextBlock"/>)
    /// with <see cref="FrameworkElement.Tag"/> set to the work's
    /// <see cref="Work.Id"/>. Deliberately not itself a <see cref="Button"/>:
    /// both callers add these directly into a <see cref="ListView"/>/
    /// <see cref="GridView"/>'s <c>Items</c> collection (never
    /// <c>ItemsSource</c> plus a bound <c>ItemTemplate</c> -- this project
    /// uses neither <c>{x:Bind}</c> nor <c>{Binding}</c> anywhere, see
    /// <c>Views/LoginPage.xaml.cs</c>'s type-level remarks), and UWP
    /// automatically wraps every non-container item added that way in a real
    /// focusable, clickable item container (a <see cref="ListViewItem"/> or
    /// <see cref="GridViewItem"/>) that its own built-in gamepad XY focus
    /// navigation can already reach -- exactly the "must be a real focusable
    /// control, not a bare Image/TextBlock" requirement, satisfied by the
    /// generated container rather than by this method wrapping its own
    /// return value in a second, redundant focusable control.
    /// </para>
    /// <para>
    /// The caller wires one <c>ItemClick</c> handler for the whole list/grid
    /// (with <c>IsItemClickEnabled="True"</c> and <c>SelectionMode="None"</c>
    /// in XAML) and reads the clicked tile's <see cref="FrameworkElement.Tag"/>
    /// back out of <c>ItemClickEventArgs.ClickedItem</c> -- see
    /// <c>HomePage.xaml.cs</c>'s and <c>LibraryPage.xaml.cs</c>'s own
    /// <c>*_ItemClick</c> handlers.
    /// </para>
    /// </remarks>
    internal static class CatalogTileFactory
    {
        private const double TileWidth = 180;
        private const double TileHeight = 270;

        /// <summary>The landscape card size follows Settings > Appearance > Artwork size (328 x 184 at the default).</summary>
        internal static double CardWidth => Appearance.CardWidth;

        internal static double CardHeight => Appearance.CardHeight;

        private static Style? _cardContainerStyle;

        /// <summary>
        /// Rail item container: no padding, the web's 25 px card gap, and a brand-pink focus ring in place of the
        /// stock focus rectangle (web card focus: lift, shadow and a pink glow ring).
        /// </summary>
        public static Style CardContainerStyle
        {
            get
            {
                if (_cardContainerStyle == null)
                {
                    var style = new Style(typeof(ListViewItem));
                    style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(0)));
                    style.Setters.Add(new Setter(FrameworkElement.MarginProperty, new Thickness(0, 0, 25, 0)));
                    style.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 0d));
                    style.Setters.Add(new Setter(FrameworkElement.MinHeightProperty, 0d));
                    style.Setters.Add(new Setter(Control.VerticalContentAlignmentProperty, VerticalAlignment.Top));
                    // CardFocus draws the web focus (lift and glow ring) instead of the system focus rectangle.
                    style.Setters.Add(new Setter(Control.UseSystemFocusVisualsProperty, false));
                    _cardContainerStyle = style;
                }

                return _cardContainerStyle;
            }
        }

        private static Style? _gridCardContainerStyle;

        /// <summary>Library grid container: the web grid's 25 px column gap and 56 px row gap, same focus ring as rails.</summary>
        public static Style GridCardContainerStyle
        {
            get
            {
                if (_gridCardContainerStyle == null)
                {
                    var style = new Style(typeof(GridViewItem));
                    foreach (var setter in CardContainerStyle.Setters)
                    {
                        if (setter is Setter { Property: var property } plain && property != FrameworkElement.MarginProperty)
                        {
                            style.Setters.Add(new Setter(property, plain.Value));
                        }
                    }

                    style.Setters.Add(new Setter(FrameworkElement.MarginProperty, new Thickness(0, 0, 25, 25.5)));
                    _gridCardContainerStyle = style;
                }

                return _gridCardContainerStyle;
            }
        }

        /// <summary>
        /// Web TV Home card: 328x184 landscape art (thumb, else backdrop; a titled placeholder without art),
        /// then the title and the "Kind · year" caption.
        /// </summary>
        public static FrameworkElement CreateLandscapeCard(Work work, bool caption = true, bool cover = false)
        {
            var width = cover ? Appearance.CoverWidth : CardWidth;
            var height = cover ? Appearance.CoverHeight : CardHeight;
            var art = new Grid
            {
                Width = width,
                Height = height,
                CornerRadius = new CornerRadius(12),
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
            };
            var episode = work.OnDeckEpisode;
            if (episode == null && work.Image(cover ? ImageKind.Poster : ImageKind.Thumb) == null && work.Image(ImageKind.Backdrop) == null && work.Image(ImageKind.Thumb) == null)
            {
                art.Children.Add(new TextBlock
                {
                    Text = work.Title,
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.Resources["PlayarrInkMuted"],
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
            else
            {
                var image = new Image { Stretch = Stretch.UniformToFill };
                art.Children.Add(image);
                if (episode != null)
                {
                    Artwork.LoadEpisode(image, work, episode, (int)width);
                }
                else
                {
                    Artwork.Load(image, work, (int)width, cover ? new[] { ImageKind.Poster, ImageKind.Thumb } : new[] { ImageKind.Thumb, ImageKind.Backdrop });
                }
            }

            if (work.WatchPercent is { } percent)
            {
                // .tv-watch-progress: a 3 px line along the bottom edge in the brand colour on a 20 % white track.
                var track = new Grid { Height = 3, VerticalAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(51, 255, 255, 255)), IsHitTestVisible = false };
                track.Children.Add(new Border { Width = System.Math.Max(3, width * percent / 100), HorizontalAlignment = HorizontalAlignment.Left, Background = (Brush)Application.Current.Resources["PlayarrBrand"] });
                art.Children.Add(track);
            }
            else if (work.ShowUnwatched)
            {
                // .tv-watch-unseen: a brand dot with a white ring in the top right corner.
                art.Children.Add(new Windows.UI.Xaml.Shapes.Ellipse
                {
                    Width = 13,
                    Height = 13,
                    Margin = new Thickness(0, 10, 10, 0),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Fill = (Brush)Application.Current.Resources["PlayarrBrand"],
                    Stroke = new SolidColorBrush(Windows.UI.Color.FromArgb(240, 255, 255, 255)),
                    StrokeThickness = 2,
                    IsHitTestVisible = false,
                });
            }

            var root = new StackPanel { Width = width, Spacing = 0, Tag = work.Id };
            root.Children.Add(RestingShadow(width, height));
            root.Children.Add(art);
            root.Children.Add(new TextBlock
            {
                Text = episode != null ? (string.IsNullOrEmpty(episode.Title) ? work.Title : episode.Title) : work.Title,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(2, 12, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
                // Library grid rows repeat every 240.5 px, as the web: 184 px art, 12 px gap, 19 px title and a 25.5 px row gap.
                LineHeight = caption ? 0 : 19,
                LineStackingStrategy = caption ? LineStackingStrategy.MaxHeight : LineStackingStrategy.BlockLineHeight,
            });
            if (!caption)
            {
                return root;
            }

            root.Children.Add(new TextBlock
            {
                Text = episode != null ? WorkLabels.OnDeckCaption(work) : WorkLabels.KindWithYear(work),
                FontSize = 10,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.Resources["PlayarrInkSoft"],
                Margin = new Thickness(2, 4, 0, 0),
            });
            return root;
        }

        /// <summary>
        /// Web's resting card shadow (<c>--card-shadow-rest</c>: 0 10px 20px at 14 %, 0 3px 8px at 10 %) as stacked, fading
        /// rounded layers on a zero-size canvas before the art, so it paints beneath the card and moves nothing.
        /// </summary>
        private static Canvas RestingShadow(double width, double height)
        {
            var canvas = new Canvas { Width = 0, Height = 0, HorizontalAlignment = HorizontalAlignment.Left, IsHitTestVisible = false };
            for (var k = 15; k >= 0; k--)
            {
                var d = k * 2;
                var layer = new Border
                {
                    Width = width + 2 * d,
                    Height = height + 2 * d,
                    CornerRadius = new CornerRadius(12 + d),
                    Background = new SolidColorBrush(Windows.UI.Color.FromArgb(k < 3 ? (byte)7 : (byte)4, 56, 38, 33)),
                };
                Canvas.SetLeft(layer, -d);
                Canvas.SetTop(layer, 8 - d);
                canvas.Children.Add(layer);
            }

            return canvas;
        }

        public static FrameworkElement CreateTile(Work work, Uri? posterUri)
        {
            var posterHost = new Border
            {
                Width = TileWidth,
                Height = TileHeight,
                Background = (Brush)Application.Current.Resources["PlayarrSurfaceSoft"],
                CornerRadius = new CornerRadius(4),
            };

            if (posterUri != null)
            {
                posterHost.Child = new Image
                {
                    Source = new BitmapImage(posterUri),
                    Stretch = Stretch.UniformToFill,
                };
            }

            var title = new TextBlock
            {
                Text = work.Title,
                Width = TileWidth,
                Margin = new Thickness(0, 8, 0, 0),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };

            var root = new StackPanel
            {
                Width = TileWidth,
                Margin = new Thickness(0, 0, 20, 20),
                Tag = work.Id,
            };
            root.Children.Add(posterHost);
            root.Children.Add(title);

            return root;
        }
    }
}
