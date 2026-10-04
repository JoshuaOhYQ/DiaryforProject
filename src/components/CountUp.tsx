import { useEffect, useState } from 'react';

const NUMBER = /\d+(?:\.\d+)?/;
const DURATION = 900;

/**
 * Shows a value like "12.5 h" or "4", counting the number up from 0 when it first appears or
 * changes. Text around the number is kept. Screen readers (and reduced motion) get the final value.
 */
export function CountUp({ value }: { value: string }) {
  const match = NUMBER.exec(value);
  const target = match ? Number(match[0]) : 0;
  const decimals = match?.[0].split('.')[1]?.length ?? 0;
  const [shown, setShown] = useState(() => (match && !reducedMotion() ? 0 : target));

  useEffect(() => {
    if (!target || reducedMotion()) {
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setShown(target * (1 - Math.pow(1 - t, 4))); // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  if (!match) return <>{value}</>;
  const text = value.slice(0, match.index) + shown.toFixed(decimals) + value.slice(match.index + match[0].length);
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
