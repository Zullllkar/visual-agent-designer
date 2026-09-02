"use client";

export function GeneratingArtworkFace({ ghostSrc }: { ghostSrc?: string }) {
  return (
    <div className="vad-gen-card" aria-busy="true" aria-label="生成中">
      {ghostSrc ? (
        <img className="vad-gen-ghost" src={ghostSrc} alt="" draggable={false} />
      ) : null}
      <span className="vad-gen-glow" />
      <span className="vad-gen-scan" />
      <span className="vad-gen-orbit" />
      <span className="vad-gen-copy">
        生成中
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
