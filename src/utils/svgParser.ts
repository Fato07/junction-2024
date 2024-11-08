import { parse } from 'svgson';
import { readFileSync } from 'fs';
import path from 'path';
import { logger } from './logger';
import { SimplifiedPath } from '@/types/floorPlan';

interface SVGParserOptions {
  maxPaths?: number;
  includeTransforms?: boolean;
}

interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function getPathBounds(d: string): PathBounds | null {
  const numbers = d.match(/-?\d+\.?\d*/g);
  if (!numbers) return null;

  const coords = numbers.map(Number);
  if (coords.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Process coordinates in pairs
  for (let i = 0; i < coords.length - 1; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

function isPathContained(bounds1: PathBounds, bounds2: PathBounds): boolean {
  const margin = 1; // Small margin to account for floating point errors
  return (
    bounds1.minX >= bounds2.minX - margin &&
    bounds1.minY >= bounds2.minY - margin &&
    bounds1.maxX <= bounds2.maxX + margin &&
    bounds1.maxY <= bounds2.maxY + margin
  );
}

interface PathKey {
  d: string;
  style: string;
  transform?: string;
}

function createPathKey(path: PathKey): string {
  return `${path.d}|${path.style}|${path.transform || ''}`;
}

export async function parseSVGFloorPlan(
  floorNumber: number,
  options: SVGParserOptions = {}
): Promise<SimplifiedPath[]> {
  const {
    maxPaths = 50000,
    includeTransforms = true,
    minPathLength = 10, // Minimum path length to filter out tiny elements
    deduplicatePaths = true // Option to remove duplicate paths
  } = options;

  // Track unique paths
  const uniquePaths = new Map<string, SimplifiedPath>();

  try {
    // Read the SVG file
    const filePath = path.join(
      process.cwd(),
      'public',
      'assets',
      'floor_plans',
      `floor_${floorNumber}_small.svg`
    );
    const svgContent = readFileSync(filePath, 'utf-8');

    // Parse SVG content
    const parsedSVG = await parse(svgContent);

    // Extract paths
    const paths: SimplifiedPath[] = [];
    const seenIds = new Set<string>();

    // Helper function to generate unique IDs
    const generateUniqueId = (baseId: string): string => {
      let uniqueId = baseId;
      let counter = 1;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${baseId}_${counter}`;
        counter++;
      }
      seenIds.add(uniqueId);
      return uniqueId;
    };

    // Recursive function to find all path elements
    const extractPaths = (node: any) => {
      if (node.name === 'path') {
        if (paths.length >= maxPaths) {
          logger.warn(`Reached maximum path limit for floor ${floorNumber}`, {
            maxPaths,
            floor: floorNumber
          });
          return;
        }

        const attributes = node.attributes;
        const id = generateUniqueId(attributes.id || `path_${paths.length}`);
        const d = attributes.d;
        const transform = includeTransforms ? attributes.transform : undefined;
        const style = attributes.style || '';

        // Determine path type based on style attributes
        const type = determinePathType(style, d);

        // Skip paths that are too short (likely decoration or artifacts)
        if (!d || d.trim().length < minPathLength) {
          return;
        }

        // Create path object
        const path: SimplifiedPath = {
          id,
          d: d.trim(),
          type,
          transform,
          floor: floorNumber
        };

        if (deduplicatePaths) {
          // Create a key for path deduplication
          const pathKey = createPathKey({
            d: d.trim(),
            style,
            transform
          });

          // Only add if we haven't seen this exact path before
          if (!uniquePaths.has(pathKey)) {
            uniquePaths.set(pathKey, path);
          }
        } else {
          paths.push(path);
        }
      }

      // Recursively process child nodes
      if (node.children) {
        node.children.forEach(extractPaths);
      }
    };

    // Start extraction from root
    extractPaths(parsedSVG);

    // Get final path list
    const finalPaths = deduplicatePaths ? Array.from(uniquePaths.values()) : paths;

    // Filter out paths that are completely contained within others
    const filteredPaths = finalPaths.filter((path1, index) => {
      // Skip checking if this is a wall
      if (path1.type === 'wall') return true;

      // Check if this path is contained within any other path
      const isContained = finalPaths.some((path2, j) => {
        if (index === j) return false;
        
        // Simple bounding box check using path commands
        const bounds1 = getPathBounds(path1.d);
        const bounds2 = getPathBounds(path2.d);
        
        return bounds1 && bounds2 && isPathContained(bounds1, bounds2);
      });

      return !isContained;
    });

    logger.info('SVG parsing complete', {
      floor: floorNumber,
      originalPaths: paths.length,
      uniquePaths: finalPaths.length,
      filteredPaths: filteredPaths.length,
      wallPaths: filteredPaths.filter(p => p.type === 'wall').length,
      otherPaths: filteredPaths.filter(p => p.type === 'other').length
    });

    return filteredPaths;

  } catch (error) {
    logger.error('Error parsing SVG floor plan:', {
      floor: floorNumber,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function determinePathType(style: string, d: string): SimplifiedPath['type'] {
  // Wall detection logic
  const hasWallStyle = (
    style.includes('stroke:#000000') &&
    style.includes('stroke-width:0.1') &&
    style.includes('fill:none')
  );

  // Analyze path commands
  const commands = d.match(/[MmHhVvLl][-\d.,\s]*/g) || [];
  const commandTypes = commands.map(cmd => cmd[0].toUpperCase());

  // Check for rectangular patterns
  const hasRectangularPattern = (
    commandTypes[0] === 'M' && // Starts with Move
    commandTypes.length >= 4 && // Has enough commands to form a shape
    commandTypes.some((cmd, i) =>
      (cmd === 'V' && commandTypes[i + 1] === 'H') ||
      (cmd === 'H' && commandTypes[i + 1] === 'V')
    )
  );

  // Count vertical and horizontal lines
  const verticalLines = commandTypes.filter(cmd => cmd === 'V').length;
  const horizontalLines = commandTypes.filter(cmd => cmd === 'H').length;

  // Scoring system for wall detection
  let wallScore = 0;
  if (hasWallStyle) wallScore += 2;
  if (hasRectangularPattern) wallScore += 3;
  if (verticalLines >= 1 && horizontalLines >= 1) wallScore += 2;
  if (commands.length >= 4) wallScore += 1;

  return wallScore >= 5 ? 'wall' : 'other';
}
