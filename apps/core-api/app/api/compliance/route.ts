// API Route for fetching compliance data by access token
import { NextRequest, NextResponse } from 'next/server';
import { findDiscoveriesByToken } from '@recall/shared/services/discovery';
import { buildComplianceResponse } from '@/lib/services/compliance-builder';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'Token parameter is required' },
      { status: 400 }
    );
  }

  try {
    const result = await findDiscoveriesByToken(token);

    if (!result) {
      return NextResponse.json(
        { error: 'No compliance data found for this token' },
        { status: 404 }
      );
    }

    const response = await buildComplianceResponse(result.company, result.discoveries);
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[API] Compliance fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch compliance data' },
      { status: 500 }
    );
  }
}
