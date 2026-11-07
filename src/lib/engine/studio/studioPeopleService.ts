/**
 * OTAKUVA STUDIO PEOPLE & STAFF INTELLIGENCE SERVICE (PHASE 9.4)
 * 
 * Connects Studios, People, and Anime Projects:
 * - Reuses canonical Person entity without duplication
 * - Distinguishes active vs. former staff & tenure years
 * - Links Studio -> Person -> Anime via canonical AnimeStaff graph
 * - Supports founders, directors, producers, animators, and key creators
 * - Admin staff management, verification, and audit logging
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';

export type StudioStaffRole =
  | 'FOUNDER'
  | 'CO_FOUNDER'
  | 'EXECUTIVE'
  | 'CEO'
  | 'PRESIDENT'
  | 'DIRECTOR'
  | 'PRODUCER'
  | 'ANIMATOR'
  | 'ARTIST'
  | 'DESIGNER'
  | 'WRITER'
  | 'KEY_STAFF'
  | 'STAFF'
  | 'OTHER';

export interface StudioPeopleFilterOptions {
  role?: string; // 'ALL', 'FOUNDER', 'DIRECTOR', 'PRODUCER', 'LEADERSHIP', etc.
  isCurrent?: boolean;
  q?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface LinkPersonToStudioInput {
  personId: string;
  role: StudioStaffRole | string;
  tenureStartYear?: number | null;
  tenureEndYear?: number | null;
  isCurrent?: boolean;
  notes?: string | null;
}

export class StudioPeopleService {
  /**
   * Resolves a studio record by slug, ID, or name
   */
  async resolveStudio(studioSlugOrId: string) {
    return prisma.studio.findFirst({
      where: {
        OR: [
          { slug: studioSlugOrId },
          { id: studioSlugOrId },
          { name: studioSlugOrId },
        ],
      },
      select: { id: true, name: true, slug: true },
    });
  }

  /**
   * Retrieves all people/staff associated with a studio, including their notable studio productions
   */
  async getStudioPeople(studioSlugOrId: string, options: StudioPeopleFilterOptions = {}) {
    const studio = await this.resolveStudio(studioSlugOrId);
    if (!studio) {
      return { studio: null, people: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    }

    const { role, isCurrent, q, search, page = 1, limit = 50 } = options;
    const queryStr = (q || search || '').trim().toLowerCase();
    const skip = (Math.max(1, page) - 1) * limit;

    const where: any = { studioId: studio.id };

    if (role && role !== 'ALL') {
      if (role === 'LEADERSHIP') {
        where.role = { in: ['FOUNDER', 'CO_FOUNDER', 'CEO', 'PRESIDENT', 'EXECUTIVE'] };
      } else {
        where.role = role;
      }
    }

    if (typeof isCurrent === 'boolean') {
      where.isCurrent = isCurrent;
    }

    if (queryStr) {
      where.person = {
        OR: [
          { name: { contains: queryStr, mode: 'insensitive' } },
          { nameKanji: { contains: queryStr, mode: 'insensitive' } },
          { about: { contains: queryStr, mode: 'insensitive' } },
        ],
      };
    }

    // Get studio anime IDs to resolve studio-specific anime projects for each person
    const studioAnimeRels = await prisma.animeStudio.findMany({
      where: { studioId: studio.id },
      select: { animeId: true },
    });
    const studioAnimeIds = studioAnimeRels.map((r) => r.animeId);

    const [staffRelations, total] = await Promise.all([
      prisma.studioPerson.findMany({
        where,
        orderBy: [{ isCurrent: 'desc' }, { tenureStartYear: 'asc' }],
        skip,
        take: limit,
        include: {
          person: {
            include: {
              staffRoles: {
                where: { animeId: { in: studioAnimeIds } },
                include: {
                  anime: {
                    select: {
                      id: true,
                      canonicalTitle: true,
                      slug: true,
                      posterUrl: true,
                      score: true,
                      year: true,
                      type: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.studioPerson.count({ where }),
    ]);

    const formatted = staffRelations.map((rel) => {
      const p = rel.person;
      // Deduplicate studio-specific projects this person worked on
      const notableProjectsMap = new Map();
      for (const sr of p.staffRoles || []) {
        if (sr.anime && !notableProjectsMap.has(sr.anime.id)) {
          notableProjectsMap.set(sr.anime.id, {
            ...sr.anime,
            staffRole: sr.role,
          });
        }
      }

      return {
        id: rel.id,
        studioId: rel.studioId,
        personId: rel.personId,
        role: rel.role,
        tenureStartYear: rel.tenureStartYear,
        tenureEndYear: rel.tenureEndYear,
        tenureDisplay: rel.tenureStartYear
          ? rel.isCurrent
            ? `${rel.tenureStartYear}–Present`
            : rel.tenureEndYear
            ? `${rel.tenureStartYear}–${rel.tenureEndYear}`
            : `${rel.tenureStartYear}`
          : 'Tenure Unknown',
        isCurrent: rel.isCurrent,
        notes: rel.notes,
        person: {
          id: p.id,
          name: p.name,
          slug: p.slug,
          nameKanji: p.nameKanji,
          about: p.about,
          birthday: p.birthday,
          website: p.website,
          imageUrl: p.imageUrl,
        },
        studioProjects: Array.from(notableProjectsMap.values()),
        createdAt: rel.createdAt,
        updatedAt: rel.updatedAt,
      };
    });

    return {
      studio,
      people: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Links a canonical Person entity to a Studio (Admin)
   */
  async linkPersonToStudio(actorId: string, studioId: string, input: LinkPersonToStudioInput) {
    const { personId, role, tenureStartYear, tenureEndYear, isCurrent = false, notes } = input;

    const [studio, person] = await Promise.all([
      prisma.studio.findUnique({ where: { id: studioId } }),
      prisma.person.findUnique({ where: { id: personId } }),
    ]);

    if (!studio) throw new Error('Studio not found.');
    if (!person) throw new Error('Person not found.');

    const cleanRole = (role || 'STAFF').trim().toUpperCase();

    const relation = await prisma.studioPerson.upsert({
      where: {
        studioId_personId_role: {
          studioId,
          personId,
          role: cleanRole,
        },
      },
      create: {
        studioId,
        personId,
        role: cleanRole,
        tenureStartYear: tenureStartYear || null,
        tenureEndYear: tenureEndYear || null,
        isCurrent,
        notes: notes?.trim() || null,
      },
      update: {
        tenureStartYear: tenureStartYear !== undefined ? tenureStartYear : undefined,
        tenureEndYear: tenureEndYear !== undefined ? tenureEndYear : undefined,
        isCurrent: isCurrent !== undefined ? isCurrent : undefined,
        notes: notes !== undefined ? (notes?.trim() || null) : undefined,
      },
    });

    // Record Audit Log
    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'PERSON_LINK',
        newValues: JSON.stringify({ personId, personName: person.name, role: cleanRole, isCurrent }),
        reason: `Linked staff member: "${person.name}" as ${cleanRole}`,
      },
    });

    if (cleanRole === 'FOUNDER' || cleanRole === 'CO_FOUNDER') {
      await emitEngineEvent({
        eventType: 'STUDIO_FOUNDER_LINKED',
        userId: actorId,
        entityType: 'STUDIO',
        entityId: studioId,
        metadata: { personId, role: cleanRole },
      });
    }

    return relation;
  }

  /**
   * Updates an existing StudioPerson relationship
   */
  async updateStudioPerson(
    actorId: string,
    studioId: string,
    personId: string,
    input: Partial<LinkPersonToStudioInput>
  ) {
    const existing = await prisma.studioPerson.findFirst({
      where: { studioId, personId },
    });
    if (!existing) throw new Error('Studio-Person relationship not found.');

    const data: any = {};
    if (input.role !== undefined) data.role = input.role.trim().toUpperCase();
    if (input.tenureStartYear !== undefined) data.tenureStartYear = input.tenureStartYear;
    if (input.tenureEndYear !== undefined) data.tenureEndYear = input.tenureEndYear;
    if (input.isCurrent !== undefined) data.isCurrent = input.isCurrent;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

    const updated = await prisma.studioPerson.update({
      where: { id: existing.id },
      data,
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'UPDATE',
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updated),
        reason: `Updated staff record: personId=${personId}`,
      },
    });

    return updated;
  }

  /**
   * Unlinks a Person from a Studio without deleting the canonical Person entity
   */
  async unlinkPersonFromStudio(actorId: string, studioId: string, personId: string, reason?: string) {
    const existing = await prisma.studioPerson.findFirst({
      where: { studioId, personId },
      include: { person: { select: { name: true } } },
    });

    if (!existing) throw new Error('Studio-Person relationship not found.');

    await prisma.studioPerson.delete({
      where: { id: existing.id },
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'PERSON_UNLINK',
        oldValues: JSON.stringify(existing),
        reason: reason || `Unlinked staff member: "${existing.person.name}"`,
      },
    });

    return { success: true, unlinkedPersonId: personId };
  }
}

export const studioPeopleService = new StudioPeopleService();
