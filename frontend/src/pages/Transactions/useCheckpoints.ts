import { useQuery } from '@tanstack/react-query';
import { listCheckpoints } from '../../api/checkpoints';
import type { BalanceCheckpoint, Transaction } from '../../api/types';

interface CheckpointMutations {
  accountId: number | undefined;
  createCheckpointM: {
    mutate: (vars: { accountId: number; date: string; amount: string }) => void;
  };
  removeCheckpointM: {
    mutate: (vars: { accountId: number; cpId: number }) => void;
  };
  setPendingCheckpointDate: (date: string | null) => void;
}

// Balance-checkpoint state for the transactions table: the per-account
// checkpoint list, keyed by date, plus the toggle handler the running-balance
// column uses to create/remove a checkpoint on a given row.
export function useCheckpoints({
  accountId,
  createCheckpointM,
  removeCheckpointM,
  setPendingCheckpointDate,
}: CheckpointMutations) {
  const checkpointsQ = useQuery({
    queryKey: ['balance-checkpoints', accountId],
    queryFn: () => listCheckpoints(accountId!),
    enabled: accountId != null,
  });

  const checkpointByDate: Map<string, BalanceCheckpoint> = new Map(
    (checkpointsQ.data?.checkpoints ?? []).map((c) => [c.checkpointDate, c] as const),
  );

  const onToggleCheckpoint = (tx: Transaction, checked: boolean) => {
    if (accountId == null || tx.runningBalance == null) return;
    setPendingCheckpointDate(tx.date);
    if (checked) {
      createCheckpointM.mutate({ accountId, date: tx.date, amount: tx.runningBalance });
    } else {
      const cp = checkpointByDate.get(tx.date);
      if (cp) removeCheckpointM.mutate({ accountId, cpId: cp.id });
      else setPendingCheckpointDate(null);
    }
  };

  return { checkpointByDate, onToggleCheckpoint };
}
