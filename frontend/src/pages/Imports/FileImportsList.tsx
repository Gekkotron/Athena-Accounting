import { Link } from 'react-router-dom';
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
  return (
    <section>
      <div className="section-rule mb-4">Historique</div>
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">Fichier</th>
                <th className="px-4 py-3 label font-normal">Compte</th>
                <th className="px-4 py-3 label font-normal">Format</th>
                <th className="px-4 py-3 label font-normal text-right">Lues</th>
                <th className="px-4 py-3 label font-normal text-right">Insérées</th>
                <th className="px-4 py-3 label font-normal text-right">Dédup.</th>
                <th className="px-4 py-3 label font-normal">Quand</th>
                <th className="px-4 py-3 label font-normal w-8"></th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-500 display-italic">
                    Aucun import pour l'instant.
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
                          title="Voir les transactions issues de cet import"
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
                        title="Supprimer cet import et toutes ses transactions"
                        aria-label="Supprimer l'import"
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
