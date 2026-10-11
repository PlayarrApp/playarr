using System;
using System.Collections.Generic;
using System.Linq;
using System.ComponentModel;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The real home/catalog screen, replacing the Screens-phase placeholder
    /// the foundation agent left here. Reached from <see cref="ProfilesPage"/>'s
    /// tile click and from <see cref="LibraryPage"/>'s "Home" nav button.
    /// </summary>
    /// <remarks>
    /// Follows <c>Views/LoginPage.xaml.cs</c>'s six-point pattern. The one
    /// addition: <see cref="RailItem_Click"/> reads the
    /// <see cref="Guid"/> that <see cref="CatalogTileFactory"/> stashed on
    /// each tile's <c>Tag</c> and navigates to <see cref="WorkDetailPage"/>
    /// directly -- a synchronous, one-shot user action with no ViewModel
    /// state to relay through <c>Render()</c>, the same judgment call
    /// <see cref="ProfilesPage"/>'s tile click makes (see its own remarks).
    /// </remarks>
    public sealed partial class HomePage : Page
    {
        private readonly HomeViewModel _viewModel;
        private bool _focusFirst;
        private IReadOnlyList<HomeRail>? _renderedRails;

        public HomePage()
        {
            InitializeComponent();
            _viewModel = new HomeViewModel(App.Environment);
            // The rails' scroller would swallow Up/Down to scroll; D-pad Up/Down must move focus to the card above or below.
            RailsScroll.PreviewKeyDown += RailsScroll_PreviewKeyDown;
        }

        private void RailsScroll_PreviewKeyDown(object sender, Windows.UI.Xaml.Input.KeyRoutedEventArgs e)
        {
            var direction = e.Key switch
            {
                Windows.System.VirtualKey.Down or Windows.System.VirtualKey.GamepadDPadDown => Windows.UI.Xaml.Input.FocusNavigationDirection.Down,
                Windows.System.VirtualKey.Up or Windows.System.VirtualKey.GamepadDPadUp => Windows.UI.Xaml.Input.FocusNavigationDirection.Up,
                _ => Windows.UI.Xaml.Input.FocusNavigationDirection.None,
            };
            if (direction != Windows.UI.Xaml.Input.FocusNavigationDirection.None)
            {
                Windows.UI.Xaml.Input.FocusManager.TryMoveFocus(direction);
                e.Handled = true;
            }
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _focusFirst = true;
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            base.OnNavigatedFrom(e);
        }

        private void ViewModel_PropertyChanged(object sender, PropertyChangedEventArgs e) => Render();

        /// <summary>
        /// Pushes the ViewModel's current state onto this page's named
        /// elements. See <c>Views/LoginPage.xaml.cs</c>'s type-level remarks
        /// for why this is one unconditional method rather than a
        /// per-property handler.
        /// </summary>
        private void Render()
        {
            LoadingRing.IsActive = _viewModel.IsLoading;
            LoadingRing.Visibility = _viewModel.IsLoading ? Visibility.Visible : Visibility.Collapsed;

            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            RailsScroll.Visibility = _viewModel.IsLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            // Rebuild only for a new result: a rebuild drops focus back to the nav rail.
            if (!ReferenceEquals(_renderedRails, _viewModel.Rails))
            {
                // A late On deck replaces the rails under the viewer: if focus was on a card, claim the first one again.
                if (_renderedRails != null && Windows.UI.Xaml.Input.FocusManager.GetFocusedElement() is DependencyObject focused && IsInRails(focused))
                {
                    _focusFirst = true;
                }

                _renderedRails = _viewModel.Rails;
                RailsPanel.Children.Clear();
                foreach (var rail in _viewModel.Rails)
                {
                    RailsPanel.Children.Add(BuildRail(rail));
                }

                var shown = _viewModel.Rails.Count > 0 && _viewModel.Rails[0].Items.Count > 0 ? _viewModel.Rails[0].Items[0] : null;
                Detail.Show(shown, withKind: true);
                if (shown != null)
                {
                    ShowRuntime(shown.Id);
                }
            }

            var first = _viewModel.Rails.Count > 0 && _viewModel.Rails[0].Items.Count > 0 ? _viewModel.Rails[0].Items[0] : null;
            if (_focusFirst && !_viewModel.IsLoading && !hasError && first != null && RailsPanel.Children.Count > 0)
            {
                // Render rebuilds the rails on every notification: keep asking until a card really holds focus.
                var firstList = (ListView)((StackPanel)RailsPanel.Children[0]).Children[1];
                _focusFirst = false;
                CardFocus.FocusFirstWhenReady(firstList);
            }
        }

        private static readonly System.Collections.Generic.Dictionary<Guid, string> Runtimes = new System.Collections.Generic.Dictionary<Guid, string>();
        private Guid _runtimeFor;

        /// <summary>The web hero's meta is the runtime ("1h 48m"), read from the title's detail once focus has dwelt on it.</summary>
        private async void ShowRuntime(Guid id)
        {
            _runtimeFor = id;
            if (!Runtimes.TryGetValue(id, out var label))
            {
                await System.Threading.Tasks.Task.Delay(300);
                if (_runtimeFor != id)
                {
                    return;
                }

                try
                {
                    var detail = await App.Environment.ApiClient.GetWorkAsync(id);
                    var minutes = detail.RuntimeMs is { } ms && ms > 0 ? Math.Max(1, (int)Math.Round(ms / 60000.0)) : 0;
                    label = minutes == 0 ? string.Empty : minutes < 60 ? $"{minutes}m" : minutes % 60 == 0 ? $"{minutes / 60}h" : $"{minutes / 60}h {minutes % 60}m";
                }
                catch (Exception)
                {
                    label = string.Empty;
                }

                Runtimes[id] = label;
            }

            if (_runtimeFor == id)
            {
                Detail.SetMeta(label);
            }
        }

        private bool IsInRails(DependencyObject node)
        {
            for (var current = node; current != null; current = Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(current))
            {
                if (ReferenceEquals(current, RailsPanel))
                {
                    return true;
                }
            }

            return false;
        }

        private UIElement BuildRail(HomeRail rail)
        {
            var list = new ListView
            {
                SelectionMode = ListViewSelectionMode.None,
                IsItemClickEnabled = true,
                Height = 262,
                Padding = new Thickness(0),
            };
            ScrollViewer.SetHorizontalScrollBarVisibility(list, ScrollBarVisibility.Hidden);
            ScrollViewer.SetHorizontalScrollMode(list, ScrollMode.Enabled);
            ScrollViewer.SetVerticalScrollMode(list, ScrollMode.Disabled);
            list.ItemsPanel = (ItemsPanelTemplate)Windows.UI.Xaml.Markup.XamlReader.Load(
                "<ItemsPanelTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
                "<ItemsStackPanel Orientation='Horizontal' /></ItemsPanelTemplate>");
            list.ItemContainerStyle = CatalogTileFactory.CardContainerStyle;
            list.ItemClick += RailItem_Click;
            CardFocus.Attach(list);
            CardActions.Attach(list, id => rail.Items.FirstOrDefault(w => w.Id == id));
            list.GotFocus += (s, e) =>
            {
                if (e.OriginalSource is ListViewItem { Content: FrameworkElement { Tag: Guid id } })
                {
                    Detail.Show(rail.Items.FirstOrDefault(w => w.Id == id), withKind: true);
                }
            };
            foreach (var work in rail.Items)
            {
                list.Items.Add(CatalogTileFactory.CreateLandscapeCard(work));
            }

            var section = new StackPanel { Spacing = 22 };
            section.Children.Add(new TextBlock { Text = rail.Title, Style = (Style)Application.Current.Resources["PlayarrRailTitle"] });
            section.Children.Add(list);
            return section;
        }

        private void RailItem_Click(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();
    }
}
