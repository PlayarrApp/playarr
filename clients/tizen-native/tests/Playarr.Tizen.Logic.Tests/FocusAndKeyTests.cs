using Playarr.Tizen.Logic;
using Xunit;

public class FocusAndKeyTests
{
    // Rail A (y=0): three cards. Rail B (y=300): cards at x=1000 and x=1400, as if scrolled far right.
    private static readonly Box[] Layout =
    {
        new(0, 0, 300, 200), new(350, 0, 300, 200), new(700, 0, 300, 200),
        new(1000, 300, 300, 200), new(1400, 300, 300, 200),
    };

    [Fact]
    public void DownLandsOnTheCardVisuallyBeneathNotTheSameIndex()
    {
        Assert.Equal(3, GeometricFocus.Next(Layout, 2, RemoteKey.Down)); // centre 850 is closest to 1150, not index 2
    }

    [Fact]
    public void UpPicksNearestCentreInTheRowAbove()
    {
        Assert.Equal(2, GeometricFocus.Next(Layout, 3, RemoteKey.Up));
        Assert.Equal(2, GeometricFocus.Next(Layout, 4, RemoteKey.Up));
    }

    [Fact]
    public void LeftAndRightStayInTheRowAndStopAtTheEnds()
    {
        Assert.Equal(1, GeometricFocus.Next(Layout, 0, RemoteKey.Right));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 2, RemoteKey.Right));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 0, RemoteKey.Left));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 4, RemoteKey.Down));
    }

    [Fact]
    public void NoFocusYetStartsAtTheFirstItem() => Assert.Equal(0, GeometricFocus.Next(Layout, -1, RemoteKey.Down));

    [Theory]
    [InlineData("Return", RemoteKey.Select)]
    [InlineData("XF86Back", RemoteKey.Back)]
    [InlineData("Escape", RemoteKey.Back)]
    [InlineData("XF86AudioPlay", RemoteKey.Play)]
    [InlineData("F13", RemoteKey.None)]
    [InlineData(null, RemoteKey.None)]
    public void KeysMap(string? name, RemoteKey expected) => Assert.Equal(expected, RemoteKeys.FromName(name));

    [Theory]
    [InlineData("BackSpace", TextFieldKeyAction.PassThrough, null)]
    [InlineData("space", TextFieldKeyAction.PassThrough, null)]
    [InlineData("Left", TextFieldKeyAction.PassThrough, null)]
    [InlineData("Right", TextFieldKeyAction.PassThrough, null)]
    [InlineData("XF86Select", TextFieldKeyAction.Remote, RemoteKey.Select)]
    [InlineData("Escape", TextFieldKeyAction.Remote, RemoteKey.Back)]
    [InlineData("XF86Back", TextFieldKeyAction.Remote, RemoteKey.Back)]
    [InlineData("Down", TextFieldKeyAction.Remote, RemoteKey.Down)]
    [InlineData("Up", TextFieldKeyAction.Remote, RemoteKey.Up)]
    public void CreateNameEditingRoutesRemoteKeysAndLeavesTextToEditor(string name, TextFieldKeyAction action, RemoteKey? key)
    {
        var route = RemoteKeys.ForEditingTextField(name, TextFieldEditingContext.PlaylistName);
        Assert.Equal(action, route.Action);
        Assert.Equal(key, route.RemoteKey);
    }

    [Theory]
    [InlineData("Return", TextFieldKeyAction.SearchEnter)]
    [InlineData("KP_Enter", TextFieldKeyAction.SearchEnter)]
    [InlineData("XF86Select", TextFieldKeyAction.Remote)]
    [InlineData("BackSpace", TextFieldKeyAction.PassThrough)]
    [InlineData("space", TextFieldKeyAction.PassThrough)]
    public void SearchEditingDoesNotSubmitOnEnter(string name, TextFieldKeyAction action)
    {
        var route = RemoteKeys.ForEditingTextField(name, TextFieldEditingContext.SearchQuery);
        Assert.Equal(action, route.Action);
        if (name == "XF86Select") Assert.Equal(RemoteKey.Select, route.RemoteKey);
    }

    [Theory]
    [InlineData("Return", TextFieldKeyAction.Submit)]
    [InlineData("KP_Enter", TextFieldKeyAction.Submit)]
    [InlineData("XF86Select", TextFieldKeyAction.Remote)]
    [InlineData("BackSpace", TextFieldKeyAction.PassThrough)]
    [InlineData("space", TextFieldKeyAction.PassThrough)]
    public void CreateNameEditingSubmitsOnlyOnKeyboardEnter(string name, TextFieldKeyAction action) =>
        Assert.Equal(action, RemoteKeys.ForEditingTextField(name, TextFieldEditingContext.PlaylistName).Action);

    [Fact]
    public void NonEditingKeysKeepExistingGlobalMappings()
    {
        Assert.Equal(TextFieldKeyAction.PassThrough, RemoteKeys.ForEditingTextField("space", TextFieldEditingContext.None).Action);
        Assert.Equal(RemoteKey.PlayPause, RemoteKeys.FromName("space"));
        Assert.Equal(RemoteKey.Select, RemoteKeys.FromName("XF86Select"));
    }

    [Fact]
    public void ConsumedSubmitReleaseStaysConsumedAfterEditingContextChanges()
    {
        var releases = new ConsumedKeyReleaseTracker();
        var enter = RemoteKeys.ForEditingTextField("Return", TextFieldEditingContext.PlaylistName);
        Assert.Equal(TextFieldKeyAction.Submit, enter.Action);
        releases.Mark("Return", finishSelect: false);

        Assert.Equal(TextFieldKeyAction.PassThrough, RemoteKeys.ForEditingTextField("Return", TextFieldEditingContext.None).Action);
        Assert.True(releases.TryConsume("Return", out var finishSelect));
        Assert.False(finishSelect);
        Assert.False(releases.TryConsume("Return", out _));
    }

}
