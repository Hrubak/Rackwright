// Node presets for the "Start from" list. Empty until spec-sheet numbers are cited: see the design doc's "Node presets" section.
export interface NodePreset { id: string; label: string; cores: number; ramGb: number; rawTb: number }
export const NODE_PRESETS: NodePreset[] = [];
