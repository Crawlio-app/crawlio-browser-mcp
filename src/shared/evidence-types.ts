// Typed evidence records for Method Mode smart methods.
// Interfaces only — no runtime code.

import type { PageCapture } from "./types.js";

// --- Phase 2: Evidence Records ---

export interface AccessibilitySummary {
  nodeCount: number;
  landmarkCount: number;
  imagesWithoutAlt: number;
  headingStructure: Array<{ level: number; text: string }>;
}

export interface MobileReadiness {
  hasViewportMeta: boolean;
  viewportContent: string | null;
  mediaQueryCount: number;
  isOverflowing: boolean;
}

export interface PageEvidence {
  capture: PageCapture | Record<string, unknown>;
  performance: Record<string, unknown> | null;
  security: Record<string, unknown> | null;
  fonts: Record<string, unknown> | null;
  meta: PageMeta | null;
  accessibility: AccessibilitySummary | null;
  mobileReadiness: MobileReadiness | null;
}

export interface PageMeta {
  _title: string;
  _canonical: string | null;
  _structuredData: unknown[];
  _headings: Array<{ level: string; text: string }>;
  _nav: string[];
  [key: string]: unknown;
}

export interface ScrollSection {
  index: number;
  scrollY: number;
  screenshot: string;
}

export interface ScrollEvidence {
  sectionCount: number;
  sections: ScrollSection[];
}

export interface IdleStatus {
  status: "idle" | "timeout";
}

export interface ComparisonEvidence {
  siteA: PageEvidence & { url: string; gaps: CoverageGap[] };
  siteB: PageEvidence & { url: string; gaps: CoverageGap[] };
  scaffold: ComparisonScaffold;
}

// --- Phase 3: Findings ---

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Finding {
  claim: string;
  evidence: string[];
  sourceUrl: string;
  confidence: ConfidenceLevel;
  method: string;
  dimension?: string;
  confidenceCapped?: boolean;
  cappedBy?: string;
}

// --- Phase 4: Coverage Gaps ---

export type GapImpact = "data-absent" | "data-stale" | "method-failed" | "timeout";

export interface CoverageGap {
  dimension: string;
  reason: string;
  impact: GapImpact;
  reducesConfidence: boolean;
}

export type ObservationType = "present" | "absent" | "degraded";

export interface Observation {
  type: ObservationType;
  dimension: string;
  value?: unknown;
  gap?: CoverageGap;
}

// --- Phase 5: Comparison Scaffolds ---

export interface DimensionSlot {
  name: string;
  siteA: Observation;
  siteB: Observation;
  comparable: boolean;
}

export interface ComparableMetric {
  name: string;
  siteA: number | null;
  siteB: number | null;
  unit?: string;
}

export interface ComparisonScaffold {
  dimensions: DimensionSlot[];
  sharedFields: string[];
  missingFields: { siteA: string[]; siteB: string[] };
  metrics: ComparableMetric[];
}

// --- Phase 6: Method Telemetry ---

export interface StepTrace {
  name: string;
  elapsed: number;
  success: boolean;
  fallback?: string;
}

export interface MethodTrace {
  method: string;
  startedAt: number;
  elapsed: number;
  steps: StepTrace[];
  outcome: "success" | "partial" | "timeout" | "error";
}
