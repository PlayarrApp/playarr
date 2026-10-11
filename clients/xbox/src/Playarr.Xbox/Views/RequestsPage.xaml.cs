using System;
using System.Globalization;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Playarr.Xbox.Views
{
    /// <summary>The web Requests page: titles the viewer asked for that the library does not have yet, with their progress.</summary>
    public sealed partial class RequestsPage : Page
    {
        private readonly StackPanel _rows = new StackPanel { Spacing = 14, Margin = new Thickness(786, 80, 58, 48), VerticalAlignment = VerticalAlignment.Top };
        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(786, 100, 0, 0), FontSize = 13 };

        public RequestsPage()
        {
            InitializeComponent();
            Ui.PageHeader(RootGrid, "Requests", null, () => App.Navigation.GoBack());
            RootGrid.Children.Add(_rows);
            RootGrid.Children.Add(_status);
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _status.Text = "Loading your requests\u2026";
            try
            {
                var requests = await App.Environment.ApiClient.ListRequestsAsync();
                _status.Text = string.Empty;
                _rows.Children.Clear();
                if (requests.Count == 0)
                {
                    RootGrid.Children.Add(Ui.EmptyState("\uE8C8", "No requests yet", "Request a title that is not in the library and its progress shows up here."));
                    return;
                }

                foreach (var request in requests)
                {
                    _rows.Children.Add(Row(request));
                }
            }
            catch (Exception error)
            {
                _status.Text = error is ApiException api ? api.DisplayMessage : "Couldn't load your requests";
            }
        }

        private static FrameworkElement Row(RequestView request)
        {
            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 8 };
            text.Children.Add(Ui.Text(request.Title, 15, FontWeights.Bold, "PlayarrInk"));
            var caption = request.Year is { } year ? year.ToString(CultureInfo.InvariantCulture) + "  " + request.Kind : request.Kind;
            text.Children.Add(Ui.Text(caption, 14, FontWeights.Normal, "PlayarrInkSoft"));
            var status = new TextBlock { Text = request.Status.Length == 0 ? string.Empty : char.ToUpperInvariant(request.Status[0]) + request.Status.Substring(1), FontSize = 13, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            var row = new Grid { Height = 100, Padding = new Thickness(22, 0, 22, 0) };
            row.Children.Add(text);
            row.Children.Add(status);
            return new Border { CornerRadius = new CornerRadius(16), Background = Ui.Res("PlayarrSurface"), Child = row };
        }
    }
}
