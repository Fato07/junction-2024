import { createReadStream, existsSync } from 'fs';
import { Parser } from 'xml2js';
import { Transform } from 'stream';
import path from 'path';
import { NextResponse } from 'next/server';
import { streamParseFloorPlan } from '../parser';

interface RouteParams {
  params: {
    floor: string;
  };
}

export async function GET(
  request: Request,
  { params }: RouteParams
) {
  try {
    const floorNumber = parseInt(params.floor);
    const paths: any[] = [];

    const metadata = await streamParseFloorPlan(
      floorNumber,
      (path) => {
        paths.push(path);
      }
    );

    return NextResponse.json({ metadata, paths });
  } catch (error) {
    console.error('Error processing floor plan:', error);
    return NextResponse.json(
      { error: 'Failed to process floor plan' },
      { status: 500 }
    );
  }
}
