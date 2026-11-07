/**
 * OTAKUVA Community Domain Service
 * PostgreSQL is the permanent canonical source of truth.
 * All operations enforce authentication, authorization, and transactional consistency.
 */

import { prisma } from '../prisma';
import { generateSlug } from '../normalizers';
import { validateExternalImageUrl } from '../storage';

export interface CreateCommunityInput {
  name: string;
  description: string;
  category?: string;
  visibility?: string;
  iconUrl?: string | null;
  iconSource?: 'UPLOAD' | 'URL';
  bannerUrl?: string | null;
  bannerSource?: 'UPLOAD' | 'URL';
  animeId?: string | null;
  rules?: { title: string; content: string }[];
}

export interface ListCommunitiesOptions {
  filter?: string; // 'all', 'trending', 'popular', 'growing', 'new', 'joined'
  category?: string;
  animeId?: string;
  query?: string;
  limit?: number;
  userId?: string | null;
}

export interface CommunityResponseItem {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  iconUrl: string | null;
  iconSource: string;
  bannerUrl: string | null;
  bannerSource: string;
  category: string;
  visibility: string;
  memberCount: number;
  discussionCount: number;
  createdAt: string;
  owner: { id: string; username: string; avatarUrl: string | null };
  channels: { id: string; name: string; slug: string; type: string }[];
  rules: { id: string; title: string; content: string }[];
  anime: { id: string; canonicalTitle: string; slug: string; posterUrl: string } | null;
  currentUserMembership: { role: string; status: string } | null;
  membershipStatus: string | null;
}

/**
 * Lists discoverable communities from PostgreSQL.
 * Does NOT filter out communities created by other users.
 */
export async function listDiscoverableCommunities(
  options: ListCommunitiesOptions = {}
): Promise<{ communities: CommunityResponseItem[]; total: number }> {
  const {
    filter = 'all',
    category,
    animeId,
    query,
    limit = 30,
    userId,
  } = options;

  let where: any = {};

  // For discovery, include PUBLIC and REQUEST_TO_JOIN communities (exclude only strict PRIVATE unless joined)
  if (filter === 'joined' && userId) {
    where.members = {
      some: {
        userId,
        status: 'ACTIVE',
      },
    };
  } else {
    // Public discoverability: show PUBLIC and REQUEST_TO_JOIN
    where.visibility = { in: ['PUBLIC', 'REQUEST_TO_JOIN'] };
  }

  if (category && category !== 'ALL') {
    where.category = category.toUpperCase();
  }

  if (animeId) {
    where.animeId = animeId;
  }

  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
    ];
  }

  let orderBy: any = { memberCount: 'desc' };
  if (filter === 'new') {
    orderBy = { createdAt: 'desc' };
  } else if (filter === 'popular' || filter === 'trending') {
    orderBy = { memberCount: 'desc' };
  }

  const communities = await prisma.community.findMany({
    where,
    include: {
      owner: { select: { id: true, username: true, avatarUrl: true } },
      channels: { select: { id: true, name: true, slug: true, type: true } },
      rules: { select: { id: true, title: true, content: true } },
      anime: { select: { id: true, canonicalTitle: true, slug: true, posterUrl: true } },
      _count: { select: { members: true, discussions: true } },
    },
    orderBy,
    take: limit,
  });

  // Query authenticated user's memberships across these communities
  let userMembershipMap: Record<string, { role: string; status: string }> = {};
  if (userId && communities.length > 0) {
    const memberships = await prisma.communityMember.findMany({
      where: {
        userId,
        communityId: { in: communities.map((c) => c.id) },
      },
    });
    memberships.forEach((m) => {
      userMembershipMap[m.communityId] = { role: m.role, status: m.status };
    });
  }

  const formatted: CommunityResponseItem[] = communities.map((c) => {
    const membership = userMembershipMap[c.id] || null;
    return {
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      slug: c.slug,
      description: c.description,
      iconUrl: c.iconUrl,
      iconSource: c.iconSource || 'URL',
      bannerUrl: c.bannerUrl,
      bannerSource: c.bannerSource || 'URL',
      category: c.category,
      visibility: c.visibility,
      memberCount: c._count.members || c.memberCount,
      discussionCount: c._count.discussions,
      createdAt: c.createdAt.toISOString(),
      owner: c.owner,
      channels: c.channels,
      rules: c.rules,
      anime: c.anime,
      currentUserMembership: membership,
      membershipStatus: membership ? membership.status : null,
    };
  });

  return {
    communities: formatted,
    total: formatted.length,
  };
}

