"use client";

import type { ReactNode } from "react";

function SelectionFrame({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <svg
      className="vad-first-run-svg"
      viewBox="0 0 360 280"
      fill="none"
      role="img"
      aria-hidden
      aria-label="向导插画"
    >
      <title>向导插画</title>
      <rect
        x="28"
        y="28"
        width="304"
        height="224"
        rx="6"
        stroke="var(--primary)"
        strokeWidth="1.6"
        strokeDasharray={dashed ? "5 5" : undefined}
      />
      {[
        [22, 22],
        [326, 22],
        [22, 246],
        [326, 246],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="12"
          height="12"
          rx="1"
          fill="var(--surface)"
          stroke="var(--primary)"
          strokeWidth="1.6"
        />
      ))}
      {children}
    </svg>
  );
}

export function WelcomeArt() {
  return (
    <SelectionFrame>
      <rect x="52" y="52" width="256" height="176" rx="8" fill="var(--surface)" />
      <rect x="52" y="52" width="256" height="176" rx="8" stroke="var(--border)" strokeWidth="1" />
      <rect x="52" y="52" width="44" height="176" rx="8" fill="var(--surface-muted)" />
      <rect x="68" y="72" width="12" height="12" rx="2" fill="var(--primary)" />
      <rect x="68" y="96" width="12" height="8" rx="1.5" fill="currentColor" opacity="0.28" />
      <rect x="68" y="112" width="12" height="8" rx="1.5" fill="currentColor" opacity="0.28" />
      <rect x="68" y="128" width="12" height="8" rx="1.5" fill="currentColor" opacity="0.28" />
      <rect x="112" y="72" width="72" height="10" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="112" y="96" width="56" height="40" rx="4" fill="var(--primary-soft)" />
      <rect x="176" y="104" width="56" height="40" rx="4" fill="var(--surface-muted)" />
      <rect x="240" y="112" width="48" height="40" rx="4" fill="var(--surface-muted)" />
      <path d="M168 116 H176 M232 124 H240" stroke="var(--primary)" strokeWidth="1.4" />
      <circle cx="168" cy="116" r="2.2" fill="var(--primary)" />
      <circle cx="240" cy="124" r="2.2" fill="var(--primary)" />
      <rect x="112" y="160" width="176" height="44" rx="4" fill="var(--background)" />
      <rect x="124" y="172" width="48" height="20" rx="3" fill="var(--surface-muted)" />
      <rect x="180" y="172" width="48" height="20" rx="3" fill="var(--surface-muted)" />
      <rect x="236" y="172" width="40" height="20" rx="3" fill="var(--primary)" />
    </SelectionFrame>
  );
}

export function WorkflowArt() {
  return (
    <svg
      className="vad-first-run-svg"
      viewBox="0 0 360 220"
      fill="none"
      role="img"
      aria-hidden
      aria-label="工作方式"
    >
      <title>工作方式</title>
      <WorkflowCard x={18} n="1" active={false}>
        <path
          d="M46 92h28a8 8 0 0 1 8 8v18H46a8 8 0 0 1-8-8v-10a8 8 0 0 1 8-8Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="78" cy="104" r="3" fill="var(--primary)" />
      </WorkflowCard>
      <line x1="122" y1="110" x2="148" y2="110" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="135" cy="110" r="3" fill="var(--primary)" />
      <WorkflowCard x={148} n="2" active>
        <rect
          x="172"
          y="86"
          width="26"
          height="32"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x="206"
          y="92"
          width="26"
          height="32"
          rx="3"
          stroke="var(--primary)"
          strokeWidth="1.8"
        />
      </WorkflowCard>
      <line x1="252" y1="110" x2="278" y2="110" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="265" cy="110" r="3" fill="currentColor" opacity="0.35" />
      <WorkflowCard x={278} n="3" active={false}>
        <path
          d="M306 86h28v8l-6 4v34h-22V86Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M312 104h16M312 112h12" stroke="currentColor" strokeWidth="1.4" />
      </WorkflowCard>
    </svg>
  );
}

