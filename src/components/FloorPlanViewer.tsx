"use client";
import React, { useEffect, useState, useRef } from 'react';
import { SimplifiedPath, FloorPlanMetadata } from '../types/floorPlan';
import styles from './FloorPlanViewer.module.css';

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
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
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
          <div className={styles.floorPlanControls}>
            <select 
              className={styles.floorSelect}
              value={currentFloor} 
              onChange={(e) => setCurrentFloor(parseInt(e.target.value))}
            >
              {[1,2,3,4,5,6,7].map(floor => (
                <option key={floor} value={floor}>Floor {floor}</option>
              ))}
            </select>
            <div className={styles.controlGroup}>
              <button onClick={() => setZoom(z => z * 1.2)}>Zoom In</button>
              <button onClick={() => setZoom(z => z / 1.2)}>Zoom Out</button>
              <button onClick={() => {
                setZoom(1);
                setPosition({ x: 0, y: 0 });
              }}>Reset View</button>
            </div>
            <div>Dimensions: {metadata.dimensions.width} x {metadata.dimensions.height}</div>
            <div>Scale: {metadata.scale}</div>
            <div>Paths: {paths.length}</div>
            <div>Zoom: {(zoom * 100).toFixed(0)}%</div>
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
              <defs>
                <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
                  <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#ddd" strokeWidth="0.02"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              <g transform={`translate(${position.x} ${position.y}) scale(${zoom * metadata.scale})`}>
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
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
