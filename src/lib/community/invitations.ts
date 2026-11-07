/**
 * Members-only community invitations (Creator Mode, 2026-10-24).
 *
 * An invitation is two things the creator shares together:
 *   - a URL, /community/invite/<invitationId> — identifies the invitation,
 *     grants nothing by itself;
 *   - an access key, 120 random bits from crypto.randomBytes, shown to the
 *     owner ONCE when issued or rotated. Only SHA-256(key) is stored
 *     (`CommunityInvite.keyHash`); the plaintext never goes to the database,
 *     logs, events or any later API response.
 *
 * Redeeming checks, inside one transaction with the invitation row locked
 * (SELECT … FOR UPDATE, so concurrent uses can't overshoot maxUses): the
 * invitation is active (not revoked, not expired, not used up), the key's
 * hash matches (constant-time compare), the community is still private and
 * not deleted, and the user isn't banned. Only then is the membership
 * written; an existing active member is told so and nothing changes.
 * Wrong keys get one generic message. Rate limited per user and per
 * invitation (RateLimiter INVITE_KEY).
 *
 * Revoking or rotating stops the old key immediately but never removes
 * existing members — that's a separate, explicit member-removal action.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma';
import { hasMinRole } from '../roles';
import { RateLimiter } from '../security/rateLimiter';

export class InviteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Crockford base32: no I, L, O, U — easy to read aloud and type. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 15; // 120 bits → 24 characters

/** e.g. "K7QM-2X9P-AB3D-…" (6 groups of 4). */
export function generateAccessKey(): string {
  const bytes = randomBytes(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{1,4}/g)!.join('-');
}

