import { createReadStream, existsSync } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { SimplifiedPath, FloorPlanMetadata } from '@/types/floorPlan';

class SVGPathExtractor extends Transform {
  private buffer = '';
  private pathCount = 0;
  private seenIds = new Set<string>();
  private floorNumber: number;

  constructor(
    private callback: (path: SimplifiedPath) => void,
    floorNumber: number
  ) {
    super({ objectMode: true });
    this.floorNumber = floorNumber;
  }

  private generateUniqueId(baseId: string): string {
    let uniqueId = baseId;
    let counter = 1;
    
    while (this.seenIds.has(uniqueId)) {
      uniqueId = `${baseId}_${counter}`;
      counter++;
    }
    
    this.seenIds.add(uniqueId);
    return uniqueId;
  }

  _transform(chunk: any, encoding: string, callback: Function) {
    this.buffer += chunk.toString();
    
    const pathRegex = /<path[^>]* d="[^"]*"[^>]*>/g;
    let match;
    
    while ((match = pathRegex.exec(this.buffer)) !== null) {
      const pathElement = match[0];
      
      let id = (pathElement.match(/id="([^"]*)"/) || [])[1];
      const d = (pathElement.match(/d="([^"]*)"/) || [])[1];
      const transform = (pathElement.match(/transform="([^"]*)"/) || [])[1];
      
      // Validate path data
      if (!d || !d.trim().match(/^[Mm]/)) {
        continue; // Skip invalid paths
      }

      // Ensure unique IDs
      if (id && d) {
        id = this.generateUniqueId(id);
        const type = this.determinePathType(pathElement);
        
        this.pathCount++;
        this.callback({
          id,
          d,
          type,
          transform,
          floor: this.floorNumber
        });
      }
    }

    const lastTagIndex = this.buffer.lastIndexOf('<path');
    if (lastTagIndex !== -1) {
      this.buffer = this.buffer.substring(lastTagIndex);
    }

    callback();
  }

  private determinePathType(pathElement: string): 'wall' | 'window' | 'door' | 'other' {
    // Extract all relevant attributes
    const styleMatch = pathElement.match(/style="([^"]*)"/);
    const classMatch = pathElement.match(/class="([^"]*)"/);
    
    // Extract path data to analyze the shape
    const dMatch = pathElement.match(/d="([^"]*)"/);
    const pathData = dMatch?.[1];
    
    // If no style or path data, it's not a wall
    if (!styleMatch && !pathData) return 'other';
    
    const style = styleMatch?.[1] || '';
    
    // Check for wall-like characteristics in the style
    const hasWallStyle = (
        style.includes('stroke:#000000') &&
        style.includes('stroke-width:0.1') &&
        style.includes('fill:none') &&
        style.includes('stroke-opacity:1')
    );

    // Check path data characteristics
    const isLongEnoughPath = pathData && (
        pathData.length > 10 || // Arbitrary minimum length
        pathData.includes('L') || // Has line segments
        pathData.includes('H') || // Has horizontal lines
        pathData.includes('V')    // Has vertical lines
    );

    // Check transform matrix for scaling
    const transformMatch = pathElement.match(/matrix\(([\d.-]+,?)+\)/);
    const hasValidTransform = transformMatch && transformMatch[0].includes('3.7795333');

    // Additional checks for specific wall patterns
    const hasWallIndicators = (
        pathElement.includes('wall') ||
        pathElement.includes('Wall') ||
        (classMatch && classMatch[1]?.toLowerCase().includes('wall')) ||
        style.includes('stroke-linecap:round') ||
        style.includes('stroke-linejoin:round') ||
        style.includes('stroke-miterlimit:10')
    );

    // Score-based system for wall detection
    let wallScore = 0;
    if (hasWallStyle) wallScore += 2;
    if (isLongEnoughPath) wallScore += 1;
    if (hasValidTransform) wallScore += 1;
    if (hasWallIndicators) wallScore += 1;

    // Debug logging for borderline cases
    if (wallScore > 0) {
        console.debug('Wall detection score:', {
            path: pathData?.substring(0, 50) + '...',
            score: wallScore,
            style: style.substring(0, 50) + '...',
            hasWallStyle,
            isLongEnoughPath,
            hasValidTransform,
            hasWallIndicators
        });
    }

    // Consider it a wall if it scores high enough
    return wallScore >= 3 ? 'wall' : 'other';
  }

  getPathCount(): number {
    return this.pathCount;
  }
}

export interface ParsedFloorPlan {
  metadata: FloorPlanMetadata;
  paths: SimplifiedPath[];
}

export async function streamParseFloorPlan(
  floorNumber: number,
  pathCallback: (path: SimplifiedPath) => void,
  progressCallback?: (progress: number) => void
): Promise<ParsedFloorPlan> {
  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'public', 'assets', 'floor_plans', `floor_${floorNumber}.svg`);
    console.log('Attempting to read SVG from:', filePath);
    
    if (!existsSync(filePath)) {
      console.error(`SVG file not found at path: ${filePath}`);
      reject(new Error(`SVG file not found at path: ${filePath}`));
      return;
    }
    
    let dimensions = {
      width: 0,
      height: 0,
      viewBox: '',
    };
    let scale = 3.7795333;

    const parser = new Parser({
      trim: true,
      explicitArray: false,
    });

    // Read the entire file for header parsing
    const fileContent = createReadStream(filePath);
    let svgData = '';

    fileContent.on('data', chunk => {
      svgData += chunk;
    });

    fileContent.on('end', () => {
      // Find the SVG opening tag and extract attributes
      const svgOpeningTag = svgData.match(/<svg[^>]*>/);
      if (!svgOpeningTag) {
        reject(new Error('Invalid SVG file: No opening svg tag found'));
        return;
      }

      // Parse dimensions from the opening tag
      const widthMatch = svgOpeningTag[0].match(/width="([^"]*)/);
      const heightMatch = svgOpeningTag[0].match(/height="([^"]*)/);
      const viewBoxMatch = svgOpeningTag[0].match(/viewBox="([^"]*)/);

      dimensions = {
        width: widthMatch ? Math.round(parseFloat(widthMatch[1])) : 0,
        height: heightMatch ? Math.round(parseFloat(heightMatch[1])) : 0,
        viewBox: viewBoxMatch ? viewBoxMatch[1].trim() : '0 0 100 100',
      };

      // Now process the paths
      const collectedPaths: SimplifiedPath[] = [];
      const pathExtractor = new SVGPathExtractor((path) => {
        collectedPaths.push(path);
        pathCallback(path);
      }, floorNumber);

      const readStream = createReadStream(filePath);

      readStream
        .pipe(pathExtractor)
        .on('finish', () => {
          const result = {
            metadata: {
              floor: floorNumber,
              dimensions,
              scale,
              pathCount: pathExtractor.getPathCount(),
            },
            paths: collectedPaths
          };

          // Log summary of parsed paths
          console.log('Floor plan parsing complete:', {
            floor: floorNumber,
            totalPaths: collectedPaths.length,
            wallPaths: collectedPaths.filter(p => p.type === 'wall').length,
            otherPaths: collectedPaths.filter(p => p.type === 'other').length,
          });

          resolve(result);
        })
        .on('error', reject);
    });
  });
}
