import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, BarChart3, CheckCircle2, Database, Table2 } from 'lucide-react';
import api from '../lib/apiClient';

/* ------------------------------------------------------------------ *
 * Types — mirror backend/src/decision-support/decision-support.service.ts
 * ------------------------------------------------------------------ */

type Basis = 'observed' | 'queue_type_average' | 'insufficient_history';

interface Measured {
  value: number | null;
  basis: Basis;
  sampleSize: number;
}

interface Report {
  pawnshopId: string;
  branchId: number | null;
  generatedAt: string;
  dataQuality: { servedTickets: number; canPredictWait: boolean; warnings: string[] };
  waitPrediction: {
    minutes: Measured;
    meanServiceMinutes: Measured;
    peopleAhead: number;
    activeCounters: number;
    explanation: string;
  };
  noShowRate: {
    overall: Measured;
    byQueueType: Array<{ queueType: string; noShows: number; notified: number; rate: number | null }>;
  };
  predictionCalibration: {
    biasMinutes: Measured;
    comparedSamples: number;
    note: string;
  };
  counterUtilisation: Array<{ counter: string; served: number; meanServiceMinutes: number | null }>;
  peakHours: Array<{ hour: number; joined: number }>;
  serviceTimeByType: Array<{ queueType: string; meanServiceMinutes: number | null; samples: number }>;
  lifecycleExposure: Array<{ lifecycleStatus: string; tickets: number; principal: number }>;
}

const BASIS_LABEL: Record<Basis, string> = {
  observed: 'measured from your own completed tickets',
  queue_type_average: 'estimated from similar transaction types',
  insufficient_history: 'not enough history yet',
};

const QUEUE_TYPE_LABEL: Record<string, string> = {
  PAWNING: 'Pawning',
  RENEWAL: 'Renewal',
  REDEMPTION: 'Redemption',
  AUCTION_INQUIRY: 'Auction enquiry',
  GENERAL: 'General',
};

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;

/* ------------------------------------------------------------------ *
 * MeasuredValue
 *
 * The single most important component here. A measurement that cannot be
 * supported is rendered as an explicit "we don't know yet" with its basis and
 * sample size, never as a zero, a dash, or a plausible-looking number.
 * ------------------------------------------------------------------ */

