using System.Collections.Generic;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Core.Tests
{
    public class LibraryAlphabetTests
    {
        [Theory]
        [InlineData("  É Sample Item", 'E')]
        [InlineData("# Sample Item", '#')]
        [InlineData("", '#')]
        public void GroupsTitlesByNormalizedFirstLetter(string title, char expected)
        {
            Assert.Equal(expected, LibraryAlphabet.LetterFor(new Work { Title = title }));
        }

        [Fact]
        public void UsesSortTitleForLetterGrouping()
        {
            Assert.Equal('A', LibraryAlphabet.LetterFor(new Work { Title = "A Sample Item", SortTitle = "A Sample Sort" }));
        }

        [Fact]
        public void JumpSelectsNextAvailableLetterOrLastInAscendingOrder()
        {
            var works = new List<Work>
            {
                new Work { Title = "A Sample Item" },
                new Work { Title = "D Sample Item" },
                new Work { Title = "Z Sample Item" },
            };

            Assert.Equal(1, LibraryAlphabet.FindJumpIndex(works, 'B', descending: false));
            Assert.Equal(2, LibraryAlphabet.FindJumpIndex(works, 'X', descending: false));
        }

        [Fact]
        public void JumpFallsBackToFinalItemWhenNoLaterLetterExists()
        {
            var works = new List<Work>
            {
                new Work { Title = "A Sample Item" },
                new Work { Title = "D Sample Item" },
            };

            Assert.Equal(1, LibraryAlphabet.FindJumpIndex(works, 'Z', descending: false));
        }

        [Fact]
        public void JumpSelectsNextAvailableLetterInDescendingOrder()
        {
            var works = new List<Work>
            {
                new Work { Title = "Z Sample Item" },
                new Work { Title = "D Sample Item" },
                new Work { Title = "A Sample Item" },
            };

            Assert.Equal(1, LibraryAlphabet.FindJumpIndex(works, 'E', descending: true));
            Assert.Equal(2, LibraryAlphabet.FindJumpIndex(works, '#', descending: true));
        }

        [Fact]
        public void EmptyLibraryHasNoJumpTarget()
        {
            Assert.Equal(-1, LibraryAlphabet.FindJumpIndex(new List<Work>(), '#', descending: false));
        }
    }

    public class LibraryFocusRestoreTests
    {
        private static readonly System.Guid First = System.Guid.Parse("11111111-1111-4111-8111-111111111111");
        private static readonly System.Guid Retained = System.Guid.Parse("22222222-2222-4222-8222-222222222222");

        [Fact]
        public void DoesNotRestoreWhenTheGridDidNotOwnFocusOrTheUserMoved()
        {
            var ids = new[] { First, Retained };

            Assert.Null(LibraryFocusRestore.ResolveTarget(ids, Retained, gridOwnedFocus: false, userMoved: false));
            Assert.Null(LibraryFocusRestore.ResolveTarget(ids, Retained, gridOwnedFocus: true, userMoved: true));
        }

        [Fact]
        public void KeepsTheSameWorkWhenResultsAreReordered()
        {
            var ids = new[] { First, Retained };

            Assert.Equal(Retained, LibraryFocusRestore.ResolveTarget(ids, Retained, gridOwnedFocus: true, userMoved: false));
        }

        [Fact]
        public void FallsBackToTheFirstWorkWhenTheRetainedWorkWasRemoved()
        {
            var ids = new[] { First };

            Assert.Equal(First, LibraryFocusRestore.ResolveTarget(ids, Retained, gridOwnedFocus: true, userMoved: false));
        }

        [Fact]
        public void WaitsForAnUnrealisedTargetUntilTheUserMovesFocus()
        {
            Assert.True(LibraryFocusRestore.ShouldContinueClaim(gridOwnedFocus: true, userMoved: false));
            Assert.False(LibraryFocusRestore.ShouldContinueClaim(gridOwnedFocus: true, userMoved: true));
        }

        [Fact]
        public void DoesNotTreatAnAutomaticallyFocusedDifferentCardAsTheRefreshTarget()
        {
            Assert.False(LibraryFocusRestore.IsFocusComplete(First, Retained, userMoved: false));
            Assert.True(LibraryFocusRestore.IsFocusComplete(Retained, Retained, userMoved: false));
            Assert.False(LibraryFocusRestore.IsFocusComplete(Retained, Retained, userMoved: true));
        }

        [Fact]
        public void KeepsTheOriginalRefreshTargetAcrossIntermediateFocusNotifications()
        {
            var initial = new LibraryInitialFocusState();
            initial.Begin();
            initial.Settle();

            Assert.False(initial.ShouldCaptureRefresh(refreshPending: true, resultsOrLoadingChanged: true, gridOwnedFocus: true));
            Assert.True(initial.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: true));
            Assert.False(initial.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: false));
        }

        [Fact]
        public void InitialFocusClaimRemainsProtectedUntilTheClaimSettles()
        {
            var state = new LibraryInitialFocusState();
            state.Begin();

            Assert.True(state.ShouldStartClaim);
            Assert.False(state.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: true));

            // The first focus event is not completion. FocusClaim settles after four stable timer ticks.
            Assert.True(state.IsPending);
            Assert.False(state.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: true));

            state.Settle();

            Assert.False(state.IsPending);
            Assert.True(state.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: true));
        }

        [Fact]
        public void UserInputCancelsTheInitialClaimAndAllowsSubsequentRefreshOwnershipCapture()
        {
            var state = new LibraryInitialFocusState();
            state.Begin();

            Assert.True(state.CancelForUserInput());

            Assert.False(state.ShouldStartClaim);
            Assert.False(state.IsPending);
            Assert.True(state.WasCancelledByUser);
            Assert.False(state.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: false));
            Assert.True(state.ShouldCaptureRefresh(refreshPending: false, resultsOrLoadingChanged: true, gridOwnedFocus: true));
        }

        [Fact]
        public void EmptyResultsHaveNoFocusTarget()
        {
            Assert.Null(LibraryFocusRestore.ResolveTarget(new List<System.Guid>(), Retained, gridOwnedFocus: true, userMoved: false));
        }
    }
}
