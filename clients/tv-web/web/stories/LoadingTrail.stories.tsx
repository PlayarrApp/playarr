import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingTrail, SkeletonCard } from "../src/components/shell";
import { Caption } from "./fixtures";

function LoadingMore() {
  return (
    <div className="sb-pad sb-col" style={{ maxWidth: 420 }} aria-busy="true">
      <LoadingTrail label="Loading more titles" />
      <Caption>One extra row of skeleton cards below the loaded items, with the loading trail along the top of the screen</Caption>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24 }}>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

const meta = { title: "Components/LoadingTrail", component: LoadingMore, tags: ["autodocs"] } satisfies Meta<typeof LoadingMore>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