function MeasuredValue({
  measured,
  unit = '',
  format,
}: {
  measured: Measured;
  unit?: string;
  format?: (value: number) => string;
}) {
  if (measured.value === null) {
    return (
      <div>
        <p
          className="text-[26px] font-bold leading-none"
          style={{ color: 'var(--text-dim)' }}
        >
          Not enough data
        </p>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {BASIS_LABEL[measured.basis]}.{' '}
          {measured.sampleSize > 0
            ? `${measured.sampleSize} completed ticket${measured.sampleSize === 1 ? '' : 's'} on record.`
            : 'No completed tickets on record yet.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p
        className="text-[26px] font-bold leading-none"
        style={{ color: 'var(--text-primary)' }}
      >
        {format ? format(measured.value) : measured.value}
        {unit && (
          <span className="ml-1 text-[14px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {unit}
          </span>
        )}
      </p>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {BASIS_LABEL[measured.basis]} · {measured.sampleSize} sample
        {measured.sampleSize === 1 ? '' : 's'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chart card with a data-table fallback
 *
 * The table is not a nicety. It is what makes each figure checkable: a panel
 * member can read the exact numbers behind a bar, and the figures come from
 * named queries rather than a black box. Colour never carries meaning alone —
 * every bar is labelled and every value is also in the table.
 * ------------------------------------------------------------------ */

function BarCard({
  title,
  description,
  data,
  valueKey,
  categoryKey,
  formatValue,
  unit,
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number | null>>;
  valueKey: string;
  categoryKey: string;
  formatValue: (value: number) => string;
  unit?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const hasData = data.length > 0 && data.some((d) => Number(d[valueKey] ?? 0) > 0);

  return (
    <div
      className="rounded-[16px] p-5"
      style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="shrink-0 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition-opacity hover:opacity-80"
          style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}
          aria-pressed={showTable}
        >
          <span className="inline-flex items-center gap-1.5">
            {showTable ? <BarChart3 size={12} aria-hidden="true" /> : <Table2 size={12} aria-hidden="true" />}
            {showTable ? 'Chart' : 'Data'}
          </span>
        </button>
      </div>

      {!hasData ? (
        <p className="mt-6 text-[13px]" style={{ color: 'var(--text-dim)' }}>
          No completed transactions to chart yet.
        </p>
      ) : showTable ? (
        <table className="mt-4 w-full text-[12px]">
          <caption className="sr-only">{title} — underlying values</caption>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th scope="col" className="py-1.5 text-left font-medium">Category</th>
              <th scope="col" className="py-1.5 text-right font-medium">
                {unit ?? 'Value'}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td className="py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {String(row[categoryKey])}
                </td>
                <td className="py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                  {row[valueKey] === null ? '—' : formatValue(Number(row[valueKey]))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-5 h-[190px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey={categoryKey}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(201,160,92,0.08)' }}
                contentStyle={{
                  background: 'rgba(20,20,27,0.98)',
                  border: '1px solid rgba(201,160,92,0.2)',
                  borderRadius: 10,
                  fontSize: 12,
                }}
                formatter={(v) => [formatValue(Number(v ?? 0)), unit ?? 'Value']}
              />
              <Bar dataKey={valueKey} radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={i === 0 ? 'var(--gold)' : 'rgba(201,160,92,0.42)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export function DecisionSupport({
  branchId,
  activeBranchId,
}: {
  branchId?: number | null;
  activeBranchId?: number | null;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const branch = activeBranchId ?? branchId ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<Report>('/decision-support/report', branch ? { branchId: String(branch) } : undefined)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load decision support data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branch]);

  const serviceTimeRows = useMemo(
    () =>
      (report?.serviceTimeByType ?? [])
        .filter((row) => row.meanServiceMinutes !== null)
        .map((row) => ({
          type: QUEUE_TYPE_LABEL[row.queueType] ?? row.queueType,
          minutes: Number(row.meanServiceMinutes),
        })),
    [report],
  );

  const peakHourRows = useMemo(
    () =>
      (report?.peakHours ?? []).map((row) => ({
        hour: `${String(row.hour).padStart(2, '0')}:00`,
        joined: row.joined,
      })),
    [report],
  );

  const counterRows = useMemo(
    () =>
      (report?.counterUtilisation ?? []).map((row) => ({
        counter: `Counter ${row.counter}`,
        minutes: Number(row.meanServiceMinutes ?? 0),
      })),
    [report],
  );

  if (loading) {
    return (
      <div className="p-6">
        <div
          className="h-5 w-64 animate-pulse rounded"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        />
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[16px]"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <div
          className="flex items-start gap-3 rounded-[16px] p-5"
          style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.22)' }}
          role="alert"
        >
          <AlertTriangle size={18} style={{ color: '#f87171' }} aria-hidden="true" />
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Decision support unavailable
            </p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const calibrationTone =
    report.predictionCalibration.biasMinutes.value === null
      ? 'var(--text-dim)'
      : Math.abs(report.predictionCalibration.biasMinutes.value) <= 3
        ? '#4ade80'
        : '#fbbf24';

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1
          className="text-[22px] font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
        >
          Decision Support
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Every figure below is computed from this shop's own completed transactions. Where
          there is not enough history, it says so rather than estimating.
        </p>
      </header>

      {/* Data quality — stated first, because everything else depends on it. */}
      <div
        className="flex items-start gap-3 rounded-[16px] p-4"
        style={{
          background: report.dataQuality.canPredictWait
            ? 'rgba(201,160,92,0.05)'
            : 'rgba(251,191,36,0.05)',
          border: `1px solid ${
            report.dataQuality.canPredictWait
              ? 'rgba(201,160,92,0.18)'
              : 'rgba(251,191,36,0.22)'
          }`,
        }}
      >
        {report.dataQuality.canPredictWait ? (
          <CheckCircle2 size={18} style={{ color: 'var(--gold)' }} aria-hidden="true" />
        ) : (
          <AlertTriangle size={18} style={{ color: '#fbbf24' }} aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {report.dataQuality.canPredictWait
              ? `Based on ${report.dataQuality.servedTickets} completed transactions`
              : 'Not enough history to predict yet'}
          </p>
          {report.dataQuality.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {report.dataQuality.warnings.map((w, i) => (
                <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Headline measures */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          className="rounded-[16px] p-5"
          style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
            No-show rate
          </p>
          <MeasuredValue measured={report.noShowRate.overall} unit="%" />
        </div>

        <div
          className="rounded-[16px] p-5"
          style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
            Mean service time
          </p>
          <MeasuredValue
            measured={report.waitPrediction.meanServiceMinutes}
            unit="min"
            format={(v) => v.toFixed(1)}
          />
        </div>

        <div
          className="rounded-[16px] p-5"
          style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
            Estimate accuracy
          </p>
          {report.predictionCalibration.biasMinutes.value === null ? (
            <MeasuredValue measured={report.predictionCalibration.biasMinutes} unit="min" />
          ) : (
            <div>
              <p className="text-[26px] font-bold leading-none" style={{ color: calibrationTone }}>
                {report.predictionCalibration.biasMinutes.value > 0 ? '+' : ''}
                {report.predictionCalibration.biasMinutes.value.toFixed(1)}
                <span className="ml-1 text-[14px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  min
                </span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {report.predictionCalibration.note}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                {report.predictionCalibration.comparedSamples} tickets compared
              </p>
            </div>
          )}
        </div>

        <div
          className="rounded-[16px] p-5"
          style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
            Live queue
          </p>
          {report.waitPrediction.peopleAhead === 0 && report.waitPrediction.activeCounters === 0 ? (
            <div>
              <p className="text-[26px] font-bold leading-none" style={{ color: 'var(--text-dim)' }}>
                Queue clear
              </p>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Nobody is waiting and no counter is occupied.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[26px] font-bold leading-none" style={{ color: 'var(--text-primary)' }}>
                {report.waitPrediction.peopleAhead}
                <span className="ml-1 text-[14px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  waiting
                </span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {report.waitPrediction.activeCounters} counter
                {report.waitPrediction.activeCounters === 1 ? '' : 's'} serving
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Operational breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BarCard
          title="Service time by transaction"
          description="How long a counter is occupied, measured per type."
          data={serviceTimeRows}
          valueKey="minutes"
          categoryKey="type"
          formatValue={(v) => `${v.toFixed(1)} min`}
          unit="Minutes"
        />
        <BarCard
          title="Peak hours"
          description="Completed transactions by the hour the customer joined."
          data={peakHourRows}
          valueKey="joined"
          categoryKey="hour"
          formatValue={(v) => `${v} ticket${v === 1 ? '' : 's'}`}
          unit="Tickets"
        />
        <BarCard
          title="Counter throughput"
          description="Transactions served and mean time per counter."
          data={counterRows}
          valueKey="minutes"
          categoryKey="counter"
          formatValue={(v) => `${v.toFixed(1)} min`}
          unit="Mean minutes"
        />
        <BarCard
          title="No-shows by transaction"
          description="Share of warned customers who did not arrive, per type."
          data={report.noShowRate.byQueueType
            .filter((r) => r.rate !== null)
            .map((r) => ({
              type: QUEUE_TYPE_LABEL[r.queueType] ?? r.queueType,
              rate: Number(r.rate),
            }))}
          valueKey="rate"
          categoryKey="type"
          formatValue={(v) => `${v.toFixed(1)}%`}
          unit="No-show rate"
        />
      </div>

      {/* Lifecycle exposure — raw counts and sums, no rate applied. */}
      <div
        className="rounded-[16px] p-5"
        style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid rgba(201,160,92,0.12)' }}
      >
        <div className="flex items-center gap-2">
          <Database size={15} style={{ color: 'var(--gold)' }} aria-hidden="true" />
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Where the capital is
          </h3>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Ticket counts and principal by lifecycle stage. No rate is applied and nothing is
          forecast — these are the records as they stand.
        </p>

        {report.lifecycleExposure.length === 0 ? (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--text-dim)' }}>
            No pawn tickets recorded for this shop yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                Ticket counts and principal value by lifecycle stage
              </caption>
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th scope="col" className="py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em]">
                    Stage
                  </th>
                  <th scope="col" className="py-2 text-right text-[11px] font-semibold uppercase tracking-[0.1em]">
                    Tickets
                  </th>
                  <th scope="col" className="py-2 text-right text-[11px] font-semibold uppercase tracking-[0.1em]">
                    Principal
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.lifecycleExposure.map((row) => (
                  <tr key={row.lifecycleStatus} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="py-2.5" style={{ color: 'var(--text-secondary)' }}>
                      {row.lifecycleStatus.replace(/_/g, ' ').toLowerCase()}
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {row.tickets}
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {peso(row.principal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default DecisionSupport;
