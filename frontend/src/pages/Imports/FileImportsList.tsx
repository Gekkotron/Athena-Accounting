import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Account, FileImport } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import { getAccountName } from '../../lib/accounts';

export function FileImportsList({
  imports, accounts, onRequestDelete,
}: {
  imports: FileImport[];
  accounts: Account[];
  onRequestDelete: (fileImport: FileImport) => void;
}): JSX.Element {
  const { t } = useTranslation('imports');
  return (
    <section>
      <div className="section-rule mb-4">{t('fileImports.sectionTitle')}</div>
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">{t('fileImports.table.file')}</th>
                <th className="px-4 py-3 label font-normal">{t('fileImports.table.account')}</th>
                <th className="px-4 py-3 label font-normal">{t('fileImports.table.format')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('fileImports.table.read')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('fileImports.table.inserted')}</th>
                <th className="px-4 py-3 label font-normal text-right">{t('fileImports.table.dedup')}</th>
                <th className="px-4 py-3 label font-normal">{t('fileImports.table.when')}</th>
                <th className="px-4 py-3 label font-normal w-8"></th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-500 display-italic">
                    {t('fileImports.empty')}
                  </td>
                </tr>
              ) : (
                imports.map((i) => (
                  <tr key={i.id} className="border-b border-ink-800/40 last:border-0">
                    <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{i.filename}</td>
                    <td className="px-4 py-2.5 text-ink-300">{getAccountName(accounts, i.accountId)}</td>
                    <td className="px-4 py-2.5"><span className="badge">{i.format}</span></td>
                    <td className="px-4 py-2.5 text-right text-ink-300 font-mono">{i.totalLines}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {i.insertedCount > 0 ? (
                        <Link
                          to={`/transactions?sourceFileId=${i.id}`}
                          className="text-sage-300 hover:text-sage-200 underline-offset-2 hover:underline transition"
                          title={t('fileImports.viewTransactionsTitle')}
                        >
                          {i.insertedCount}
                        </Link>
                      ) : (
                        <span className="text-sage-300">{i.insertedCount}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-400 font-mono">{i.dedupSkipped}</td>
                    <td className="px-4 py-2.5 text-ink-400 text-xs whitespace-nowrap">{formatDateTime(i.importedAt)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        className="text-ink-500 hover:text-clay-300 transition px-1"
                        onClick={() => onRequestDelete(i)}
                        title={t('fileImports.deleteTitle')}
                        aria-label={t('fileImports.deleteAriaLabel')}
                      >🗑</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
