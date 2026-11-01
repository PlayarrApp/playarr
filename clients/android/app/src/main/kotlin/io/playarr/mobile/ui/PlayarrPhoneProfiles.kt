package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.parityShape
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import io.playarr.shared.designsystem.page.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import io.playarr.shared.designsystem.page.Surface
import io.playarr.shared.designsystem.page.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.mobile.R
import io.playarr.shared.designsystem.page.parityBox

/*
 * The web phone profile page (`.profiles-page` under the phone media query), metric for metric: the stage chrome row
 * (logo, theme and language selectors) at the mobile top inset, the heading 58 px below it, the profile row from
 * 164 px with 18 px of padding, and the Clients link bottom right.
 */

/** `.tv-stage-chrome` on a phone: the logo and the two selectors share one row at `max(14px, inset)`. */
@Composable
internal fun BoxScope.PhoneProfilesChrome() {
    val display = LocalPlayarrDisplayPreferences.current
    val topInset = webPhoneInsets().asPaddingValues().calculateTopPadding()
    Box(
        Modifier.align(Alignment.TopStart).padding(start = 21.dp, top = topInset).size(width = 30.dp, height = 42.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.playarr_mark),
            contentDescription = null,
            tint = Color.Unspecified,
            modifier = Modifier.size(30.dp).parityBox("image"),
        )
    }
    Row(
        Modifier.align(Alignment.TopEnd).padding(end = 14.dp, top = topInset),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProfilesChromeThemeDropdown(display, webPhone = true)
        ProfilesChromeLanguageDropdown(display, webPhone = true)
    }
}

/** `.profiles-heading`: kicker and title, centred, from `inset + 58px`. */
@Composable
internal fun PhoneProfilesHeading(kicker: String, title: String) {
    val topInset = webPhoneInsets().asPaddingValues().calculateTopPadding()
    Column(
        Modifier.fillMaxWidth().padding(top = topInset + 58.dp, end = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            kicker.uppercase(),
            color = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette.brandInk, fontSize = 7.36.sp, lineHeight = 11.04.sp, fontWeight = FontWeight(820),
            letterSpacing = 0.9568.sp, style = WebTextStyle, maxLines = 1, modifier = Modifier,
        )
        Spacer(Modifier.height(7.2.dp))
        // 42.9 px title on a 40.755 px line: the box is shorter than the glyphs, so pin it and let the text overflow.
        Box(Modifier.fillMaxWidth().height(40.8.dp), contentAlignment = Alignment.TopCenter) {
            Text(
                title,
                color = WebInk, fontSize = 42.9.sp, lineHeight = 40.755.sp, fontWeight = FontWeight.Medium,
                letterSpacing = (-3.0888).sp, style = WebTextStyle, maxLines = 1, softWrap = false,
                modifier = Modifier.wrapContentSize(align = Alignment.TopCenter, unbounded = true).semantics { heading() },
            )
        }
    }
}

/** The web `--line-strong` at 66%: the 1 px ring of an avatar plate. */
private val PlateBorder: Color get() = WebPillBorder

/** Web phone `.profiles-row` top below the status inset: 150 px of heading block plus 18 px of padding. */
internal const val PHONE_PROFILES_ROW_TOP_CSS = 168f
/** `.profile-avatar-button`: 156 avatar, 8.8 gap, 19.68 name line, 8.8 gap, 10.08 status line. */
internal const val PHONE_PROFILE_CHOICE_HEIGHT_CSS = 156f + 8.8f + 19.68f + 8.8f + 10.08f

