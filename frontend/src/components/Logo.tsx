interface Props {
  size?: number;
  className?: string;
}

// Brand mark for Athena Accounting — a stylised chouette (Athena's owl)
// generated as a PNG and stored at /owl-logo.png. The image already includes
// the dark rounded-square plaque, so it slots into both light-on-dark
// (sidebar, login) and standalone contexts without restyling.
//
// Prefixing with import.meta.env.BASE_URL keeps the src correct in both
// the root-deployed builds (Docker/Tauri, BASE_URL='/') and the demo
// build served under /Athena-Accounting/demo/. BASE_URL always ends with
// a slash, so string concatenation gives one clean slash.
export function Logo({ size = 28, className = '' }: Props) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}owl-logo.png`}
      alt="Athena Accounting"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
