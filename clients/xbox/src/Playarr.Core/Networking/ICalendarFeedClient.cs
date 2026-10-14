using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    /// <summary>The read/create boundary used by the calendar link panel and its deterministic tests.</summary>
    public interface ICalendarFeedClient
    {
        Task<CalendarFeedStatus> GetCalendarFeedAsync(CancellationToken cancellationToken = default);

        /// <summary>With rotate=false this returns an existing link unchanged only when the status allows it.</summary>
        Task<CalendarFeedCreated> CreateCalendarFeedAsync(bool rotate = false, CancellationToken cancellationToken = default);
    }
}
