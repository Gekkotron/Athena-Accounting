import { Trans, useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { Transaction } from '../../api/types';
import { truncate } from './lib';

type Props = {
  deletingTx: Transaction | null;
  deleteError: string | null;
  isDeleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  confirmBulkDelete: boolean;
  bulkDeleteCount: number;
  bulkDeleteError: string | null;
  isBulkDeleting: boolean;
  onConfirmBulkDelete: () => void;
  onCancelBulkDelete: () => void;
};

export function TransactionsConfirmDialogs({
  deletingTx,
  deleteError,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  confirmBulkDelete,
  bulkDeleteCount,
  bulkDeleteError,
  isBulkDeleting,
  onConfirmBulkDelete,
  onCancelBulkDelete,
}: Props) {
  const { t } = useTranslation(['transactions', 'common']);
  return (
    <>
      <ConfirmDialog
        open={!!deletingTx}
        title={
          deletingTx
            ? t('deleteDialog.title', { label: truncate(deletingTx.rawLabel, 40) })
            : ''
        }
        description={
          <Trans i18nKey="transactions:deleteDialog.description">
            Cette action est <span className="display-italic">irréversible</span>. Si la
            transaction fait partie d'un virement interne, la jambe miroir est délinkée
            (transfer_group_id mis à null) pour ne pas devenir invisible dans les agrégats.
          </Trans>
        }
        confirmLabel={t('deleteDialog.confirmLabel')}
        destructive
        busy={isDeleting}
        error={deleteError}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={t('bulkDeleteDialog.title', { count: bulkDeleteCount })}
        description={
          <Trans i18nKey="transactions:bulkDeleteDialog.description">
            Cette action est <span className="display-italic">irréversible</span>. Toute
            jambe miroir de virement interne est délinkée avant la suppression.
          </Trans>
        }
        confirmLabel={t('delete', { ns: 'common' })}
        destructive
        busy={isBulkDeleting}
        error={bulkDeleteError}
        onConfirm={onConfirmBulkDelete}
        onCancel={onCancelBulkDelete}
      />
    </>
  );
}
