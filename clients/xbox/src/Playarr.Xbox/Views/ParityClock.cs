using System;
using Windows.Storage;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// The clock the pages show. It is the system clock, except while the parity marker <c>parity.on</c> exists in
    /// LocalState: then it stands still at the suite's pinned instant (docs/parity/SUITE.md, 2026-10-07 12:00) so the
    /// header time, the calendar's today and every aired/upcoming tone match the web references.
    /// </summary>
    internal static class ParityClock
    {
        private static readonly DateTime Pinned = new DateTime(2026, 10, 7, 12, 0, 0, DateTimeKind.Local);
        internal static readonly bool IsPinned = System.IO.File.Exists(System.IO.Path.Combine(ApplicationData.Current.LocalFolder.Path, "parity.on"));

        public static DateTime Now => IsPinned ? Pinned : DateTime.Now;

        public static DateTime Today => Now.Date;
    }
}
