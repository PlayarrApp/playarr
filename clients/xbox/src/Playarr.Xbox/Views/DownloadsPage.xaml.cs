using Windows.UI.Xaml.Controls;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The web Downloads page. This client cannot download titles for offline viewing yet, so the page says so rather
    /// than offering a feature that is not there.
    /// </summary>
    public sealed partial class DownloadsPage : Page
    {
        public DownloadsPage()
        {
            InitializeComponent();
            Ui.PageHeader(RootGrid, "Downloads", null, () => App.Navigation.GoBack());
            RootGrid.Children.Add(Ui.EmptyState("\uE896", "No downloads yet", "Downloading titles to watch without a connection is not available in the Xbox app yet."));
        }
    }
}
