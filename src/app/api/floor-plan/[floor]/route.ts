import { createReadStream, existsSync } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { NextResponse } from 'next/server';
import { streamParseFloorPlan } from '../parser';
import { logger } from '@/utils/logger';

interface RouteParams {
  params: {
    floor: string;
  };
}

export async function GET(
  request: Request,
  { params }: RouteParams
) {
  const { floor } = await params;
  
  try {
    const floorNumber = parseInt(floor);
    const paths: any[] = [];

    const { metadata, paths: parsedPaths } = await streamParseFloorPlan(
      floorNumber,
      (path) => {
        // Optional: You can still use the callback for progress updates
      }
    );

    // Filter paths to only include those matching the requested floor
    const floorPaths = parsedPaths.filter(path => path.floor === floorNumber);

    return NextResponse.json({ 
      metadata,
      paths: floorPaths
    });
  } catch (error) {
    logger.error('Error processing floor plan:', { 
      floor: params.floor, 
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: 'Failed to process floor plan' },
      { status: 500 }
    );
  }
}