/** `.profile-choice` for a profile: avatar, name, status and, when selected, the settings and sign-out pills. */
@Composable
internal fun PhoneProfileChoice(
    profile: io.playarr.shared.data.model.AvailableProfile,
    serverLabel: String?,
    avatar: io.playarr.shared.data.model.ProfileAvatarPreference?,
    selected: Boolean,
    switching: Boolean,
    enabled: Boolean,
    onFocus: () -> Unit,
    onClick: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: (() -> Unit)?,
) {
    val avatarDescription = playarrString(
        if (profile.isCurrent) PlayarrString.ProfilesAvatarLabelCurrent else PlayarrString.ProfilesAvatarLabel,
        "name" to profile.displayName,
    )
    val rowTop = webPhoneInsets().asPaddingValues().calculateTopPadding().value + PHONE_PROFILES_ROW_TOP_CSS
    WebCssLayout(rowTop, listOf(0f, PHONE_PROFILE_CHOICE_HEIGHT_CSS + 20f), listOf(PHONE_PROFILE_CHOICE_HEIGHT_CSS, 44f), 0f) {
        WebCssLayout(
            rowTop, listOf(0f, 156f + 8.8f, 156f + 8.8f + 19.68f + 8.8f), listOf(156f, 19.68f, 10.08f), 0f,
            Modifier
                .graphicsLayer {
                    if (selected) {
                        translationY = -8.dp.toPx()
                        scaleX = 1.045f
                        scaleY = 1.045f
                    }
                }
                .clickable(enabled = enabled, onClick = onClick, role = androidx.compose.ui.semantics.Role.Button),
        ) {
            PhoneProfileAvatarPlate(selected, Modifier.semantics { contentDescription = avatarDescription }) {
                PlayarrProfileAvatar(userId = profile.id, preference = avatar, modifier = Modifier.fillMaxSize().parityBox("container", radius = 999f), artworkModifier = Modifier.parityBox("image"), artworkInset = 1.dp)
            }
            Text(
                profile.displayName,
                color = if (selected) WebInk else WebInkSoft, fontSize = 13.12.sp, lineHeight = 19.68.sp, fontWeight = FontWeight(680),
                style = WebTextStyle, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) { Text(
                playarrString(
                    when {
                        switching -> PlayarrString.ProfilesStatusSwitching
                        profile.isCurrent -> PlayarrString.ProfilesStatusCurrent
                        profile.pinLocked -> PlayarrString.ProfilesStatusPinRequired
                        else -> PlayarrString.ProfilesStatusReady
                    },
                ).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebInkMuted, fontSize = 6.72.sp, lineHeight = 10.08.sp, fontWeight = FontWeight(690),
                letterSpacing = 0.3024.sp, style = WebTextStyle, maxLines = 1, modifier = Modifier,
            ) }
        }
        if (selected) androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalMinimumInteractiveComponentSize provides androidx.compose.ui.unit.Dp.Unspecified) {
            Row(
                Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(8.8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val settingsName = playarrString(PlayarrString.ProfilesSettingsFor, "name" to profile.displayName)
                val signOutName = playarrString(PlayarrString.ProfilesSignOutFor, "name" to profile.displayName)
                Surface(
                    onClick = onSettings, enabled = enabled, shape = CircleShape,
                    color = WebSurfaceStrong.copy(alpha = 0.64f), border = BorderStroke(1.dp, WebPillBorder),
                    modifier = Modifier.size(44.dp).parityShape(999f).semantics { contentDescription = settingsName },
                ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { ProfilesSettingsIcon(ProfilesBrandRose, Modifier.parityBox("image")) } }
                onSignOut?.let { action ->
                    Surface(
                        onClick = action, enabled = enabled, shape = CircleShape,
                        color = WebSurfaceStrong.copy(alpha = 0.64f), border = BorderStroke(1.dp, WebPillBorder),
                        modifier = Modifier.height(44.dp).parityShape(999f).semantics { contentDescription = signOutName },
                    ) {
                        Row(
                            Modifier.padding(horizontal = 17.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.2.dp),
                        ) {
                            ProfilesSignOutIcon(WebInkSoft, Modifier.parityBox("image"))
                            Text(
                                playarrString(PlayarrString.ProfilesSignOut),
                                color = WebInkSoft, fontSize = 7.68.sp, lineHeight = 11.52.sp, fontWeight = FontWeight(720),
                                style = WebTextStyle, maxLines = 1, modifier = Modifier,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** `.profile-add`: the dashed rose plate with a plus. */
@Composable
internal fun PhoneAddProfileChoice(selected: Boolean, enabled: Boolean, onFocus: () -> Unit, onClick: () -> Unit) {
    val rowTop = webPhoneInsets().asPaddingValues().calculateTopPadding().value + PHONE_PROFILES_ROW_TOP_CSS
    val addName = playarrString(PlayarrString.ProfilesSignIn) + " " + playarrString(PlayarrString.ProfilesAddAnother)
    WebCssLayout(rowTop, listOf(0f), listOf(PHONE_PROFILE_CHOICE_HEIGHT_CSS), 0f) {
        WebCssLayout(
            rowTop, listOf(0f, 156f + 8.8f, 156f + 8.8f + 19.68f + 8.8f), listOf(156f, 19.68f, 10.08f), 0f,
            Modifier
                .graphicsLayer {
                    if (selected) {
                        translationY = -8.dp.toPx()
                        scaleX = 1.045f
                        scaleY = 1.045f
                    }
                }
                .clickable(enabled = enabled, onClick = onClick, role = androidx.compose.ui.semantics.Role.Button)
                .semantics { contentDescription = addName },
        ) {
            PhoneProfileAvatarPlate(selected, Modifier, dashed = true) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("+", color = WebInkSoft, fontSize = 38.4.sp, lineHeight = 57.6.sp, fontWeight = FontWeight(300), style = WebTextStyle, modifier = Modifier)
                }
            }
            Text(
                playarrString(PlayarrString.ProfilesSignIn),
                color = if (selected) WebInk else WebInkSoft, fontSize = 13.12.sp, lineHeight = 19.68.sp, fontWeight = FontWeight(680),
                style = WebTextStyle, maxLines = 1, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) { Text(
                playarrString(PlayarrString.ProfilesAddAnother).uppercase(LocalPlayarrLanguage.current.locale),
                color = WebInkMuted, fontSize = 6.72.sp, lineHeight = 10.08.sp, fontWeight = FontWeight(690),
                letterSpacing = 0.3024.sp, style = WebTextStyle, maxLines = 1, modifier = Modifier,
            ) }
        }
    }
}

/**
 * `.profile-avatar`: a 156 px circle with a 1 px ring; selected, it grows 1.035x and gains the rose 4 px ring and the
 * 22/52 drop shadow. [dashed] is the add-profile plate with its radial highlight and rose-to-wine diagonal.
 */
@Composable
private fun PhoneProfileAvatarPlate(
    selected: Boolean,
    modifier: Modifier,
    dashed: Boolean = false,
    content: @Composable () -> Unit,
) {
    val ring = ProfilesBrandRose.copy(alpha = 0.42f)
    WebShadowedBox(
        shadows = if (selected) listOf(WebShadow(22.dp, 52.dp, Color(0xFF1F0E14).copy(alpha = 0.18f))) else emptyList(),
        shape = CircleShape,
        modifier = modifier.size(156.dp).graphicsLayer { if (selected) { scaleX = 1.035f; scaleY = 1.035f } }.drawBehind {
            if (selected) {
                val width = 4.dp.toPx()
                drawCircle(ring, radius = size.minDimension / 2f + width / 2f, style = Stroke(width = width))
            }
        },
        innerModifier = Modifier
            .then(
                if (dashed) {
                    // The plate's own node paints the gradient, so it is the exported container.
                    Modifier
                        .parityBox("container", radius = 999f)
                        .background(Brush.linearGradient(listOf(Color.Transparent, Color.Transparent)), CircleShape)
                        .drawBehind {
                            val css = Math.toRadians(145.0)
                            val dx = Math.sin(css).toFloat()
                            val dy = (-Math.cos(css)).toFloat()
                            val length = kotlin.math.abs(size.width * dx) + kotlin.math.abs(size.height * dy)
                            val centre = Offset(size.width / 2f, size.height / 2f)
                            val half = Offset(dx * length / 2f, dy * length / 2f)
                            drawRect(
                                Brush.linearGradient(
                                    listOf(WebSurfaceStrong.copy(alpha = 1f).mix(ProfilesBrandRose, 0.16f), Color(0xFFA82655)),
                                    start = centre - half, end = centre + half,
                                ),
                            )
                            drawRect(
                                Brush.radialGradient(
                                    0f to Color.White.copy(alpha = 0.28f), 1f to Color.Transparent,
                                    center = Offset(size.width * 0.34f, size.height * 0.26f),
                                    radius = 41.8.dp.toPx(),
                                ),
                            )
                        }
                } else {
                    Modifier
                },
            ),
    ) {
        content()
        Canvas(Modifier.fillMaxSize()) {
            val hair = 1.dp.toPx()
            drawCircle(
                PlateBorder, radius = size.minDimension / 2f - hair / 2f,
                style = Stroke(width = hair, pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(hair * 3f, hair * 3f)) else null),
            )
        }
    }
}

private fun Color.mix(other: Color, fraction: Float): Color = androidx.compose.ui.graphics.lerp(this, other, fraction)

/** `.profile-clients-link`: the glass pill bottom right. */
@Composable
internal fun BoxScope.PhoneProfilesClientsLink(onClick: () -> Unit) = androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalMinimumInteractiveComponentSize provides androidx.compose.ui.unit.Dp.Unspecified) {
    Surface(
        onClick = onClick, shape = CircleShape,
        color = WebSurfaceStrong.copy(alpha = 0.72f), border = BorderStroke(1.dp, WebPillBorder),
        modifier = Modifier.align(Alignment.BottomEnd).padding(end = 22.dp, bottom = 25.3.dp).height(44.dp).parityShape(999f),
    ) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.8.dp)) {
            Text(playarrString(PlayarrString.ProfilesClients), color = WebInkSoft, fontSize = 7.68.sp, lineHeight = 11.52.sp, fontWeight = FontWeight(720), style = WebTextStyle, maxLines = 1, modifier = Modifier)
            Text("→", color = WebInkSoft, fontSize = 7.68.sp, lineHeight = 11.52.sp, fontWeight = FontWeight(720), style = WebTextStyle, maxLines = 1, modifier = Modifier)
        }
    }
}
