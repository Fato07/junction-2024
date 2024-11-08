import { createReadStream, existsSync, statSync } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { logger } from '@/utils/logger';
import { SimplifiedPath, FloorPlanMetadata } from '@/types/floorPlan';
import { LRUCache } from 'lru-cache';

// Cache configuration
const cache = new LRUCache<string, ParsedFloorPlan>({
  max: 10, // Maximum number of floor plans to cache
  ttl: 1000 * 60 * 60, // Cache for 1 hour
});

// Batch size for processing paths
const BATCH_SIZE = 100;

class OptimizedSVGPathExtractor extends Transform {
  private buffer = '';
  private pathCount = 0;
  private seenIds = new Set<string>();
  private floorNumber: number;
  private batch: SimplifiedPath[] = [];
  private processedBytes = 0;
  private totalBytes: number;
  private startTime: number;
  private readonly MAX_PATHS = 10000;

  constructor(
    private pathCallback: (paths: SimplifiedPath[]) => void,
    private progressCallback?: (progress: number) => void,
    floorNumber: number,
    totalBytes: number
  ) {
    super({ objectMode: true });
    this.floorNumber = floorNumber;
    this.totalBytes = totalBytes;
    this.startTime = Date.now();
  }

  private processBatch() {
    if (this.batch.length > 0) {
      this.pathCallback(this.batch);
      this.batch = [];
    }
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
    try {
      this.processedBytes += chunk.length;
      this.buffer += chunk.toString();
      
      // Report progress
      if (this.progressCallback) {
        const progress = (this.processedBytes / this.totalBytes) * 100;
        this.progressCallback(Math.round(progress));
      }

      const pathRegex = /<path[^>]* d="[^"]*"[^>]*>/g;
      let match;
      
      while ((match = pathRegex.exec(this.buffer)) !== null) {
        const pathElement = match[0];
        const path = this.extractPath(pathElement);
        
        if (path) {
          this.batch.push(path);
          this.pathCount++;

          if (this.batch.length >= BATCH_SIZE) {
            this.processBatch();
          }
        }
      }

      const lastTagIndex = this.buffer.lastIndexOf('<path');
      if (lastTagIndex !== -1) {
        this.buffer = this.buffer.substring(lastTagIndex);
      }

      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback: Function) {
    this.processBatch();
    callback();
  }

  private extractPath(pathElement: string): SimplifiedPath | null {
    let id = (pathElement.match(/id="([^"]*)"/) || [])[1];
    const d = (pathElement.match(/d="([^"]*)"/) || [])[1];
    const transform = (pathElement.match(/transform="([^"]*)"/) || [])[1];

    if (!d || !d.trim()) return null;

    id = this.generateUniqueId(id || `path_${this.pathCount}`);
    
    return {
      id,
      d,
      type: this.determinePathType(pathElement),
      transform,
      floor: this.floorNumber
    };
    if (this.pathCount >= this.MAX_PATHS) {
      logger.warn(`Reached maximum path limit for floor ${this.floorNumber}`, {
        maxPaths: this.MAX_PATHS,
        floor: this.floorNumber
      });
      return null;
    }

    id = this.generateUniqueId(id || `path_${this.pathCount}`);
    
    return {
      id,
      d,
      type: this.determinePathType(pathElement),
      transform,
      floor: this.floorNumber
    };
  }

