import { useMemo, useState } from 'react';
import { ZoneCanvas, type PageRect } from './ZoneCanvas.js';
import { ColumnMapper, type Column } from './ColumnMapper.js';
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

type Step = 'header' | 'table' | 'columns' | 'submit';

export function PdfTemplateBuilder({ needsTemplate, onClose, onImported }: Props) {
  const firstPage = needsTemplate.pages[0]!;
  const [step, setStep] = useState<Step>('header');
  const [headerRect, setHeaderRect] = useState<PageRect>(
    needsTemplate.suggestedZones?.headerZone ?? {
      x: 0, y: 0, w: firstPage.widthPt, h: firstPage.heightPt * 0.15,
    },
  );
  const [tableRect, setTableRect] = useState<PageRect | null>(
    needsTemplate.suggestedZones
      ? {
          x: needsTemplate.suggestedZones.tableZone.x,
          y: needsTemplate.suggestedZones.tableZone.y,
          w: needsTemplate.suggestedZones.tableZone.w,
          h: needsTemplate.suggestedZones.tableZone.h,
        }
      : null,
  );
  const [columns, setColumns] = useState<Column[]>(needsTemplate.suggestedZones?.columns ?? []);
  const [tableRepeats, setTableRepeats] = useState<boolean>(
    needsTemplate.suggestedZones?.tableRepeatsPerPage ?? true,
  );
  const [label, setLabel] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const columnsValid = useMemo(() => {
    const d = columns.filter((c) => c.role === 'date').length;
    const desc = columns.filter((c) => c.role === 'description').length;
    const s = columns.filter((c) => c.role === 'amountSigned').length;
    const db = columns.filter((c) => c.role === 'debit').length;
    const cr = columns.filter((c) => c.role === 'credit').length;
    if (d !== 1 || desc !== 1) return false;
    return (s === 1 && db === 0 && cr === 0) || (s === 0 && db === 1 && cr === 1);
  }, [columns]);

  async function handleSubmit() {
    if (!tableRect) return;
    setSubmitting(true);
    setErr(null);
    try {
      const zones: TemplateZones = {
        headerZone: { page: 0, ...headerRect },
        tableZone: { page: 0, ...tableRect },
        tableRepeatsPerPage: tableRepeats,
        columns,
        rowsStartY: tableRect.y,
      };
      const result = await submitZones(needsTemplate.draftId, label || 'Untitled', zones);
      onImported(result);
    } catch (e: any) {
      setErr(e?.message ?? 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-ink-900 border border-ink-800 rounded-xl shadow-card max-w-4xl w-full max-h-[90vh] overflow-auto p-6 text-ink-100">
        <div className="flex justify-between items-center mb-5">
          <h2 className="display text-xl text-ink-50">Définir le template PDF</h2>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 transition text-lg leading-none px-2"
            aria-label="Fermer"
          >✕</button>
        </div>
        {needsTemplate.reason === 'no_text_layer' && (
          <div className="bg-clay-900/30 border border-clay-800/60 text-clay-200 p-3 rounded-lg mb-4 text-sm">
            Ce PDF semble être une image scannée. La sélection de zones fonctionne, mais l'extraction
            de lignes sera vide — l'OCR n'est pas encore disponible.
          </div>
        )}

        {step === 'header' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-100">
              Étape 1/3 — Sélectionnez l'en-tête <span className="text-ink-400 font-normal">(utilisé pour reconnaître cette banque la prochaine fois)</span>.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={headerRect}
              onChange={setHeaderRect}
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition"
                onClick={() => setStep('table')}
              >Suivant →</button>
            </div>
          </>
        )}

        {step === 'table' && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-100">
              Étape 2/3 — Sélectionnez le tableau des transactions.
            </p>
            <ZoneCanvas
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              initialRect={tableRect}
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
            <div className="flex justify-between gap-2 mt-5">
              <button
                className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition"
                onClick={() => setStep('header')}
              >← Précédent</button>
              <button
                className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!tableRect}
                onClick={() => setStep('columns')}
              >Suivant →</button>
            </div>
          </>
        )}

        {step === 'columns' && tableRect && (
          <>
            <p className="mb-3 text-sm font-medium text-ink-100">
              Étape 3/3 — Étiquetez chaque colonne.
            </p>
            <ColumnMapper
              pngBase64={firstPage.pngBase64}
              widthPt={firstPage.widthPt}
              heightPt={firstPage.heightPt}
              textItems={needsTemplate.textItems}
              tableRect={tableRect}
              initialColumns={columns.length > 0 ? columns : null}
              onChange={setColumns}
            />
            <div className="mt-5">
              <label className="block text-sm text-ink-200 mb-1.5">Nom du template</label>
              <input
                className="w-full rounded-lg border border-ink-700 bg-ink-850 text-ink-100 placeholder-ink-500 px-3 py-2 text-sm focus:border-sage-300 focus:outline-none transition"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex: BNP — Compte Chèques"
              />
            </div>
            {!columnsValid && (
              <p className="mt-3 text-sm text-clay-200">
                Il faut exactement 1 colonne Date, 1 colonne Libellé, et soit 1 Montant (signé), soit 1 Débit + 1 Crédit.
              </p>
            )}
            {err && (
              <p className="mt-3 text-sm text-clay-300">{err}</p>
            )}
            <div className="flex justify-between gap-2 mt-5">
              <button
                className="px-4 py-2 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition"
                onClick={() => setStep('table')}
              >← Précédent</button>
              <button
                className="px-4 py-2 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!columnsValid || submitting || !label.trim()}
                onClick={handleSubmit}
              >{submitting ? 'Import…' : 'Importer'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
