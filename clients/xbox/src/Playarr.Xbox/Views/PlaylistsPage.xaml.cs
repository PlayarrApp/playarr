using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>The web Playlists page: the viewer's own and the system playlists as cards; a card opens its titles.</summary>
    public sealed partial class PlaylistsPage : Page
    {
        private readonly GridView _grid = new GridView
        {
            Width = 1080,
            Margin = new Thickness(783, 0, 0, 0),
            Padding = new Thickness(0, 162, 0, 48),
            HorizontalAlignment = HorizontalAlignment.Left,
            SelectionMode = ListViewSelectionMode.None,
            IsItemClickEnabled = true,
        };

        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(786, 100, 0, 0), FontSize = 13 };

        public PlaylistsPage()
        {
            InitializeComponent();
            _grid.ItemContainerStyle = CatalogTileFactory.GridCardContainerStyle;
            ScrollViewer.SetVerticalScrollBarVisibility(_grid, ScrollBarVisibility.Hidden);
            CardFocus.ReserveFocusRoom(_grid, top: 0, right: 0, bottom: 0);
            CardFocus.Attach(_grid);
            _grid.ItemClick += (s, e) =>
            {
                if (e.ClickedItem is FrameworkElement { Tag: PlaylistInfo playlist })
                {
                    App.Navigation.Navigate(typeof(PlaylistPage), playlist);
                }
            };
            RootGrid.Children.Add(_grid);
            RootGrid.Children.Add(_status);
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _status.Text = "Loading your playlists\u2026";
            try
            {
                var playlists = await App.Environment.ApiClient.ListPlaylistsAsync();
                _status.Text = string.Empty;
                RootGrid.Children.Clear();
                Ui.PageHeader(RootGrid, "Playlists", playlists.Count == 1 ? "1 playlist" : playlists.Count + " playlists", () => App.Navigation.GoBack());
                if (playlists.Count == 0)
                {
                    RootGrid.Children.Add(Ui.EmptyState("\uE8FD", "No playlists yet", "Playlists you create on any device show up here."));
                    return;
                }

                var counts = await Task.WhenAll(playlists.Select(p => CountAsync(p.Id)));
                _grid.Items.Clear();
                for (var i = 0; i < playlists.Count; i++)
                {
                    _grid.Items.Add(Card(playlists[i], counts[i]));
                }

                RootGrid.Children.Add(_grid);
                FocusClaim.Start(this, () => _grid.ContainerFromIndex(0) as Control);
            }
            catch (Exception error)
            {
                _status.Text = error is ApiException api ? api.DisplayMessage : "Couldn't load your playlists";
            }
        }

        private static async Task<int> CountAsync(Guid id)
        {
            try
            {
                return (await App.Environment.ApiClient.ListPlaylistItemsAsync(id)).Count;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        private static FrameworkElement Card(PlaylistInfo playlist, int count)
        {
            var art = new Grid { Width = CatalogTileFactory.CardWidth, Height = CatalogTileFactory.CardHeight, CornerRadius = new CornerRadius(12), Background = Ui.Res("PlayarrSurfaceSoft") };
            var root = new StackPanel { Width = CatalogTileFactory.CardWidth, Tag = playlist };
            root.Children.Add(art);
            root.Children.Add(new TextBlock { Text = playlist.Name, FontSize = 13, FontWeight = FontWeights.SemiBold, Margin = new Thickness(2, 12, 0, 0), TextTrimming = TextTrimming.CharacterEllipsis });
            var kind = playlist.MediaType == "audio" ? "Audio" : "Video";
            var owner = playlist.IsSystem ? "System" : "Personal";
            root.Children.Add(Ui.Text($"{kind} \u00b7 {owner} \u00b7 {count} {(count == 1 ? "title" : "titles")}", 10, FontWeights.SemiBold, "PlayarrInkSoft", new Thickness(2, 4, 0, 0)));
            return root;
        }
    }
}
