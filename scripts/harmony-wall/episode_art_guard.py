"""Frame checks for the pinned 1080x2340 Harmony phone series-detail capture."""
from PIL import ImageChops, ImageStat


EXPECTED_PHONE_FRAME_SIZE = (1080, 2340)
FIRST_EPISODE_CARD_CROP = (60, 2050, 460, 2330)
MIN_EPISODE_CROP_LUMA_STDDEV = 25.0
MAX_STABLE_CROP_MEAN_DELTA = 0.5


def episode_art_crop_stddev(frame):
    """Return None for an incompatible frame, otherwise the first card crop's luma SD."""
    if frame.size != EXPECTED_PHONE_FRAME_SIZE:
        return None
    crop = frame.crop(FIRST_EPISODE_CARD_CROP).convert("L")
    return ImageStat.Stat(crop).stddev[0]


def has_visible_episode_art(frame):
    """Distinguish the textured pinned still from the uniform episode placeholder."""
    score = episode_art_crop_stddev(frame)
    return score is not None and score > MIN_EPISODE_CROP_LUMA_STDDEV


def stable_episode_card_crop(first, second):
    """Require the visible card crop to settle while ignoring unrelated page motion."""
    if first.size != EXPECTED_PHONE_FRAME_SIZE or second.size != EXPECTED_PHONE_FRAME_SIZE:
        return False
    first_crop = first.crop(FIRST_EPISODE_CARD_CROP).convert("L")
    second_crop = second.crop(FIRST_EPISODE_CARD_CROP).convert("L")
    difference = ImageChops.difference(first_crop, second_crop)
    return ImageStat.Stat(difference).mean[0] <= MAX_STABLE_CROP_MEAN_DELTA
