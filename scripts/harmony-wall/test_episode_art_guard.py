#!/usr/bin/env python3
"""Synthetic tests for the pinned phone episode-art capture guard."""
import unittest

from PIL import Image, ImageDraw

from episode_art_guard import (
    EXPECTED_PHONE_FRAME_SIZE,
    FIRST_EPISODE_CARD_CROP,
    has_visible_episode_art,
    stable_episode_card_crop,
)


def placeholder_frame(size=EXPECTED_PHONE_FRAME_SIZE):
    frame = Image.new("RGB", size, (21, 19, 22))
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((63, 2080, 455, 2339), radius=28, fill=(40, 38, 42))
    return frame


def textured_episode_frame():
    frame = placeholder_frame()
    draw = ImageDraw.Draw(frame)
    left, top, right, bottom = FIRST_EPISODE_CARD_CROP
    for y in range(top, bottom, 12):
        for x in range(left, right, 12):
            tone = 35 + ((x // 12 + y // 12) % 7) * 28
            draw.rectangle((x, y, x + 11, y + 11), fill=(tone, tone // 2, 180 - tone // 3))
    return frame


class EpisodeArtGuardTests(unittest.TestCase):
    def test_uniform_placeholder_does_not_pass_as_art(self):
        self.assertFalse(has_visible_episode_art(placeholder_frame()))

    def test_textured_episode_still_passes(self):
        self.assertTrue(has_visible_episode_art(textured_episode_frame()))

    def test_incompatible_frame_dimensions_fail_closed(self):
        self.assertFalse(has_visible_episode_art(placeholder_frame((1080, 1920))))

    def test_same_episode_card_crop_is_stable(self):
        frame = textured_episode_frame()
        self.assertTrue(stable_episode_card_crop(frame, frame.copy()))

    def test_card_crop_motion_is_not_stable(self):
        first = textured_episode_frame()
        second = first.copy()
        ImageDraw.Draw(second).rectangle((60, 2050, 460, 2330), fill=(0, 0, 0))
        self.assertFalse(stable_episode_card_crop(first, second))

    def test_motion_outside_episode_crop_does_not_block_capture(self):
        first = textured_episode_frame()
        second = first.copy()
        ImageDraw.Draw(second).rectangle((0, 0, 1079, 100), fill=(255, 0, 0))
        self.assertTrue(stable_episode_card_crop(first, second))


if __name__ == "__main__":
    unittest.main()
