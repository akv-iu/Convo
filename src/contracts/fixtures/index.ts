/**
 * Hand-written fixtures for the fake API and the contract tests.
 * Day 0 task for A and B: grow this to 20 people and 10 sample asks.
 * The 500 generated profiles live in scripts/seed and only go to Elasticsearch.
 */
import type { EvidenceDoc, Person, RorMatch } from "../types";

/** Build day, Mountain Standard Time. */
export const CONFERENCE_DAY = "2026-11-09";
const tz = "-07:00";
export const block = (from: string, to: string) => ({
  start: `${CONFERENCE_DAY}T${from}:00${tz}`,
  end: `${CONFERENCE_DAY}T${to}:00${tz}`,
});

export const DEMO_USER_A = "u_demo_a";
export const DEMO_USER_B = "u_demo_b";

export const ror: RorMatch[] = [
  { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" },
  { id: "https://ror.org/042nb2s44", name: "Massachusetts Institute of Technology", country: "US" },
  { id: "https://ror.org/03vek6s52", name: "Harvard University", country: "US" },
  { id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" },
  { id: "https://ror.org/013meh722", name: "University of Cambridge", country: "GB" },
  { id: "https://ror.org/00njsd438", name: "Google", country: "US" },
  { id: "https://ror.org/00d0nc645", name: "Microsoft", country: "US" },
  { id: "https://ror.org/01jm5k213", name: "Red Hat", country: "US" },
  { id: "https://ror.org/04z8jg394", name: "Grafana Labs", country: "US" },
  { id: "https://ror.org/05dxps055", name: "California Institute of Technology", country: "US" },
  { id: "https://ror.org/03yrm5c26", name: "California Polytechnic State University", country: "US" },
  { id: "https://ror.org/01p7jjy08", name: "Brigham Young University", country: "US" },
  { id: "https://ror.org/03r0ha626", name: "University of Utah", country: "US" },
  { id: "https://ror.org/02rrk5m52", name: "Utah State University", country: "US" },
  { id: "https://ror.org/01bj3aw27", name: "United States Department of Energy", country: "US" },
  { id: "https://ror.org/05ektbh42", name: "Netflix", country: "US" },
  { id: "https://ror.org/02dg8fs35", name: "Datadog", country: "US" },
  { id: "https://ror.org/00hj54h04", name: "University of Toronto", country: "CA" },
  { id: "https://ror.org/01f80g185", name: "University of Edinburgh", country: "GB" },
  { id: "https://ror.org/05qghxh33", name: "Technical University of Munich", country: "DE" },
];

export const people: Person[] = [
  {
    id: DEMO_USER_A,
    name: "Demo Requester",
    githubLogin: "demo-requester",
    bio: "Platform engineer learning Kubernetes internals.",
    languages: ["Go", "TypeScript"],
    organisations: ["cncf"],
    filters: { country: "US", rorId: "https://ror.org/03r0ha626", hiring: false },
    synthetic: false,
    freeTimes: [block("09:00", "10:00"), block("13:00", "14:30"), block("16:30", "17:30")],
  },
  {
    id: DEMO_USER_B,
    name: "Demo Expert",
    githubLogin: "demo-expert",
    bio: "Maintainer on the Kubernetes scheduler; happy to talk preemption.",
    languages: ["Go"],
    organisations: ["kubernetes", "kubernetes-sigs"],
    filters: { country: "US", rorId: "https://ror.org/01jm5k213", hiring: true },
    synthetic: false,
    freeTimes: [block("09:30", "10:30"), block("13:00", "14:00"), block("16:00", "17:30")],
  },
  {
    id: "p_001",
    name: "Priya Natarajan",
    githubLogin: "priyan",
    bio: "SRE at Grafana Labs. Loki and Tempo on call, Go and Rust by day.",
    languages: ["Go", "Rust"],
    organisations: ["grafana"],
    filters: { country: "US", rorId: "https://ror.org/04z8jg394", hiring: true },
    synthetic: true,
    freeTimes: [block("10:30", "11:00"), block("13:00", "14:30")],
  },
  {
    id: "p_002",
    name: "Tomasz Wierzbicki",
    githubLogin: "twierz",
    bio: "Works on etcd and Raft. Occasionally breaks clusters on purpose.",
    languages: ["Go"],
    organisations: ["etcd-io"],
    filters: { country: "DE", rorId: "https://ror.org/05qghxh33", hiring: false },
    synthetic: true,
    freeTimes: [block("09:00", "09:30"), block("16:30", "17:00")],
  },
  {
    id: "p_003",
    name: "Aisha Bello",
    githubLogin: "aishab",
    bio: "OpenTelemetry collector contributor; traces, metrics and the occasional log.",
    languages: ["Go", "Python"],
    organisations: ["open-telemetry"],
    filters: { country: "GB", rorId: "https://ror.org/052gg0110", hiring: false },
    synthetic: true,
    freeTimes: [block("13:30", "14:30"), block("16:30", "17:30")],
  },
  {
    id: "p_004",
    name: "Marcus Lindqvist",
    githubLogin: "mlind",
    bio: "Hiring manager for platform at Netflix. Ask me how the loop works.",
    languages: ["Java", "Kotlin"],
    organisations: ["netflix"],
    filters: { country: "US", rorId: "https://ror.org/05ektbh42", hiring: true },
    synthetic: true,
    freeTimes: [block("09:00", "10:00"), block("13:00", "13:30")],
  },
  {
    id: "p_005",
    name: "Yuki Tanaka",
    githubLogin: "ytanaka",
    bio: "Argo CD maintainer. GitOps, application sets, sync waves.",
    languages: ["Go", "TypeScript"],
    organisations: ["argoproj"],
    filters: { country: "US", rorId: "https://ror.org/00njsd438", hiring: false },
    synthetic: true,
    freeTimes: [block("10:30", "11:00"), block("16:30", "17:30")],
  },
  {
    id: "p_006",
    name: "Elena Petrova",
    githubLogin: "epetrova",
    bio: "Researches scheduling for ML workloads; PhD student at Toronto.",
    languages: ["Python", "C++"],
    organisations: ["kubeflow"],
    filters: { country: "CA", rorId: "https://ror.org/00hj54h04", hiring: false },
    synthetic: true,
    freeTimes: [block("13:00", "14:30")],
  },
];

// Older callers may omit these fields; fixture profiles expose the database defaults.
for (const person of people) {
  person.workplaceName = null;
  person.badgeColour = "sunflower";
  person.visibility = { country: true, workplace: true, hiring: true };
}

export const evidence: EvidenceDoc[] = [
  {
    id: "e_b_1",
    personId: DEMO_USER_B,
    kind: "commit_area",
    title: "Maintains pkg/scheduler/framework/preemption",
    text: "Preemption picks victims by priority and PDB impact, then evicts the cheapest set of pods that lets the pending pod fit. Reviewer on scheduler preemption and priority changes.",
    url: "https://github.com/kubernetes/kubernetes/tree/master/pkg/scheduler/framework/preemption",
  },
  {
    id: "e_b_2",
    personId: DEMO_USER_B,
    kind: "talk",
    title: "KubeCon: Inside the scheduler's scoring and preemption",
    text: "Walkthrough of the scheduling cycle, filter and score plugins, and how preemption chooses which pods to evict.",
  },
  {
    id: "e_001_1",
    personId: "p_001",
    kind: "repo",
    title: "grafana/loki",
    text: "Loki ingester and compactor work; on-call runbooks for Loki and Tempo at Grafana Labs.",
  },
  {
    id: "e_001_2",
    personId: "p_001",
    kind: "abstract",
    title: "Hiring at Grafana Labs: what the SRE loop looks like",
    text: "How Grafana Labs interviews SREs, what the take-home covers, and what the team looks for.",
  },
  {
    id: "e_002_1",
    personId: "p_002",
    kind: "repo",
    title: "etcd-io/raft",
    text: "Raft log compaction, snapshots and leader election; etcd defrag and performance tuning.",
  },
  {
    id: "e_003_1",
    personId: "p_003",
    kind: "repo",
    title: "open-telemetry/opentelemetry-collector-contrib",
    text: "Collector processors and exporters; tail sampling; OTLP exporter retry and queueing.",
  },
  {
    id: "e_004_1",
    personId: "p_004",
    kind: "abstract",
    title: "Platform hiring at Netflix",
    text: "What the platform hiring loop at Netflix covers and how to prepare for the systems design round.",
  },
  {
    id: "e_005_1",
    personId: "p_005",
    kind: "repo",
    title: "argoproj/argo-cd",
    text: "Argo CD sync waves, hooks and ApplicationSet generators; GitOps rollout patterns.",
  },
  {
    id: "e_006_1",
    personId: "p_006",
    kind: "paper",
    title: "Gang scheduling for ML training on Kubernetes",
    text: "Compares scheduler plugins for gang scheduling and preemption of ML training jobs.",
  },
];

/** Which people are themselves looking for someone like a given user (mutual interest). */
export const lookingFor: Record<string, string[]> = {
  [DEMO_USER_A]: [DEMO_USER_B, "p_006"],
  [DEMO_USER_B]: ["p_006"],
};

export const sampleAsks = [
  {
    raw: "I want to understand how preemption works in the Kubernetes scheduler",
    expectedTop: DEMO_USER_B,
  },
  { raw: "I want a job at Grafana Labs", expectedTop: "p_001" },
  { raw: "How does etcd compaction interact with Raft snapshots?", expectedTop: "p_002" },
];
