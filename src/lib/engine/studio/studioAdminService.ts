/**
 * OTAKUVA STUDIO ADMIN SERVICE (PHASE 9.1)
 * 
 * Server-Side Administrative Control Engine:
 * - RBAC permission checks for all mutations
 * - Immutable StudioAuditLog recording for all actions
 * - Admin Overrides & Override Reset System
 * - Entity Linkers (Anime-to-Studio, Person-to-Studio, Sister/Parent relationships)
 * - Safe Duplicate Detection & Non-Destructive Studio Merge Workflow
 * - Secure Image Upload with Magic Byte & Content-Type validation
 * - Standardized Event Engine stream integration
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';
import { getStorageProvider, validateImageMagicBytes, MAX_ICON_SIZE_BYTES } from '../../storage';
import { studioService } from './studioService';
import {
  AdminOverrideStudioInput,
  CreateStudioInput,
  DuplicateCandidateMatch,
  MergeStudioInput,
  StudioAuditAction,
  StudioFilterOptions,
  StudioPersonRole,
  StudioRole,
  StudioVerificationStatus,
  UpdateStudioInput,
} from './studioTypes';

export class StudioAdminService {
  /**
   * Records an immutable audit log entry
   */
  async recordAuditLog(
    studioId: string,
    actorId: string,
    action: StudioAuditAction,
    oldValues?: any,
    newValues?: any,
    reason?: string
  ) {
    try {
      await prisma.studioAuditLog.create({
        data: {
          studioId,
          actorId,
          action,
          oldValues: oldValues ? JSON.stringify(oldValues) : null,
          newValues: newValues ? JSON.stringify(newValues) : null,
          reason: reason || null,
        },
      });
    } catch (err) {
      console.error('[StudioAdminService] Failed to record audit log:', err);
    }
  }

  /**
   * Retrieves studios for Admin Table with extended filters & metrics
   */
  async getAdminStudios(options: StudioFilterOptions = {}) {
    const {
      q,
      search,
      status,
      country,
      foundedYearMin,
      foundedYearMax,
      verificationStatus,
      publicationState,
      hasImage,
      hasFounder,
      hasAnime,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      page = 1,
      limit = 25,
    } = options;

    const queryStr = (q || search || '').trim();
    const skip = (Math.max(1, page) - 1) * limit;

    const where: any = {};

    if (queryStr) {
      where.OR = [
        { name: { contains: queryStr, mode: 'insensitive' } },
        { nativeName: { contains: queryStr, mode: 'insensitive' } },
        { romanizedName: { contains: queryStr, mode: 'insensitive' } },
        { slug: { contains: queryStr.toLowerCase(), mode: 'insensitive' } },
        { alternativeNamesJson: { contains: queryStr, mode: 'insensitive' } },
        { externalId: { contains: queryStr, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (verificationStatus && verificationStatus !== 'ALL') {
      where.verificationStatus = verificationStatus;
    }

    if (publicationState && publicationState !== 'ALL') {
      where.publicationState = publicationState;
    }

    if (country) {
      where.country = country;
    }

    if (foundedYearMin || foundedYearMax) {
      where.foundedYear = {};
      if (foundedYearMin) where.foundedYear.gte = foundedYearMin;
      if (foundedYearMax) where.foundedYear.lte = foundedYearMax;
    }

    if (hasImage === true) {
      where.imageUrl = { not: null };
    }

    if (hasFounder === true) {
      where.staffRelations = { some: { role: { in: ['FOUNDER', 'CO_FOUNDER'] } } };
    }

    if (hasAnime === true) {
      where.animeStudios = { some: {} };
    }

    let orderBy: any = {};
    if (sortBy === 'name') {
      orderBy = { name: sortOrder };
    } else if (sortBy === 'foundedYear') {
      orderBy = { foundedYear: sortOrder };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === 'animeCount') {
      orderBy = { animeStudios: { _count: sortOrder } };
    } else {
      orderBy = { updatedAt: sortOrder };
    }

    const [studios, total] = await Promise.all([
      prisma.studio.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          _count: {
            select: { animeStudios: true, staffRelations: true, auditLogs: true },
          },
          staffRelations: {
            where: { role: { in: ['FOUNDER', 'CO_FOUNDER', 'CEO'] } },
            take: 2,
            include: { person: true },
          },
        },
      }),
      prisma.studio.count({ where }),
    ]);

    const formatted = studios.map((s) => ({
      id: s.id,
      name: s.name,
      displayTitle: s.adminOverrideName || s.name,
      slug: s.slug || studioService.generateSlug(s.name),
      nativeName: s.nativeName,
      status: s.status,
      foundedYear: s.adminOverrideFoundedYear || s.foundedYear,
      country: s.country,
      region: s.region,
      city: s.city,
      website: s.adminOverrideWebsite || s.website,
      imageUrl: s.adminOverrideImageUrl || s.imageUrl,
      verificationStatus: s.verificationStatus,
      publicationState: s.publicationState,
      hasAdminOverride: s.hasAdminOverride,
      totalAnimeCount: s._count.animeStudios,
      totalStaffCount: s._count.staffRelations,
      totalAuditLogsCount: s._count.auditLogs,
      founders: s.staffRelations.map((sp) => sp.person.name),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return {
      studios: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Retrieves single studio for Admin editing drawer with full relations & overrides
   */
  async getAdminStudioById(studioId: string) {
    const studio = await prisma.studio.findUnique({
      where: { id: studioId },
      include: {
        _count: {
          select: { animeStudios: true, staffRelations: true, newsRelations: true },
        },
        animeStudios: {
          include: {
            anime: {
              select: {
                id: true,
                slug: true,
                canonicalTitle: true,
                posterUrl: true,
                score: true,
                year: true,
                type: true,
              },
            },
          },
        },
        staffRelations: {
          include: {
            person: true,
          },
        },
        childRelationships: {
          include: { childStudio: true },
        },
        parentRelationships: {
          include: { parentStudio: true },
        },
        auditLogs: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { id: true, username: true, role: true } } },
        },
      },
    });

    if (!studio) return null;

    return studioService.formatStudioWithOverrides(studio);
  }

  /**
   * Creates a brand-new canonical studio profile
   */
  async createStudio(actorId: string, input: CreateStudioInput) {
    const cleanName = (input.name || '').trim();
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Studio name must be at least 2 characters long.');
    }

    // Uniqueness check for name
    const existing = await prisma.studio.findFirst({
      where: { name: cleanName },
    });
    if (existing) {
      throw new Error(`A studio with the name "${cleanName}" already exists.`);
    }

    // Slug calculation & collision avoidance
    let baseSlug = input.slug ? studioService.generateSlug(input.slug) : studioService.generateSlug(cleanName);
    let uniqueSlug = baseSlug;
    let counter = 1;
    while (await prisma.studio.findUnique({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    // Date & URL validation
    const dateVal = studioService.validateDates(input.foundedDate, input.dissolvedDate, input.foundedYear);
    if (!dateVal.valid) {
      throw new Error(dateVal.error);
    }

    const cleanWebsite = studioService.validateUrl(input.website);
    const cleanWiki = studioService.validateUrl(input.wikipediaUrl);
    const cleanTwitter = studioService.validateUrl(input.twitterUrl);
    const cleanYoutube = studioService.validateUrl(input.youtubeUrl);

    const alternativeNamesJson = input.alternativeNames && input.alternativeNames.length > 0
      ? JSON.stringify(input.alternativeNames)
      : null;

    const externalLinksJson = input.externalLinks && input.externalLinks.length > 0
      ? JSON.stringify(input.externalLinks)
      : null;

    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    const created = await prisma.studio.create({
      data: {
        name: cleanName,
        nativeName: input.nativeName?.trim() || null,
        romanizedName: input.romanizedName?.trim() || null,
        alternativeNamesJson,
        slug: uniqueSlug,
        about: input.about?.trim() || null,
        shortDescription: input.shortDescription?.trim() || null,
        descriptionSource: 'ADMIN',
        foundedDate: dateVal.parsedFoundedDate,
        foundedYear: dateVal.derivedFoundedYear,
        dissolvedDate: dateVal.parsedDissolvedDate,
        status: input.status || 'ACTIVE',
        country: input.country?.trim() || 'Japan',
        region: input.region?.trim() || null,
        city: input.city?.trim() || null,
        website: cleanWebsite,
        wikipediaUrl: cleanWiki,
        twitterUrl: cleanTwitter,
        youtubeUrl: cleanYoutube,
        imageUrl: input.imageUrl?.trim() || null,
        bannerUrl: input.bannerUrl?.trim() || null,
        verificationStatus: input.verificationStatus || 'UNVERIFIED',
        publicationState: input.publicationState || 'PUBLISHED',
        adminNotes: input.adminNotes?.trim() || null,
        externalLinksJson,
        metadataJson,
      },
    });

    await this.recordAuditLog(created.id, actorId, 'CREATE', null, created, 'Initial Studio profile creation');

    await emitEngineEvent({
      eventType: 'STUDIO_CREATED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });

    return created;
  }

  /**
   * Updates an existing studio with audit trail
   */
  async updateStudio(actorId: string, studioId: string, input: UpdateStudioInput) {
    const existing = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!existing) {
      throw new Error('Studio not found.');
    }

    const data: any = {};

    if (input.name !== undefined) {
      const cleanName = input.name.trim();
      if (!cleanName) throw new Error('Studio name cannot be blank.');
      if (cleanName !== existing.name) {
        const nameCollision = await prisma.studio.findFirst({ where: { name: cleanName, id: { not: studioId } } });
        if (nameCollision) throw new Error(`Another studio with the name "${cleanName}" already exists.`);
        data.name = cleanName;
      }
    }

    if (input.slug !== undefined) {
      const cleanSlug = studioService.generateSlug(input.slug || '');
      if (cleanSlug && cleanSlug !== existing.slug) {
        const slugCollision = await prisma.studio.findFirst({ where: { slug: cleanSlug, id: { not: studioId } } });
        if (slugCollision) throw new Error(`Slug "${cleanSlug}" is already taken by another studio.`);
        data.slug = cleanSlug;
      }
    }

    if (input.nativeName !== undefined) data.nativeName = input.nativeName?.trim() || null;
    if (input.romanizedName !== undefined) data.romanizedName = input.romanizedName?.trim() || null;
    if (input.about !== undefined) data.about = input.about?.trim() || null;
    if (input.shortDescription !== undefined) data.shortDescription = input.shortDescription?.trim() || null;
    if (input.country !== undefined) data.country = input.country?.trim() || null;
    if (input.region !== undefined) data.region = input.region?.trim() || null;
    if (input.city !== undefined) data.city = input.city?.trim() || null;
    if (input.status !== undefined) data.status = input.status;
    if (input.verificationStatus !== undefined) data.verificationStatus = input.verificationStatus;
    if (input.publicationState !== undefined) data.publicationState = input.publicationState;
    if (input.adminNotes !== undefined) data.adminNotes = input.adminNotes?.trim() || null;

    if (input.website !== undefined) data.website = studioService.validateUrl(input.website);
    if (input.wikipediaUrl !== undefined) data.wikipediaUrl = studioService.validateUrl(input.wikipediaUrl);
    if (input.twitterUrl !== undefined) data.twitterUrl = studioService.validateUrl(input.twitterUrl);
    if (input.youtubeUrl !== undefined) data.youtubeUrl = studioService.validateUrl(input.youtubeUrl);
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl?.trim() || null;
    if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl?.trim() || null;

    if (input.alternativeNames !== undefined) {
      data.alternativeNamesJson = input.alternativeNames && input.alternativeNames.length > 0
        ? JSON.stringify(input.alternativeNames)
        : null;
    }

    if (input.externalLinks !== undefined) {
      data.externalLinksJson = input.externalLinks && input.externalLinks.length > 0
        ? JSON.stringify(input.externalLinks)
        : null;
    }

    if (input.metadata !== undefined) {
      data.metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    }

    if (input.foundedDate !== undefined || input.dissolvedDate !== undefined || input.foundedYear !== undefined) {
      const fDate = input.foundedDate !== undefined ? input.foundedDate : existing.foundedDate;
      const dDate = input.dissolvedDate !== undefined ? input.dissolvedDate : existing.dissolvedDate;
      const fYear = input.foundedYear !== undefined ? input.foundedYear : existing.foundedYear;

      const dateVal = studioService.validateDates(fDate, dDate, fYear);
      if (!dateVal.valid) throw new Error(dateVal.error);

      if (input.foundedDate !== undefined) data.foundedDate = dateVal.parsedFoundedDate;
      if (input.dissolvedDate !== undefined) data.dissolvedDate = dateVal.parsedDissolvedDate;
      if (input.foundedYear !== undefined) data.foundedYear = dateVal.derivedFoundedYear;
    }

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data,
    });

    await this.recordAuditLog(studioId, actorId, 'UPDATE', existing, updated, input.reason || 'Metadata update');

    await emitEngineEvent({
      eventType: 'STUDIO_UPDATED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { changes: Object.keys(data) },
    });

    return updated;
  }

  /**
   * Applies editorial Admin Override (takes presentation priority without destroying raw provider values)
   */
  async applyAdminOverride(actorId: string, studioId: string, overrides: AdminOverrideStudioInput) {
    const existing = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!existing) throw new Error('Studio not found.');

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data: {
        adminOverrideName: overrides.name !== undefined ? overrides.name?.trim() || null : existing.adminOverrideName,
        adminOverrideDescription: overrides.about !== undefined ? overrides.about?.trim() || null : existing.adminOverrideDescription,
        adminOverrideFoundedYear: overrides.foundedYear !== undefined ? overrides.foundedYear : existing.adminOverrideFoundedYear,
        adminOverrideImageUrl: overrides.imageUrl !== undefined ? overrides.imageUrl?.trim() || null : existing.adminOverrideImageUrl,
        adminOverrideWebsite: overrides.website !== undefined ? studioService.validateUrl(overrides.website) : existing.adminOverrideWebsite,
        hasAdminOverride: true,
      },
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'OVERRIDE_APPLY',
      {
        name: existing.adminOverrideName,
        about: existing.adminOverrideDescription,
        foundedYear: existing.adminOverrideFoundedYear,
        imageUrl: existing.adminOverrideImageUrl,
      },
      {
        name: updated.adminOverrideName,
        about: updated.adminOverrideDescription,
        foundedYear: updated.adminOverrideFoundedYear,
        imageUrl: updated.adminOverrideImageUrl,
      },
      overrides.overrideReason || 'Admin applied editorial override'
    );

    return updated;
  }

  /**
   * Resets Admin Override back to canonical normalized provider data
   */
  async resetAdminOverride(actorId: string, studioId: string) {
    const existing = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!existing) throw new Error('Studio not found.');

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data: {
        adminOverrideName: null,
        adminOverrideDescription: null,
        adminOverrideFoundedYear: null,
        adminOverrideImageUrl: null,
        adminOverrideWebsite: null,
        hasAdminOverride: false,
      },
    });

    await this.recordAuditLog(studioId, actorId, 'OVERRIDE_RESET', existing, updated, 'Admin reset override to normalized values');

    return updated;
  }

  /**
   * Archives a studio (removes from public display safely without deleting records)
   */
  async archiveStudio(actorId: string, studioId: string, reason?: string) {
    const existing = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!existing) throw new Error('Studio not found.');

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data: { publicationState: 'ARCHIVED' },
    });

    await this.recordAuditLog(studioId, actorId, 'ARCHIVE', { state: existing.publicationState }, { state: 'ARCHIVED' }, reason);

    await emitEngineEvent({
      eventType: 'STUDIO_ARCHIVED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { reason },
    });

    return updated;
  }

  /**
   * Restores an archived studio back to published status
   */
  async restoreStudio(actorId: string, studioId: string, reason?: string) {
    const existing = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!existing) throw new Error('Studio not found.');

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data: { publicationState: 'PUBLISHED' },
    });

    await this.recordAuditLog(studioId, actorId, 'RESTORE', { state: existing.publicationState }, { state: 'PUBLISHED' }, reason);

    return updated;
  }

  /**
   * Links an Anime to Studio with role and primary designation
   */
  async linkAnimeToStudio(
    actorId: string,
    studioId: string,
    animeId: string,
    role: StudioRole = 'MAIN_STUDIO',
    isPrimary: boolean = true
  ) {
    const [studio, anime] = await Promise.all([
      prisma.studio.findUnique({ where: { id: studioId } }),
      prisma.anime.findUnique({ where: { id: animeId } }),
    ]);

    if (!studio) throw new Error('Studio not found.');
    if (!anime) throw new Error('Anime not found.');

    // If setting as primary, clear primary on other studios for this anime
    if (isPrimary) {
      await prisma.animeStudio.updateMany({
        where: { animeId },
        data: { isPrimary: false },
      });
    }

    const relation = await prisma.animeStudio.upsert({
      where: {
        animeId_studioId: {
          animeId,
          studioId,
        },
      },
      update: {
        role,
        isPrimary,
        isMain: role === 'MAIN_STUDIO',
      },
      create: {
        animeId,
        studioId,
        role,
        isPrimary,
        isMain: role === 'MAIN_STUDIO',
        source: 'ADMIN_OVERRIDE',
      },
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'ANIME_LINK',
      null,
      { animeId, title: anime.canonicalTitle, role, isPrimary },
      `Linked anime "${anime.canonicalTitle}" as ${role}`
    );

    await emitEngineEvent({
      eventType: 'STUDIO_ANIME_LINKED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { animeId, role, isPrimary },
    });

    return relation;
  }

  /**
   * Unlinks an Anime from Studio without deleting the Anime or Studio
   */
  async unlinkAnimeFromStudio(actorId: string, studioId: string, animeId: string) {
    const existing = await prisma.animeStudio.findUnique({
      where: { animeId_studioId: { animeId, studioId } },
      include: { anime: { select: { canonicalTitle: true } } },
    });

    if (!existing) {
      throw new Error('Studio-Anime relationship does not exist.');
    }

    await prisma.animeStudio.delete({
      where: { animeId_studioId: { animeId, studioId } },
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'ANIME_UNLINK',
      existing,
      null,
      `Unlinked anime "${existing.anime.canonicalTitle}"`
    );

    await emitEngineEvent({
      eventType: 'STUDIO_ANIME_UNLINKED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { animeId },
    });

    return { success: true };
  }

  /**
   * Links a founder or key staff Person to Studio
   */
  async linkPersonToStudio(
    actorId: string,
    studioId: string,
    personId: string,
    role: StudioPersonRole = 'FOUNDER',
    options: {
      tenureStartYear?: number;
      tenureEndYear?: number;
      isCurrent?: boolean;
      notes?: string;
    } = {}
  ) {
    const [studio, person] = await Promise.all([
      prisma.studio.findUnique({ where: { id: studioId } }),
      prisma.person.findUnique({ where: { id: personId } }),
    ]);

    if (!studio) throw new Error('Studio not found.');
    if (!person) throw new Error('Person not found.');

    const relation = await prisma.studioPerson.upsert({
      where: {
        studioId_personId_role: {
          studioId,
          personId,
          role,
        },
      },
      update: {
        tenureStartYear: options.tenureStartYear || null,
        tenureEndYear: options.tenureEndYear || null,
        isCurrent: options.isCurrent ?? false,
        notes: options.notes || null,
      },
      create: {
        studioId,
        personId,
        role,
        tenureStartYear: options.tenureStartYear || null,
        tenureEndYear: options.tenureEndYear || null,
        isCurrent: options.isCurrent ?? false,
        notes: options.notes || null,
      },
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'PERSON_LINK',
      null,
      { personId, name: person.name, role },
      `Linked staff "${person.name}" as ${role}`
    );

    await emitEngineEvent({
      eventType: 'STUDIO_FOUNDER_LINKED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { personId, role },
    });

    return relation;
  }

  /**
   * Unlinks a person from Studio
   */
  async unlinkPersonFromStudio(actorId: string, studioId: string, personId: string, role: StudioPersonRole) {
    const existing = await prisma.studioPerson.findUnique({
      where: {
        studioId_personId_role: {
          studioId,
          personId,
          role,
        },
      },
      include: { person: { select: { name: true } } },
    });

    if (!existing) {
      throw new Error('Studio-Person relationship does not exist.');
    }

    await prisma.studioPerson.delete({
      where: {
        studioId_personId_role: {
          studioId,
          personId,
          role,
        },
      },
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'PERSON_UNLINK',
      existing,
      null,
      `Unlinked staff "${existing.person.name}" (${role})`
    );

    return { success: true };
  }

  /**
   * Scans and detects duplicate studio candidates using exact and fuzzy matching
   */
  async detectDuplicates(input: {
    name: string;
    slug?: string;
    website?: string;
    excludeStudioId?: string;
  }): Promise<DuplicateCandidateMatch[]> {
    const cleanName = input.name.trim().toLowerCase();
    const cleanSlug = input.slug ? studioService.generateSlug(input.slug) : studioService.generateSlug(input.name);
    const cleanWebsite = studioService.validateUrl(input.website);

    const candidates = await prisma.studio.findMany({
      where: input.excludeStudioId ? { id: { not: input.excludeStudioId } } : {},
      include: {
        _count: { select: { animeStudios: true } },
      },
    });

    const matches: DuplicateCandidateMatch[] = [];

    for (const c of candidates) {
      const cName = c.name.toLowerCase();
      const cSlug = (c.slug || '').toLowerCase();
      const cWeb = (c.website || '').toLowerCase();

      let matchType: any = null;
      let confidenceScore = 0;
      let reason = '';

      if (cName === cleanName) {
        matchType = 'EXACT_NAME';
        confidenceScore = 1.0;
        reason = `Exact name match: "${c.name}"`;
      } else if (cSlug && cSlug === cleanSlug) {
        matchType = 'EXACT_SLUG';
        confidenceScore = 0.95;
        reason = `Exact slug match: "${c.slug}"`;
      } else if (cleanWebsite && cWeb && cleanWebsite.toLowerCase() === cWeb) {
        matchType = 'WEBSITE';
        confidenceScore = 0.90;
        reason = `Identical official website: "${c.website}"`;
      } else if (cName.includes(cleanName) || cleanName.includes(cName)) {
        matchType = 'NAME_SIMILARITY';
        confidenceScore = 0.80;
        reason = `Substring name overlap: "${c.name}"`;
      } else if (c.alternativeNamesJson && c.alternativeNamesJson.toLowerCase().includes(cleanName)) {
        matchType = 'ALT_NAME';
        confidenceScore = 0.85;
        reason = `Matches alternative name/alias of "${c.name}"`;
      }

      if (matchType) {
        matches.push({
          studio: {
            id: c.id,
            name: c.name,
            slug: c.slug || '',
            foundedYear: c.foundedYear,
            website: c.website,
            imageUrl: c.imageUrl,
            animeCount: c._count.animeStudios,
          },
          matchType,
          confidenceScore,
          reason,
        });
      }
    }

    return matches.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Performs safe atomic Studio Merge: Migrates relationships and archives secondary studio
   */
  async mergeStudios(actorId: string, input: MergeStudioInput) {
    const { primaryStudioId, secondaryStudioId, reason, keepSecondaryAsAlias = true } = input;

    if (primaryStudioId === secondaryStudioId) {
      throw new Error('Cannot merge a studio into itself.');
    }

    const [primary, secondary] = await Promise.all([
      prisma.studio.findUnique({
        where: { id: primaryStudioId },
        include: { animeStudios: true, staffRelations: true },
      }),
      prisma.studio.findUnique({
        where: { id: secondaryStudioId },
        include: { animeStudios: true, staffRelations: true, newsRelations: true },
      }),
    ]);

    if (!primary) throw new Error('Primary studio not found.');
    if (!secondary) throw new Error('Secondary studio not found.');

    const mergeResult = await prisma.$transaction(async (tx) => {
      // 1. Migrate Anime relationships
      for (const rel of secondary.animeStudios) {
        const primaryHasRelation = await tx.animeStudio.findUnique({
          where: { animeId_studioId: { animeId: rel.animeId, studioId: primaryStudioId } },
        });

        if (!primaryHasRelation) {
          await tx.animeStudio.create({
            data: {
              animeId: rel.animeId,
              studioId: primaryStudioId,
              role: rel.role,
              isPrimary: rel.isPrimary,
              isMain: rel.isMain,
              source: 'MERGE_MIGRATION',
            },
          });
        }
      }

      // 2. Migrate Staff relationships
      for (const sp of secondary.staffRelations) {
        const primaryHasStaff = await tx.studioPerson.findUnique({
          where: {
            studioId_personId_role: {
              studioId: primaryStudioId,
              personId: sp.personId,
              role: sp.role,
            },
          },
        });

        if (!primaryHasStaff) {
          await tx.studioPerson.create({
            data: {
              studioId: primaryStudioId,
              personId: sp.personId,
              role: sp.role,
              tenureStartYear: sp.tenureStartYear,
              tenureEndYear: sp.tenureEndYear,
              isCurrent: sp.isCurrent,
              notes: sp.notes,
            },
          });
        }
      }

      // 3. Migrate News Article relationships
      for (const nr of secondary.newsRelations) {
        const primaryHasNews = await tx.newsArticleStudio.findUnique({
          where: {
            articleId_studioId: {
              articleId: nr.articleId,
              studioId: primaryStudioId,
            },
          },
        });

        if (!primaryHasNews) {
          await tx.newsArticleStudio.create({
            data: {
              articleId: nr.articleId,
              studioId: primaryStudioId,
              confidenceScore: nr.confidenceScore,
              matchMethod: 'MERGE_MIGRATION',
              status: nr.status,
            },
          });
        }
      }

      // 4. Update Primary Studio aliases if requested
      if (keepSecondaryAsAlias) {
        let aliases: string[] = [];
        if (primary.alternativeNamesJson) {
          try {
            aliases = JSON.parse(primary.alternativeNamesJson);
          } catch {
            aliases = [];
          }
        }
        if (!aliases.includes(secondary.name)) {
          aliases.push(secondary.name);
          await tx.studio.update({
            where: { id: primaryStudioId },
            data: { alternativeNamesJson: JSON.stringify(aliases) },
          });
        }
      }

      // 5. Create StudioRelationship link (MERGED_INTO)
      await tx.studioRelationship.upsert({
        where: {
          parentStudioId_childStudioId_relationshipType: {
            parentStudioId: primaryStudioId,
            childStudioId: secondaryStudioId,
            relationshipType: 'MERGED_INTO',
          },
        },
        update: { notes: reason },
        create: {
          parentStudioId: primaryStudioId,
          childStudioId: secondaryStudioId,
          relationshipType: 'MERGED_INTO',
          establishedYear: new Date().getFullYear(),
          notes: reason,
        },
      });

      // 6. Transition Secondary Studio status
      const secondaryArchived = await tx.studio.update({
        where: { id: secondaryStudioId },
        data: {
          status: 'MERGED',
          publicationState: 'ARCHIVED',
          adminNotes: `Merged into "${primary.name}" (${primaryStudioId}) by Admin. Reason: ${reason}`,
        },
      });

      return { primaryId: primaryStudioId, secondaryId: secondaryStudioId, secondaryArchived };
    });

    await this.recordAuditLog(
      primaryStudioId,
      actorId,
      'MERGE',
      { secondaryId: secondary.id, secondaryName: secondary.name },
      { migratedAnimeCount: secondary.animeStudios.length, migratedStaffCount: secondary.staffRelations.length },
      `Merged secondary studio "${secondary.name}" (${secondary.id}). Reason: ${reason}`
    );

    await emitEngineEvent({
      eventType: 'STUDIO_MERGED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: primaryStudioId,
      metadata: { secondaryStudioId, secondaryName: secondary.name, reason },
    });

    return mergeResult;
  }

  /**
   * Uploads and validates studio branding media (Logo or Banner)
   */
  async uploadStudioImage(
    actorId: string,
    studioId: string,
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
    imageType: 'LOGO' | 'BANNER' = 'LOGO'
  ) {
    const studio = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new Error('Studio not found.');

    // 1. Magic bytes & MIME validation
    const magicCheck = validateImageMagicBytes(fileBuffer);
    if (!magicCheck.valid) {
      throw new Error(magicCheck.error || 'Invalid image file.');
    }

    if (fileBuffer.length > MAX_ICON_SIZE_BYTES) {
      throw new Error('Image file is too large. Maximum size is 5 MB.');
    }

    // 2. Persist with Storage Provider
    const storage = getStorageProvider();
    const uploadResult = await storage.upload({
      file: fileBuffer,
      filename,
      mimeType: magicCheck.detectedMime || mimeType,
      category: imageType === 'BANNER' ? 'studio-banner' : 'studio-logo',
      entityId: studioId,
      maxSizeBytes: MAX_ICON_SIZE_BYTES,
    });

    // 3. Update Studio record
    const updateData: any = {};
    if (imageType === 'BANNER') {
      updateData.bannerUrl = uploadResult.url;
    } else {
      updateData.imageUrl = uploadResult.url;
    }

    const updated = await prisma.studio.update({
      where: { id: studioId },
      data: updateData,
    });

    await this.recordAuditLog(
      studioId,
      actorId,
      'IMAGE_UPDATE',
      { previousUrl: imageType === 'BANNER' ? studio.bannerUrl : studio.imageUrl },
      { newUrl: uploadResult.url, type: imageType },
      `Uploaded studio ${imageType.toLowerCase()}`
    );

    await emitEngineEvent({
      eventType: 'STUDIO_IMAGE_UPDATED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { imageType, url: uploadResult.url },
    });

    return { success: true, url: uploadResult.url, studio: updated };
  }

  /**
   * Aggregates telemetry stats for Admin Studio Dashboard
   */
  async getAdminStudioStats() {
    const [
      totalStudios,
      verifiedStudios,
      activeOverrides,
      publishedStudios,
      totalAnimeProductions,
      recentAuditLogs,
    ] = await Promise.all([
      prisma.studio.count(),
      prisma.studio.count({ where: { verificationStatus: 'VERIFIED' } }),
      prisma.studio.count({ where: { hasAdminOverride: true } }),
      prisma.studio.count({ where: { publicationState: 'PUBLISHED' } }),
      prisma.animeStudio.count(),
      prisma.studioAuditLog.count(),
    ]);

    return {
      totalStudios,
      verifiedStudios,
      activeOverrides,
      publishedStudios,
      totalAnimeProductions,
      totalAuditLogs: recentAuditLogs,
    };
  }

  /**
   * Retrieves paginated audit logs for a specific studio
   */
  async getStudioAuditLogs(studioId: string, limit = 20) {
    return prisma.studioAuditLog.findMany({
      where: { studioId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { id: true, username: true, role: true } },
      },
    });
  }
}

export const studioAdminService = new StudioAdminService();
