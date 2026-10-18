using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using Windows.UI.Text;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Playarr.Core.Models;
using Playarr.Xbox.ViewModels;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The catalog browse screen: server-defined kind tabs (plus an "All"
    /// tab this page adds itself) and a two-way sort choice, feeding a
    /// <see cref="GridView"/> of catalog tiles. Reached from
    /// <see cref="HomePage"/>'s "Library" nav button.
    /// </summary>
    /// <remarks>
    /// Follows <c>Views/LoginPage.xaml.cs</c>'s six-point pattern. Kind tabs
    /// and grid tiles are both rebuilt from scratch on every <c>Render()</c>
    /// call (no per-property diffing), the same simplicity call every other
    /// page in this project makes. <see cref="WorksGridView_ItemClick"/>
    /// mirrors <see cref="HomePage"/>'s own tile-click handling exactly --
    /// see that page's remarks and <see cref="CatalogTileFactory"/>'s.
    /// </remarks>
    public sealed partial class LibraryPage : Page
    {
        private readonly LibraryViewModel _viewModel;
        private bool _focusFirst;
        private readonly LibraryInitialFocusState _initialFocus = new LibraryInitialFocusState();
        private Guid? _restoreId;
        private Guid? _lastFocusedWorkId;
        private Guid? _refreshFocusId;
        private bool _refreshFocusPending;
        private bool _refreshFocusClaimStarted;
        private bool _refreshFocusCancelled;
        private bool _refreshUserInput;
        private IReadOnlyList<Work>? _renderedWorks;
        private char _activeLetter = '#';
        private char? _renderedActiveLetter;
        private bool? _renderedReverse;

        /// <summary>The kind this page lists; read by the parity trace.</summary>
        internal WorkKind? Kind => _viewModel.SelectedKind;
        internal bool InitialFocusPending => _initialFocus.IsPending;
        private readonly Dictionary<Guid, Work> _worksById = new Dictionary<Guid, Work>();

        private readonly Ui.PageHeaderParts _header;

        public LibraryPage()
        {
            InitializeComponent();
            _header = Ui.PageHeader(Root, "Library", null, () => App.Navigation.GoBack());
            Root.Children.Add(Ui.ActionTile(Ui.FiltersIcon(), "Filters", 152, OpenFilters));
            _viewModel = new LibraryViewModel(App.Environment);
            WorksGridView.ItemContainerStyle = Appearance.LibraryCover ? CatalogTileFactory.CoverGridCardContainerStyle : CatalogTileFactory.GridCardContainerStyle;
            WorksGridView.GotFocus += WorksGridView_GotFocus;
            CardFocus.Attach(WorksGridView, true, 4);
            EdgeFade.AttachVertical(Root, WorksGridView);
            CardActions.Attach(WorksGridView, id => _worksById.TryGetValue(id, out var work) ? work : null);
            Root.GotFocus += Root_GotFocus;
            Root.SizeChanged += (s, e) => UpdateLetterRailViewport(e.NewSize.Height);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            if (e.Parameter is WorkKind kind && kind != _viewModel.SelectedKind)
            {
                // Opened from the nav rail's Series, Movies or Music item.
                _viewModel.SelectKind(kind);
            }

            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            Window.Current.CoreWindow.KeyDown -= CoreWindow_KeyDown;
            Window.Current.CoreWindow.KeyDown += CoreWindow_KeyDown;
            Window.Current.CoreWindow.PointerPressed -= CoreWindow_PointerPressed;
            Window.Current.CoreWindow.PointerPressed += CoreWindow_PointerPressed;
            Window.Current.Content.GotFocus -= WindowContent_GotFocus;
            Window.Current.Content.GotFocus += WindowContent_GotFocus;
            _focusFirst = true;
            _initialFocus.Begin();
            // Back from a title lands on the card that was focused, as the web does.
            _restoreId = e.NavigationMode == NavigationMode.Back ? FocusClaim.Recall(MemoryKey()) : null;
            Render();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
            Window.Current.CoreWindow.KeyDown -= CoreWindow_KeyDown;
            Window.Current.CoreWindow.PointerPressed -= CoreWindow_PointerPressed;
            Window.Current.Content.GotFocus -= WindowContent_GotFocus;
            CancelRefreshFocusRestore();
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
            var isLoading = _viewModel.IsLoadingKinds || _viewModel.IsLoadingWorks;
            var hasError = !string.IsNullOrEmpty(_viewModel.ErrorMessage);
            var resultsChanged = !ReferenceEquals(_renderedWorks, _viewModel.Works);
            if (_initialFocus.ShouldCaptureRefresh(_refreshFocusPending, resultsChanged || isLoading || hasError, IsFocusWithin(WorksGridView)))
            {
                _refreshFocusPending = true;
                _refreshFocusCancelled = false;
                _refreshUserInput = false;
                _refreshFocusClaimStarted = false;
                _refreshFocusId = FocusedWorkId() ?? _lastFocusedWorkId;
                _focusFirst = false;
                FocusClaim.Cancel(WorksGridView);
            }

            LoadingRing.IsActive = isLoading;
            LoadingRing.Visibility = isLoading ? Visibility.Visible : Visibility.Collapsed;

            ErrorPanel.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
            ErrorText.Text = _viewModel.ErrorMessage ?? string.Empty;

            WorksGridView.Visibility = isLoading || hasError ? Visibility.Collapsed : Visibility.Visible;

            var kind = _viewModel.SelectedKind;
            _header.Title.Text = kind is { } k ? DisplayNameFor(k) : "Library";
            _header.Subtitle.Text = _viewModel.Total is { } total
                ? $"{total.ToString("N0", CultureInfo.CurrentCulture)} {(kind == WorkKind.Artist ? "ARTISTS" : "TITLES")}"
                : string.Empty;
            Ui.LayoutHeader(_header.Titles, _header.Title, _header.Subtitle);

            // Rebuild only for a new result: a rebuild drops focus back to the nav rail.
            if (resultsChanged)
            {
                _renderedWorks = _viewModel.Works;
                WorksGridView.Items.Clear();
                _worksById.Clear();
                foreach (var work in _viewModel.Works)
                {
                    _worksById[work.Id] = work;
                    WorksGridView.Items.Add(CatalogTileFactory.CreateLandscapeCard(work, caption: false, cover: Appearance.LibraryCover));
                }

                var preview = _viewModel.Works.FirstOrDefault(work => _refreshFocusPending && work.Id == _refreshFocusId)
                    ?? _viewModel.Works.FirstOrDefault();
                ShowFocused(preview);
                _activeLetter = preview != null ? LibraryAlphabet.LetterFor(preview) : '#';
            }

            if (_refreshFocusPending && !_refreshFocusClaimStarted && !isLoading && !hasError && _viewModel.Works.Count > 0)
            {
                if (_refreshUserInput)
                {
                    CancelRefreshFocusRestore();
                }
                else
                {
                    var orderedIds = _viewModel.Works.Select(work => work.Id).ToList();
                    var targetId = LibraryFocusRestore.ResolveTarget(orderedIds, _refreshFocusId, gridOwnedFocus: true, userMoved: false);
                    if (targetId is Guid id)
                    {
                        _refreshFocusId = id;
                        if (LibraryFocusRestore.IsFocusComplete(FocusedWorkId(), id, _refreshUserInput))
                        {
                            CompleteRefreshFocusRestore();
                        }
                        else
                        {
                            _refreshFocusClaimStarted = true;
                            CardFocus.FocusWhenReady(WorksGridView, () => RefreshFocusTarget(id),
                                () => !LibraryFocusRestore.ShouldContinueClaim(_refreshFocusPending, _refreshUserInput || _refreshFocusCancelled),
                                () => LibraryFocusRestore.IsFocusComplete(FocusedWorkId(), id, _refreshUserInput));
                        }
                    }
                    else
                    {
                        CancelRefreshFocusRestore();
                    }
                }
            }

            if (_focusFirst && !_refreshFocusPending && !isLoading && !hasError && _viewModel.Works.Count > 0)
            {
                _focusFirst = false;
                if (_initialFocus.ShouldStartClaim)
                {
                    CardFocus.FocusWhenReady(WorksGridView, RestoreOrFirst, () => _initialFocus.Settle());
                }
            }

            RenderLetterRail();
        }

        private string MemoryKey() => "library:" + _viewModel.SelectedKind;

        private Control? RestoreOrFirst()
        {
            if (_restoreId is { } id)
            {
                foreach (var item in WorksGridView.Items)
                {
                    if (item is FrameworkElement { Tag: Guid tag } && tag == id)
                    {
                        WorksGridView.ScrollIntoView(item);
                        if (WorksGridView.ContainerFromItem(item) is Control container)
                        {
                            return container;
                        }

                        return null;
                    }
                }
            }

            return WorksGridView.ContainerFromIndex(0) as Control;
        }

        private Control? RefreshFocusTarget(Guid id)
        {
            foreach (var item in WorksGridView.Items)
            {
                if (item is FrameworkElement { Tag: Guid tag } && tag == id)
                {
                    WorksGridView.ScrollIntoView(item);
                    return WorksGridView.ContainerFromItem(item) as Control;
                }
            }

            return null;
        }

        private Guid? FocusedWorkId()
        {
            for (var current = Windows.UI.Xaml.Input.FocusManager.GetFocusedElement() as DependencyObject;
                current != null && !ReferenceEquals(current, WorksGridView);
                current = Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(current))
            {
                if (current is GridViewItem { Content: FrameworkElement { Tag: Guid id } })
                {
                    return id;
                }
            }

            return null;
        }

        private void CompleteRefreshFocusRestore()
        {
            _refreshFocusPending = false;
            _refreshFocusClaimStarted = false;
            _refreshFocusId = null;
            FocusClaim.Cancel(WorksGridView);
        }

        private void CancelRefreshFocusRestore()
        {
            _refreshFocusCancelled = true;
            _refreshFocusPending = false;
            _refreshFocusClaimStarted = false;
            FocusClaim.Cancel(WorksGridView);
        }

        private void Root_GotFocus(object sender, RoutedEventArgs e)
        {
            if (_refreshFocusPending && _refreshFocusClaimStarted && !IsFocusWithin(WorksGridView))
            {
                CancelRefreshFocusRestore();
            }
        }

        private void WindowContent_GotFocus(object sender, RoutedEventArgs e)
        {
            if (_refreshFocusPending && _refreshFocusClaimStarted && !IsFocusWithin(WorksGridView))
            {
                CancelRefreshFocusRestore();
            }
        }

        private void CoreWindow_KeyDown(Windows.UI.Core.CoreWindow sender, Windows.UI.Core.KeyEventArgs e)
        {
            if (_initialFocus.IsPending && IsDirectionalKey(e.VirtualKey))
            {
                if (_initialFocus.CancelForUserInput()) FocusClaim.Cancel(WorksGridView);
            }

            if (_refreshFocusPending && IsDirectionalKey(e.VirtualKey))
            {
                _refreshUserInput = true;
                CancelRefreshFocusRestore();
            }
        }

        private void CoreWindow_PointerPressed(Windows.UI.Core.CoreWindow sender, Windows.UI.Core.PointerEventArgs e)
        {
            if (_initialFocus.IsPending)
            {
                if (_initialFocus.CancelForUserInput()) FocusClaim.Cancel(WorksGridView);
            }

            if (!_refreshFocusPending) return;

            _refreshUserInput = true;
            CancelRefreshFocusRestore();
        }

        private static bool IsDirectionalKey(Windows.System.VirtualKey key) => key is
            Windows.System.VirtualKey.Up or Windows.System.VirtualKey.Down or
            Windows.System.VirtualKey.Left or Windows.System.VirtualKey.Right or
            Windows.System.VirtualKey.GamepadDPadUp or Windows.System.VirtualKey.GamepadDPadDown or
            Windows.System.VirtualKey.GamepadDPadLeft or Windows.System.VirtualKey.GamepadDPadRight or
            Windows.System.VirtualKey.GamepadLeftThumbstickUp or Windows.System.VirtualKey.GamepadLeftThumbstickDown or
            Windows.System.VirtualKey.GamepadLeftThumbstickLeft or Windows.System.VirtualKey.GamepadLeftThumbstickRight;

        private void WorksGridView_GotFocus(object sender, RoutedEventArgs e)
        {
            var id = FocusedWorkId();
            if (id is Guid workId && _worksById.TryGetValue(workId, out var work))
            {
                _lastFocusedWorkId = workId;
                if (_refreshFocusPending && LibraryFocusRestore.IsFocusComplete(workId, _refreshFocusId ?? Guid.Empty, _refreshUserInput))
                {
                    CompleteRefreshFocusRestore();
                }
                else if (_refreshFocusPending && _refreshUserInput)
                {
                    CancelRefreshFocusRestore();
                }

                FocusClaim.Remember(MemoryKey(), workId);
                ShowFocused(work);
                _activeLetter = LibraryAlphabet.LetterFor(work);
                UpdateLetterRail();
            }
        }

        private void ShowFocused(Work? work) => Detail.Show(work);

        /// <summary>Web A-Z rail with a bounded viewport and sort-aware letter jumps.</summary>
        private void RenderLetterRail()
        {
            if (LetterRail.Children.Count == 0 || _renderedReverse != _viewModel.Reversed)
            {
                LetterRail.Children.Clear();
                var alphabet = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                if (_viewModel.Reversed) alphabet = new string(alphabet.Reverse().ToArray());
                foreach (var letter in alphabet)
                {
                    var button = new Button
                    {
                        Content = LetterContent(letter, letter == _activeLetter),
                        Width = 40,
                        Height = 44,
                        Padding = new Thickness(0),
                        CornerRadius = new CornerRadius(20),
                        HorizontalContentAlignment = HorizontalAlignment.Center,
                        Background = new Windows.UI.Xaml.Media.SolidColorBrush(Windows.UI.Colors.Transparent),
                        BorderThickness = new Thickness(0),
                        Tag = letter,
                    };
                    button.Click += LetterButton_Click;
                    LetterRail.Children.Add(button);
                }
                _renderedActiveLetter = _activeLetter;
                _renderedReverse = _viewModel.Reversed;
            }
            UpdateLetterRail();
            UpdateLetterRailViewport(Root.ActualHeight);
        }

        private void UpdateLetterRailViewport(double height)
        {
            var top = Math.Max(214, Math.Min(height * 0.25, 286));
            var bottomPadding = Math.Max(48, Math.Min(height * 0.06, 78));
            LetterRailScrollViewer.Margin = new Thickness(0, top, 21, 0);
            LetterRailContent.Padding = new Thickness(0, 8, 0, bottomPadding);
        }

        private object LetterContent(char letter, bool active)
        {
            var ink = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInk"];
            var soft = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrInkSoft"];
            var surface = (Windows.UI.Xaml.Media.Brush)Application.Current.Resources["PlayarrSurfaceStrong"];
            return active
                ? new Border
                {
                    Width = 24,
                    Height = 24,
                    CornerRadius = new CornerRadius(12),
                    Background = ink,
                    Child = new TextBlock { Text = letter.ToString(), FontSize = 10, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Foreground = surface },
                }
                : new TextBlock { Text = letter.ToString(), FontSize = 10, FontWeight = FontWeights.SemiBold, Foreground = soft };
        }

        private void UpdateLetterRail()
        {
            var previous = _renderedActiveLetter;
            Button? activeButton = null;
            foreach (var child in LetterRail.Children)
            {
                if (child is Button button && button.Tag is char letter)
                {
                    if (previous == null || letter == previous || letter == _activeLetter)
                    {
                        button.Content = LetterContent(letter, letter == _activeLetter);
                    }
                    if (letter == _activeLetter) activeButton = button;
                }
            }
            _renderedActiveLetter = _activeLetter;

            if (activeButton != null && !IsFocusWithin(LetterRailScrollViewer))
            {
                var point = activeButton.TransformToVisual(LetterRail).TransformPoint(new Windows.Foundation.Point(0, 0));
                var offset = point.Y + activeButton.ActualHeight / 2 - LetterRailScrollViewer.ViewportHeight / 2;
                LetterRailScrollViewer.ScrollToVerticalOffset(Math.Max(0, offset));
            }
        }

        private static bool IsFocusWithin(DependencyObject ancestor)
        {
            for (var current = Windows.UI.Xaml.Input.FocusManager.GetFocusedElement() as DependencyObject; current != null; current = Windows.UI.Xaml.Media.VisualTreeHelper.GetParent(current))
            {
                if (ReferenceEquals(current, ancestor)) return true;
            }
            return false;
        }

        private void LetterButton_Click(object sender, RoutedEventArgs e)
        {
            CancelRefreshFocusRestore();
            var letter = (char)((Button)sender).Tag;
            var works = _viewModel.Works.ToList();
            var targetIndex = LibraryAlphabet.FindJumpIndex(works, letter, _viewModel.Reversed);
            if (targetIndex >= 0)
            {
                WorksGridView.ScrollIntoView(WorksGridView.Items[targetIndex], ScrollIntoViewAlignment.Leading);
                ShowFocused(works[targetIndex]);
                var capturedIndex = targetIndex;
                CardFocus.FocusWhenReady(WorksGridView, () => WorksGridView.ContainerFromIndex(capturedIndex) as Control);
            }
        }

        private void OpenFilters()
        {
            var body = new StackPanel();
            // shortcut: the web also has List and Cover flow; Xbox has Screen and Cover.
            body.Children.Add(Drawer.Segmented("View", new[] { "Screen", "Cover" }, Appearance.LibraryCover ? 1 : 0, i =>
            {
                Appearance.LibraryCover = i == 1;
                Drawer.TryCloseCurrent();
                App.Navigation.NavigateReplacingCurrent(typeof(LibraryPage), _viewModel.SelectedKind!);
            }));
            body.Children.Add(Drawer.Segmented("Sort by", new[] { "Title", "Date Added" }, _viewModel.SelectedSort == null ? 0 : 1, i =>
            {
                _viewModel.SelectSort(i == 0 ? null : LibraryViewModel.SortRecentlyAdded);
                Drawer.TryCloseCurrent();
            }));
            body.Children.Add(Drawer.Segmented("Order", _viewModel.SelectedSort == null ? new[] { "A\u2013Z", "Z\u2013A" } : new[] { "Newest", "Oldest" }, _viewModel.Reversed ? 1 : 0, i =>
            {
                _viewModel.SelectOrder(i == 1);
                Drawer.TryCloseCurrent();
            }));
            Drawer.Open((Panel)Content, "Library controls", "Filters", body);
        }


        private void WorksGridView_ItemClick(object sender, ItemClickEventArgs e)
        {
            if (e.ClickedItem is FrameworkElement tile && tile.Tag is Guid workId)
            {
                App.Navigation.Navigate(typeof(WorkDetailPage), workId);
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e) => _viewModel.Retry();

        private static string DisplayNameFor(WorkKind kind) => kind switch
        {
            WorkKind.Movie => "Movies",
            WorkKind.Series => "Series",
            WorkKind.Site => "Sites",
            WorkKind.Artist => "Music",
            WorkKind.Author => "Books",
            _ => kind.ToString(),
        };
    }
}
