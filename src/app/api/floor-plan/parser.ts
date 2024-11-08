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
    const styleMatch = pathElement.match(/style="([^"]*)"/);
    const classMatch = pathElement.match(/class="([^"]*)"/);
    const dMatch = pathElement.match(/d="([^"]*)"/);
    const pathData = dMatch?.[1];
    
    if (!styleMatch || !pathData) return 'other';
    
    const style = styleMatch[1];

    // Function to calculate path length considering scale
    const calculatePathLength = (d: string): number => {
        const coordinates = d.match(/-?\d+\.?\d*/g);
        if (!coordinates) return 0;
        
        let length = 0;
        for (let i = 0; i < coordinates.length - 2; i += 2) {
            const x1 = parseFloat(coordinates[i]);
            const y1 = parseFloat(coordinates[i + 1]);
            const x2 = parseFloat(coordinates[i + 2]);
            const y2 = parseFloat(coordinates[i + 3]);
            length += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        }
        return length * 3.7795333; // Apply scale factor
    };

    // More lenient wall style detection
    const hasWallStyle = (
        style.includes('stroke:#000000') &&
        style.includes('stroke-width:0.1') &&
        style.includes('fill:none')
    );

    // Calculate path characteristics
    const pathLength = calculatePathLength(pathData);
    const isSignificantPath = pathLength > 10; // Increased threshold after scaling

    // Analyze path commands for straightness
    const commands = pathData.match(/[A-Za-z][^A-Za-z]*/g) || [];
    const isStraightPath = commands.some(cmd => {
        const type = cmd[0];
        return type === 'H' || type === 'V' || type === 'L';
    });

    // Check for consecutive line segments
    const hasConsecutiveLines = commands.length > 1;

    let wallScore = 0;
    if (hasWallStyle) wallScore += 2;
    if (isSignificantPath) wallScore += 2;
    if (isStraightPath) wallScore += 1;
    if (hasConsecutiveLines) wallScore += 1;
    
    // Debug logging with more details
    if (wallScore > 0) {
        console.debug('Wall detection analysis:', {
            path: pathData,
            pathLength,
            commands: commands.map(cmd => cmd[0]).join(','),
            score: wallScore,
            style: style.substring(0, 50) + '...',
            hasWallStyle,
            isSignificantPath,
            isStraightPath,
            hasConsecutiveLines
        });
    }

    // Adjusted threshold
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