/**
 * Retrieves a single community by slug with complete metadata and user membership
 */
export async function getCommunityBySlug(slug: string, userId?: string | null) {
  const community = await prisma.community.findUnique({
    where: { slug },
    include: {
      owner: { select: { id: true, username: true, avatarUrl: true } },
      channels: {
        select: { id: true, name: true, slug: true, type: true, position: true },
        orderBy: { position: 'asc' },
      },
      rules: {
        select: { id: true, position: true, title: true, content: true },
        orderBy: { position: 'asc' },
      },
      anime: {
        select: { id: true, canonicalTitle: true, slug: true, posterUrl: true, bannerUrl: true },
      },
      members: {
        take: 20,
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: 'desc' },
      },
      _count: {
        select: { members: true, discussions: true },
      },
    },
  });

  if (!community) {
    return null;
  }

  let userRole: string | null = null;
  let membershipStatus: string | null = null;

  if (userId) {
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: community.id,
          userId,
        },
      },
    });

    if (membership) {
      userRole = membership.role;
      membershipStatus = membership.status;
    } else if (community.ownerId === userId) {
      userRole = 'OWNER';
      membershipStatus = 'ACTIVE';
    }
  }

  return {
    ...community,
    memberCount: community._count.members || community.memberCount,
    discussionCount: community._count.discussions,
    userRole,
    membershipStatus,
    currentUserMembership: membershipStatus ? { role: userRole || 'MEMBER', status: membershipStatus } : null,
  };
}

/**
 * Creates a new community in a single atomic database transaction
 */
