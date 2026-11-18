/**
 * Client-side report exporters. Heavy libraries are loaded lazily, only when the user exports.
 * Nothing leaves the device.
 */
import { downloadBlob, safeFileName } from '../lib/utils';
import { ACH_HEAD, OBS_HEAD, SUBJECT_HEAD, type ChartSpec, type ReportData } from './reportData';

const fileBase = (r: ReportData) => safeFileName(`InclusiveInsight_${r.typeLabel}_${r.student.name}_${r.range.from}_${r.range.to}`);

/* ------------------------------------------------------------------ */
/* Chart images (canvas → PNG)                                         */
/* ------------------------------------------------------------------ */

const PALETTE = ['#5B9BD5', '#8CCFB5', '#E8B04A', '#ECA5A0', '#C59BD8', '#6CC3D5', '#E8B07A', '#86A8E7'];

export function chartPng(spec: ChartSpec, width = 900): string {
  const rowH = 34;
  const top = 50;
  const height = top + spec.labels.length * rowH + 20;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#25344A';
  g.font = '600 20px Roboto, Arial, sans-serif';
  g.fillText(spec.title, 16, 30);
  const labelW = 260;
  const maxV = Math.max(...spec.values, spec.suffix === '%' ? 100 : 1);
  const barMax = width - labelW - 90;
  g.font = '15px Roboto, Arial, sans-serif';
  spec.labels.forEach((label, i) => {
    const y = top + i * rowH;
    g.fillStyle = '#25344A';
    g.textAlign = 'right';
    g.fillText(label.length > 30 ? label.slice(0, 29) + '…' : label, labelW - 12, y + 20);
    g.fillStyle = '#EEF3F8';
    g.fillRect(labelW, y + 6, barMax, 20);
    g.fillStyle = spec.colors?.[i] ?? PALETTE[i % PALETTE.length];
    const w = Math.max(2, (spec.values[i] / maxV) * barMax);
    g.fillRect(labelW, y + 6, w, 20);
    g.fillStyle = '#25344A';
    g.textAlign = 'left';
    g.fillText(`${spec.values[i]}${spec.suffix}`, labelW + w + 8, y + 21);
  });
  return c.toDataURL('image/png');
}

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(',')[1];
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* PDF (pdfmake with embedded Roboto — supports Ukrainian)              */
/* ------------------------------------------------------------------ */

