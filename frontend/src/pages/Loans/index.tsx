import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { listLoans, type Loan, type LoanDetail } from '../../api/loans';
import { todayLocalIso } from '../../lib/dates';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { LoanCard } from './LoanCard';
import { LoanDrawer } from './LoanDrawer';
import { sortLoans, type LoansTab } from './loan-list';
import { LoanEditor } from './editor/LoanEditor';
import { WhatIfPanel } from './whatif/WhatIfPanel';
import { ChangePaymentDialog } from './ChangePaymentDialog';
import { asSimulation, emptyForm, formFromLoan, type LoanForm } from './editor/form-state';

interface EditorState {
  title: string;
  form: LoanForm;
  loanId: number | null;
}

const TABS: LoansTab[] = ['loans', 'simulations'];

export function Loans() {
  const { t } = useTranslation('loans');
  const [params, setParams] = useSearchParams();
  const tab: LoansTab = params.get('tab') === 'simulations' ? 'simulations' : 'loans';
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['loans', 'list'], queryFn: listLoans });
  const shown = sortLoans(q.data?.loans ?? [], tab);

  const selectTab = (next: LoansTab) => {
    if (next === 'simulations') params.set('tab', 'simulations');
    else params.delete('tab');
    setParams(params, { replace: true });
  };

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [whatIf, setWhatIf] = useState<LoanDetail | null>(null);
  const [changing, setChanging] = useState<LoanDetail | null>(null);

  const openCreate = () => setEditor({
    title: t(tab === 'simulations' ? 'form.createSimulationTitle' : 'form.createTitle'),
    form: emptyForm(tab === 'simulations', todayLocalIso()),
    loanId: null,
  });
  const openEdit = (d: LoanDetail) =>
    setEditor({ title: t('form.editTitle'), form: formFromLoan(d.loan), loanId: d.loan.id });
  const openDuplicate = (d: LoanDetail) => setEditor({
    title: t('form.createSimulationTitle'),
    form: asSimulation(formFromLoan(d.loan), d.loan, t('form.copyName', { name: d.loan.name })),
    loanId: null,
  });
  const onSaved = (loan: Loan) => {
    setEditor(null);
    setOpenId(loan.id);
    if (loan.isSimulation !== (tab === 'simulations')) selectTab(loan.isSimulation ? 'simulations' : 'loans');
  };

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl">{t('title')}</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">{t('subtitle')}</p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreate}>
          {t(tab === 'simulations' ? 'actions.newSimulation' : 'actions.newLoan')}
        </button>
      </header>

      <div role="tablist" aria-label={t('title')} className="mb-4 flex gap-1">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => selectTab(k)}
            className={`px-3 py-1.5 text-xs rounded ${tab === k ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-100'}`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <LoadingBlock />
      ) : shown.length === 0 ? (
        <EmptyState title={t(`empty.${tab}.title`)} hint={t(`empty.${tab}.hint`)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((l) => (
            <LoanCard key={l.id} loan={l} onOpen={setOpenId} />
          ))}
        </div>
      )}
      {openId !== null && (
        <LoanDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={openEdit}
          onDuplicate={openDuplicate}
          onWhatIf={setWhatIf}
          onChangePayment={setChanging}
          onConverted={(loan) => {
            setOpenId(loan.id);
            if (tab === 'simulations') selectTab('loans');
          }}
        />
      )}
      {editor && (
        <LoanEditor
          key={`${editor.loanId ?? 'new'}-${editor.title}`}
          title={editor.title}
          initial={editor.form}
          loanId={editor.loanId}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
        />
      )}
      {whatIf && (
        <WhatIfPanel
          detail={whatIf}
          onClose={() => setWhatIf(null)}
          onSaveAsSimulation={(form) => {
            setWhatIf(null);
            setEditor({ title: t('form.createSimulationTitle'), form, loanId: null });
          }}
        />
      )}
      {changing && (
        <ChangePaymentDialog
          detail={changing}
          onCancel={() => setChanging(null)}
          onConfirm={(terms) => {
            const loan = changing.loan;
            setChanging(null);
            setEditor({ title: t('form.editTitle'), form: formFromLoan({ ...loan, ...terms }), loanId: loan.id });
          }}
        />
      )}
    </div>
  );
}
