"use client";

import React, { useEffect, useState, useRef } from 'react';
import { loadFloorPlanPaths } from '../utils/floorPlanParser';
import { SimplifiedPath, FloorPlanMetadata } from '../types/floorPlan';

interface FloorPlanViewerProps {
  floorNumber: number;
  onLoad?: (metadata: FloorPlanMetadata) => void;
}

export const FloorPlanViewer: React.FC<FloorPlanViewerProps> = ({ 
  floorNumber,
  onLoad 
}) => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [paths, setPaths] = useState<SimplifiedPath[]>([]);
  const [metadata, setMetadata] = useState<FloorPlanMetadata | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const loadFloorPlan = async () => {
      console.log('Starting to load floor plan:', floorNumber);
      setLoading(true);
      const collectedPaths: SimplifiedPath[] = [];

      try {
        const meta = await loadFloorPlanPaths(floorNumber, {
          onPath: (path) => {
            collectedPaths.push(path);
            if (collectedPaths.length <= 5) {
              console.log('Sample path loaded:', path.id);
            }
          },
          onProgress: (progress) => {
            console.log('Loading progress:', progress);
            setProgress(progress);
          },
          filter: (path) => path.type === 'wall' // Example filter
        });

        console.log('Metadata loaded:', meta);
        console.log('Total paths collected:', collectedPaths.length);
        setPaths(collectedPaths);
        setMetadata(meta);
        onLoad?.(meta);
      } catch (error) {
        console.error('Error loading floor plan:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFloorPlan();
  }, [floorNumber, onLoad]);

  if (loading) {
    return <div>Loading floor plan... {progress}%</div>;
  }

  if (!metadata) {
    return <div>Error loading floor plan</div>;
  }

  return (
    <svg
      ref={svgRef}
      width={metadata.dimensions.width}
      height={metadata.dimensions.height}
      viewBox={metadata.dimensions.viewBox}
    >
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          transform={path.transform}
          stroke="#000"
          strokeWidth="0.1"
          fill="none"
        />
      ))}
    </svg>
  );
};
