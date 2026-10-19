package io.playarr.mobile.ui

import org.junit.Test
import org.junit.Assert.assertEquals

class PlayarrTitleBalanceTest {
    private val width = { text: String -> text.length }

    @Test fun fittingTitleIsUnchanged() = assertEquals("Silent Meridian", balanceTitleWrap("Silent Meridian", 20, width))

    @Test fun oneWordIsUnchanged() = assertEquals("Supercalifragilistic", balanceTitleWrap("Supercalifragilistic", 5, width))

    @Test fun breaksWhereTheLongerLineIsShortest() =
        assertEquals("Golden\nCathedral 1", balanceTitleWrap("Golden Cathedral 1", 12, width))

    @Test fun tieBreaksAtTheFirstSplit() = assertEquals("Ab\nCd Ef", balanceTitleWrap("Ab Cd Ef", 6, width))
}
