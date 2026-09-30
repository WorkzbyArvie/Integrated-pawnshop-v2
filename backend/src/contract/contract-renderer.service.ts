import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StorageService } from '../common/storage/storage.service';
import * as Handlebars from 'handlebars';
import PDFDocument from 'pdfkit';

/** A run of text with a single style. Templates mark labels with `<strong>`. */
interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

/**
 * A laid-out unit. `lines` comes from splitting a paragraph on `<br/>`, which is
 * what the templates use to put a label and its value on one row.
 */
type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'p'; lines: Run[][] }
  | { kind: 'li'; lines: Run[][]; marker: string; depth: number };

/** A4 at 72dpi. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
/** Left gutter for the label column, and the gap before the value column. */
const LABEL_WIDTH = 148;
const LABEL_GAP = 14;

/** Labels whose value is the point of the document, so it is set larger. */
const EMPHASISED_LABELS = new Set(['loan amount', 'amount paid', 'total', 'winning bid']);

@Injectable()
export class ContractRendererService {
  private readonly logger = new Logger(ContractRendererService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async renderContract(
    templateId: string,
    data: Record<string, any>,
    pawnshopId: string,
    userId: string,
    signatures?: {
      customerSignature?: string | null;
      customerSignedAt?: string | null;
      staffSignature?: string | null;
      staffSignedAt?: string | null;
    },
  ) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId);
    let template = isUuid
      ? await this.prisma.contractTemplate.findUnique({ where: { id: templateId } })
      : null;
    if (!template) {
      const normalizedType = templateId
        .replace(/-/g, '_')
        .toUpperCase();
      template = await this.prisma.contractTemplate.findFirst({
        where: { type: normalizedType as any, isActive: true },
      });
    }
    if (!template) throw new NotFoundException('Template not found');

    const compile = Handlebars.compile(template.content);
    const htmlContent = compile(data);

    const pdfBuffer = await this.generatePdf(htmlContent, data, signatures);

    const fileName = `${template.type}-${Date.now()}.pdf`;
    const storageUrl = await this.storage.uploadPdf(pdfBuffer, 'contracts', fileName);

