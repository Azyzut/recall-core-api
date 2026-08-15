import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import db from '@recall/shared/db';

export async function GET(request: NextRequest) {
  const fmKey = process.env.FM_KEY || '';
  const props: Record<string, string | number | boolean> = {};

  const session = await auth();
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  let companyId: string | null = null;

  if (session?.user?.id) {
    props.isLoggedIn = true;
    props.email = session.user.email || '';
    props.userId = session.user.id;

    const user = await db
      .selectFrom('users')
      .select(['companyId'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();
    companyId = user?.companyId || null;
  } else if (token) {
    const company = await db
      .selectFrom('companies')
      .select(['id'])
      .where('accessToken', '=', token)
      .executeTakeFirst();
    companyId = company?.id || null;
    props.isLoggedIn = false;
  }

  if (companyId) {
    const company = await db
      .selectFrom('companies')
      .select(['companyName', 'employeeCount', 'naicsCode', 'state'])
      .where('id', '=', companyId)
      .executeTakeFirst();

    if (company) {
      props.company = company.companyName || '';
      props.naicsCode = company.naicsCode || '';
      props.state = company.state || '';
      const count = company.employeeCount ?? 0;
      if (count >= 500) props.companySize = 'enterprise';
      else if (count >= 100) props.companySize = 'mid-market';
      else props.companySize = 'small';
    }
  }

  return NextResponse.json({ fmKey, props });
}
