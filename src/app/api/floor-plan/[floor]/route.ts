import { existsSync } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { logger } from '@/utils/logger';
import { parseSVGFloorPlan } from '@/utils/svgParser';

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
    
    // Check if file exists
    const filePath = path.join(
      process.cwd(),
      'public',
      'assets',
      'floor_plans',
      `floor_${floorNumber}_small.svg`
    );
    
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: 'Floor plan not found' },
        { status: 404 }
      );
    }

    // Parse the SVG file
    const paths = await parseSVGFloorPlan(floorNumber, {
      maxPaths: 10000,
      includeTransforms: true
    });

    // Basic metadata
    const metadata = {
      floor: floorNumber,
      pathCount: paths.length,
      wallCount: paths.filter(p => p.type === 'wall').length,
      otherCount: paths.filter(p => p.type === 'other').length
    };

    return NextResponse.json({ 
      metadata,
      paths
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
