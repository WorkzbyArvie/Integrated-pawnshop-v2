import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { QueueType } from '@prisma/client';

/**
 * Decision Support — measures, predicts, and is honest about not knowing.
 *
 * The screen this replaces was labelled "Neural Engine" and computed
 * `total * 0.035` plus a 90-day age threshold. There was no model, and one of its
 * headline figures was a hardcoded string.
 *
 * Two rules govern everything here.
 *
 * **1. Nothing is invented.** Every figure returns a `basis` and a `sampleSize`
 * alongside its value. When there is not enough history the value is `null` and
 * the basis says `insufficient_history`. A dashboard that says "I don't know yet"
 * is checkable; a confident wrong number is not, and for a decision-support
 * system the second one is worthless.
 *
 * **2. Predictions are calibrated against outcomes.** The wait prediction is
 * compared against what actually happened, and the bias is reported. If the
 * prediction is systematically wrong the shop can see that, which is the whole
 * point of reporting it at all.
 *
 * A prediction is only ever built from `calledAt`, `servedAt` and `completedAt`,
 * which the queue already records for every served ticket. There is no external
 * data source and nothing to seed.
 */

const MS_PER_MINUTE = 60_000;

/**
 * Below this many observations a per-bucket average is noise, not measurement.
 * Below it the engine falls back to the per-type average; with no history at all
 * it declines to answer.
 */
const MIN_SAMPLE_SIZE = 10;

export type Basis = 'observed' | 'queue_type_average' | 'insufficient_history';

export interface Measured {
  /** Null when there is not enough history to answer. */
  value: number | null;
  basis: Basis;
  sampleSize: number;
}

export interface WaitPrediction {
  /** Estimated minutes until this ticket is called. Null when unknown. */
  minutes: Measured;
  /** Mean minutes a counter is occupied, the quantity the estimate rests on. */
  meanServiceMinutes: Measured;
  /** Tickets ahead of this one, ordered by the same rule the counter uses. */
  peopleAhead: number;
  /** Counters currently serving someone. */
  activeCounters: number;
  /** Plain-language note for the owner, safe to show verbatim. */
  explanation: string;
}

export interface DecisionSupportReport {
  pawnshopId: string;
  branchId: number | null;
  generatedAt: string;
  /** A flat "how much do I not know" summary, surfaced at the top of the panel. */
  dataQuality: {
    servedTickets: number;
    canPredictWait: boolean;
    warnings: string[];
  };
  waitPrediction: WaitPrediction;
  noShowRate: {
    overall: Measured;
    byQueueType: Array<{ queueType: string; noShows: number; notified: number; rate: number | null }>;
  };
  predictionCalibration: {
    /** Mean signed error in minutes. Positive = the engine over-promised. */
    biasMinutes: Measured;
    comparedSamples: number;
    note: string;
  };
  counterUtilisation: Array<{
    counter: string;
    served: number;
    meanServiceMinutes: number | null;
  }>;
  peakHours: Array<{ hour: number; joined: number }>;
  serviceTimeByType: Array<{ queueType: string; meanServiceMinutes: number | null; samples: number }>;
  /** Ticket-lifecycle exposure. Counts and sums read straight from the ticket
   *  table; no rate is applied and no figure is derived from a forecast. */
  lifecycleExposure: Array<{
    lifecycleStatus: string;
    tickets: number;
    principal: number;
  }>;
}