export async function exportPdf(r: ReportData) {
  const pdfMakeMod: any = await import('pdfmake/build/pdfmake');
  const vfsMod: any = await import('pdfmake/build/vfs_fonts');
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  const vfs = vfsMod.default?.pdfMake?.vfs ?? vfsMod.pdfMake?.vfs ?? vfsMod.default ?? vfsMod.vfs ?? vfsMod;
  pdfMake.vfs = vfs;

  const table = (head: string[], body: string[][], widths?: (string | number)[]) => ({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: widths ?? head.map(() => '*'),
      body: [head.map((h) => ({ text: h, style: 'th' })), ...body.map((row) => row.map((c) => ({ text: c, style: 'td' })))],
    },
    layout: {
      fillColor: (i: number) => (i === 0 ? '#EAF4FF' : i % 2 === 0 ? '#F8FAFD' : null),
      hLineColor: () => '#E5ECF3',
      vLineColor: () => '#E5ECF3',
    },
    margin: [0, 4, 0, 12],
  });
  const h2 = (t: string) => ({ text: t, style: 'h2' });
  const content: any[] = [
    { text: 'Inclusive Insight', style: 'brand' },
    { text: r.title, style: 'h1' },
    ...(r.isDemo ? [{ text: 'ДЕМОНСТРАЦІЙНІ ДАНІ — вигаданий учень', color: '#C0605A', bold: true, margin: [0, 0, 0, 6] }] : []),
    {
      columns: [
        { width: '*', text: [{ text: 'Учень: ', bold: true }, `${r.student.name}\n`, { text: 'Клас: ', bold: true }, `${r.student.grade}\n`, { text: 'Навчальний рік: ', bold: true }, r.student.schoolYear] },
        { width: '*', text: [{ text: 'Період: ', bold: true }, `${r.periodLabel}\n`, { text: 'Предмети: ', bold: true }, `${r.subjectsLabel}\n`, { text: 'Склав(ла): ', bold: true }, r.authorName] },
      ],
      margin: [0, 6, 0, 14],
      fontSize: 10,
    },
  ];
  if (r.include.summary) content.push(h2('Підсумок'), { text: r.summary, margin: [0, 0, 0, 12], lineHeight: 1.3 });
  if (r.include.metrics) content.push(h2('Основні показники'), table(['Показник', 'Значення', 'Основа розрахунку'], r.metrics.map((m) => [m.label, m.value, m.basis]), ['*', 70, '*']));
  if (r.include.charts) for (const ch of r.charts) content.push({ image: chartPng(ch), width: 500, margin: [0, 4, 0, 12] });
  if (r.include.subjects && r.subjectRows.length) content.push(h2('Порівняння предметів'), table(SUBJECT_HEAD, r.subjectRows));
  if (r.include.categories) for (const t of r.categoryTables) content.push(h2(t.title), table(['Категорія', 'Кількість', 'Примітка'], t.rows, ['*', 60, 120]));
  if (r.include.insights && r.insights.length) content.push(h2('Спостереження за даними (автоматично за правилами)'), { ul: r.insights.map((i) => `${i.text} (${i.basis})`), margin: [0, 0, 0, 12] });
  if (r.include.observations && r.observationRows.length) content.push(h2('Журнал спостережень'), { ...table(OBS_HEAD, r.observationRows, [42, 14, 50, 60, '*', 55, 60, '*']), fontSize: 7.5 });
  if (r.include.notes && r.noteRows.length) content.push(h2('Нотатки'), table(['Урок', 'Нотатка'], r.noteRows, [90, '*']));
  if (r.include.achievements && r.achievementRows.length) content.push(h2('Досягнення'), table(ACH_HEAD, r.achievementRows, [55, 80, '*', '*']));
  if (r.include.iep && r.goals.length) {
    content.push(h2('Цілі ІПР'));
    for (const g of r.goals) {
      content.push({
        stack: [
          { text: g.goal.title, bold: true },
          { text: `Напрям: ${g.goal.area} · Статус: ${g.goal.status === 'achieved' ? 'досягнуто' : g.goal.status === 'paused' ? 'призупинено' : 'активна'}`, fontSize: 9, color: '#718096' },
          { text: `Початковий рівень: ${g.goal.baseline || '—'}`, fontSize: 9 },
          { text: `Критерій: ${g.goal.criterion || '—'}`, fontSize: 9 },
          { text: `Останнє вимірювання: ${g.latest}`, fontSize: 9 },
          { text: `Вимірювань за період: ${g.measurements.length}; критерій досягнуто: ${g.met} раз(и)`, fontSize: 9 },
          ...(g.goal.summary ? [{ text: `Підсумок: ${g.goal.summary}`, fontSize: 9 }] : []),
        ],
        margin: [0, 2, 0, 10],
        unbreakable: true,
      });
    }
  }
  content.push(
    { text: 'Дані є педагогічними спостереженнями й не є медичним чи психологічним висновком.', fontSize: 8, color: '#718096', margin: [0, 16, 0, 0] },
    { columns: [{ text: `Дата: ${r.generatedAt}` }, { text: 'Підпис: ____________________', alignment: 'right' }], margin: [0, 30, 0, 0] },
  );

  const doc = {
    content,
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#25344A' },
    styles: {
      brand: { fontSize: 9, color: '#5B9BD5', bold: true },
      h1: { fontSize: 17, bold: true, margin: [0, 2, 0, 4] },
      h2: { fontSize: 12, bold: true, color: '#3F7FBA', margin: [0, 8, 0, 4] },
      th: { bold: true, fontSize: 8.5, color: '#25344A' },
      td: { fontSize: 8.5 },
    },
    footer: (page: number, pages: number) => ({ text: `Inclusive Insight · ${r.student.name} · стор. ${page} з ${pages}`, alignment: 'center', fontSize: 8, color: '#A0AEC0', margin: [0, 15, 0, 0] }),
    info: { title: r.title, creator: 'Inclusive Insight 1.1' },
  };
  await new Promise<void>((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob((blob: Blob) => {
        downloadBlob(blob, `${fileBase(r)}.pdf`);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                 */
/* ------------------------------------------------------------------ */

export async function exportDocx(r: ReportData) {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ImageRun, AlignmentType, ShadingType, BorderStyle } = d;
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'E5ECF3' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const mkTable = (head: string[], body: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders,
      rows: [
        new TableRow({
          tableHeader: true,
          children: head.map((h) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: 'EAF4FF', color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })] })),
        }),
        ...body.map((row) => new TableRow({ cantSplit: true, children: row.map((c) => new TableCell({ children: c.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 18 })] })) })) })),
      ],
    });
  const h2 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, color: '3F7FBA' })] });
  const p = (t: string, opts: any = {}) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, ...opts })] });
  const kv = (k: string, v: string) => new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] });

  const children: any[] = [
    p('Inclusive Insight', { color: '5B9BD5', bold: true, size: 18 }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: r.title })] }),
  ];
  if (r.isDemo) children.push(p('ДЕМОНСТРАЦІЙНІ ДАНІ — вигаданий учень', { color: 'C0605A', bold: true }));
  children.push(
    kv('Учень', r.student.name), kv('Клас', r.student.grade), kv('Навчальний рік', r.student.schoolYear),
    kv('Період', r.periodLabel), kv('Предмети', r.subjectsLabel), kv('Склав(ла)', r.authorName),
  );
  if (r.include.summary) children.push(h2('Підсумок'), p(r.summary));
  if (r.include.metrics) children.push(h2('Основні показники'), mkTable(['Показник', 'Значення', 'Основа розрахунку'], r.metrics.map((m) => [m.label, m.value, m.basis])));
  if (r.include.charts) {
    for (const ch of r.charts) {
      const url = chartPng(ch);
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = url; });
      const w = 600;
      const h = Math.round((img.height / img.width) * w);
      children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(url), transformation: { width: w, height: h } } as any)] }));
    }
  }
  if (r.include.subjects && r.subjectRows.length) children.push(h2('Порівняння предметів'), mkTable(SUBJECT_HEAD, r.subjectRows));
  if (r.include.categories) for (const t of r.categoryTables) children.push(h2(t.title), mkTable(['Категорія', 'Кількість', 'Примітка'], t.rows));
  if (r.include.insights && r.insights.length) {
    children.push(h2('Спостереження за даними (автоматично за правилами)'));
    for (const i of r.insights) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(`${i.text} (${i.basis})`)] }));
  }
  if (r.include.observations && r.observationRows.length) children.push(h2('Журнал спостережень'), mkTable(OBS_HEAD, r.observationRows));
  if (r.include.notes && r.noteRows.length) children.push(h2('Нотатки'), mkTable(['Урок', 'Нотатка'], r.noteRows));
  if (r.include.achievements && r.achievementRows.length) children.push(h2('Досягнення'), mkTable(ACH_HEAD, r.achievementRows));
  if (r.include.iep && r.goals.length) {
    children.push(h2('Цілі ІПР'));
    for (const g of r.goals) {
      children.push(
        p(g.goal.title, { bold: true }),
        p(`Напрям: ${g.goal.area}. Початковий рівень: ${g.goal.baseline || '—'}. Критерій: ${g.goal.criterion || '—'}.`, { size: 18 }),
        p(`Останнє вимірювання: ${g.latest}. Вимірювань за період: ${g.measurements.length}; критерій досягнуто: ${g.met} раз(и).`, { size: 18 }),
      );
      if (g.goal.summary) children.push(p(`Підсумок: ${g.goal.summary}`, { size: 18 }));
    }
  }
  children.push(
    p('Дані є педагогічними спостереженнями й не є медичним чи психологічним висновком.', { size: 16, color: '718096' }),
    new Paragraph({ spacing: { before: 480 }, children: [new TextRun(`Дата: ${r.generatedAt}`)] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Підпис: ____________________')] }),
  );

  const doc = new Document({
    creator: 'Inclusive Insight 1.1',
    title: r.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: '25344A' } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${fileBase(r)}.docx`);
}

/* ------------------------------------------------------------------ */
/* XLSX                                                                 */
/* ------------------------------------------------------------------ */

export async function exportXlsx(r: ReportData) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: (string | number)[][], widths?: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = (widths ?? rows[0]?.map(() => 18) ?? []).map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/\s*\(.*\)\s*$/, '').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  };
  add('Підсумок', [
    ['Inclusive Insight — ' + r.title],
    ...(r.isDemo ? [['ДЕМОНСТРАЦІЙНІ ДАНІ']] : []),
    ['Учень', r.student.name], ['Клас', r.student.grade], ['Період', r.periodLabel], ['Предмети', r.subjectsLabel], ['Склав(ла)', r.authorName], [],
    ['Підсумок'], [r.summary], [],
    ['Показник', 'Значення', 'Основа розрахунку'], ...r.metrics.map((m) => [m.label, m.value, m.basis]),
  ], [28, 18, 50]);
  if (r.subjectRows.length) add('Предмети', [SUBJECT_HEAD, ...r.subjectRows]);
  if (r.observationRows.length) add('Спостереження', [OBS_HEAD, ...r.observationRows], [12, 5, 18, 26, 34, 24, 28, 40]);
  for (const t of r.categoryTables) add(t.title.slice(0, 28), [['Категорія', 'Кількість', 'Примітка'], ...t.rows], [34, 12, 24]);
  if (r.achievementRows.length) add('Досягнення', [ACH_HEAD, ...r.achievementRows], [12, 20, 34, 50]);
  if (r.goals.length) {
    add('Цілі ІПР', [
      ['Ціль', 'Напрям', 'Початковий рівень', 'Критерій', 'Одиниця', 'Ціль (число)', 'Останнє вимірювання', 'Статус'],
      ...r.goals.map((g) => [g.goal.title, g.goal.area, g.goal.baseline, g.goal.criterion, g.goal.unit, g.goal.targetValue ?? '', g.latest, g.goal.status]),
    ], [36, 16, 30, 30, 10, 10, 34, 10]);
    add('Вимірювання ІПР', [
      ['Ціль', 'Дата', 'Значення', 'Критерій досягнуто', 'Коментар'],
      ...r.goals.flatMap((g) => g.measurements.map((m) => [g.goal.title, m.date, m.value ?? '', m.criterionMet ? 'так' : 'ні', m.comment])),
    ], [36, 12, 10, 12, 40]);
  }
  if (r.noteRows.length) add('Нотатки', [['Урок', 'Нотатка'], ...r.noteRows], [24, 80]);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase(r)}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* CSV (UTF-8 with BOM so Excel opens Cyrillic correctly)               */
/* ------------------------------------------------------------------ */

export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + rows.map((r) => r.map((c) => esc(c ?? '')).join(';')).join('\r\n');
}

export function exportCsv(r: ReportData) {
  const rows = [OBS_HEAD, ...r.observationRows];
  downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${fileBase(r)}.csv`);
}
