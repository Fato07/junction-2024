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
    // Extract the style attribute
    const styleMatch = pathElement.match(/style="([^"]*)"/);
    const classMatch = pathElement.match(/class="([^"]*)"/);
    
    // Debug logging
    console.debug('Analyzing path:', {
        style: styleMatch?.[1],
        class: classMatch?.[1],
        fullElement: pathElement
    });

    // If no style attribute, check for direct attributes
    const strokeWidth = pathElement.match(/stroke-width="([^"]*)"/)?.[1];
    const fill = pathElement.match(/fill="([^"]*)"/)?.[1];
    const stroke = pathElement.match(/stroke="([^"]*)"/)?.[1];

    // Common wall characteristics
    const isWall = (style: string | undefined, directStrokeWidth?: string, directFill?: string, directStroke?: string): boolean => {
        if (!style && !directStrokeWidth) return false;

        // Check both style attribute and direct attributes
        const hasValidStrokeWidth = (
            (style?.includes('stroke-width:0.1') || style?.includes('stroke-width:0.2')) ||
            (directStrokeWidth && (directStrokeWidth === '0.1' || directStrokeWidth === '0.2'))
        );

        const hasValidFill = (
            style?.includes('fill:none') ||
            directFill === 'none'
        );

        const hasValidStroke = (
            style?.includes('stroke:#000') ||
            style?.includes('stroke:#000000') ||
            directStroke === '#000' ||
            directStroke === '#000000' ||
            directStroke === 'black'
        );

        // Additional wall indicators
        const hasWallClass = classMatch?.[1]?.toLowerCase().includes('wall');
        const hasWallId = pathElement.includes('wall') || pathElement.includes('Wall');

        // Consider it a wall if it matches most wall characteristics
        return (hasValidStrokeWidth || hasValidStroke) && 
               (hasValidFill || hasWallClass || hasWallId);
    };

    if (styleMatch || strokeWidth || fill || stroke) {
        const style = styleMatch?.[1];
        if (isWall(style, strokeWidth, fill, stroke)) {
            return 'wall';
        }
    }

    // If no clear wall characteristics are found, check for specific patterns
    if (pathElement.includes('wall') || 
        pathElement.includes('Wall') || 
        (classMatch && classMatch[1].toLowerCase().includes('wall'))) {
        return 'wall';
    }

    // Log paths that weren't identified as walls
    console.debug('Path not identified as wall:', pathElement);
    
    return 'other';
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