  private determinePathType(pathElement: string): 'wall' | 'window' | 'door' | 'other' {
    const styleMatch = pathElement.match(/style="([^"]*)"/);
    const dMatch = pathElement.match(/d="([^"]*)"/);
    const pathData = dMatch?.[1];
    
    if (!styleMatch || !pathData) return 'other';
    
    const style = styleMatch[1];

    // Function to analyze path commands
    const analyzePathCommands = (d: string) => {
        const commands = d.match(/[MmHhVvLl][-\d.,\s]*/g) || [];
        const commandTypes = commands.map(cmd => cmd[0].toUpperCase());
        
        // Check for rectangular pattern (M followed by alternating V and H commands)
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

        return {
            hasRectangularPattern,
            verticalLines,
            horizontalLines,
            commandCount: commands.length,
            commands: commandTypes.join(',')
        };
    };

    // More specific wall style detection
    const hasWallStyle = (
        style.includes('stroke:#000000') &&
        style.includes('stroke-width:0.1') &&
        style.includes('fill:none')
    );

    const pathAnalysis = analyzePathCommands(pathData);
    
    // Scoring system for wall detection
    let wallScore = 0;
    if (hasWallStyle) wallScore += 2;
    if (pathAnalysis.hasRectangularPattern) wallScore += 3;
    if (pathAnalysis.verticalLines >= 1 && pathAnalysis.horizontalLines >= 1) wallScore += 2;
    if (pathAnalysis.commandCount >= 4) wallScore += 1;

    // Debug logging with more details
    if (wallScore > 0) {
        console.debug('Wall detection analysis:', {
            path: pathData,
            pathAnalysis,
            score: wallScore,
            style: style.substring(0, 50) + '...',
            hasWallStyle
        });
    }

    // Higher threshold for wall detection
    return wallScore >= 5 ? 'wall' : 'other';
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
  const cacheKey = `floor_${floorNumber}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`Using cached floor plan for floor ${floorNumber}`);
    return cached;
  }

  return new Promise((resolve, reject) => {
    const filePath = path.join(process.cwd(), 'public', 'assets', 'floor_plans', `floor_${floorNumber}.svg`);
    
    if (!existsSync(filePath)) {
      reject(new Error(`Floor plan not found: floor_${floorNumber}.svg`));
      return;
    }

    const stats = statSync(filePath);
    const fileSize = stats.size;

    let dimensions = {
      width: 0,
      height: 0,
      viewBox: '',
    };

    const collectedPaths: SimplifiedPath[] = [];
    const batchCallback = (paths: SimplifiedPath[]) => {
      paths.forEach(path => {
        collectedPaths.push(path);
        pathCallback(path);
      });
    };

    // First pass: extract metadata
    const headerStream = createReadStream(filePath, { end: 1000 }); // Read first 1KB for metadata
    let headerData = '';

    headerStream.on('data', chunk => {
      headerData += chunk;
      const svgMatch = headerData.match(/<svg[^>]*>/);
      if (svgMatch) {
        const widthMatch = svgMatch[0].match(/width="([^"]*)/);
        const heightMatch = svgMatch[0].match(/height="([^"]*)/);
        const viewBoxMatch = svgMatch[0].match(/viewBox="([^"]*)/);

        dimensions = {
          width: widthMatch ? Math.round(parseFloat(widthMatch[1])) : 0,
          height: heightMatch ? Math.round(parseFloat(heightMatch[1])) : 0,
          viewBox: viewBoxMatch ? viewBoxMatch[1].trim() : '0 0 100 100',
        };
        headerStream.destroy();
      }
    });

    headerStream.on('end', () => {
      // Second pass: process paths
      const pathExtractor = new OptimizedSVGPathExtractor(
        batchCallback,
        progressCallback,
        floorNumber,
        fileSize
      );

      const readStream = createReadStream(filePath);

      readStream
        .pipe(pathExtractor)
        .on('finish', () => {
          const result = {
            metadata: {
              floor: floorNumber,
              dimensions,
              scale: 3.7795333,
              pathCount: pathExtractor.getPathCount(),
            },
            paths: collectedPaths
          };

          const duration = Date.now() - pathExtractor.startTime;
          cache.set(cacheKey, result);
          logger.info('Floor plan parsing complete:', {
            floor: floorNumber,
            totalPaths: collectedPaths.length,
            wallPaths: collectedPaths.filter(p => p.type === 'wall').length,
            otherPaths: collectedPaths.filter(p => p.type === 'other').length,
            duration: `${duration}ms`
          });

          resolve(result);
        })
        .on('error', reject);
    });
  });
}
