import { Logo } from '../Logo';

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={28} className="text-sage-300 shrink-0" />
      <div className="flex flex-col leading-none">
        <span className="display text-[20px] text-ink-50 tracking-tight">Athena</span>
        <span className="display-italic text-[12px] text-ink-500 mt-0.5">Accounting</span>
      </div>
    </div>
  );
}
