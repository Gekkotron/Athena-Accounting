import { useState } from 'react';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import {
  submitZones,
  type PdfImportNeedsTemplate,
  type PdfImportImported,
  type TemplateZones,
} from '../../api/pdf-templates.js';

interface Props {
  needsTemplate: PdfImportNeedsTemplate;
  onClose: () => void;
  onImported: (r: PdfImportImported) => void;
}

type AmountMode = 'signed' | 'pair';
type Step = 'header' | 'table' | 'date' | 'description' | 'amount';

const STEP_ORDER: Step[] = ['header', 'table', 'date', 'description', 'amount'];
const STEP_TITLE: Record<Step, string> = {
  header: "Sélectionnez l'en-tête",
  table: 'Sélectionnez le tableau des transactions',
  date: 'Sélectionnez la colonne Date',
  description: 'Sélectionnez la colonne Libellé',
  amount: 'Sélectionnez la colonne Montant',
};

// Sage and clay map to the project's tailwind tokens.
const PAINT_COLOR: Partial<Record<Step, string>> = {
  header: '#7dd3c0',
  table: '#7dd3c0',
  date: '#7dd3c0',
  description: '#7dd3c0',
  amount: '#e69782',
};

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props) {
  const firstPage = needsTemplate.pages[0]!;
  const [step, setStep] = useState<Step>('header');

  // Header + table zones get a sensible default so the user has something to
  // nudge if the heuristic already had a guess. Column rectangles start empty —
  // the user paints every one from scratch.
  const [headerRect, setHeaderRect] = useState<PageRect>(
    needsTemplate.suggestedZones?.headerZone ?? {
      x: 0, y: 0, w: firstPage.widthPt, h: firstPage.heightPt * 0.15,
    },
  );
  const [tableRect, setTableRect] = useState<PageRect | null>(
    needsTemplate.suggestedZones
      ? { ...needsTemplate.suggestedZones.tableZone }
      : null,
  );
  const [tableRepeats, setTableRepeats] = useState<boolean>(
    needsTemplate.suggestedZones?.tableRepeatsPerPage ?? true,
  );
  const [dateCol, setDateCol] = useState<PageRect | null>(null);
  const [descCol, setDescCol] = useState<PageRect | null>(null);
  const [amountMode, setAmountMode] = useState<AmountMode>('signed');
  const [signedCol, setSignedCol] = useState<PageRect | null>(null);
  const [debitCol, setDebitCol] = useState<PageRect | null>(null);
  const [creditCol, setCreditCol] = useState<PageRect | null>(null);

  const [label, setLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stepIdx = STEP_ORDER.indexOf(step);
  const totalSteps = STEP_ORDER.length;

  function goTo(s: Step) {
    setErr(null);
    setStep(s);
  }
  const next = () => goTo(STEP_ORDER[stepIdx + 1] ?? step);
  const prev = () => goTo(STEP_ORDER[stepIdx - 1] ?? step);

  // The amount step is the only one with no fixed "next" — it submits instead.
  const isLast = step === 'amount';

  const amountReady =
    amountMode === 'signed' ? signedCol !== null : debitCol !== null && creditCol !== null;
  const canSubmit =
    !!tableRect && !!dateCol && !!descCol && amountReady && label.trim().length > 0;

  function buildZones(): TemplateZones | null {
    if (!tableRect || !dateCol || !descCol) return null;
    const cols: TemplateZones['columns'] = [
      { xStart: dateCol.x, xEnd: dateCol.x + dateCol.w, role: 'date' },
      { xStart: descCol.x, xEnd: descCol.x + descCol.w, role: 'description' },
    ];
    if (amountMode === 'signed') {
      if (!signedCol) return null;
      cols.push({ xStart: signedCol.x, xEnd: signedCol.x + signedCol.w, role: 'amountSigned' });
    } else {
      if (!debitCol || !creditCol) return null;
      cols.push({ xStart: debitCol.x, xEnd: debitCol.x + debitCol.w, role: 'debit' });
      cols.push({ xStart: creditCol.x, xEnd: creditCol.x + creditCol.w, role: 'credit' });
    }
    return {
      headerZone: { page: 0, ...headerRect },
      tableZone: { page: 0, ...tableRect },
      tableRepeatsPerPage: tableRepeats,
      columns: cols,
      rowsStartY: tableRect.y,
    };
  }

  async function handleSubmit() {
    const zones = buildZones();
    if (!zones || !label.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const result = await submitZones(needsTemplate.draftId, label.trim(), zones);
      onImported(result);
    } catch (e: any) {
      setErr(e?.message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  // Build the reference-rect overlay shown beneath the column-painting canvases:
  // - the table zone (always when inside a column step)
  // - any columns the user has already painted on prior column steps
  const columnRefs = (current: Step) => {
    if (!tableRect) return [];
    const refs: Array<{ rect: PageRect; label?: string; color?: string }> = [
      { rect: tableRect, label: 'Tableau', color: '#5b6478' },
    ];
    const add = (rect: PageRect | null, lbl: string, color: string) => {
      if (rect) refs.push({ rect, label: lbl, color });
    };
    if (current !== 'date') add(dateCol, 'Date', '#7dd3c0');
    if (current !== 'description') add(descCol, 'Libellé', '#7dd3c0');
    if (current !== 'amount') {
      if (amountMode === 'signed') add(signedCol, 'Montant', '#e69782');
      else {
        add(debitCol, 'Débit', '#e69782');
        add(creditCol, 'Crédit', '#e69782');
      }
    }
    return refs;
  };

  return (
    <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-ink-900 border border-ink-700 rounded-xl shadow-card max-w-5xl w-full max-h-[92vh] overflow-auto p-6 text-ink-100"
        style={{ backgroundColor: '#11141a', color: '#e6e8ed' }}
      >
        <div className="flex justify-between items-start mb-1">
          <h2 className="display text-xl text-ink-50" style={{ color: '#f4f5f8' }}>
            Définir le template PDF
          </h2>
          <button
            onClick={onClose}
            className="text-ink-300 hover:text-ink-50 transition text-lg leading-none px-2"
            aria-label="Fermer"
          >✕</button>
        </div>

        {/* step indicator strip */}
        <ol className="flex gap-2 mb-4 text-xs">
          {STEP_ORDER.map((s, i) => {
            const active = s === step;
            const done = i < stepIdx;
            return (
              <li
                key={s}
                className={
                  'px-2.5 py-1 rounded-full border transition ' +
                  (active
                    ? 'bg-sage-300 text-ink-950 border-sage-300 font-semibold'
                    : done
                    ? 'border-sage-300/60 text-sage-300'
                    : 'border-ink-700 text-ink-400')
                }
              >
                {i + 1}. {STEP_TITLE[s]}
              </li>
            );
          })}
        </ol>

        {needsTemplate.reason === 'no_text_layer' && (
          <div className="bg-clay-900/30 border border-clay-800/60 text-clay-200 p-3 rounded-lg mb-4 text-sm">
            Ce PDF semble être une image scannée. La sélection de zones fonctionne, mais l'extraction
            de lignes sera vide — l'OCR n'est pas encore disponible.
          </div>
        )}

        {/* ───────── step body ───────── */}

        {step === 'header' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50">
              Étape 1/{totalSteps} — Sélectionnez l'en-tête{' '}
              <span className="text-ink-400 font-normal">
                (utilisé pour reconnaître cette banque la prochaine fois)
              </span>.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={headerRect}
              paintColor={PAINT_COLOR.header}
              onChange={setHeaderRect}
            />
          </>
        )}

        {step === 'table' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50">
              Étape 2/{totalSteps} — Sélectionnez le tableau des transactions{' '}
              <span className="text-ink-400 font-normal">(toutes les lignes, en-tête de colonne incluse)</span>.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={tableRect}
              paintColor={PAINT_COLOR.table}
              onChange={setTableRect}
            />
            <label className="flex items-center gap-2 mt-4 text-sm text-ink-200">
              <input
                type="checkbox"
                checked={tableRepeats}
                onChange={(e) => setTableRepeats(e.target.checked)}
                className="accent-sage-300"
              />
              Le tableau se répète sur chaque page
            </label>
          </>
        )}

        {step === 'date' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50">
              Étape 3/{totalSteps} — Tracez la colonne <span className="text-sage-300">Date</span>{' '}
              <span className="text-ink-400 font-normal">à l'intérieur du tableau</span>.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={dateCol}
              referenceRects={columnRefs('date')}
              paintColor={PAINT_COLOR.date}
              onChange={setDateCol}
            />
          </>
        )}

        {step === 'description' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50">
              Étape 4/{totalSteps} — Tracez la colonne <span className="text-sage-300">Libellé</span>{' '}
              <span className="text-ink-400 font-normal">(description de la transaction)</span>.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={descCol}
              referenceRects={columnRefs('description')}
              paintColor={PAINT_COLOR.description}
              onChange={setDescCol}
            />
          </>
        )}

        {step === 'amount' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-50">
              Étape 5/{totalSteps} — Tracez la colonne <span className="text-clay-300">Montant</span>.
            </p>
            <fieldset className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="amount-mode"
                  checked={amountMode === 'signed'}
                  onChange={() => setAmountMode('signed')}
                  className="accent-clay-300"
                />
                <span>Une colonne <span className="text-ink-400">(montants positifs et négatifs)</span></span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="amount-mode"
                  checked={amountMode === 'pair'}
                  onChange={() => setAmountMode('pair')}
                  className="accent-clay-300"
                />
                <span>Deux colonnes <span className="text-ink-400">(Débit + Crédit)</span></span>
              </label>
            </fieldset>

            {amountMode === 'signed' ? (
              <>
                <p className="text-xs text-ink-300 mb-1">Colonne Montant</p>
                <ZoneCanvas
                  pngBase64={firstPage.pngBase64}
                  widthPt={firstPage.widthPt}
                  heightPt={firstPage.heightPt}
                  initialRect={signedCol}
                  referenceRects={columnRefs('amount')}
                  paintColor={PAINT_COLOR.amount}
                  onChange={setSignedCol}
                />
              </>
            ) : (
              <div className="grid gap-4">
                <div>
                  <p className="text-xs text-ink-300 mb-1">Colonne Débit</p>
                  <ZoneCanvas
                    pngBase64={firstPage.pngBase64}
                    widthPt={firstPage.widthPt}
                    heightPt={firstPage.heightPt}
                    initialRect={debitCol}
                    referenceRects={columnRefs('amount').filter((r) => r.label !== 'Crédit')}
                    paintColor={PAINT_COLOR.amount}
                    onChange={setDebitCol}
                    displayMaxWidth={520}
                  />
                </div>
                <div>
                  <p className="text-xs text-ink-300 mb-1">Colonne Crédit</p>
                  <ZoneCanvas
                    pngBase64={firstPage.pngBase64}
                    widthPt={firstPage.widthPt}
                    heightPt={firstPage.heightPt}
                    initialRect={creditCol}
                    referenceRects={columnRefs('amount').filter((r) => r.label !== 'Débit')}
                    paintColor={PAINT_COLOR.amount}
                    onChange={setCreditCol}
                    displayMaxWidth={520}
                  />
                </div>
              </div>
            )}

            <div className="mt-5">
              <label className="block text-sm text-ink-200 mb-1.5">Nom du template</label>
              <input
                className="w-full rounded-lg border border-ink-700 bg-ink-850 text-ink-100 placeholder-ink-500 px-3 py-2 text-sm focus:border-sage-300 focus:outline-none transition"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex: BNP — Compte Chèques"
              />
            </div>
            {err && <p className="mt-3 text-sm text-clay-300">{err}</p>}
          </>
        )}

        {/* ───────── nav buttons ───────── */}

        <div className="flex justify-between gap-2 mt-6">
          <button
            className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={prev}
            disabled={stepIdx === 0}
          >← Précédent</button>

          {!isLast ? (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={next}
              disabled={
                (step === 'table' && !tableRect) ||
                (step === 'date' && !dateCol) ||
                (step === 'description' && !descCol)
              }
            >Suivant →</button>
          ) : (
            <button
              className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >{submitting ? 'Import…' : 'Importer'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
