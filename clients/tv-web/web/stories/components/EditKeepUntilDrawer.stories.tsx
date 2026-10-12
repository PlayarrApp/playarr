import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditKeepUntilDrawer } from "../../src/components/EditKeepUntilDrawer";
import { MockApi } from "../mocks/providers";

const OPTIONS = {
  media_file_id: "00000000-0000-4000-8000-0000000002a0",
  container: "mp4",
  options: [
    { id: "original", label: "Original", profile: null, height: 2160, estimated_size_bytes: 8_400_000_000, size_is_estimate: false },
    { id: "high", label: "High 1080p", profile: "high", height: 1080, estimated_size_bytes: 2_600_000_000, size_is_estimate: true },
    { id: "low", label: "Low 480p", profile: "low", height: 480, estimated_size_bytes: 600_000_000, size_is_estimate: true },
  ],
};

function Edit({ type, busy }: { type: "forever" | "date" | "after-watched"; busy: boolean }) {
  const keepUntil =
    type === "forever"
      ? ({ type: "forever" } as const)
      : type === "date"
        ? ({ type: "date", date: "2026-12-01T00:00:00.000Z" } as const)
        : ({ type: "after-watched", amount: 2, unit: "weeks" } as const);
  return (
    <MockApi key={type} handlers={{ getDownloadOptions: OPTIONS }}>
      <EditKeepUntilDrawer title="Test Movie A" keepUntil={keepUntil} qualityId="high" mediaFileId={OPTIONS.media_file_id} busy={busy} onClose={() => undefined} onConfirm={() => undefined} />
    </MockApi>
  );
}

const meta = {
  title: "Components/Edit keep-until drawer",
  component: Edit,
  tags: ["autodocs"],
  args: { type: "forever", busy: false },
  argTypes: { type: { control: "inline-radio", options: ["forever", "date", "after-watched"] }, busy: { control: "boolean" } },
} satisfies Meta<typeof Edit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
