import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.extend((str(HERE), str(HERE.parent / "sim-vnc")))
import harmony_vnc


class Recorder(harmony_vnc.Commands):
    """The Previewer command channel replaced by a list of the commands that would be sent."""

    def __init__(self):
        self.sent = []

    def send(self, command, args, kind="action"):
        self.sent.append((command, args))
        return True


class PointerCommandTests(unittest.TestCase):
    def test_swipe_presses_moves_along_the_line_and_releases(self):
        commands = Recorder()
        with patch.object(harmony_vnc.time, "sleep"):
            self.assertTrue(commands.swipe(100, 1000, 100, 400, steps=3, ms=300))
        self.assertEqual([name for name, _ in commands.sent], ["MousePress", "MouseMove", "MouseMove", "MouseMove", "MouseRelease"])
        self.assertEqual(commands.sent[0][1], {"x": 100, "y": 1000})
        self.assertEqual([args["y"] for name, args in commands.sent if name == "MouseMove"], [800, 600, 400])
        self.assertEqual(commands.sent[-1][1], {"x": 100, "y": 400})

    def test_swipe_spaces_its_moves_so_the_whole_drag_takes_about_the_requested_time(self):
        commands = Recorder()
        with patch.object(harmony_vnc.time, "sleep") as sleep:
            commands.swipe(0, 0, 300, 0, steps=3, ms=900)
        # each move waits ms / steps less the 30 ms send() already spends
        self.assertEqual([round(call.args[0], 2) for call in sleep.call_args_list], [0.27, 0.27, 0.27])

    def test_wheel_sends_one_rotate_command(self):
        commands = Recorder()
        self.assertTrue(commands.wheel(540, 1200, -3.0))
        self.assertEqual(commands.sent, [("MouseWheel", {"x": 540, "y": 1200, "rotate": -3.0})])


if __name__ == "__main__":
    unittest.main()
