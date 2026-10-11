using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Playback;
using Xunit;

namespace Playarr.Core.Tests
{
    public class DeviceCapsTests
    {
        private static readonly XboxPlaybackProfile Series = XboxPlaybackProfile.ForModel(XboxModel.XboxSeriesX);

        [Fact]
        public void HdrDisplayReportsHdr10AndTenBit()
        {
            var q = DeviceCaps.ForXbox(Series, displayHdr10: true, false, false).ToQueryParameters();
            Assert.Equal("hdr10", q["hdr"]);
            Assert.Equal("10", q["max_bit_depth"]);
            Assert.Equal("hevc:main 10", q["video_profiles"]);
            Assert.False(q.ContainsKey("dv_profiles")); // Dolby Vision is never claimed
        }

        [Fact]
        public void SdrDisplaySendsEmptyHdrSoTheServerToneMaps()
        {
            var q = DeviceCaps.ForXbox(Series, displayHdr10: false, false, false).ToQueryParameters();
            Assert.Equal(string.Empty, q["hdr"]);
            Assert.Equal("10", q["max_bit_depth"]);
        }

        [Fact]
        public void OriginalXboxOneIsEightBit()
        {
            var q = DeviceCaps.ForXbox(XboxPlaybackProfile.ForModel(XboxModel.XboxOne), true, false, false).ToQueryParameters();
            Assert.Equal("8", q["max_bit_depth"]);
            Assert.Equal(string.Empty, q["hdr"]);
        }

        [Fact]
        public void DolbyVisionProfileFiveOnlyWhenListed()
        {
            var caps = DeviceCaps.ForXbox(Series, true, false, false);
            Assert.False(caps.ToQueryParameters().ContainsKey("dv_profiles"));
            caps.DvProfiles = new[] { 5, 8 };
            Assert.Equal("5,8", caps.ToQueryParameters()["dv_profiles"]);
        }

        [Fact]
        public void ForceFlagsReachTheQueryOnlyWhenOn()
        {
            var off = DeviceCaps.ForXbox(Series, true, false, false).ToQueryParameters();
            Assert.False(off.ContainsKey("force_direct_video"));
            Assert.False(off.ContainsKey("force_direct_audio"));
            var on = Series.ToQueryParameters(DeviceCaps.ForXbox(Series, true, true, true));
            Assert.Equal("true", on["force_direct_video"]);
            Assert.Equal("true", on["force_direct_audio"]);
            Assert.Equal("xbox", on["profile"]);
        }

        [Fact]
        public void UnsupportedColourFormatShowsTheServerMessageWithoutRetry()
        {
            var error = ApiException.ForStatus((System.Net.HttpStatusCode)422, new ApiErrorBody { Error = "unsupported_colour_format", Message = "This title's colour format can't be converted for this device." });
            Assert.Equal("This title's colour format can't be converted for this device.", error.DisplayMessage);
            Assert.False(error.IsRetryable);
            Assert.True(ApiException.ForStatus(System.Net.HttpStatusCode.ServiceUnavailable, null).IsRetryable);
        }
    }
}