function WorkflowCard({
  x,
  n,
  active,
  children,
}: {
  x: number;
  n: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <g>
      <rect
        x={x}
        y="48"
        width="104"
        height="124"
        rx="10"
        fill="var(--surface)"
        stroke={active ? "var(--primary)" : "var(--border)"}
        strokeWidth={active ? 1.8 : 1.2}
      />
      <circle
        cx={x + 22}
        cy="70"
        r="11"
        stroke={active ? "var(--primary)" : "currentColor"}
        strokeWidth="1.4"
      />
      <text
        x={x + 22}
        y="74"
        textAnchor="middle"
        fill={active ? "var(--primary)" : "currentColor"}
        fontSize="11"
        fontWeight="650"
      >
        {n}
      </text>
      {children}
    </g>
  );
}

function ModelPanel({ x, active, children }: { x: number; active: boolean; children: ReactNode }) {
  const at = (n: number) => x + n;
  return (
    <g>
      <rect
        x={x}
        y="64"
        width="118"
        height="152"
        rx="10"
        fill="var(--surface)"
        stroke={active ? "var(--primary)" : "var(--border)"}
        strokeWidth={active ? 1.8 : 1.2}
      />
      <g
        transform={`translate(${at(14)} 80)`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        {children}
      </g>
      <rect x={at(46)} y="88" width="48" height="8" rx="2" fill="currentColor" opacity="0.5" />
      <line x1={at(14)} y1="118" x2={at(104)} y2="118" stroke="var(--border)" strokeWidth="1" />

      <rect x={at(14)} y="132" width="90" height="16" rx="3" fill="var(--surface-muted)" />
      <rect
        x={at(20)}
        y="138.5"
        width="46"
        height="3"
        rx="1.5"
        fill="currentColor"
        opacity="0.28"
      />

      <rect x={at(14)} y="156" width="90" height="16" rx="3" fill="var(--surface-muted)" />
      <g
        transform={`translate(${at(20)} 159)`}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      >
        <path d="M2.6 4.2V3a2.4 2.4 0 0 1 4.8 0v1.2" />
        <rect x="0.9" y="4.2" width="8.2" height="5.9" rx="1.6" />
      </g>
      {[0, 1, 2, 3, 4].map((dot) => (
        <circle
          key={dot}
          cx={at(38 + dot * 5.5)}
          cy="164"
          r="1.3"
          fill="currentColor"
          opacity="0.32"
        />
      ))}

      <rect x={at(14)} y="180" width="90" height="16" rx="3" fill="var(--surface-muted)" />
      <rect
        x={at(20)}
        y="186.5"
        width="38"
        height="3"
        rx="1.5"
        fill="currentColor"
        opacity="0.28"
      />
      <path
        d={`M${at(89)} 186.5l3.5 3.5 3.5-3.5`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
    </g>
  );
}

export function ModelsArt() {
  return (
    <SelectionFrame>
      <ModelPanel x={52} active>
        <path d="M5 2h14a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-7l-6 4.5V17H5a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" />
        <circle cx="7" cy="9.5" r="1.5" fill="var(--primary)" stroke="none" />
        <circle cx="12" cy="9.5" r="1.5" fill="var(--primary)" stroke="none" />
        <circle cx="17" cy="9.5" r="1.5" fill="var(--primary)" stroke="none" />
      </ModelPanel>

      <ModelPanel x={190} active={false}>
        <rect x="1" y="3" width="22" height="18" rx="3" />
        <circle cx="7.5" cy="9" r="2" fill="var(--primary)" stroke="none" />
        <path d="M2.5 20 9 12.5l4.5 5 3-3 5 5.5" />
      </ModelPanel>
    </SelectionFrame>
  );
}
