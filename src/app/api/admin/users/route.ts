import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { requireRole } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// Lists/searches platform users for role management. Only SUPER_ADMIN can
// see this — it's the entry point for granting/revoking every other role.
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'SUPER_ADMIN');
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10) || 25, 100);

    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error listing users for admin:', error);
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}
