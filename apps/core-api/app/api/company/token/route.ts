import { NextRequest, NextResponse } from 'next/server';
import { findCompanyByEmail, findCompanyByToken } from '@recall/shared/services/company';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const token = searchParams.get('token');

  if (!email && !token) {
    return NextResponse.json(
      { error: 'Either email or token parameter is required' },
      { status: 400 }
    );
  }

  try {
    if (email) {
      // Lookup by email -> return access token (used by discover page after submission)
      const company = await findCompanyByEmail(email);
      if (!company) {
        return NextResponse.json(
          { error: 'No company found for this email' },
          { status: 404 }
        );
      }
      return NextResponse.json({ accessToken: company.accessToken });
    }

    // Lookup by token -> return token + email (used by register page to pre-fill)
    const company = await findCompanyByToken(token!);
    if (!company) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      accessToken: company.accessToken,
      email: company.contactEmail,
    });
  } catch (error) {
    console.error('[API] Token lookup error:', error);
    return NextResponse.json(
      { error: 'Failed to lookup token' },
      { status: 500 }
    );
  }
}
