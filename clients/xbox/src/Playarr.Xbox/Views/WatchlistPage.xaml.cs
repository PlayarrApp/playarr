using System;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web Watchlist: one row per saved title with its year and library, a Resume or Play action when the title
    /// is playable here, and Remove from watchlist. Built in code; the XAML file only registers the page.
    /// </summary>
    public sealed partial class WatchlistPage : Page
    {
        private readonly Grid _list = new Grid { Margin = new Thickness(786, 80, 58, 0), VerticalAlignment = VerticalAlignment.Top };
        private readonly StackPanel _rows = new StackPanel { Spacing = 14 };
        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(786, 100, 0, 0), FontSize = 13 };

        public WatchlistPage()
        {
            InitializeComponent();
            Ui.PageHeader(RootGrid, "Watchlist", null, () => App.Navigation.GoBack());
            _list.Children.Add(new ScrollViewer { Content = _rows, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, Height = 960, VerticalAlignment = VerticalAlignment.Top });
            RootGrid.Children.Add(_list);
            RootGrid.Children.Add(_status);
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _status.Text = "Loading your watchlist\u2026";
            await LoadAsync(focusFirst: true);
        }

        private async System.Threading.Tasks.Task LoadAsync(bool focusFirst)
        {
            try
            {
                var response = await App.Environment.ApiClient.GetWatchlistAsync();
                _status.Text = string.Empty;
                Render(response.Items);
                if (focusFirst && response.Items.Count > 0)
                {
                    FocusClaim.Start(this, () => FirstButton());
                }
            }
            catch (Exception error)
            {
                _status.Text = error is ApiException api ? api.DisplayMessage : "Couldn't load your watchlist";
            }
        }

        private Control? FirstButton() =>
            _rows.Children.Count > 0 ? Windows.UI.Xaml.Input.FocusManager.FindFirstFocusableElement(_rows) as Control : null;

        private void Render(System.Collections.Generic.IList<WatchlistEntry> items)
        {
            _rows.Children.Clear();
            if (items.Count == 0)
            {
                _rows.Children.Add(Ui.EmptyState("\uE728", "Your watchlist is empty", "Add titles from search or a title page to keep them here on every device."));
                return;
            }

            foreach (var entry in items)
            {
                _rows.Children.Add(Row(entry));
            }
        }

        private FrameworkElement Row(WatchlistEntry entry)
        {
            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 8 };
            text.Children.Add(Ui.Text(entry.Title.Title, 15, FontWeights.Bold, "PlayarrInk"));
            text.Children.Add(Ui.Text(entry.Caption(), 14, FontWeights.Normal, "PlayarrInkSoft"));

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            if (entry.PrimaryPlayAction() is { } play)
            {
                var label = play.Action == "resume" ? "Resume" : "Play";
                var button = Ui.Pill(label, () => Play(entry, play), 88);
                SetPillSize(button, 17);
                actions.Children.Add(button);
            }

            var remove = Ui.Pill("Remove from watchlist", null);
            remove.Height = 44;
            remove.Click += async (s, e) => await RemoveAsync(entry);
            actions.Children.Add(remove);

            var row = new Grid { Height = 100, Padding = new Thickness(22, 0, 22, 0) };
            row.Children.Add(text);
            row.Children.Add(actions);
            return new Border { CornerRadius = new CornerRadius(16), Background = Ui.Res("PlayarrSurface"), Child = row };
        }

        private static void SetPillSize(Button pill, double size)
        {
            ((TextBlock)pill.Content).FontSize = size;
            pill.Height = 44;
        }

        private static void Play(WatchlistEntry entry, TitleAction action)
        {
            var title = entry.Title.Title;
            App.Navigation.Navigate(typeof(PlayerPage), new PlayerNavigationParameter(action.MediaFileId!.Value, action.PositionMs, title, action.WorkId));
        }

        private async System.Threading.Tasks.Task RemoveAsync(WatchlistEntry entry)
        {
            try
            {
                await App.Environment.ApiClient.RemoveFromWatchlistAsync(entry.Title.TitleKey);
                await LoadAsync(focusFirst: true);
            }
            catch (Exception error)
            {
                _status.Text = error is ApiException api ? api.DisplayMessage : "Couldn't remove that title";
            }
        }
    }
}
