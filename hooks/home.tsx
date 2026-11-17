// The way back to the MODZ hub (MODZ DESIGN.md §9), as every other mod pane draws it now: "← modz" in the brand's
// own lowercase, a quiet plain button whose own padding is its hover box. The vendored kit still says "← MODZ";
// this stands in until kit-pull brings the lowercase one.
import type { ElementTable, RenderElement } from 'claude-code'

export const HOME_LABEL = '← modz'

// A button's padding is a cell a side: one cell back, its arrow starts where the text under it does.
export function HomeButton(ui: ElementTable, onPress: () => void): RenderElement {
  const { Box, Button } = ui
  return (
    <Box key="modz-home-row" flexDirection="row" marginLeft={-1}>
      <Button key="modz-home" label={HOME_LABEL} plain dimColor onPress={onPress} />
    </Box>
  )
}
