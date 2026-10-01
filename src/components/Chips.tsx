import { useProject } from '../app/context.ts';
import { useResolvedTheme } from '../app/theme.ts';
import { displayColour } from '../lib/colours.ts';

export function Swatch({ colour, round }: { colour: string; round?: boolean }) {
  const theme = useResolvedTheme();
  return <span className={`swatch${round ? ' round' : ''}`} style={{ background: displayColour(colour, theme) }} aria-hidden="true" />;
}

export function MemberChip({ id }: { id: string }) {
  const m = useProject().memberById.get(id);
  return (
    <span className="chip">
      <Swatch colour={m?.colour ?? '#999'} round />
      <span className="label">{m?.name ?? 'Unknown member'}</span>
    </span>
  );
}

export function FeatureChip({ id }: { id: string | null }) {
  const { featureById } = useProject();
  if (!id) return <span className="chip muted">No feature</span>;
  const f = featureById.get(id);
  return (
    <span className="chip">
      <Swatch colour={f?.colour ?? '#999'} />
      <span className="label">{f?.name ?? 'Deleted feature'}</span>
    </span>
  );
}

/** A row of toggle pills, e.g. for choosing owners or assignees. */
export function PillToggles<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; colour?: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  label?: string;
}) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            className="pill"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
          >
            {o.colour && <Swatch colour={o.colour} round />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
