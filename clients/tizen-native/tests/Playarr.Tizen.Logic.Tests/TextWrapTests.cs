using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class TextWrapTests
{
    private static float Chars(string text) => text.Length * 10f; // 10 px per character, spaces included

    [Fact]
    public void BreaksGreedilyAtWordBoundaries()
    {
        Assert.Equal(new[] { "aaa bbb", "ccc" }, TextWrap.WrapLines("aaa bbb ccc", Chars, 70));
    }

    [Fact]
    public void ShortTextStaysOnOneLine()
    {
        Assert.Equal(new[] { "hello" }, TextWrap.WrapLines("hello", Chars, 200));
    }

    [Fact]
    public void LongWordIsNotSplit()
    {
        Assert.Equal(new[] { "short", "extraordinarily" }, TextWrap.WrapLines("short extraordinarily", Chars, 100));
    }

    [Fact]
    public void CutsAtMaxLinesWithAnEllipsisThatFits()
    {
        var lines = TextWrap.WrapLines("aaaa bbbb cccc dddd", Chars, 45, maxLines: 2);
        Assert.Equal(2, lines.Count);
        Assert.EndsWith("…", lines[1]);
        Assert.True(Chars(lines[1]) <= 45);
    }

    [Fact]
    public void ZeroWidthSpaceIsAnExtraBreakOpportunity()
    {
        Assert.Equal(new[] { "abcd", "efgh" }, TextWrap.WrapLines("abcd​efgh", Chars, 50));
    }

    [Fact]
    public void BalanceEvensOutTheLines()
    {
        var greedy = TextWrap.WrapLines("aa bb cc dd ee ff", Chars, 140);
        var balanced = TextWrap.WrapLines("aa bb cc dd ee ff", Chars, 140, balance: true);
        Assert.Equal(greedy.Count, balanced.Count);
        Assert.True(Math.Abs(Chars(balanced[0]) - Chars(balanced[^1])) <= Math.Abs(Chars(greedy[0]) - Chars(greedy[^1])));
    }
}
