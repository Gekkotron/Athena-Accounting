import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { getSettings, patchSettings } from '../api/settings';
import { DEFAULTS, type Settings } from './settings';

export function useSettings(): {
  settings: Settings;
  isReady: boolean;
  patch: (p: Partial<Settings>) => void;
  mutation: UseMutationResult<{ settings: Settings }, Error, Partial<Settings>>;
} {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const mut = useMutation({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<{ settings: Settings }>(['settings']);
      qc.setQueryData(['settings'], {
        settings: { ...(prev?.settings ?? DEFAULTS), ...patch },
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  return {
    settings: q.data?.settings ?? DEFAULTS,
    isReady: !q.isLoading,
    patch: mut.mutate,
    mutation: mut,
  };
}
