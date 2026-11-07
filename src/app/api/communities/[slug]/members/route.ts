import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { getAuthUserFromRequest } from '../../../../../lib/auth';
import { canUserViewCommunityContent } from '../../../../../lib/engine/community/communityEngine';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const query = searchParams.get('q');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;

    const community = await prisma.community.findFirst({
      where: { OR: [{ slug }, { id: slug }] },
      select: { id: true, ownerId: true, visibility: true, status: true },
    });

    if (!community) {
      return NextResponse.json({ error: 'Community not found' }, { status: 404 });
    }

    const authUser = await getAuthUserFromRequest(request);
    if (!(await canUserViewCommunityContent(community, authUser?.id))) {
      return NextResponse.json({ error: 'Access denied: Private community membership required' }, { status: 403 });
    }

    const where: any = {
      communityId: community.id,
      status: 'ACTIVE',
    };

    if (role) {
      where.role = role.toUpperCase();
    }

    if (query && query.trim()) {
      where.user = {
        username: { contains: query.trim(), mode: 'insensitive' },
      };
    }

    const [members, total] = await Promise.all([
      prisma.communityMember.findMany({
        where,
        skip,
        take: limit,
        orderBy: { joinedAt: 'asc' },
        include: {
          user: { select: { id: true, username: true, avatarUrl: true, bio: true } },
        },
      }),
      prisma.communityMember.count({ where }),
    ]);

    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        username: m.user.username,
        avatarUrl: m.user.avatarUrl,
        bio: m.user.bio,
        role: m.role,
        status: m.status,
        creatorVerified: m.creatorVerified,
        joinedAt: m.joinedAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch community members' }, { status: 500 });
  }
}
