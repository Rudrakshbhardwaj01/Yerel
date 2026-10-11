import Image from 'next/image';

export function Brand({ symbolOnly = false, className = '' }: { symbolOnly?: boolean; className?: string }) {
  return (
    <span className={`brand-lockup ${symbolOnly ? 'brand-lockup-symbol' : ''} ${className}`.trim()} aria-label={symbolOnly ? 'Yerel' : undefined}>
      <Image className="brand-symbol" src="/logo.svg" alt="" width={34} height={34} priority />
      {!symbolOnly && <span className="brand-wordmark">YEREL</span>}
    </span>
  );
}
