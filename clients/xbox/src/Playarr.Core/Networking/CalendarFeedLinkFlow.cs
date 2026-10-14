using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    public enum CalendarFeedOpenKind
    {
        Link,
        NeedsReset,
    }

    public sealed class CalendarFeedOpenResult
    {
        public CalendarFeedOpenKind Kind { get; set; }

        public string? Url { get; set; }
    }

    /// <summary>
    /// Mirrors the web calendar-link panel. It asks for status first, then only POSTs when no feed exists or the server
    /// explicitly confirms that the existing URL can be shown again. An older server's active feed is never replaced
    /// just because this device has no locally saved URL.
    /// </summary>
    public static class CalendarFeedLinkFlow
    {
        public static CalendarFeedOpenResult Plan(CalendarFeedStatus status, string? storedUrl)
        {
            if (!status.Active || status.LinkAvailable == true)
            {
                return new CalendarFeedOpenResult { Kind = CalendarFeedOpenKind.Link };
            }

            if (!string.IsNullOrWhiteSpace(storedUrl))
            {
                return new CalendarFeedOpenResult { Kind = CalendarFeedOpenKind.Link, Url = storedUrl };
            }

            return new CalendarFeedOpenResult { Kind = CalendarFeedOpenKind.NeedsReset };
        }

        public static async Task<CalendarFeedOpenResult> OpenAsync(
            ICalendarFeedClient client,
            string? storedUrl,
            CancellationToken cancellationToken = default)
        {
            var plan = Plan(await client.GetCalendarFeedAsync(cancellationToken).ConfigureAwait(false), storedUrl);
            if (plan.Kind == CalendarFeedOpenKind.NeedsReset || plan.Url != null)
            {
                return plan;
            }

            var created = await client.CreateCalendarFeedAsync(rotate: false, cancellationToken).ConfigureAwait(false);
            return new CalendarFeedOpenResult { Kind = CalendarFeedOpenKind.Link, Url = created.Url };
        }

        /// <summary>Explicit, confirmed action only. The previous subscription URL becomes invalid immediately.</summary>
        public static async Task<string> ResetAsync(ICalendarFeedClient client, CancellationToken cancellationToken = default)
        {
            var created = await client.CreateCalendarFeedAsync(rotate: true, cancellationToken).ConfigureAwait(false);
            return created.Url;
        }
    }
}
