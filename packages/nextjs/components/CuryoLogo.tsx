import Image from "next/image";

/**
 * Shared RateLoop logo wrapper.
 */
export function CuryoLogo({ className = "h-8 w-8", idPrefix }: { className?: string; idPrefix?: string }) {
  void idPrefix;

  return (
    <Image
      src="/rateloop-logo.svg"
      alt=""
      aria-hidden="true"
      width={128}
      height={128}
      className={className}
      sizes="36px"
    />
  );
}
