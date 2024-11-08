"use client";
import React, { useEffect, useState, useRef } from 'react';
import { SimplifiedPath, FloorPlanMetadata } from '../types/floorPlan';

interface FloorPlanViewerProps {
  floorNumber: number;
}

export const FloorPlanViewer: React.FC<FloorPlanViewerProps> = ({ 
  floorNumber
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

      try {
        const response = await fetch(`/api/floor-plan/${floorNumber}`);
        if (!response.ok) {
          throw new Error('Failed to fetch floor plan');
        }

        const data = await response.json();
        const filteredPaths = data.paths.filter((path: SimplifiedPath) => path.type === 'wall');
        
        console.log('Metadata loaded:', data.metadata);
        console.log('Total paths collected:', filteredPaths.length);
        
        setPaths(filteredPaths);
        setMetadata(data.metadata);
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
