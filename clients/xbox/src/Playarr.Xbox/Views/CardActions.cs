using System;
using System.Linq;
using Playarr.Core.Models;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Controls.Primitives;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web's long-press actions panel (MediaContextMenu) in the shared <see cref="Drawer"/>: the gamepad Menu
    /// button, a long press or right-click on a card opens "Title actions" with Play, Download (films), Add to
    /// Playlist, Mark as Watched and Mark as Unwatched.
    /// </summary>
    internal static class CardActions
    {
        public static void Attach(ListViewBase list, Func<Guid, Work?> workFor)
        {
            list.ContextRequested += (s, e) =>
            {
                if (ContainerOf(e.OriginalSource as DependencyObject) is { ContentTemplateRoot: FrameworkElement { Tag: Guid id } }
                    && workFor(id) is { } work
                    && FindHost(list) is { } host)
                {
                    e.Handled = true;
                    Open(host, work);
                }
            };
        }

        private static SelectorItem? ContainerOf(DependencyObject? element)
        {
            while (element != null && !(element is SelectorItem))
            {
                element = Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(element);
            }

            return element as SelectorItem;
        }

        private static Panel? FindHost(DependencyObject element)
        {
            while (element != null && !(element is Page))
            {
                element = Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(element);
            }

            return (element as Page)?.Content as Panel;
        }

        public static void Open(Panel host, Work work)
        {
            var body = new StackPanel();
            Drawer? drawer = null;
            body.Children.Add(Drawer.Action("\uE768", "Play", async () =>
            {
                drawer?.Close();
                var detail = await App.Environment.ApiClient.GetWorkAsync(work.Id);
                var leaf = detail.PlayableLeaves().FirstOrDefault();
                if (work.Kind == WorkKind.Movie && leaf.MediaFileId != Guid.Empty)
                {
                    App.Navigation.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(leaf.MediaFileId, title: work.Title, workId: work.Id));
                }
                else
                {
                    // Series open on their page, which puts focus on the next episode to play.
                    App.Navigation.Navigate(typeof(WorkDetailPage), work.Id);
                }
            }));
            if (work.Kind == WorkKind.Movie)
            {
                body.Children.Add(Drawer.Action("\uE896", "Download", () => Download(work, drawer)));
            }

            body.Children.Add(Drawer.Action("\uE710", "Add to Playlist", () => OpenPlaylists(host, work)));
            body.Children.Add(Drawer.Action("", "Mark as Watched", () => SetWatched(work, true, drawer)));
            body.Children.Add(Drawer.Action("", "Mark as Unwatched", () => SetWatched(work, false, drawer)));
            drawer = Drawer.Open(host, "Title actions", work.Title, body);
        }

        private static async void Download(Work work, Drawer? drawer)
        {
            try
            {
                var detail = await App.Environment.ApiClient.GetWorkAsync(work.Id);
                var leaf = detail.PlayableLeaves().FirstOrDefault();
                var service = Services.DownloadService.Instance;
                await service.LoadAsync();
                if (leaf.MediaFileId != Guid.Empty && service.ForMediaFile(leaf.MediaFileId) == null)
                {
                    await service.StartAsync(new DownloadRecord { WorkId = work.Id, MediaFileId = leaf.MediaFileId, Kind = "movie", Title = work.Title });
                }

                drawer?.Close();
            }
            catch (Exception error)
            {
                App.LogCrash(error);
            }
        }

        private static async void OpenPlaylists(Panel host, Work work)
        {
            try
            {
                var body = new StackPanel();
                foreach (var info in (await App.Environment.ApiClient.ListPlaylistsAsync()).Where(p => !p.IsSystem))
                {
                    var id = info.Id;
                    body.Children.Add(Drawer.Action("\uE710", info.Name, async () =>
                    {
                        try
                        {
                            await App.Environment.ApiClient.AddToPlaylistAsync(id, work.Id);
                        }
                        catch (Exception error)
                        {
                            App.LogCrash(error);
                        }

                        Drawer.TryCloseCurrent();
                    }));
                }

                Drawer.Open(host, "Add to Playlist", work.Title, body);
            }
            catch (Exception error)
            {
                App.LogCrash(error);
            }
        }

        private static async void SetWatched(Work work, bool watched, Drawer? drawer)
        {
            try
            {
                var detail = await App.Environment.ApiClient.GetWorkAsync(work.Id);
                foreach (var (file, runtimeMs) in detail.PlayableLeaves())
                {
                    await App.Environment.ApiClient.UpdateWatchProgressAsync(file, new UpdateWatchProgressRequest
                    {
                        PositionMs = watched ? runtimeMs : 0,
                        DurationMs = runtimeMs,
                        Completed = watched,
                    });
                }

                drawer?.Close();
            }
            catch (Exception error)
            {
                App.LogCrash(error);
            }
        }
    }
}
