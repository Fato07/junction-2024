"use client";
import React, { useEffect, useState, useRef } from 'react';
import { SimplifiedPath, FloorPlanMetadata } from '../types/floorPlan';

interface FloorPlanViewerProps {
  floorNumber: number;
}

export const FloorPlanViewer: React.FC<FloorPlanViewerProps> = ({ 
  floorNumber: initialFloor
}) => {
  const [currentFloor, setCurrentFloor] = useState(initialFloor);
  const [loading, setLoading] = useState(true);
  const [paths, setPaths] = useState<SimplifiedPath[]>([]);
  const [metadata, setMetadata] = useState<FloorPlanMetadata | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const loadFloorPlan = async () => {
      console.log('Starting to load floor plan:', currentFloor);
      setLoading(true);

      try {
        const response = await fetch(`/api/floor-plan/${currentFloor}`);
        if (!response.ok) {
          throw new Error('Failed to fetch floor plan');
        }

        const data = await response.json();
        const filteredPaths = data.paths.filter((path: SimplifiedPath) => 
          path.type === 'wall' && path.floor === currentFloor
        );
        
        console.log('Metadata loaded:', data.metadata);
        console.log('Total paths collected:', filteredPaths.length);
        console.log('Sample path:', filteredPaths[0]);
        console.log('ViewBox:', data.metadata.dimensions.viewBox);
        
        setPaths(filteredPaths);
        setMetadata(data.metadata);
      } catch (error) {
        console.error('Error loading floor plan:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFloorPlan();
  }, [currentFloor]);

  return (
    <div>
      {loading && <div>Loading floor plan...</div>}
      {!loading && !metadata && <div>Error loading floor plan</div>}
      {!loading && metadata && (
        <>
          <div style={{ padding: '10px', fontSize: '12px' }}>
            <select 
              value={currentFloor} 
              onChange={(e) => setCurrentFloor(parseInt(e.target.value))}
              style={{ marginBottom: '10px' }}
            >
              {[1,2,3,4,5,6,7].map(floor => (
                <option key={floor} value={floor}>Floor {floor}</option>
              ))}
            </select>
            <div>Dimensions: {metadata.dimensions.width} x {metadata.dimensions.height}</div>
            <div>Scale: {metadata.scale}</div>
            <div>Paths: {paths.length}</div>
          </div>
          <div style={{ 
            width: '100%',
            height: '90vh',
            border: '1px solid #ccc',
            overflow: 'auto',
            backgroundColor: '#f5f5f5',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={metadata.dimensions.viewBox}
              style={{ 
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                border: '1px solid red'
              }}
              preserveAspectRatio="xMidYMid meet"
            >
              <g transform={`scale(${metadata.scale})`}>
                <g transform="translate(0.05, 0.05)">
                  {paths.map((path) => (
                    <path
                      key={path.id}
                      d={path.d}
                      transform={path.transform}
                      stroke="#000"
                      strokeWidth={0.5}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              </g>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
