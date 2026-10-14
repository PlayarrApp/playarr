import { CommonModifier } from '@kit.ArkUI';
import type { UIContext } from '@kit.ArkUI';
import type { EpisodeFocusRect } from '../core/SeriesEpisodePresentation';
import { episodeFocusRectFromWindowPixels } from '../core/SeriesEpisodePresentation';

/** Apply a component ID only when a scoped measurement ID was supplied. */
export class NonEmptyComponentIdModifier extends CommonModifier {
  private componentId: string;

  constructor(componentId: string) {
    super();
    this.componentId = componentId;
  }

  applyNormalAttribute(instance: CommonAttribute): void {
    if (this.componentId.length > 0) {
      instance.id(this.componentId);
    }
  }
}

/** Read a laid-out component through ComponentUtils and return its window rectangle in vp. */
export function episodeFocusRectForComponent(uiContext: UIContext, componentId: string): EpisodeFocusRect | null {
  if (componentId.length === 0) {
    return null;
  }
  try {
    const component = uiContext.getComponentUtils().getRectangleById(componentId);
    return episodeFocusRectFromWindowPixels(component.windowOffset.x, component.windowOffset.y,
      component.size.width, component.size.height, (value: number): number => uiContext.px2vp(value));
  } catch (_error) {
    return null;
  }
}
