export function InspectorProjectSummary({
  title,
  description,
  targetLabel,
  visualStyle,
}: {
  title: string;
  description: string;
  targetLabel: string;
  visualStyle?: string;
}) {
  return (
    <section className="vad-inspector-summary">
      <div className="vad-inspector-summary-head">
        <span className="vad-inspector-summary-mark" aria-hidden />
        <div className="min-w-0">
          <p className="vad-inspector-hero-title">{title}</p>
          <p className="vad-inspector-copy vad-inspector-summary-copy">{description}</p>
        </div>
      </div>

      <div className="vad-inspector-meta">
        <span className="app-badge">{targetLabel}</span>
      </div>

      {visualStyle ? (
        <div className="vad-inspector-style">
          <span className="vad-inspector-style-label">视觉语言</span>
          <p className="vad-inspector-style-value">{visualStyle}</p>
        </div>
      ) : null}
    </section>
  );
}
