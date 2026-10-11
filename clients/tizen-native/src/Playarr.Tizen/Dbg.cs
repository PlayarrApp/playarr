using System.Diagnostics;

namespace Playarr.Tizen;

internal static class Dbg
{
    /// <summary>Writes to stderr (the TV's kernel log). Compiled out unless built with -p:PlayarrDebug=true.</summary>
    [Conditional("PLAYARR_DEBUG")]
    public static void Log(string message) => Console.Error.WriteLine("DBG " + message);
}

/// <summary>Posts work back onto the NUI main thread (async API calls complete on the thread pool).</summary>
internal static class SynchronizationContextHolder
{
    public static SynchronizationContext? Ui;
    public static void Post(Action a) => Ui!.Post(_ => a(), null);
}
