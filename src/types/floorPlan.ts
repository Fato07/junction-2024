export interface SimplifiedPath {
  id: string;
  d: string;
  type: 'wall' | 'window' | 'door' | 'other';
  transform?: string;
  floor: number;
}

export interface FloorPlanMetadata {
  floor: number;
  dimensions: {
    width: number;
    height: number;
    viewBox: string;
  };
  scale: number;
  pathCount: number;
}
