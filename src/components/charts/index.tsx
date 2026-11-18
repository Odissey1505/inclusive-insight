import type { ReactNode } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { BarChart3 } from 'lucide-react';

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

const axis = { stroke: 'rgb(var(--c-line))', tick: { fill: 'rgb(var(--c-muted))', fontSize: 12 }, tickLine: false };
const tooltipStyle = {
  contentStyle: { background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-line))', borderRadius: 12, fontSize: 13, color: 'rgb(var(--c-ink))' },
  labelStyle: { fontWeight: 700, color: 'rgb(var(--c-ink))' },
  itemStyle: { color: 'rgb(var(--c-ink))' },
  cursor: { stroke: 'rgb(var(--c-muted))', strokeDasharray: '3 3', fill: 'rgb(var(--c-line) / .35)' },
};

export function NoChartData({ text = 'Недостатньо даних для графіка' }: { text?: string }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-sm text-muted">
      <BarChart3 className="h-8 w-8 opacity-40" />
      {text}
    </div>
  );
}

export function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Легенда">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

/** Percentage trend lines. Null values break the line (no fake zeros). */
export function TrendChart({ data, series, height = 260, onPointClick }: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
  onPointClick?: (row: Record<string, any>) => void;
}) {
  const has = data.some((d) => series.some((s) => d[s.key] !== null && d[s.key] !== undefined));
  if (!has) return <div style={{ height }}><NoChartData /></div>;
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
            onClick={(e: any) => e?.activePayload?.[0] && onPointClick?.(e.activePayload[0].payload)}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={16} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" {...axis} axisLine={false} />
            <Tooltip {...tooltipStyle} formatter={(v: any, name: any) => [v === null ? '—' : `${v}%`, name]}
              labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.lessons !== undefined ? ` · уроків: ${p[0].payload.lessons}` : ''}`} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--c-card))', fill: s.color }} activeDot={{ r: 6, cursor: onPointClick ? 'pointer' : undefined }} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && <LegendRow items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    </>
  );
}

/** Horizontal or vertical bars for one metric. */
export function BarsChart({ data, dataKey, nameKey = 'name', color = SERIES[0], unit = '', height = 260, horizontal, onBarClick, max }: {
  data: Record<string, any>[]; dataKey: string; nameKey?: string; color?: string; unit?: string; height?: number;
  horizontal?: boolean; onBarClick?: (row: Record<string, any>) => void; max?: number;
}) {
  if (!data.length || !data.some((d) => d[dataKey] !== null && d[dataKey] !== undefined)) return <div style={{ height }}><NoChartData /></div>;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, left: horizontal ? 8 : -18, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--grid)" vertical={!!horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" domain={[0, max ?? 'auto']} unit={unit} {...axis} />
              <YAxis type="category" dataKey={nameKey} width={130} {...axis} axisLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey={nameKey} {...axis} interval={0} tick={{ ...axis.tick, fontSize: 11 }} />
              <YAxis domain={[0, max ?? 'auto']} unit={unit} {...axis} axisLine={false} allowDecimals={false} />
            </>
          )}
          <Tooltip {...tooltipStyle} formatter={(v: any, _n: any, p: any) => [v === null ? '—' : `${v}${unit}`, p?.payload?.basis ?? '']} />
          <Bar dataKey={dataKey} fill={color} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36}
            cursor={onBarClick ? 'pointer' : undefined} onClick={(d: any) => onBarClick?.(d.payload ?? d)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked bars (e.g. support levels by subject). */
export function StackedChart({ data, keys, nameKey = 'name', height = 280 }: {
  data: Record<string, any>[]; keys: { key: string; label: string }[]; nameKey?: string; height?: number;
}) {
  const used = keys.filter((k) => data.some((d) => d[k.key]));
  if (!data.length || !used.length) return <div style={{ height }}><NoChartData /></div>;
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey={nameKey} {...axis} interval={0} tick={{ ...axis.tick, fontSize: 11 }} />
            <YAxis {...axis} axisLine={false} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            {used.map((k) => (
              <Bar key={k.key} dataKey={k.key} name={k.label} stackId="s" fill={SERIES[keys.indexOf(k) % 8]} stroke="rgb(var(--c-card))" strokeWidth={2} maxBarSize={44} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <LegendRow items={used.map((k) => ({ label: k.label, color: SERIES[keys.indexOf(k) % 8] }))} />
    </>
  );
}

export function DonutChart({ data, height = 240, center }: { data: { name: string; value: number; color?: string }[]; height?: number; center?: ReactNode }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  if (!total) return <div style={{ height }}><NoChartData /></div>;
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={1.5} stroke="rgb(var(--c-card))" strokeWidth={2}>
            {data.map((d, i) => <Cell key={d.name} fill={d.color ?? SERIES[i % 8]} />)}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'rgb(var(--c-muted))' }} layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[calc(100%-150px)] items-center justify-center text-center">{center}</div>}
    </div>
  );
}

/** Accessible data-table toggle under a chart. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-primary">Показати таблицю даних</summary>
      <div className="mt-2 overflow-x-auto scrollbar-thin">
        <table className="w-full text-left text-xs">
          <thead><tr>{head.map((h) => <th key={h} className="border-b border-line px-2 py-1.5 font-semibold text-muted">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line/60 px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
