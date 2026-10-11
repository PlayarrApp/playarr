package io.playarr.mobile.ui

import io.playarr.shared.domain.model.PlayarrError
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class PlayarrUserMessageTest {
    private fun http(code: Int, body: String) =
        PlayarrError.Http(code, HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType()))))

    @Test
    fun `a 422 unsupported colour format shows the server message`() {
        val message = http(422, """{"error":"unsupported_colour_format","message":"Cannot convert this title's colour format."}""")
            .userMessageForExperience(PlayarrString.ErrorSubjectMedia)
        assertEquals(PlayarrMessage.Dynamic("Cannot convert this title's colour format."), message)
    }

    @Test
    fun `a 422 without a body falls back to the documented text`() {
        val message = http(422, "").userMessageForExperience(PlayarrString.ErrorSubjectMedia)
        assertEquals(PlayarrMessage.Dynamic("This title's colour format can't be converted for this device."), message)
    }

    @Test
    fun `other statuses keep the server status text`() {
        val message = http(500, "{}").userMessageForExperience(PlayarrString.ErrorSubjectMedia)
        assertEquals(PlayarrMessage.Localized(PlayarrString.ErrorServerStatus, mapOf("code" to 500)), message)
    }
}
