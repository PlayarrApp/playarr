using Playarr.Core.Navigation;
using Xunit;

namespace Playarr.Core.Tests
{
    public sealed class DirectionalFocusTests
    {
        [Fact]
        public void Best_prefers_vertical_overlap_over_nearer_misaligned_target()
        {
            var source = new FocusRect(500, 400, 100, 120);
            var candidates = new[]
            {
                new FocusRect(300, 430, 80, 60),
                new FocusRect(420, 650, 80, 60),
            };

            Assert.Equal(0, DirectionalFocus.Best(source, candidates, left: true));
        }

        [Fact]
        public void Score_uses_forward_cone_and_overlap_bonus()
        {
            var source = new FocusRect(500, 400, 100, 120);
            var aligned = new FocusRect(300, 400, 80, 120);
            var behind = new FocusRect(650, 400, 80, 120);
            var outsideCone = new FocusRect(300, 800, 80, 60);

            Assert.Equal(144d, DirectionalFocus.Score(source, aligned, left: true)!.Value);
            Assert.Null(DirectionalFocus.Score(source, behind, left: true));
            Assert.Null(DirectionalFocus.Score(source, outsideCone, left: true));
        }

        [Fact]
        public void Best_returns_minus_one_when_no_candidate_is_forward()
        {
            var source = new FocusRect(500, 400, 100, 120);

            Assert.Equal(-1, DirectionalFocus.Best(source, new[] { new FocusRect(650, 400, 80, 120) }, left: true));
        }
    }
}