/** Case-insensitive, dashes/spaces ignored, and the usual look-alikes mapped. */
export function normalizeAccessKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function hashAccessKey(key: string): string {
  return createHash('sha256').update(`otakuva-invite-v1:${normalizeAccessKey(key)}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export type InvitationStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'USED_UP';

function statusOf(inv: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; uses: number; keyHash: string | null }): InvitationStatus {
  if (inv.revokedAt || !inv.keyHash) return 'REVOKED';
  if (inv.expiresAt && inv.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  if (inv.maxUses != null && inv.uses >= inv.maxUses) return 'USED_UP';
  return 'ACTIVE';
}

export const invitationPath = (id: string) => `/community/invite/${id}`;

export interface InvitationDto {
  id: string;
  path: string;
  status: InvitationStatus;
  keyHint: string | null;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function toDto(inv: any): InvitationDto {
  return {
    id: inv.id,
    path: invitationPath(inv.id),
    status: statusOf(inv),
    keyHint: inv.keyHint ?? null,
    uses: inv.uses,
    maxUses: inv.maxUses ?? null,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
    lastUsedAt: inv.lastUsedAt ? inv.lastUsedAt.toISOString() : null,
  };
}

/** The community, if `userId` may manage its invitations: its owner, or a platform ADMIN. */
export async function requireManageableCommunity(userId: string, communityIdOrSlug: string) {
  const [user, community] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.community.findFirst({
      where: { OR: [{ id: communityIdOrSlug }, { slug: communityIdOrSlug }], status: { not: 'DELETED' } },
      select: { id: true, slug: true, name: true, ownerId: true, visibility: true, joinPolicy: true },
    }),
  ]);
  if (!community) throw new InviteError(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  const isAdmin = Boolean(user && hasMinRole(user.role, 'ADMIN'));
  if (community.ownerId !== userId && !isAdmin) {
    // Same answer as "not found" for anyone who isn't the owner.
    throw new InviteError(404, 'COMMUNITY_NOT_FOUND', 'Community not found.');
  }
  return community;
}

function cleanLimits(opts: { expiresAt?: unknown; maxUses?: unknown }) {
  let expiresAt: Date | null = null;
  if (opts.expiresAt != null && opts.expiresAt !== '') {
    const d = new Date(String(opts.expiresAt));
    if (isNaN(+d) || d.getTime() <= Date.now()) throw new InviteError(400, 'INVALID_EXPIRY', 'Expiry must be a date in the future.');
    expiresAt = d;
  }
  let maxUses: number | null = null;
  if (opts.maxUses != null && opts.maxUses !== '') {
    const n = Number(opts.maxUses);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new InviteError(400, 'INVALID_MAX_USES', 'Max uses must be a whole number from 1 to 100,000.');
    maxUses = n;
  }
  return { expiresAt, maxUses };
}

type Db = Pick<typeof prisma, 'communityInvite'>;

/**
 * Writes one invitation row and returns its key (the only time it exists in
 * plaintext). Takes a transaction client so community creation can issue the
 * first invitation atomically. Callers check permission first.
 */
export async function issueInvitation(
  db: Db,
  input: { communityId: string; userId: string; expiresAt?: unknown; maxUses?: unknown }
): Promise<{ invitation: InvitationDto; key: string }> {
  const { expiresAt, maxUses } = cleanLimits(input);
  const key = generateAccessKey();
  const row = await db.communityInvite.create({
    data: {
      communityId: input.communityId,
      createdBy: input.userId,
      // Legacy unique column; an opaque random value that grants nothing.
      token: randomBytes(24).toString('base64url'),
      keyHash: hashAccessKey(key),
      keyHint: key.slice(-4),
      expiresAt,
      maxUses,
    },
  });
  return { invitation: toDto(row), key };
}

/** New invitation for a private community. Returns the key once — it can't be read again. */
export async function createInvitation(
  userId: string,
  communityIdOrSlug: string,
  opts: { expiresAt?: unknown; maxUses?: unknown } = {}
): Promise<{ invitation: InvitationDto; key: string }> {
  const community = await requireManageableCommunity(userId, communityIdOrSlug);
  if (community.visibility !== 'PRIVATE') {
    throw new InviteError(400, 'NOT_PRIVATE', 'Invitations are for members-only communities.');
  }
  return issueInvitation(prisma, { communityId: community.id, userId, ...opts });
}

export async function listInvitations(userId: string, communityIdOrSlug: string): Promise<InvitationDto[]> {
  const community = await requireManageableCommunity(userId, communityIdOrSlug);
  const rows = await prisma.communityInvite.findMany({
    where: { communityId: community.id, keyHash: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map(toDto);
}

async function requireOwnInvitation(userId: string, communityIdOrSlug: string, invitationId: string) {
  const community = await requireManageableCommunity(userId, communityIdOrSlug);
  const inv = await prisma.communityInvite.findFirst({ where: { id: invitationId, communityId: community.id, keyHash: { not: null } } });
  if (!inv) throw new InviteError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
  return inv;
}

/** New key, same link. The old key stops working immediately. */
export async function rotateInvitationKey(userId: string, communityIdOrSlug: string, invitationId: string) {
  const inv = await requireOwnInvitation(userId, communityIdOrSlug, invitationId);
  if (inv.revokedAt) throw new InviteError(409, 'INVITATION_REVOKED', 'This invitation is revoked. Create a new one instead.');
  const key = generateAccessKey();
  const row = await prisma.communityInvite.update({
    where: { id: inv.id },
    data: { keyHash: hashAccessKey(key), keyHint: key.slice(-4) },
  });
  return { invitation: toDto(row), key };
}

/** Stops the invitation for good. Existing members stay. */
export async function revokeInvitation(userId: string, communityIdOrSlug: string, invitationId: string) {
  const inv = await requireOwnInvitation(userId, communityIdOrSlug, invitationId);
  const row = inv.revokedAt ? inv : await prisma.communityInvite.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  return toDto(row);
}

/**
 * What anyone opening the link may see: whether it's usable and, only if
 * it is, the community's name and icon. Never posts, members or settings.
 */
export async function getInvitationPreview(invitationId: string): Promise<
  { status: 'ACTIVE'; community: { name: string; iconUrl: string | null } } | { status: 'INACTIVE' }
> {
  const inv = await prisma.communityInvite.findUnique({
    where: { id: invitationId },
    include: { community: { select: { name: true, iconUrl: true, visibility: true, status: true } } },
  });
  if (!inv || statusOf(inv) !== 'ACTIVE' || inv.community.status === 'DELETED' || inv.community.visibility !== 'PRIVATE') {
    return { status: 'INACTIVE' };
  }
  return { status: 'ACTIVE', community: { name: inv.community.name, iconUrl: inv.community.iconUrl } };
}

const GENERIC_INACTIVE = 'This invitation is no longer active. Ask the creator for a new link and key.';
const GENERIC_WRONG_KEY = "That key doesn't match this invitation.";

/** Join a members-only community with its invitation link + key. */
export async function redeemInvitation(
  userId: string,
  invitationId: string,
  rawKey: unknown
): Promise<{ joined: boolean; alreadyMember: boolean; slug: string }> {
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > 100) {
    throw new InviteError(400, 'KEY_REQUIRED', 'Enter the access key you were given.');
  }
  for (const id of [`user:${userId}`, `invite:${invitationId}`]) {
    const limit = await RateLimiter.check('INVITE_KEY', id, id.startsWith('invite:') ? { maxRequests: 30 } : undefined);
    if (!limit.allowed) {
      throw new InviteError(429, 'TOO_MANY_ATTEMPTS', `Too many attempts. Try again in ${Math.ceil((limit.retryAfterSec ?? 60) / 60)} min.`);
    }
  }
  const submittedHash = hashAccessKey(rawKey);

  return prisma.$transaction(async (tx) => {
    // Lock the invitation row so concurrent redemptions are serialised.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CommunityInvite" WHERE "id" = ${invitationId} FOR UPDATE`;
    if (locked.length === 0) throw new InviteError(410, 'INVITATION_INACTIVE', GENERIC_INACTIVE);
    const inv = await tx.communityInvite.findUnique({
      where: { id: invitationId },
      include: { community: { select: { id: true, slug: true, visibility: true, status: true, ownerId: true } } },
    });
    if (!inv || statusOf(inv) !== 'ACTIVE' || inv.community.status === 'DELETED' || inv.community.visibility !== 'PRIVATE') {
      throw new InviteError(410, 'INVITATION_INACTIVE', GENERIC_INACTIVE);
    }
    if (!inv.keyHash || !sameHash(inv.keyHash, submittedHash)) {
      throw new InviteError(403, 'WRONG_KEY', GENERIC_WRONG_KEY);
    }

    const communityId = inv.community.id;
    const ban = await tx.communityBan.findUnique({ where: { communityId_userId: { communityId, userId } } });
    if (ban && (!ban.expiresAt || ban.expiresAt.getTime() > Date.now())) {
      throw new InviteError(403, 'BANNED', 'You can’t join this community.');
    }

    const existing = await tx.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } } });
    if (inv.community.ownerId === userId || existing?.status === 'ACTIVE') {
      return { joined: false, alreadyMember: true, slug: inv.community.slug };
    }
    if (existing?.status === 'BANNED') throw new InviteError(403, 'BANNED', 'You can’t join this community.');

    await tx.communityMember.upsert({
      where: { communityId_userId: { communityId, userId } },
      update: { status: 'ACTIVE', role: 'MEMBER', joinedAt: new Date() },
      create: { communityId, userId, role: 'MEMBER', status: 'ACTIVE' },
    });
    await tx.communityInvite.update({ where: { id: inv.id }, data: { uses: { increment: 1 }, lastUsedAt: new Date() } });
    const members = await tx.communityMember.count({ where: { communityId, status: 'ACTIVE' } });
    await tx.community.update({ where: { id: communityId }, data: { memberCount: members } });
    // A pending join request (from before it went private) is now moot.
    await tx.communityJoinRequest.deleteMany({ where: { communityId, userId } });
    return { joined: true, alreadyMember: false, slug: inv.community.slug };
  });
}
