import Link from "next/link";

export function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="EchoLens home">
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="none" stroke="#2c2f36" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="#4f8ff7" strokeWidth="2" />
        <path d="M12 1.5 A10.5 10.5 0 0 1 22.5 12" fill="none" stroke="#4f8ff7" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        <circle cx="12" cy="12" r="2.4" fill="#e8e9ec" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">EchoLens</span>
    </Link>
  );
}
