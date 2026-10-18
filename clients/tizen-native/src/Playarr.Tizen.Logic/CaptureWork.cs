namespace Playarr.Tizen.Logic;

/// <summary>Tracks asynchronous visual work until its final UI update has settled.</summary>
public sealed class CaptureWork
{
    private int _pending;

    public int Pending => Volatile.Read(ref _pending);

    public async Task RunAsync(Func<Task> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        Interlocked.Increment(ref _pending);
        try
        {
            // Some image loaders synchronously probe and read the cache before their first await.
            // Keep that work off the UI thread while counting it from the moment it is scheduled.
            await Task.Run(operation).ConfigureAwait(false);
        }
        finally
        {
            Interlocked.Decrement(ref _pending);
        }
    }
}