@Injectable()
export class DecisionSupportService {
  private readonly logger = new Logger(DecisionSupportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Milliseconds a counter is occupied: called -> served is walking/settling,
   *  served -> completed is the transaction itself. The latter is what limits
   *  throughput, so that is what the estimate is built on. */
  private serviceDurationMs(a: {
    servedAt: Date | null;
    completedAt: Date | null;
  }): number | null {
    if (!a.servedAt || !a.completedAt) return null;
    const ms = a.completedAt.getTime() - a.servedAt.getTime();
    // A negative or implausibly long duration is a data error, not a signal.
    if (ms < 0 || ms > 12 * 60 * MS_PER_MINUTE) return null;
    return ms;
  }

  private mean(values: number[]): number | null {
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Mean service minutes for one bucket, with the documented fallback chain.
   *
   * specific (branch + type) -> per type across the shop -> decline to answer.
   */
  private async measureServiceMinutes(
    pawnshopId: string,
    branchId: number | null,
    queueType: QueueType,
  ): Promise<Measured> {
    const where = {
      pawnshopId,
      status: 'COMPLETED' as const,
      servedAt: { not: null },
      completedAt: { not: null },
    };

    const specific = await this.prisma.queueTicket.findMany({
      where: { ...where, queueType, ...(branchId ? { branchId } : {}) },
      select: { servedAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: 'desc' },
    });

    const specificSamples = specific
      .map((t) => this.serviceDurationMs(t))
      .filter((v): v is number => v !== null)
      .map((v) => v / MS_PER_MINUTE);

    if (specificSamples.length >= MIN_SAMPLE_SIZE) {
      return {
        value: Number(this.mean(specificSamples)!.toFixed(1)),
        basis: 'observed',
        sampleSize: specificSamples.length,
      };
    }

    const byType = await this.prisma.queueTicket.findMany({
      where: { ...where, queueType },
      select: { servedAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: 'desc' },
    });

    const typeSamples = byType
      .map((t) => this.serviceDurationMs(t))
      .filter((v): v is number => v !== null)
      .map((v) => v / MS_PER_MINUTE);

    if (typeSamples.length >= MIN_SAMPLE_SIZE) {
      return {
        value: Number(this.mean(typeSamples)!.toFixed(1)),
        basis: 'queue_type_average',
        sampleSize: typeSamples.length,
      };
    }

    return { value: null, basis: 'insufficient_history', sampleSize: typeSamples.length };
  }

  /**
   * Estimates how long until `ticketId` is called.
   *
   * Uses position rather than a clock, and the caller's warning says so: the
   * alert fires on reaching the front of the queue, not on a promised time,
   * because a prediction that is wrong makes a worse promise than none.
   */
  async predictWait(
    pawnshopId: string,
    ticketId: string,
  ): Promise<WaitPrediction> {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        pawnshopId: true,
        branchId: true,
        queueType: true,
        status: true,
        priority: true,
        joinedAt: true,
      },
    });

    if (!ticket || ticket.pawnshopId !== pawnshopId) {
      return {
        minutes: { value: null, basis: 'insufficient_history', sampleSize: 0 },
        meanServiceMinutes: { value: null, basis: 'insufficient_history', sampleSize: 0 },
        peopleAhead: 0,
        activeCounters: 0,
        explanation: 'This ticket could not be found.',
      };
    }

    // Same ordering the counter uses, so "people ahead" means what the staff
    // member calling next would actually do.
    const ahead = await this.prisma.queueTicket.count({
      where: {
        pawnshopId: ticket.pawnshopId,
        status: 'WAITING',
        ...(ticket.branchId ? { branchId: ticket.branchId } : {}),
        joinedAt: { lt: ticket.joinedAt },
      },
    });

    const serving = await this.prisma.queueTicket.count({
      where: {
        pawnshopId: ticket.pawnshopId,
        status: 'SERVING',
        ...(ticket.branchId ? { branchId: ticket.branchId } : {}),
      },
    });

    // At least one counter, or the estimate is division by zero.
    const activeCounters = Math.max(1, serving);
    const meanService = await this.measureServiceMinutes(
      ticket.pawnshopId,
      ticket.branchId,
      ticket.queueType,
    );

    if (meanService.value === null) {
      return {
        minutes: { value: null, basis: 'insufficient_history', sampleSize: meanService.sampleSize },
        meanServiceMinutes: meanService,
        peopleAhead: ahead,
        activeCounters: serving,
        explanation:
          'Not enough completed tickets at this branch yet to estimate a wait. ' +
          'The shop is still building its own history.',
      };
    }

