interface Props {
  size?: number;
  className?: string;
}

// Brand mark for Athena Accounting — a stylised chouette (Athena's owl)
// generated as a PNG and stored at /owl-logo.png. The image already includes
// the dark rounded-square plaque, so it slots into both light-on-dark
// (sidebar, login) and standalone contexts without restyling.
export function Logo({ size = 28, className = '' }: Props) {
  return (
    <img
      src="/owl-logo.png"
      alt="Athena Accounting"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
