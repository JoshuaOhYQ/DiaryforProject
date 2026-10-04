interface Props {
  id: string;
  projects: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}

/** Choose one of the locked log book's projects (names come from data/lock.json). */
export function ProjectSelect({ id, projects, value, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor={id}>Project</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && (
          <option value="" disabled>
            Choose a project…
          </option>
        )}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