    const contractNumber = `CTR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const record = await this.prisma.loanContract.create({
      data: {
        loanId: data.loanId ? parseInt(data.loanId) : 0,
        applicationId: data.applicationId || '',
        contractNumber,
        templateVersion: template.version,
        contractData: { ...data, renderedHtml: htmlContent },
        pdfUrl: storageUrl,
        generatedAt: new Date(),
      },
    });

    await this.prisma.legalProof.create({
      data: {
        proofNumber: `PROOF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8)}`,
        pawnshopId,
        recordType: 'CONTRACT_PROOF',
        title: `Contract: ${contractNumber}`,
        summary: `Generated ${template.name} contract`,
        payload: { contractNumber, templateId, templateVersion: template.version },
        sourceHash: this.hashPayload({ contractNumber, templateId, data }),
        createdBy: userId,
        contractId: record.id,
      },
    });

    return { id: record.id, contractNumber, pdfUrl: storageUrl };
  }

  async renderPdfOnly(
    templateId: string,
    data: Record<string, any>,
    signatures?: {
      customerSignature?: string | null;
      customerSignedAt?: string | null;
      staffSignature?: string | null;
      staffSignedAt?: string | null;
    },
    extraSections?: { heading: string; html: string }[],
  ): Promise<{ htmlContent: string; pdfBuffer: Buffer; templateType: string; templateVersion: string }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId);
    let template = isUuid
      ? await this.prisma.contractTemplate.findUnique({ where: { id: templateId } })
      : null;
    if (!template) {
      const normalizedType = templateId
        .replace(/-/g, '_')
        .toUpperCase();
      template = await this.prisma.contractTemplate.findFirst({
        where: { type: normalizedType as any, isActive: true },
      });
    }
    if (!template) throw new NotFoundException('Template not found');

    const compile = Handlebars.compile(template.content);
    let htmlContent = compile(data);
    if (extraSections?.length) {
      htmlContent = this.applyExtraSections(htmlContent, extraSections);
    }

    const pdfBuffer = await this.generatePdf(htmlContent, data, signatures);

    return { htmlContent, pdfBuffer, templateType: template.type, templateVersion: template.version };
  }

  private textToHtml(text: string): string {
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('\n');
  }

  private applyExtraSections(html: string, extraSections: { heading: string; html: string }[]): string {
    const extraHtml = extraSections.map((s) => `<h2>${s.heading}</h2>\n${s.html}`).join('\n');
    const signatureAnchor = '<h2>SIGNATURES</h2>';
    const signatureIdx = html.toUpperCase().indexOf(signatureAnchor.toUpperCase());

    const hasCustomTerms = extraSections.some((s) => /terms and conditions/i.test(s.heading));
    if (hasCustomTerms) {
      const header = /<h2[^>]*>\s*TERMS AND CONDITIONS\s*<\/h2>/i;
      const termsStart = html.search(header);
      if (termsStart !== -1) {
        const headerMatch = html.slice(termsStart).match(header);
        const headerEnd = headerMatch ? termsStart + headerMatch[0].length : termsStart;
        const rest = html.slice(headerEnd);
        const nextH2Rel = rest.search(/<h2[^>]*>/i);
        const sectionEnd = nextH2Rel === -1 ? html.length : headerEnd + nextH2Rel;
        html = html.slice(0, termsStart) + html.slice(sectionEnd);
      }
    }

    if (signatureIdx === -1) {
      return html + '\n' + extraHtml;
    }
    return html.slice(0, signatureIdx) + extraHtml + '\n' + html.slice(signatureIdx);
  }

  async getPdfUrl(contractId: string) {
    const contract = await this.prisma.loanContract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return { pdfUrl: contract.pdfUrl, contractNumber: contract.contractNumber };
  }

  private static decode(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  /**
   * Parse template HTML into blocks, preserving the structure the old renderer
   * discarded.
   *
   * The previous implementation was `html.replace(/<[^>]*>/g, '\n')`, which
   * turned *every* tag into a line break. The templates deliberately write
   * `<strong>Label:</strong> value<br/>` to put a label and its value on one
   * row; that `<br/>` was inverted into a newline, so "Loan Amount:" printed on
   * one line and "PHP 440.00" on the next, down the whole document. Unnumbered
   * terms and underlined headings came from the same loss.
   */
  private htmlToBlocks(html: string): Block[] {
    const blocks: Block[] = [];
    const tagPattern = /<\/?([a-z0-9]+)((?:\s[^>]*)?)\/?>/gi;

    let block: { kind: 'h1' | 'h2' | 'h3' | 'p'; lines: Run[][] } | null = null;
    let listItem: { lines: Run[][]; marker: string; depth: number } | null = null;
    // `<li>` cannot know whether it is in an `<ol>` or a `<ul>` on its own, so
    // the enclosing list type is tracked on a stack. Without this every list
    // rendered as bullets, because the counter only ever advanced for `<ol>`.
    const listStack: { ordered: boolean; counter: number }[] = [];
    const boldDepth = { value: 0 };
    const italicDepth = { value: 0 };

    const activeLines = (): Run[][] => (listItem ? listItem.lines : block!.lines);
    const currentLine = (): Run[] => {
      const lines = activeLines();
      if (!lines.length) lines.push([]);
      return lines[lines.length - 1];
    };

    const flushBlock = () => {
      if (!block) return;
      const lines = block.lines.filter((line) => line.some((run) => run.text.trim()));
      if (lines.length) blocks.push({ ...block, lines });
      block = null;
    };
    const flushItem = () => {
      if (!listItem) return;
      const lines = listItem.lines.filter((line) => line.some((run) => run.text.trim()));
      if (lines.length) blocks.push({ kind: 'li', ...listItem, lines });
      listItem = null;
    };
    const pushText = (raw: string) => {
      if (!raw) return;
      const text = ContractRendererService.decode(raw);
      if (!text.trim() && !text.includes(' ')) return;
      if (listItem || block) {
        currentLine().push({ text, bold: boldDepth.value > 0, italic: italicDepth.value > 0 });
      }
    };

    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(html)) !== null) {
      pushText(html.slice(cursor, match.index));
      cursor = match.index + match[0].length;

      const closing = match[0].startsWith('</');
      const tag = match[1].toLowerCase();

      switch (tag) {
        case 'strong':
        case 'b':
          boldDepth.value += closing ? -1 : 1;
          break;
        case 'em':
        case 'i':
          italicDepth.value += closing ? -1 : 1;
          break;
        case 'br':
          if (listItem || block) activeLines().push([]);
          break;
        case 'h1':
        case 'h2':
        case 'h3':
        case 'p':
        case 'div':
          if (closing) flushBlock();
          else {
            flushBlock();
            block = { kind: tag === 'div' ? 'p' : tag, lines: [[]] };
          }
          break;
        case 'ol':
        case 'ul':
          if (closing) {
            flushItem();
            listStack.pop();
          } else {
            flushItem();
            listStack.push({ ordered: tag === 'ol', counter: 0 });
          }
          break;
        case 'li': {
          if (closing) {
            flushItem();
            break;
          }
          flushItem();
          const list = listStack[listStack.length - 1];
          if (list?.ordered) list.counter += 1;
          listItem = {
            lines: [[]],
            marker: list?.ordered ? `${list.counter}.` : '•',
            depth: Math.max(0, listStack.length - 1),
          };
          break;
        }
        default:
          break;
      }
      if (boldDepth.value < 0) boldDepth.value = 0;
      if (italicDepth.value < 0) italicDepth.value = 0;
    }
    pushText(html.slice(cursor));

    flushItem();
    flushBlock();
    return blocks;
  }

  /**
   * Split a paragraph into label/value rows where the template marked a label
   * with `<strong>` and ended it in a colon - the convention every template in
   * this project follows.
   */
  private splitLabelValue(lines: Run[][]): { label: string; value: Run[] }[] {
    return lines.map((line) => {
      const [first, ...rest] = line;
      if (first?.bold && first.text.trim().endsWith(':') && rest.length) {
        // The template puts a space between `</strong>` and the value, so the
        // first value run arrives as " Juan Dela Cruz". Trim the seam so the
        // extracted value is the value, not the whitespace before it.
        const value = [...rest];
        value[0] = { ...value[0], text: value[0].text.replace(/^\s+/, '') };
        return { label: first.text.trim().replace(/:$/, ''), value };
      }
      return { label: '', value: line };
    });
  }

  private static runsToText(runs: Run[]): string {
    return runs.map((run) => run.text).join('').replace(/\s+/g, ' ').trim();
  }

  /**
   * Remove the template's own SIGNATURES block.
   *
   * The template carries blank signature rules and this renderer appends the
   * signed block, so the PDF shipped with the heading and rules printed twice -
   * once blank, once signed. On a document offered as proof of signature, a
   * blank signature block above the real one invites the question of which one
   * binds. Exactly one block is rendered, by {@link renderSignatures}.
   */
  private stripSignatureBlock(html: string): string {
    const heading = /<h2[^>]*>\s*SIGNATURES\s*<\/h2>/i;
    const match = html.match(heading);
    if (!match || match.index === undefined) return html;
    // Everything from the heading onward, including the trailing
    // "electronically generated" line, which the footer now carries.
    return html.slice(0, match.index);
  }

  private drawRule(doc: PDFKit.PDFDocument, y: number, color = '#D8D2C6', width = 0.75) {
    doc
      .save()
      .moveTo(MARGIN, y)
      .lineTo(PAGE.width - MARGIN, y)
      .lineWidth(width)
      .strokeColor(color)
      .stroke()
      .restore();
  }

  private ensureRoom(doc: PDFKit.PDFDocument, needed: number) {
    if (doc.y + needed > PAGE.height - MARGIN - 34) doc.addPage();
  }

  private renderLabelValueRow(
    doc: PDFKit.PDFDocument,
    label: string,
    value: Run[],
  ) {
    const emphasised = EMPHASISED_LABELS.has(label.toLowerCase());
    const valueSize = emphasised ? 13 : 10;
    const labelSize = 8.5;
    const valueX = MARGIN + LABEL_WIDTH + LABEL_GAP;
    const valueWidth = PAGE.width - MARGIN - valueX;

    this.ensureRoom(doc, 34);

    const startY = doc.y;
    const text = ContractRendererService.runsToText(value);
    const valueHeight = doc.font('Helvetica-Bold').fontSize(valueSize)
      .heightOfString(text, { width: valueWidth });

    if (emphasised) {
      // A shaded band, so the figure the borrower is agreeing to is findable
      // at a glance on a printed page. Greyscale-safe, so it photocopies.
      doc
        .save()
        .rect(MARGIN - 8, startY - 6, PAGE.width - (MARGIN - 8) * 2, valueHeight + 12)
        .fill('#F4F1EA')
        .restore();
    }

    if (label) {
      // Both are anchored at the top of the row, so the smaller label's baseline
      // sits above the value's - by ~1pt at 8.5/10 and ~3pt at 8.5/13. Nudging
      // the label down by the size difference puts the two baselines on one
      // line, which is the whole point of a label/value column. The factor was
      // measured off the emitted text matrices, not guessed.
      const baselineShift = (valueSize - labelSize) * 0.7;
      doc
        .font('Helvetica')
        .fontSize(labelSize)
        .fillColor('#6F6A61')
        .text(label.toUpperCase(), MARGIN, startY + baselineShift, {
          width: LABEL_WIDTH,
          characterSpacing: 0.4,
          lineBreak: false,
        });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(valueSize)
      .fillColor('#1A1A1A')
      .text(text, valueX, startY, { width: valueWidth });

    doc.y = Math.max(doc.y, startY + valueHeight) + (emphasised ? 12 : 5);
  }

  private renderParagraph(doc: PDFKit.PDFDocument, lines: Run[][]) {
    for (const row of this.splitLabelValue(lines)) {
      if (row.label) {
        this.renderLabelValueRow(doc, row.label, row.value);
        continue;
      }
      const text = ContractRendererService.runsToText(row.value);
      if (!text) continue;
      this.ensureRoom(doc, 20);
      const italics = row.value.length > 0 && row.value.every((run) => run.italic);
      doc
        .font(italics ? 'Helvetica-Oblique' : 'Helvetica')
        .fontSize(italics ? 8.5 : 10)
        .fillColor(italics ? '#6F6A61' : '#26262A')
        .text(text, MARGIN, doc.y, { width: PAGE.width - MARGIN * 2, align: 'left' });
      doc.moveDown(0.4);
    }
  }

  private renderHeading(doc: PDFKit.PDFDocument, kind: 'h1' | 'h2' | 'h3', text: string) {
    if (kind === 'h1') {
      this.ensureRoom(doc, 60);
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#14140F')
        .text(text, MARGIN, doc.y, { width: PAGE.width - MARGIN * 2, characterSpacing: 0.8 });
      doc.moveDown(0.3);
      this.drawRule(doc, doc.y, '#C9A05C', 1.5);
      doc.y += 16;
      return;
    }

    const size = kind === 'h2' ? 9.5 : 9;
    this.ensureRoom(doc, 40);
    doc
      .font('Helvetica-Bold')
      .fontSize(size)
      .fillColor('#3A362E')
      .text(text.toUpperCase(), MARGIN, doc.y, {
        width: PAGE.width - MARGIN * 2,
        characterSpacing: 1.1,
      });
    doc.moveDown(0.15);
    this.drawRule(doc, doc.y, '#E4DED2', 0.75);
    doc.y += 11;
  }

  private renderListItem(doc: PDFKit.PDFDocument, block: Extract<Block, { kind: 'li' }>) {
    const indent = MARGIN + 6 + block.depth * 14;
    const markerWidth = 20;
    const textWidth = PAGE.width - MARGIN - indent - markerWidth;

    for (const line of block.lines) {
      const text = ContractRendererService.runsToText(line);
      if (!text) continue;
      this.ensureRoom(doc, 20);
      const startY = doc.y;
      const height = doc.font('Helvetica').fontSize(9.5)
        .heightOfString(text, { width: textWidth });

      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor('#8A8279')
        .text(block.marker, indent, startY, { width: markerWidth - 4 });

      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#2B2B30')
        .text(text, indent + markerWidth, startY, { width: textWidth });

      doc.y = Math.max(doc.y, startY + height) + 3;
    }
    doc.y += 4;
  }

  private renderSignatures(
    doc: PDFKit.PDFDocument,
    signatures?: {
      customerSignature?: string | null;
      customerSignedAt?: string | null;
      staffSignature?: string | null;
      staffSignedAt?: string | null;
    },
  ) {
    // Keep the whole block on one page: a signature line split across a page
    // break is not a signature line.
    this.ensureRoom(doc, 210);
    doc.y += 10;
    this.renderHeading(doc, 'h2', 'Signatures');

    const formatDate = (value?: string | null) =>
      value ? new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

    const block = (
      image: string | null | undefined,
      role: string,
      signedAt: string | null | undefined,
    ) => {
      const top = doc.y;
      const lineWidth = 208;
      const lineX = MARGIN;

      if (image) {
        try {
          doc.image(image, lineX + 4, top, { width: 170, height: 52 });
          doc.y = top + 60;
        } catch (err) {
          this.logger.warn(`Failed to embed ${role} signature image: ${(err as Error).message}`);
          doc.y = top;
        }
      } else {
        doc.y = top + 34;
      }

      const ruleY = doc.y;
      doc
        .save()
        .moveTo(lineX, ruleY)
        .lineTo(lineX + lineWidth, ruleY)
        .lineWidth(0.75)
        .strokeColor('#8A8279')
        .stroke()
        .restore();

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6F6A61')
        .text(role, lineX, ruleY + 5, { width: lineWidth, characterSpacing: 0.3 });

      const dateX = lineX + lineWidth + 28;
      const date = formatDate(signedAt);
      doc
        .save()
        .moveTo(dateX, ruleY)
        .lineTo(PAGE.width - MARGIN, ruleY)
        .lineWidth(0.75)
        .strokeColor('#8A8279')
        .stroke()
        .restore();

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(date ? '#26262A' : '#8A8279')
        .text(date || 'Date', dateX, ruleY + 5, {
          width: PAGE.width - MARGIN - dateX,
          characterSpacing: date ? 0 : 0.3,
        });

      doc.y = ruleY + 30;
    };

    block(signatures?.customerSignature, 'Customer / Borrower', signatures?.customerSignedAt);
    block(signatures?.staffSignature, 'Pawnshop Representative', signatures?.staffSignedAt);
  }

  private stampFooters(doc: PDFKit.PDFDocument, data: Record<string, any>) {
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);

      const y = PAGE.height - MARGIN + 4;
      this.drawRule(doc, y - 12, '#E4DED2', 0.75);

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#8A8279')
        .text(
          `Contract ${data.contractNumber || '—'}  ·  This document was electronically generated and is legally binding.`,
          MARGIN,
          y,
          { width: PAGE.width - MARGIN * 2 - 70, lineBreak: false },
        );

      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor('#6F6A61')
        .text(`Page ${index - range.start + 1} of ${range.count}`, PAGE.width - MARGIN - 70, y, {
          width: 70,
          align: 'right',
          lineBreak: false,
        });
    }
  }

  private generatePdf(html: string, data: Record<string, any>, signatures?: {
    customerSignature?: string | null;
    customerSignedAt?: string | null;
    staffSignature?: string | null;
    staffSignedAt?: string | null;
  }): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        bufferPages: true,
      });
      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const blocks = this.htmlToBlocks(this.stripSignatureBlock(html));
      const firstHeading = blocks.find(
        (block): block is Extract<Block, { kind: 'h1' }> => block.kind === 'h1',
      );

      doc.font('Helvetica').fontSize(10);
      doc.y = MARGIN;

      if (!firstHeading) {
        // A masthead line, so the document identifies itself before the title.
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#8A8279')
          .text(
            `Generated ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`,
            MARGIN,
            MARGIN,
            { width: PAGE.width - MARGIN * 2, align: 'right', characterSpacing: 0.3 },
          );
        doc.y = MARGIN + 18;
      }

      for (const block of blocks) {
        switch (block.kind) {
          case 'h1':
            this.renderHeading(doc, 'h1', ContractRendererService.runsToText(block.lines[0] ?? []));
            break;
          case 'h2':
            this.renderHeading(doc, 'h2', ContractRendererService.runsToText(block.lines[0] ?? []));
            break;
          case 'h3':
            this.renderHeading(doc, 'h3', ContractRendererService.runsToText(block.lines[0] ?? []));
            break;
          case 'p':
            this.renderParagraph(doc, block.lines);
            break;
          case 'li':
            this.renderListItem(doc, block);
            break;
          default:
            break;
        }
      }

      this.renderSignatures(doc, signatures);
      this.stampFooters(doc, data);

      doc.end();
    });
  }

  private hashPayload(obj: any): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }
}
