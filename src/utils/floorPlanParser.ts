import { createReadStream } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { SimplifiedPath, FloorPlanMetadata } from '../types/floorPlan';

class SVGPathExtractor extends Transform {
  private buffer = '';
  private pathCount = 0;

  constructor(private callback: (path: SimplifiedPath) => void) {
    super({ objectMode: true });
  }

  _transform(chunk: any, encoding: string, callback: Function) {
    this.buffer += chunk.toString();
    
    const pathRegex = /<path[^>]*>/g;
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
    if (pathElement.includes('stroke-width="0.1"')) {
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

    const headerStream = createReadStream(filePath, { end: 1000 });
    let headerData = '';

    headerStream.on('data', chunk => {
      headerData += chunk;
    });

    headerStream.on('end', () => {
      parser.parseString(headerData, (err: any, result: any) => {
        if (err) {
          reject(err);
          return;
        }

        if (result.svg.$) {
          dimensions = {
            width: Number(result.svg.$.width),
            height: Number(result.svg.$.height),
            viewBox: result.svg.$.viewBox,
          };
        }

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
  });
}

export async function loadFloorPlanPaths(
  floorNumber: number,
  options: {
    onPath?: (path: SimplifiedPath) => void,
    onProgress?: (progress: number) => void,
    filter?: (path: SimplifiedPath) => boolean,
  } = {}
): Promise<FloorPlanMetadata> {
  const { onPath, onProgress, filter } = options;

  const metadata = await streamParseFloorPlan(
    floorNumber,
    (path: SimplifiedPath) => {
      if (!filter || filter(path)) {
        onPath?.(path);
      }
    },
    onProgress
  );

  return metadata;
}
