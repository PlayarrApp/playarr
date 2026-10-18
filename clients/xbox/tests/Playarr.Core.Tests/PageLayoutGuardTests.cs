using System;
using System.IO;
using System.Linq;
using Xunit;

namespace Playarr.Core.Tests
{
    /// <summary>
    /// Source guard for the shared page anatomy (docs/design/page-layout.md sections 2 and 7.2, row 13.808): a page gets its
    /// Back button and title from <c>Ui.PageHeader</c> and its Filters tile from <c>Ui.ActionTile</c>, never its own.
    /// </summary>
    public class PageLayoutGuardTests
    {
        /// <summary>Pages that must render the shared header.</summary>
        private static readonly string[] Headered =
        {
            "CalendarPage", "DownloadsPage", "LibraryPage", "PlaylistPage", "PlaylistsPage", "RequestsPage", "SearchPage",
            "SettingsPage", "WatchlistPage", "WorkDetailPage",
        };

        /// <summary>No page header: Home, the player (own chrome), the profile picker and sign-in.</summary>
        private static readonly string[] Exempt = { "HomePage", "LoginPage", "PlayerPage", "ProfilesPage" };

        private static string ViewsDir()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "src", "Playarr.Xbox", "Views")))
            {
                dir = dir.Parent;
            }

            return Path.Combine(dir!.FullName, "src", "Playarr.Xbox", "Views");
        }

        private static string Source(string page) =>
            string.Concat(new[] { ".xaml", ".xaml.cs" }.Select(ext => Path.Combine(ViewsDir(), page + ext)).Where(File.Exists).Select(File.ReadAllText));

        [Fact]
        public void EveryPageIsRegistered()
        {
            var pages = Directory.GetFiles(ViewsDir(), "*Page.xaml").Select(f => Path.GetFileNameWithoutExtension(f)!);
            Assert.Empty(pages.Except(Headered).Except(Exempt));
        }

        [Fact]
        public void HeaderedPagesUseTheSharedHeader()
        {
            Assert.Empty(Headered.Where(p => !Source(p).Contains("Ui.PageHeader(")));
        }

        [Fact]
        public void NoPageDrawsItsOwnBackTitleOrFilters()
        {
            var offenders = Headered.Where(p =>
            {
                var src = Source(p);
                return src.Contains("PlayarrPageTitle") || src.Contains("Ui.BackButton(") || src.Contains("x:Name=\"BackButton\"")
                    || src.Contains("Text=\"Filters\"") || src.Contains("Text = \"Filters\"");
            });
            Assert.Empty(offenders);
        }
    }
}
