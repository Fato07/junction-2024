import { createReadStream, existsSync } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { SimplifiedPath, FloorPlanMetadata } from '@/types/floorPlan';

class SVGPathExtractor extends Transform {
  private buffer = '';
  private pathCount = 0;

  constructor(private callback: (path: SimplifiedPath) => void) {
    super({ objectMode: true });
  }

  _transform(chunk: any, encoding: string, callback: Function) {
    this.buffer += chunk.toString();
    
    // More specific regex to match complete path elements
    const pathRegex = /<path[^>]* d="[^"]*"[^>]*>/g;
    let match;
    
    while ((match = pathRegex.exec(this.buffer)) !== null) {
      const pathElement = match[0];
      
      const id = (pathElement.match(/id="([^"]*)"/) || [])[1];
      const d = (pathElement.match(/d="([^"]*)"/) || [])[1];
      const transform = (pathElement.match(/transform="([^"]*)"/) || [])[1];
      
      const type = this.determinePathType(pathElement);

      if (id && d) {
        this.pathCount++;
        this.callback({
          id,
          d,
          type,
          transform
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
    if (!styleMatch) return 'other';
    
    const style = styleMatch[1];
    
    // Check for wall characteristics
    if (style.includes('stroke-width:0.1') && 
        style.includes('fill:none') && 
        style.includes('stroke:#000000')) {
      return 'wall';
    }
    
    return 'other';
  }

  getPathCount(): number {
    return this.pathCount;
  }
}

export async function streamParseFloorPlan(
  floorNumber: number,
  pathCallback: (path: SimplifiedPath) => void,
  progressCallback?: (progress: number) => void
): Promise<FloorPlanMetadata> {
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
        width: widthMatch ? parseFloat(widthMatch[1]) : 0,
        height: heightMatch ? parseFloat(heightMatch[1]) : 0,
        viewBox: viewBoxMatch ? viewBoxMatch[1] : '',
      };

      // Now process the paths
      const pathExtractor = new SVGPathExtractor(pathCallback);
      const readStream = createReadStream(filePath);

      readStream
        .pipe(pathExtractor)
        .on('finish', () => {
          resolve({
            floor: floorNumber,
            dimensions,
            scale,
            pathCount: pathExtractor.getPathCount(),
          });
        })
        .on('error', reject);
    });
  });
}