export async function createCommunity(userId: string, input: CreateCommunityInput) {
  const { name, description, category, visibility, iconUrl, iconSource, bannerUrl, bannerSource, animeId, rules } = input;

  if (!name || name.trim().length < 3) {
    throw new Error('Community name must be at least 3 characters');
  }

  if (!description || description.trim().length < 10) {
    throw new Error('Description must be at least 10 characters');
  }

  // Validate Icon
  let finalIconUrl: string | null = null;
  let finalIconSource: string = iconSource || 'URL';
  if (iconUrl && typeof iconUrl === 'string' && iconUrl.trim()) {
    const trimmedIcon = iconUrl.trim();
    if (trimmedIcon.startsWith('/uploads/')) {
      finalIconUrl = trimmedIcon;
      finalIconSource = 'UPLOAD';
    } else {
      const val = validateExternalImageUrl(trimmedIcon);
      if (!val.valid) {
        throw new Error(`Icon Error: ${val.error}`);
      }
      finalIconUrl = val.normalizedUrl!;
      finalIconSource = 'URL';
    }
  }

  // Validate Banner
  let finalBannerUrl: string | null = null;
  let finalBannerSource: string = bannerSource || 'URL';
  if (bannerUrl && typeof bannerUrl === 'string' && bannerUrl.trim()) {
    const trimmedBanner = bannerUrl.trim();
    if (trimmedBanner.startsWith('/uploads/')) {
      finalBannerUrl = trimmedBanner;
      finalBannerSource = 'UPLOAD';
    } else {
      const val = validateExternalImageUrl(trimmedBanner);
      if (!val.valid) {
        throw new Error(`Banner Error: ${val.error}`);
      }
      finalBannerUrl = val.normalizedUrl!;
      finalBannerSource = 'URL';
    }
  }

  // Validate animeId if supplied
  let verifiedAnimeId: string | null = null;
  if (animeId && typeof animeId === 'string') {
    const anime = await prisma.anime.findUnique({ where: { id: animeId } });
    if (anime) verifiedAnimeId = anime.id;
  }

  const baseSlug = generateSlug(name);
  let uniqueSlug = baseSlug;
  let counter = 1;

  while (await prisma.community.findUnique({ where: { slug: uniqueSlug } })) {
    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  const community = await prisma.$transaction(async (tx) => {
    const created = await tx.community.create({
      data: {
        ownerId: userId,
        name: name.trim(),
        slug: uniqueSlug,
        description: description.trim(),
        category: (category || 'INTEREST').toUpperCase(),
        visibility: (visibility || 'PUBLIC').toUpperCase(),
        iconUrl: finalIconUrl,
        iconSource: finalIconSource,
        bannerUrl: finalBannerUrl,
        bannerSource: finalBannerSource,
        animeId: verifiedAnimeId,
        memberCount: 1,
        channels: {
          create: [
            { name: 'general', slug: 'general', type: 'TEXT', position: 0 },
            { name: 'discussions', slug: 'discussions', type: 'TEXT', position: 1 },
            { name: 'off-topic', slug: 'off-topic', type: 'TEXT', position: 2 },
          ],
        },
        members: {
          create: {
            userId,
            role: 'OWNER',
            status: 'ACTIVE',
          },
        },
      },
      include: {
        channels: true,
        rules: true,
        owner: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    if (Array.isArray(rules) && rules.length > 0) {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (r.title && r.content) {
          await tx.communityRule.create({
            data: {
              communityId: created.id,
              position: i,
              title: r.title,
              content: r.content,
            },
          });
        }
      }
    }

    return created;
  });

  return community;
}

/**
 * Authenticated user joins a community
 */
export async function joinCommunity(userId: string, communitySlug: string) {
  const community = await prisma.community.findUnique({
    where: { slug: communitySlug },
  });

  if (!community) {
    throw new Error('Community not found');
  }

  // Check existing membership
  const existing = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId: community.id,
        userId,
      },
    },
  });

  if (existing && existing.status === 'ACTIVE') {
    return { success: true, message: 'Already a member', status: 'ACTIVE', role: existing.role, memberCount: community.memberCount };
  }

  if (community.visibility === 'REQUEST_TO_JOIN') {
    await prisma.communityJoinRequest.upsert({
      where: {
        communityId_userId: {
          communityId: community.id,
          userId,
        },
      },
      update: { status: 'PENDING', createdAt: new Date() },
      create: {
        communityId: community.id,
        userId,
        status: 'PENDING',
      },
    });

    return { success: true, message: 'Join request submitted', status: 'PENDING', role: 'MEMBER', memberCount: community.memberCount };
  }

  // Public Join inside a transaction
  const result = await prisma.$transaction(async (tx) => {
    const membership = await tx.communityMember.upsert({
      where: {
        communityId_userId: {
          communityId: community.id,
          userId,
        },
      },
      update: { status: 'ACTIVE', joinedAt: new Date() },
      create: {
        communityId: community.id,
        userId,
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    });

    const totalMembers = await tx.communityMember.count({
      where: { communityId: community.id, status: 'ACTIVE' },
    });

    await tx.community.update({
      where: { id: community.id },
      data: { memberCount: totalMembers },
    });

    await tx.activity.create({
      data: {
        userId,
        type: 'JOINED_COMMUNITY',
        metadata: JSON.stringify({ communityId: community.id, communityName: community.name, slug: community.slug }),
      },
    });

    return { membership, totalMembers };
  });

  return {
    success: true,
    status: 'ACTIVE',
    role: result.membership.role,
    memberCount: result.totalMembers,
  };
}

/**
 * Authenticated user leaves a community
 */
export async function leaveCommunity(userId: string, communitySlug: string) {
  const community = await prisma.community.findUnique({
    where: { slug: communitySlug },
  });

  if (!community) {
    throw new Error('Community not found');
  }

  if (community.ownerId === userId) {
    throw new Error('Community owner cannot leave without transferring ownership');
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.communityMember.deleteMany({
      where: {
        communityId: community.id,
        userId,
      },
    });

    const totalMembers = await tx.communityMember.count({
      where: { communityId: community.id, status: 'ACTIVE' },
    });

    await tx.community.update({
      where: { id: community.id },
      data: { memberCount: totalMembers },
    });

    return { totalMembers };
  });

  return {
    success: true,
    status: null,
    memberCount: result.totalMembers,
  };
}
