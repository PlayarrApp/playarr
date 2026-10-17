using Playarr.Tizen.Logic;
using Xunit;

public sealed class CaptureWorkTests
{
    [Fact]
    public async Task PendingCoversOperationUntilItSettles()
    {
        var work = new CaptureWork();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var operation = work.RunAsync(async () =>
        {
            started.SetResult();
            await release.Task;
        });

        Assert.Equal(1, work.Pending);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, work.Pending);
        release.SetResult();
        await operation;

        Assert.Equal(0, work.Pending);
    }

    [Fact]
    public async Task PendingReturnsToZeroWhenOperationFails()
    {
        var work = new CaptureWork();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            work.RunAsync(() => Task.FromException(new InvalidOperationException("expected"))));

        Assert.Equal(0, work.Pending);
    }

    [Fact]
    public async Task NestedWorkKeepsPendingUntilEveryUiCompletionSettles()
    {
        var work = new CaptureWork();
        var outerStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var nestedStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var holdUiCompletion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var outer = work.RunAsync(async () =>
        {
            outerStarted.SetResult();
            await nestedStarted.Task;
        });
        await outerStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var nested = work.RunAsync(async () =>
        {
            nestedStarted.SetResult();
            await holdUiCompletion.Task;
        });

        await outer;
        Assert.Equal(1, work.Pending);
        holdUiCompletion.SetResult();
        await nested;
        Assert.Equal(0, work.Pending);
    }
}
