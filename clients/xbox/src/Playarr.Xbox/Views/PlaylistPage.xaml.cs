using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>One playlist's titles in the library grid; a card opens the title.</summary>
    public sealed partial class PlaylistPage : Page
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

        public PlaylistPage()
        {
            InitializeComponent();
            _grid.ItemContainerStyle = CatalogTileFactory.GridCardContainerStyle;
            ScrollViewer.SetVerticalScrollBarVisibility(_grid, ScrollBarVisibility.Hidden);
            CardFocus.Attach(_grid);
            _grid.ItemClick += (s, e) =>
            {
                if (e.ClickedItem is FrameworkElement { Tag: Guid workId })
                {
                    App.Navigation.Navigate(typeof(WorkDetailPage), workId);
                }
            };
            RootGrid.Children.Add(_grid);
            RootGrid.Children.Add(_status);
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (!(e.Parameter is PlaylistInfo playlist))
            {
                App.Navigation.GoBack();
                return;
            }

            Ui.PageHeader(RootGrid, playlist.Name, null, () => App.Navigation.GoBack());
            _status.Text = "Loading\u2026";
            try
            {
                var items = await App.Environment.ApiClient.ListPlaylistItemsAsync(playlist.Id);
                var works = (await Task.WhenAll(items.OrderBy(i => i.Position).Select(i => WorkAsync(i.WorkId)))).Where(w => w != null).ToList();
                _status.Text = string.Empty;
                if (works.Count == 0)
                {
                    RootGrid.Children.Add(Ui.EmptyState("\uE8FD", "This playlist is empty", "Add titles to it from a title page."));
                    return;
                }

                foreach (var work in works)
                {
                    _grid.Items.Add(CatalogTileFactory.CreateLandscapeCard(work!, caption: false));
                }

                FocusClaim.Start(this, () => _grid.ContainerFromIndex(0) as Control);
            }
            catch (Exception error)
            {
                _status.Text = error is ApiException api ? api.DisplayMessage : "Couldn't load this playlist";
            }
        }

        private static async Task<Work?> WorkAsync(Guid id)
        {
            try
            {
                return (await App.Environment.ApiClient.GetWorkAsync(id)).Work;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