    const minutes = Math.round((ahead * meanService.value) / activeCounters);

    return {
      minutes: { value: minutes, basis: meanService.basis, sampleSize: meanService.sampleSize },
      meanServiceMinutes: meanService,
      peopleAhead: ahead,
      activeCounters: serving,
      explanation:
        `${ahead} ticket${ahead === 1 ? '' : 's'} ahead, about ` +
        `${meanService.value} min per customer across ${activeCounters} ` +
        `counter${activeCounters === 1 ? '' : 's'}, from ` +
        `${meanService.sampleSize} completed tickets.`,
    };
  }

  /** The whole panel's payload for one shop, optionally one branch. */
  async buildReport(
    pawnshopId: string,
    branchId: number | null = null,
  ): Promise<DecisionSupportReport> {
    const scope = { pawnshopId, ...(branchId ? { branchId } : {}) };
    const warnings: string[] = [];

    const completed = await this.prisma.queueTicket.findMany({
      where: { ...scope, status: 'COMPLETED' },
      select: {
        queueType: true,
        servedAt: true,
        calledAt: true,
        completedAt: true,
        counterNumber: true,
        joinedAt: true,
        notifiedAt: true,
        estimatedWaitMinutes: true,
      },
      take: 2000,
      orderBy: { completedAt: 'desc' },
    });

    // --- service time, per type -------------------------------------------
    const queueTypes: QueueType[] = [
      'PAWNING',
      'RENEWAL',
      'REDEMPTION',
      'AUCTION_INQUIRY',
      'GENERAL',
    ];

    const serviceTimeByType = await Promise.all(
      queueTypes.map(async (queueType) => {
        const measured = await this.measureServiceMinutes(pawnshopId, branchId, queueType);
        return {
          queueType,
          meanServiceMinutes: measured.value,
          samples: measured.sampleSize,
        };
      }),
    );

    // --- prediction calibration: predicted vs what actually happened ------
    // Only tickets that were given a prediction *and* were later called can be
    // compared. Everything else is excluded rather than assumed correct.
    const comparable = completed.filter(
      (t) => t.estimatedWaitMinutes != null && t.calledAt != null,
    );
    const errors = comparable
      .map((t) => {
        const actual = (t.calledAt!.getTime() - t.joinedAt.getTime()) / MS_PER_MINUTE;
        return t.estimatedWaitMinutes! - actual;
      })
      .filter((v) => Number.isFinite(v) && Math.abs(v) < 24 * 60);

    const bias = errors.length >= MIN_SAMPLE_SIZE ? this.mean(errors) : null;
    if (errors.length < MIN_SAMPLE_SIZE) {
      warnings.push(
        `Only ${errors.length} completed ticket${
          errors.length === 1 ? '' : 's'
        } carry both a wait estimate and a call time, so the estimate cannot be checked against outcomes yet.`,
      );
    }

    // --- no-show rate ------------------------------------------------------
    // A no-show is only meaningful for a customer who was warned, so the
    // denominator is notified tickets rather than every join.
    const notified = await this.prisma.queueTicket.findMany({
      where: { ...scope, notifiedAt: { not: null } },
      select: { queueType: true, status: true },
      take: 2000,
    });

    const noShowTotal = notified.filter((t) => t.status === 'NO_SHOW').length;
    const noShowRate: Measured =
      notified.length >= MIN_SAMPLE_SIZE
        ? {
            value: Number(((noShowTotal / notified.length) * 100).toFixed(1)),
            basis: 'observed',
            sampleSize: notified.length,
          }
        : { value: null, basis: 'insufficient_history', sampleSize: notified.length };

    const byQueueType = queueTypes
      .map((queueType) => {
        const rows = notified.filter((t) => t.queueType === queueType);
        const noShows = rows.filter((t) => t.status === 'NO_SHOW').length;
        return {
          queueType,
          noShows,
          notified: rows.length,
          rate:
            rows.length >= MIN_SAMPLE_SIZE
              ? Number(((noShows / rows.length) * 100).toFixed(1))
              : null,
        };
      })
      .filter((row) => row.notified > 0);

    // --- counter utilisation ----------------------------------------------
    const counterRows = completed.filter((t) => t.counterNumber);
    const counterMap = new Map<string, number[]>();
    for (const t of counterRows) {
      const key = t.counterNumber!;
      const duration = this.serviceDurationMs(t);
      if (duration === null) continue;
      if (!counterMap.has(key)) counterMap.set(key, []);
      counterMap.get(key)!.push(duration / MS_PER_MINUTE);
    }
    const counterUtilisation = [...counterMap.entries()]
      .map(([counter, values]) => ({
        counter,
        served: values.length,
        meanServiceMinutes: Number(this.mean(values)!.toFixed(1)),
      }))
      .sort((a, b) => b.served - a.served);

    // --- peak hours --------------------------------------------------------
    const hourCounts = new Array(24).fill(0);
    for (const t of completed) hourCounts[t.joinedAt.getUTCHours()] += 1;
    const peakHours = hourCounts
      .map((joined, hour) => ({ hour, joined }))
      .filter((h) => h.joined > 0);

    // --- lifecycle exposure ------------------------------------------------
    // Counts and principal read straight off the tickets. No rate is applied
    // and nothing is forecast, so this stays true even while the loan amounts
    // are still being brought under server-side control.
    const tickets = await this.prisma.ticket.findMany({
      where: { pawnshopId },
      select: { lifecycleStatus: true, loanAmount: true },
    });
    const exposureMap = new Map<string, { tickets: number; principal: number }>();
    for (const t of tickets) {
      const entry = exposureMap.get(t.lifecycleStatus) ?? { tickets: 0, principal: 0 };
      entry.tickets += 1;
      entry.principal += Number(t.loanAmount) || 0;
      exposureMap.set(t.lifecycleStatus, entry);
    }
    const lifecycleExposure = [...exposureMap.entries()]
      .map(([lifecycleStatus, v]) => ({ lifecycleStatus, ...v }))
      .sort((a, b) => b.principal - a.principal);

    if (completed.length < MIN_SAMPLE_SIZE) {
      warnings.push(
        `${completed.length} completed ticket${
          completed.length === 1 ? '' : 's'
        } on record. Prediction needs ${MIN_SAMPLE_SIZE} before it will produce a number.`,
      );
    }

    return {
      pawnshopId,
      branchId,
      generatedAt: new Date().toISOString(),
      dataQuality: {
        servedTickets: completed.length,
        canPredictWait: completed.length >= MIN_SAMPLE_SIZE,
        warnings,
      },
      waitPrediction: {
        minutes: { value: null, basis: 'insufficient_history', sampleSize: completed.length },
        meanServiceMinutes: {
          value: null,
          basis: 'insufficient_history',
          sampleSize: completed.length,
        },
        peopleAhead: 0,
        activeCounters: 0,
        explanation:
          'No waiting tickets, so there is no wait to estimate. The panel reports shop-wide figures below.',
      },
      noShowRate: { overall: noShowRate, byQueueType },
      predictionCalibration: {
        biasMinutes: {
          value: bias === null ? null : Number(bias.toFixed(1)),
          basis: errors.length >= MIN_SAMPLE_SIZE ? 'observed' : 'insufficient_history',
          sampleSize: errors.length,
        },
        comparedSamples: errors.length,
        note:
          bias === null
            ? 'Not enough history to check the estimate against outcomes yet.'
            : bias > 0
              ? 'The estimate tends to run long by this much. Customers are being told to wait longer than they actually do.'
              : bias < 0
                ? 'The estimate tends to run short by this much. Customers are arriving later than the estimate implies.'
                : 'The estimate matches observed outcomes closely.',
      },
      counterUtilisation,
      peakHours,
      serviceTimeByType,
      lifecycleExposure,
    };
  }
}
