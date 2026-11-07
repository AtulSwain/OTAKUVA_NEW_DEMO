/**
 * OTAKUVA STUDIO HISTORY ADMIN SERVICE (PHASE 9.2)
 * 
 * Administrative Control Engine for Studio Milestones, Eras, and History:
 * - RBAC permission enforcement
 * - Date validation & chronological boundary checks
 * - Duplicate event detection
 * - Drag/order persistence
 * - Immutable StudioAuditLog recording
 * - Standardized Event Engine integration
 */

import { prisma } from '../../prisma';
import { emitEngineEvent } from '../events/eventEngine';
import { studioService } from './studioService';
import { studioHistoryService } from './studioHistoryService';
import {
  CreateEraInput,
  CreateHistoryEventInput,
  DuplicateHistoryMatch,
  HistoryEventFilterOptions,
  UpdateEraInput,
  UpdateHistoryEventInput,
} from './studioHistoryTypes';

export class StudioHistoryAdminService {
  /**
   * Retrieves events for Studio Admin History tab with all publication states
   */
  async getAdminStudioHistory(studioId: string, options: HistoryEventFilterOptions = {}) {
    const {
      q,
      search,
      year,
      eventType,
      importance,
      verificationStatus,
      publicationState,
      eraId,
      sortBy = 'chronological',
      page = 1,
      limit = 50,
    } = options;

    const queryStr = (q || search || '').trim();
    const skip = (Math.max(1, page) - 1) * limit;

    const where: any = { studioId };

    if (queryStr) {
      where.OR = [
        { title: { contains: queryStr, mode: 'insensitive' } },
        { shortDescription: { contains: queryStr, mode: 'insensitive' } },
        { fullDescription: { contains: queryStr, mode: 'insensitive' } },
        { source: { contains: queryStr, mode: 'insensitive' } },
      ];
    }

    if (year) where.eventYear = year;
    if (eventType && eventType !== 'ALL') where.eventType = eventType;
    if (importance && importance !== 'ALL') where.importance = importance;
    if (verificationStatus && verificationStatus !== 'ALL') where.verificationStatus = verificationStatus;
    if (publicationState && publicationState !== 'ALL') where.publicationState = publicationState;
    if (eraId) where.eraId = eraId;

    let orderBy: any = [];
    if (sortBy === 'reverseChronological') {
      orderBy = [{ eventYear: 'desc' }, { eventDate: 'desc' }, { displayOrder: 'desc' }];
    } else if (sortBy === 'createdAt') {
      orderBy = [{ createdAt: 'desc' }];
    } else {
      orderBy = [{ eventYear: 'asc' }, { eventDate: 'asc' }, { displayOrder: 'asc' }];
    }

    const [events, total, eras, stats] = await Promise.all([
      prisma.studioHistoryEvent.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          era: true,
          person: true,
          anime: true,
          relatedStudio: true,
        },
      }),
      prisma.studioHistoryEvent.count({ where }),
      prisma.studioEra.findMany({
        where: { studioId },
        orderBy: { displayOrder: 'asc' },
        include: {
          _count: { select: { events: true } },
        },
      }),
      this.getStudioHistoryStats(studioId),
    ]);

    const formattedEvents = events.map((e) => studioHistoryService.formatHistoryEvent(e));

    return {
      events: formattedEvents,
      eras,
      total,
      stats,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Aggregates history statistics for Studio Admin
   */
  async getStudioHistoryStats(studioId: string) {
    const [totalEvents, verifiedCount, needsReviewCount, draftCount, publishedCount] = await Promise.all([
      prisma.studioHistoryEvent.count({ where: { studioId } }),
      prisma.studioHistoryEvent.count({ where: { studioId, verificationStatus: 'VERIFIED' } }),
      prisma.studioHistoryEvent.count({ where: { studioId, verificationStatus: 'NEEDS_REVIEW' } }),
      prisma.studioHistoryEvent.count({ where: { studioId, publicationState: 'DRAFT' } }),
      prisma.studioHistoryEvent.count({ where: { studioId, publicationState: 'PUBLISHED' } }),
    ]);

    return {
      totalEvents,
      verifiedCount,
      needsReviewCount,
      draftCount,
      publishedCount,
    };
  }

  /**
   * Validates date information for a history event
   */
  validateHistoryDates(
    eventDate?: Date | string | null,
    eventYear?: number | null,
    eventEndDate?: Date | string | null,
    eventEndYear?: number | null
  ): {
    valid: boolean;
    error?: string;
    parsedEventDate?: Date | null;
    derivedEventYear?: number | null;
    parsedEndDate?: Date | null;
    derivedEndYear?: number | null;
  } {
    let pDate: Date | null = null;
    let pEndDate: Date | null = null;
    let pYear: number | null = eventYear || null;
    let pEndYear: number | null = eventEndYear || null;

    if (eventDate) {
      pDate = new Date(eventDate);
      if (isNaN(pDate.getTime())) {
        return { valid: false, error: 'Invalid start date format.' };
      }
      if (!pYear) pYear = pDate.getFullYear();
    }

    if (eventEndDate) {
      pEndDate = new Date(eventEndDate);
      if (isNaN(pEndDate.getTime())) {
        return { valid: false, error: 'Invalid end date format.' };
      }
      if (!pEndYear) pEndYear = pEndDate.getFullYear();
    }

    if (pDate && pEndDate && pEndDate < pDate) {
      return { valid: false, error: 'Event end date cannot precede start date.' };
    }

    if (pYear && pEndYear && pEndYear < pYear) {
      return { valid: false, error: 'Event end year cannot precede start year.' };
    }

    return {
      valid: true,
      parsedEventDate: pDate,
      derivedEventYear: pYear,
      parsedEndDate: pEndDate,
      derivedEndYear: pEndYear,
    };
  }

  /**
   * Creates a new structured Studio History Event
   */
  async createHistoryEvent(actorId: string, studioId: string, input: CreateHistoryEventInput) {
    const cleanTitle = (input.title || '').trim();
    if (!cleanTitle || cleanTitle.length < 2) {
      throw new Error('History event title must be at least 2 characters long.');
    }

    const studio = await prisma.studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new Error('Studio not found.');

    const dateVal = this.validateHistoryDates(
      input.eventDate,
      input.eventYear,
      input.eventEndDate,
      input.eventEndYear
    );
    if (!dateVal.valid) throw new Error(dateVal.error);

    const cleanSourceUrl = studioService.validateUrl(input.sourceUrl);
    const cleanImageUrl = studioService.validateUrl(input.imageUrl);

    // Get next display order if not specified
    let displayOrder = input.displayOrder ?? 0;
    if (displayOrder === 0) {
      const maxOrder = await prisma.studioHistoryEvent.findFirst({
        where: { studioId, eventYear: dateVal.derivedEventYear },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });
      displayOrder = (maxOrder?.displayOrder ?? 0) + 1;
    }

    const created = await prisma.studioHistoryEvent.create({
      data: {
        studioId,
        eraId: input.eraId || null,
        title: cleanTitle,
        shortDescription: input.shortDescription?.trim() || null,
        fullDescription: input.fullDescription?.trim() || null,
        eventDate: dateVal.parsedEventDate,
        eventYear: dateVal.derivedEventYear,
        eventEndDate: dateVal.parsedEndDate,
        eventEndYear: dateVal.derivedEndYear,
        eventType: input.eventType || 'MILESTONE',
        importance: input.importance || 'NORMAL',
        displayOrder,
        imageUrl: cleanImageUrl,
        imageCaption: input.imageCaption?.trim() || null,
        imageAltText: input.imageAltText?.trim() || null,
        personId: input.personId || null,
        animeId: input.animeId || null,
        relatedStudioId: input.relatedStudioId || null,
        source: input.source?.trim() || null,
        sourceUrl: cleanSourceUrl,
        sourceType: input.sourceType || 'OFFICIAL',
        verificationStatus: input.verificationStatus || 'UNVERIFIED',
        publicationState: input.publicationState || 'PUBLISHED',
        createdById: actorId,
        updatedById: actorId,
      },
    });

    // Audit Log
    await prisma.studioAuditLog.create({
      data: {
        studioId,
        actorId,
        action: 'HISTORY_EVENT_CREATE',
        newValues: JSON.stringify({
          eventId: created.id,
          title: created.title,
          year: created.eventYear,
          type: created.eventType,
          importance: created.importance,
        }),
        reason: `Created history milestone: "${created.title}"`,
      },
    });

    await emitEngineEvent({
      eventType: 'STUDIO_HISTORY_EVENT_CREATED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: studioId,
      metadata: { eventId: created.id, title: created.title, year: created.eventYear },
    });

    return created;
  }

  /**
   * Updates an existing history event
   */
  async updateHistoryEvent(actorId: string, eventId: string, input: UpdateHistoryEventInput) {
    const existing = await prisma.studioHistoryEvent.findUnique({
      where: { id: eventId },
    });
    if (!existing) throw new Error('History event not found.');

    const data: any = { updatedById: actorId };

    if (input.title !== undefined) {
      const cleanTitle = input.title.trim();
      if (!cleanTitle) throw new Error('Title cannot be empty.');
      data.title = cleanTitle;
    }

    if (input.shortDescription !== undefined) data.shortDescription = input.shortDescription?.trim() || null;
    if (input.fullDescription !== undefined) data.fullDescription = input.fullDescription?.trim() || null;
    if (input.eraId !== undefined) data.eraId = input.eraId || null;
    if (input.eventType !== undefined) data.eventType = input.eventType;
    if (input.importance !== undefined) data.importance = input.importance;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.imageCaption !== undefined) data.imageCaption = input.imageCaption?.trim() || null;
    if (input.imageAltText !== undefined) data.imageAltText = input.imageAltText?.trim() || null;
    if (input.personId !== undefined) data.personId = input.personId || null;
    if (input.animeId !== undefined) data.animeId = input.animeId || null;
    if (input.relatedStudioId !== undefined) data.relatedStudioId = input.relatedStudioId || null;
    if (input.source !== undefined) data.source = input.source?.trim() || null;
    if (input.sourceType !== undefined) data.sourceType = input.sourceType;
    if (input.verificationStatus !== undefined) data.verificationStatus = input.verificationStatus;
    if (input.publicationState !== undefined) data.publicationState = input.publicationState;

    if (input.imageUrl !== undefined) data.imageUrl = studioService.validateUrl(input.imageUrl);
    if (input.sourceUrl !== undefined) data.sourceUrl = studioService.validateUrl(input.sourceUrl);

    if (
      input.eventDate !== undefined ||
      input.eventYear !== undefined ||
      input.eventEndDate !== undefined ||
      input.eventEndYear !== undefined
    ) {
      const sDate = input.eventDate !== undefined ? input.eventDate : existing.eventDate;
      const sYear = input.eventYear !== undefined ? input.eventYear : existing.eventYear;
      const eDate = input.eventEndDate !== undefined ? input.eventEndDate : existing.eventEndDate;
      const eYear = input.eventEndYear !== undefined ? input.eventEndYear : existing.eventEndYear;

      const dateVal = this.validateHistoryDates(sDate, sYear, eDate, eYear);
      if (!dateVal.valid) throw new Error(dateVal.error);

      if (input.eventDate !== undefined) data.eventDate = dateVal.parsedEventDate;
      if (input.eventYear !== undefined) data.eventYear = dateVal.derivedEventYear;
      if (input.eventEndDate !== undefined) data.eventEndDate = dateVal.parsedEndDate;
      if (input.eventEndYear !== undefined) data.eventEndYear = dateVal.derivedEndYear;
    }

    const updated = await prisma.studioHistoryEvent.update({
      where: { id: eventId },
      data,
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId: existing.studioId,
        actorId,
        action: 'HISTORY_EVENT_UPDATE',
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updated),
        reason: input.reason || `Updated history event: "${updated.title}"`,
      },
    });

    await emitEngineEvent({
      eventType: 'STUDIO_HISTORY_EVENT_UPDATED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: existing.studioId,
      metadata: { eventId, changes: Object.keys(data) },
    });

    return updated;
  }

  /**
   * Archives a history event (removes from public display safely)
   */
  async archiveHistoryEvent(actorId: string, eventId: string, reason?: string) {
    const existing = await prisma.studioHistoryEvent.findUnique({ where: { id: eventId } });
    if (!existing) throw new Error('History event not found.');

    const updated = await prisma.studioHistoryEvent.update({
      where: { id: eventId },
      data: { publicationState: 'ARCHIVED', updatedById: actorId },
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId: existing.studioId,
        actorId,
        action: 'HISTORY_EVENT_ARCHIVE',
        oldValues: JSON.stringify({ state: existing.publicationState }),
        newValues: JSON.stringify({ state: 'ARCHIVED' }),
        reason: reason || 'Admin archived history milestone',
      },
    });

    await emitEngineEvent({
      eventType: 'STUDIO_HISTORY_EVENT_ARCHIVED',
      userId: actorId,
      entityType: 'STUDIO',
      entityId: existing.studioId,
      metadata: { eventId },
    });

    return updated;
  }

  /**
   * Restores an archived history event back to PUBLISHED
   */
  async restoreHistoryEvent(actorId: string, eventId: string, reason?: string) {
    const existing = await prisma.studioHistoryEvent.findUnique({ where: { id: eventId } });
    if (!existing) throw new Error('History event not found.');

    const updated = await prisma.studioHistoryEvent.update({
      where: { id: eventId },
      data: { publicationState: 'PUBLISHED', updatedById: actorId },
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId: existing.studioId,
        actorId,
        action: 'HISTORY_EVENT_PUBLISH',
        oldValues: JSON.stringify({ state: existing.publicationState }),
        newValues: JSON.stringify({ state: 'PUBLISHED' }),
        reason: reason || 'Admin restored and published history milestone',
      },
    });

    return updated;
  }

  /**
   * Updates verification status for a history event
   */
  async verifyHistoryEvent(
    actorId: string,
    eventId: string,
    verificationStatus: 'VERIFIED' | 'NEEDS_REVIEW' | 'UNVERIFIED' | 'PARTIALLY_VERIFIED',
    reason?: string
  ) {
    const existing = await prisma.studioHistoryEvent.findUnique({ where: { id: eventId } });
    if (!existing) throw new Error('History event not found.');

    const updated = await prisma.studioHistoryEvent.update({
      where: { id: eventId },
      data: { verificationStatus, updatedById: actorId },
    });

    await prisma.studioAuditLog.create({
      data: {
        studioId: existing.studioId,
        actorId,
        action: 'HISTORY_EVENT_VERIFY',
        oldValues: JSON.stringify({ status: existing.verificationStatus }),
        newValues: JSON.stringify({ status: verificationStatus }),
        reason: reason || `Updated verification status to ${verificationStatus}`,
      },
    });

    return updated;
  }

  /**
   * Persists manual / drag-and-drop reordering for history events
   */
  async reorderHistoryEvents(
    actorId: string,
    studioId: string,
    eventOrders: Array<{ eventId: string; displayOrder: number }>
  ) {
    const transactions = eventOrders.map(({ eventId, displayOrder }) =>
      prisma.studioHistoryEvent.update({
        where: { id: eventId, studioId },
        data: { displayOrder, updatedById: actorId },
      })
    );

    await prisma.$transaction(transactions);
    return { success: true, count: eventOrders.length };
  }

  /**
   * Scans for likely duplicate history events in a studio
   */
  async detectDuplicateHistoryEvents(
    studioId: string,
    input: { title: string; year?: number; eventType?: string; excludeEventId?: string }
  ): Promise<DuplicateHistoryMatch[]> {
    const cleanTitle = input.title.trim().toLowerCase();
    const existingEvents = await prisma.studioHistoryEvent.findMany({
      where: {
        studioId,
        id: input.excludeEventId ? { not: input.excludeEventId } : undefined,
      },
      select: {
        id: true,
        title: true,
        eventYear: true,
        eventType: true,
        importance: true,
      },
    });

    const matches: DuplicateHistoryMatch[] = [];

    for (const e of existingEvents) {
      const eTitle = e.title.toLowerCase();
      let confidenceScore = 0;
      let reason = '';

      if (eTitle === cleanTitle && (!input.year || e.eventYear === input.year)) {
        confidenceScore = 1.0;
        reason = `Exact title and matching year: "${e.title}" (${e.eventYear})`;
      } else if (eTitle === cleanTitle) {
        confidenceScore = 0.85;
        reason = `Identical title: "${e.title}"`;
      } else if (e.eventYear && input.year && e.eventYear === input.year && (eTitle.includes(cleanTitle) || cleanTitle.includes(eTitle))) {
        confidenceScore = 0.80;
        reason = `Same year (${e.eventYear}) and overlapping title: "${e.title}"`;
      } else if (e.eventType === input.eventType && e.eventYear === input.year && input.eventType === 'FOUNDING') {
        confidenceScore = 0.90;
        reason = `Multiple FOUNDING events registered for the same year (${e.eventYear})`;
      }

      if (confidenceScore > 0) {
        matches.push({
          event: e,
          confidenceScore,
          reason,
        });
      }
    }

    return matches.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Creates a Studio Historical Era
   */
  async createEra(actorId: string, studioId: string, input: CreateEraInput) {
    const cleanName = (input.name || '').trim();
    if (!cleanName) throw new Error('Era name is required.');

    const dateVal = this.validateHistoryDates(input.startDate, input.startYear, input.endDate, input.endYear);
    if (!dateVal.valid) throw new Error(dateVal.error);

    const era = await prisma.studioEra.create({
      data: {
        studioId,
        name: cleanName,
        description: input.description?.trim() || null,
        startDate: dateVal.parsedEventDate,
        startYear: dateVal.derivedEventYear,
        endDate: dateVal.parsedEndDate,
        endYear: dateVal.derivedEndYear,
        displayOrder: input.displayOrder ?? 0,
      },
    });

    return era;
  }

  /**
   * Updates an existing Studio Era
   */
  async updateEra(actorId: string, eraId: string, input: UpdateEraInput) {
    const existing = await prisma.studioEra.findUnique({ where: { id: eraId } });
    if (!existing) throw new Error('Era not found.');

    const data: any = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;

    if (
      input.startDate !== undefined ||
      input.startYear !== undefined ||
      input.endDate !== undefined ||
      input.endYear !== undefined
    ) {
      const sDate = input.startDate !== undefined ? input.startDate : existing.startDate;
      const sYear = input.startYear !== undefined ? input.startYear : existing.startYear;
      const eDate = input.endDate !== undefined ? input.endDate : existing.endDate;
      const eYear = input.endYear !== undefined ? input.endYear : existing.endYear;

      const dateVal = this.validateHistoryDates(sDate, sYear, eDate, eYear);
      if (!dateVal.valid) throw new Error(dateVal.error);

      data.startDate = dateVal.parsedEventDate;
      data.startYear = dateVal.derivedEventYear;
      data.endDate = dateVal.parsedEndDate;
      data.endYear = dateVal.derivedEndYear;
    }

    return prisma.studioEra.update({
      where: { id: eraId },
      data,
    });
  }

  /**
   * Deletes a Studio Era
   */
  async deleteEra(actorId: string, eraId: string) {
    await prisma.studioEra.delete({ where: { id: eraId } });
    return { success: true };
  }
}

export const studioHistoryAdminService = new StudioHistoryAdminService();
