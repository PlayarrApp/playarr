using Playarr.Core.Models;
using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public class PlaybackRecoveryTests
{
    [Fact]
    public void Only_a_started_on_demand_hls_session_is_recovered_a_limited_number_of_times()
    {
        Assert.True(PlaybackRecovery.ShouldRecover(PlaybackMode.Hls, false, true, 0));
        Assert.True(PlaybackRecovery.ShouldRecover(PlaybackMode.Hls, false, true, PlaybackRecovery.MaxAttempts - 1));
        Assert.False(PlaybackRecovery.ShouldRecover(PlaybackMode.Hls, false, true, PlaybackRecovery.MaxAttempts));
        Assert.False(PlaybackRecovery.ShouldRecover(PlaybackMode.Direct, false, true, 0));
        Assert.False(PlaybackRecovery.ShouldRecover(PlaybackMode.Hls, true, true, 0));
        Assert.False(PlaybackRecovery.ShouldRecover(PlaybackMode.Hls, false, false, 0));
    }

    [Fact]
    public void A_paused_player_stays_paused_after_recovery()
    {
        Assert.False(PlaybackRecovery.StartPlaying(wasPaused: true));
        Assert.True(PlaybackRecovery.StartPlaying(wasPaused: false));
    }

    [Fact]
    public void Back_off_grows_and_then_holds()
    {
        Assert.Equal(TimeSpan.FromMilliseconds(1500), PlaybackRecovery.Delay(0));
        Assert.Equal(TimeSpan.FromMilliseconds(3000), PlaybackRecovery.Delay(1));
        Assert.Equal(TimeSpan.FromMilliseconds(6000), PlaybackRecovery.Delay(2));
        Assert.Equal(TimeSpan.FromMilliseconds(6000), PlaybackRecovery.Delay(7));
    }
}
