using System;
using System.Collections.Generic;
using System.Linq;
using Playarr.Core.Models;
using Playarr.Xbox.Services;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web Downloads page: movies and videos as rows, series grouped series, then season, then episode, each level with
    /// Pause or Resume, Cancel or Delete, and (per download) Edit for the keep-until rule and the quality. Built in code.
    /// </summary>
    public sealed partial class DownloadsPage : Page
    {
        private readonly StackPanel _rows = new StackPanel { Spacing = 10 };
        private readonly Grid _empty;
        private readonly ScrollViewer _scroll;
        private int _kind;     // 0 all, 1 movies, 2 TV, 3 music
        private int _status;   // 0 all, 1 downloading, 2 paused, 3 done, 4 failed
        private int _sort;     // 0 recent, 1 title, 2 size

        public DownloadsPage()
        {
            InitializeComponent();
            Ui.PageHeader(RootGrid, "Downloads", null, () => App.Navigation.GoBack());
            _scroll = new ScrollViewer { Content = _rows, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, Margin = new Thickness(228, 190, 58, 0), VerticalAlignment = VerticalAlignment.Top, Height = 850 };
            CardFocus.ReserveFocusRoom(_scroll, top: 0, bottom: 0);
            RootGrid.Children.Add(_scroll);
            var filters = Ui.ActionTile(Ui.FiltersIcon(), "Filters", 152, OpenFilters);
            RootGrid.Children.Add(filters);
            _empty = new Grid { Visibility = Visibility.Collapsed };
            _empty.Children.Add(Ui.EmptyState("", "No downloads yet", "Titles you download to watch without a connection appear here."));
            RootGrid.Children.Add(_empty);
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            DownloadService.Instance.Changed += OnChanged;
            await DownloadService.Instance.LoadAsync();
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            DownloadService.Instance.Changed -= OnChanged;
            base.OnNavigatedFrom(e);
        }

        private void OnChanged() => _ = Dispatcher.RunAsync(Windows.UI.Core.CoreDispatcherPriority.Normal, Render);

        private static string Size(long bytes) => bytes >= 1L << 30 ? $"{bytes / (double)(1L << 30):0.0} GB" : $"{bytes / (double)(1L << 20):0} MB";

        private static string StatusText(DownloadRecord r)
        {
            switch (r.State)
            {
                case DownloadState.Queued: return "Queued";
                case DownloadState.Processing: return "Preparing on the server";
                case DownloadState.Downloading: return $"Downloading {r.Percent:0}%" + (r.TotalBytes is { } t ? $" · {Size(r.BytesDownloaded)} of {Size(t)}" : string.Empty);
                case DownloadState.Paused: return $"Paused {r.Percent:0}%";
                case DownloadState.Failed: return "Failed" + (string.IsNullOrEmpty(r.Error) ? string.Empty : ": " + r.Error);
                default: return "Ready" + (r.TotalBytes is { } total ? " · " + Size(total) : string.Empty);
            }
        }

        private static string KeepLabel(KeepUntilPolicy k) =>
            k.Type == "date" && k.Date is { } d ? "Keep until " + d.ToString("d MMM yyyy")
            : k.Type == "after-watched" ? $"Keep {k.Amount} {(k.Unit == "weeks" ? "week" : "day")}{(k.Amount == 1 ? string.Empty : "s")} after watched"
            : "Keep forever";

        private IReadOnlyList<DownloadRecord> Filtered(IReadOnlyList<DownloadRecord> records)
        {
            bool Kind(DownloadRecord r) => _kind == 0 || (_kind == 1 && (r.Kind == "movie" || r.Kind == "site")) || (_kind == 2 && r.Kind == "series") || (_kind == 3 && r.Kind == "artist");
            bool Status(DownloadRecord r) => _status == 0
                || (_status == 1 && (r.State == DownloadState.Downloading || r.State == DownloadState.Processing || r.State == DownloadState.Queued))
                || (_status == 2 && r.State == DownloadState.Paused) || (_status == 3 && r.State == DownloadState.Ready) || (_status == 4 && r.State == DownloadState.Failed);
            var kept = records.Where(r => Kind(r) && Status(r));
            return (_sort == 1 ? kept.OrderBy(r => (r.SeriesTitle ?? r.Title).ToLowerInvariant())
                : _sort == 2 ? kept.OrderByDescending(r => r.TotalBytes ?? r.BytesDownloaded)
                : kept.OrderByDescending(r => r.RequestedAt)).ToList();
        }

        /// <summary>The web's Downloads filters: type, status and sort, with Clear filters.</summary>
        private void OpenFilters()
        {
            var body = new StackPanel();
            body.Children.Add(Drawer.Segmented("Type", new[] { "All", "Movies", "TV", "Music" }, _kind, i => { _kind = i; Render(); Drawer.TryCloseCurrent(); }));
            body.Children.Add(Drawer.Segmented("Status", new[] { "All", "Downloading", "Paused", "Done", "Failed" }, _status, i => { _status = i; Render(); Drawer.TryCloseCurrent(); }));
            body.Children.Add(Drawer.Segmented("Sort", new[] { "Recent", "Title", "Size" }, _sort, i => { _sort = i; Render(); Drawer.TryCloseCurrent(); }));
            body.Children.Add(Drawer.Action("\uE894", "Clear filters", () => { _kind = _status = _sort = 0; Render(); Drawer.TryCloseCurrent(); }));
            Drawer.Open(RootGrid, "Downloads", "Filters", body);
        }

        private void Render()
        {
            var all = Filtered(DownloadService.Instance.Records);
            _rows.Children.Clear();
            _empty.Visibility = all.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            _scroll.Visibility = all.Count == 0 ? Visibility.Collapsed : Visibility.Visible;

            foreach (var movie in all.Where(r => string.IsNullOrEmpty(r.SeriesTitle)))
            {
                _rows.Children.Add(Row(movie, indent: 0));
            }

            foreach (var series in all.Where(r => !string.IsNullOrEmpty(r.SeriesTitle)).GroupBy(r => r.SeriesTitle!))
            {
                _rows.Children.Add(GroupHeader(series.Key, $"{series.Count()} episode{(series.Count() == 1 ? string.Empty : "s")}", series.ToList(), 0));
                foreach (var season in series.GroupBy(r => r.SeasonNumber ?? 0).OrderBy(g => g.Key))
                {
                    _rows.Children.Add(GroupHeader($"Season {season.Key}", $"{season.Count()} episode{(season.Count() == 1 ? string.Empty : "s")}", season.ToList(), 28));
                    foreach (var episode in season.OrderBy(r => r.EpisodeNumber ?? 0))
                    {
                        _rows.Children.Add(Row(episode, indent: 56));
                    }
                }
            }
        }

        private static Button Small(string text, Action click, bool enabled = true)
        {
            var button = Ui.Pill(text, click);
            button.Background = new Windows.UI.Xaml.Media.SolidColorBrush(Theme.IsLight ? Windows.UI.Color.FromArgb(18, 56, 38, 33) : Windows.UI.Color.FromArgb(15, 255, 255, 255));
            button.BorderThickness = new Thickness(0);
            button.Height = 42;
            button.Padding = new Thickness(16, 0, 16, 0);
            button.IsEnabled = enabled;
            return button;
        }

        private FrameworkElement GroupHeader(string title, string detail, IList<DownloadRecord> set, double indent)
        {
            var grid = new Grid { Margin = new Thickness(indent, indent == 0 ? 18 : 6, 0, 2), ColumnSpacing = 10 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var text = new StackPanel();
            text.Children.Add(Ui.Text(title, indent == 0 ? 20 : 15, FontWeights.SemiBold, "PlayarrInk"));
            text.Children.Add(Ui.Text(detail, 11, FontWeights.Normal, "PlayarrInkSoft", new Thickness(0, 2, 0, 0)));
            grid.Children.Add(text);
            var running = set.Any(r => r.State == DownloadState.Downloading || r.State == DownloadState.Processing || r.State == DownloadState.Queued);
            var anyUnfinished = set.Any(r => r.State != DownloadState.Ready);
            var headerButtons = new List<Button>();
            if (running)
            {
                headerButtons.Add(Small("Pause all", () => { foreach (var r in set) { DownloadService.Instance.Pause(r.Id); } }));
            }
            else if (anyUnfinished)
            {
                headerButtons.Add(Small("Resume all", () => { foreach (var r in set.Where(r => r.State != DownloadState.Ready)) { DownloadService.Instance.Resume(r.Id); } }));
            }

            headerButtons.Add(Small(anyUnfinished ? "Cancel all" : "Delete all", () => { foreach (var r in set.ToList()) { _ = DownloadService.Instance.RemoveAsync(r.Id); } }));
            AddButtons(grid, headerButtons);
            return grid;
        }

        private static void AddButtons(Grid grid, IEnumerable<Button> buttons)
        {
            foreach (var button in buttons)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                Grid.SetColumn(button, grid.ColumnDefinitions.Count - 1);
                grid.Children.Add(button);
            }
        }

        private FrameworkElement Row(DownloadRecord r, double indent)
        {
            var grid = new Grid { Margin = new Thickness(indent, 0, 0, 0), ColumnSpacing = 10, MinHeight = 76 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var title = r.EpisodeNumber is { } n ? $"{n}. {r.Title}" : r.Title;
            text.Children.Add(Ui.Text(title, 16, FontWeights.SemiBold, "PlayarrInk"));
            text.Children.Add(Ui.Text($"{StatusText(r)} · {r.QualityLabel} · {KeepLabel(r.KeepUntil)}", 11, FontWeights.Normal, r.State == DownloadState.Failed ? "PlayarrBrandInk" : "PlayarrInkSoft", new Thickness(0, 3, 0, 0)));
            grid.Children.Add(text);

            var buttons = new List<Button>();
            if (r.State == DownloadState.Downloading || r.State == DownloadState.Processing || r.State == DownloadState.Queued)
            {
                buttons.Add(Small("Pause", () => DownloadService.Instance.Pause(r.Id)));
            }
            else if (r.State == DownloadState.Paused || r.State == DownloadState.Failed)
            {
                buttons.Add(Small(r.State == DownloadState.Failed ? "Retry" : "Resume", () => DownloadService.Instance.Resume(r.Id)));
            }

            if (r.State == DownloadState.Ready)
            {
                buttons.Add(Small("Play", () => App.Navigation.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(r.MediaFileId, title: r.Title, workId: r.WorkId, preferLocal: true))));
            }

            buttons.Add(Small("Edit", () => OpenEdit(r)));
            buttons.Add(Small(r.State == DownloadState.Ready ? "Delete" : "Cancel", () => _ = DownloadService.Instance.RemoveAsync(r.Id)));
            AddButtons(grid, buttons);
            return grid;
        }

        /// <summary>Edit a download: the keep-until rule and the quality (a new quality downloads the title again).</summary>
        private async void OpenEdit(DownloadRecord record)
        {
            var body = new StackPanel();
            var keepChoices = new[] { "Forever", "1 day after watched", "7 days after watched", "2 weeks after watched" };
            var selected = record.KeepUntil.Type == "after-watched" ? (record.KeepUntil.Unit == "weeks" ? 3 : record.KeepUntil.Amount <= 1 ? 1 : 2) : 0;
            body.Children.Add(Drawer.Segmented("Keep until", keepChoices, selected, i =>
            {
                var policy = i == 0 ? KeepUntilPolicy.Forever
                    : new KeepUntilPolicy { Type = "after-watched", Amount = i == 1 ? 1 : i == 2 ? 7 : 2, Unit = i == 3 ? "weeks" : "days" };
                DownloadService.Instance.SetKeepUntil(record.Id, policy);
            }));
            try
            {
                var options = (await App.Environment.ApiClient.GetDownloadOptionsAsync(record.MediaFileId)).Options;
                if (options.Count > 1)
                {
                    var current = Math.Max(0, options.ToList().FindIndex(o => o.Id == record.QualityId));
                    body.Children.Add(Drawer.Segmented("Quality", options.Select(o => o.Label).ToArray(), current, i =>
                    {
                        if (options[i].Id == record.QualityId)
                        {
                            return;
                        }

                        Drawer.TryCloseCurrent();
                        _ = ChangeQualityAsync(record, options[i]);
                    }));
                }
            }
            catch (Exception)
            {
                // Without the options the keep-until rule can still be edited.
            }

            Drawer.Open(RootGrid, "Edit download", record.Title, body);
        }

        private static async System.Threading.Tasks.Task ChangeQualityAsync(DownloadRecord record, DownloadOption option)
        {
            var copy = new DownloadRecord
            {
                WorkId = record.WorkId, MediaFileId = record.MediaFileId, Kind = record.Kind, Title = record.Title, Subtitle = record.Subtitle,
                SeriesTitle = record.SeriesTitle, SeasonNumber = record.SeasonNumber, EpisodeNumber = record.EpisodeNumber, KeepUntil = record.KeepUntil,
            };
            await DownloadService.Instance.RemoveAsync(record.Id);
            await DownloadService.Instance.StartAsync(copy, option.Id, option.Label);
        }
    }
}
