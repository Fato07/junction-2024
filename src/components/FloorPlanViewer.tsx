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
  const [paths, setPaths] = useState<SimplifiedPath[]>([]);
  const [metadata, setMetadata] = useState<FloorPlanMetadata | null>(null);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.1));

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
  }, [floorNumber]);

  return (
    <div className="floor-plan-container">
      {loading && <div>Loading floor plan...</div>}
      {!loading && !metadata && <div>Error loading floor plan</div>}
      {!loading && metadata && (
        <div className="floor-plan-content">
          <div className="floor-plan-controls" style={{ 
            padding: '10px', 
            fontSize: '12px',
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 1,
            backgroundColor: 'rgba(255,255,255,0.8)'
          }}>
            <div>Dimensions: {metadata.dimensions.width} x {metadata.dimensions.height}</div>
            <div>Scale: {metadata.scale}</div>
            <div>Paths: {paths.length}</div>
            <div>Zoom: {(zoom * 100).toFixed(0)}%</div>
            <button onClick={handleZoomIn}>Zoom In</button>
            <button onClick={handleZoomOut}>Zoom Out</button>
          </div>
          <div className="floor-plan-svg-container" style={{ 
            width: '100%',
            height: '80vh',
            border: '1px solid #ccc',
            overflow: 'hidden',
            backgroundColor: '#f5f5f5',
            position: 'relative'
          }}>
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${metadata.dimensions.width} ${metadata.dimensions.height}`}
              style={{ 
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) scale(${zoom})`,
                maxWidth: '95%',
                maxHeight: '95%'
              }}
              preserveAspectRatio="xMidYMid contain"
            >
              <g transform={`scale(${metadata.scale / 10})`}>
              {paths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  transform={path.transform}
                  stroke="#000"
                  strokeWidth={0.05}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  style={{
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round'
                  }}
                />
              ))}
            </g>
          </g>
        </svg>
          </div>
        </div>
      )}
    </div>
  );
};
