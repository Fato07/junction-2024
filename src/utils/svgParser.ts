import { parse } from 'svgson';
import { readFileSync } from 'fs';
import path from 'path';
import { logger } from './logger';
import { SimplifiedPath } from '@/types/floorPlan';

interface SVGParserOptions {
  maxPaths?: number;
  includeTransforms?: boolean;
}

export async function parseSVGFloorPlan(
  floorNumber: number,
  options: SVGParserOptions = {}
): Promise<SimplifiedPath[]> {
  const {
    maxPaths = 10000,
    includeTransforms = true
  } = options;

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

        if (d && d.trim()) {
          paths.push({
            id,
            d,
            type,
            transform,
            floor: floorNumber
          });
        }
      }

      // Recursively process child nodes
      if (node.children) {
        node.children.forEach(extractPaths);
      }
    };

    // Start extraction from root
    extractPaths(parsedSVG);

    logger.info('SVG parsing complete', {
      floor: floorNumber,
      totalPaths: paths.length,
      wallPaths: paths.filter(p => p.type === 'wall').length,
      otherPaths: paths.filter(p => p.type === 'other').length
    });

    return paths;

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
