/**
 * Everything code decides about the 500 synthetic attendees (B1, Phase 3): who they are,
 * where they work, what they focus on and when they are free. OpenAI only writes their
 * bios and evidence (generate.ts). Deterministic: the same seed always plans the same people.
 */
import { block, ror } from "@/contracts/fixtures";
import { BadgeColour, type Person } from "@/contracts/types";

export const COUNT = 500;

/** Niches the fixture experts own. Nobody generated claims them, so each sample ask keeps one clear best person. */
export const TAKEN = [
  "Kubernetes scheduler preemption", "Grafana Loki or Tempo", "etcd or Raft internals", "the OpenTelemetry Collector",
  "hiring at Netflix", "Argo CD", "gang scheduling for ML training", "Cilium or kube-proxy replacement", "Sigstore or cosign",
];

/** About ten attendees per focus area. */
const TOPICS: { area: string; languages: string[]; orgs: string[] }[] = [
  { area: "Kubernetes cluster autoscaling and Karpenter node provisioning", languages: ["Go"], orgs: ["kubernetes-sigs", "aws"] },
  { area: "Kubernetes network policies with Calico", languages: ["Go"], orgs: ["projectcalico"] },
  { area: "Istio traffic management and mTLS", languages: ["Go"], orgs: ["istio"] },
  { area: "Linkerd proxy performance", languages: ["Rust", "Go"], orgs: ["linkerd"] },
  { area: "Envoy proxy filters and xDS control planes", languages: ["C++", "Go"], orgs: ["envoyproxy"] },
  { area: "Gateway API and Kubernetes ingress", languages: ["Go"], orgs: ["kubernetes-sigs"] },
  { area: "Prometheus storage and PromQL performance", languages: ["Go"], orgs: ["prometheus"] },
  { area: "Thanos and long-term metrics storage", languages: ["Go"], orgs: ["thanos-io"] },
  { area: "Jaeger trace storage backends", languages: ["Go"], orgs: ["jaegertracing"] },
  { area: "Fluent Bit log pipelines", languages: ["C"], orgs: ["fluent"] },
  { area: "Continuous profiling with eBPF (Parca, Pyroscope)", languages: ["Go", "C"], orgs: ["parca-dev"] },
  { area: "Falco runtime security rules", languages: ["C++", "Go"], orgs: ["falcosecurity"] },
  { area: "Open Policy Agent and Gatekeeper admission policies", languages: ["Go", "Rego"], orgs: ["open-policy-agent"] },
  { area: "Kyverno policies", languages: ["Go"], orgs: ["kyverno"] },
  { area: "SPIFFE and SPIRE workload identity", languages: ["Go"], orgs: ["spiffe"] },
  { area: "SBOM generation and vulnerability scanning", languages: ["Go"], orgs: ["anchore"] },
  { area: "Kubernetes security hardening and CIS benchmarks", languages: ["Go", "Python"], orgs: ["aquasecurity"] },
  { area: "containerd and runc container runtimes", languages: ["Go"], orgs: ["containerd", "opencontainers"] },
  { area: "Server-side WebAssembly with wasmtime and Spin", languages: ["Rust"], orgs: ["bytecodealliance", "fermyon"] },
  { area: "Crossplane and infrastructure as Kubernetes APIs", languages: ["Go"], orgs: ["crossplane"] },
  { area: "OpenTofu and Terraform providers", languages: ["Go"], orgs: ["opentofu"] },
  { area: "Flux CD and Helm controllers", languages: ["Go"], orgs: ["fluxcd"] },
  { area: "Helm chart design and OCI registries", languages: ["Go"], orgs: ["helm"] },
  { area: "Backstage developer portals", languages: ["TypeScript"], orgs: ["backstage"] },
  { area: "Internal developer platforms and golden paths", languages: ["Go", "TypeScript"], orgs: ["cncf"] },
  { area: "Chaos engineering with Litmus and Chaos Mesh", languages: ["Go"], orgs: ["litmuschaos", "chaos-mesh"] },
  { area: "Postgres on Kubernetes with CloudNativePG", languages: ["Go"], orgs: ["cloudnative-pg"] },
  { area: "Vitess and MySQL sharding", languages: ["Go"], orgs: ["vitessio"] },
  { area: "Kafka on Kubernetes with Strimzi", languages: ["Java"], orgs: ["strimzi"] },
  { area: "NATS messaging and JetStream", languages: ["Go"], orgs: ["nats-io"] },
  { area: "Dapr distributed application runtime", languages: ["Go", "C#"], orgs: ["dapr"] },
  { area: "KEDA event-driven autoscaling", languages: ["Go"], orgs: ["kedacore"] },
  { area: "Knative serving and scale to zero", languages: ["Go"], orgs: ["knative"] },
  { area: "GPU sharing and device plugins for AI inference", languages: ["Go", "Python"], orgs: ["NVIDIA"] },
  { area: "LLM serving on Kubernetes with vLLM and KServe", languages: ["Python"], orgs: ["kserve", "vllm-project"] },
  { area: "Ray clusters for distributed Python", languages: ["Python"], orgs: ["ray-project"] },
  { area: "Feature stores and ML data pipelines", languages: ["Python"], orgs: ["feast-dev"] },
  { area: "FinOps and Kubernetes cost visibility with OpenCost", languages: ["Go"], orgs: ["opencost"] },
  { area: "Edge Kubernetes with K3s and KubeEdge", languages: ["Go"], orgs: ["k3s-io", "kubeedge"] },
  { area: "Multi-cluster management with Cluster API", languages: ["Go"], orgs: ["kubernetes-sigs"] },
  { area: "Kubernetes storage and CSI drivers", languages: ["Go"], orgs: ["kubernetes-csi"] },
  { area: "Rook and Ceph storage", languages: ["Go", "C++"], orgs: ["rook"] },
  { area: "Writing Kubernetes operators with the Operator SDK", languages: ["Go"], orgs: ["operator-framework"] },
  { area: "Kubernetes tooling in Rust with kube-rs", languages: ["Rust"], orgs: ["kube-rs"] },
  { area: "gRPC and protocol buffers at scale", languages: ["Go", "C++"], orgs: ["grpc"] },
  { area: "SRE incident response and on-call tooling", languages: ["Go", "Python"], orgs: ["cncf"] },
  { area: "Developer relations and documentation for CNCF projects", languages: ["Markdown", "TypeScript"], orgs: ["cncf"] },
  { area: "Redis and Valkey on Kubernetes", languages: ["Go", "C"], orgs: ["valkey-io"] },
];

const ROLES: [string, number][] = [
  ["maintainer", 12], ["contributor", 18], ["SRE", 10], ["platform engineer", 14], ["staff engineer", 8],
  ["engineering manager", 6], ["developer advocate", 5], ["researcher", 7], ["PhD student", 8], ["student", 6],
  ["founder", 3], ["consultant", 3],
];
const ACADEMIC = new Set(["researcher", "PhD student", "student"]);
const HIRING_ROLES = new Set(["engineering manager", "founder"]);

/** No first names shared with the fixture people, so search results never look like duplicates. */
const FIRST = [
  "Amara", "Kenji", "Lucia", "Mateo", "Ingrid", "Ravi", "Zanele", "Oskar", "Mei", "Diego", "Fatima", "Lars",
  "Ana", "Tariq", "Hana", "Nikolai", "Chiara", "Jamal", "Sakura", "Pablo", "Leila", "Henrik", "Nia", "Arjun",
  "Elif", "Tomas", "Yara", "Kofi", "Greta", "Ming", "Ines", "Sipho", "Freya", "Rohan", "Camila", "Emeka",
  "Astrid", "Hiro", "Valentina", "Omar", "Noor", "Felix", "Adaeze", "Joon", "Marta", "Idris", "Saanvi", "Bruno",
  "Wanjiru", "Erik", "Lina", "Thabo", "Clara", "Daniyar", "Rosa", "Kai", "Esther", "Malik", "Ayumi", "Jonas",
];
const LAST = [
  "Okafor", "Watanabe", "Moreau", "Silva", "Johansson", "Iyer", "Dlamini", "Nowak", "Chen", "Herrera", "Haddad",
  "Berg", "Costa", "Rahman", "Kim", "Volkov", "Romano", "Bennett", "Sato", "Garcia", "Nasser", "Larsen", "Mwangi",
  "Kapoor", "Yilmaz", "Novak", "Ferreira", "Asante", "Weber", "Liu", "Ortiz", "Mendes", "Fischer", "Abara",
  "Nakamura", "Rossi", "Kowalski", "Singh", "Ndlovu", "Petersen", "Alvarez", "Brennan", "Hoffmann", "Osei", "Park",
  "Lindgren", "Duarte", "Hussain", "Morales", "Sorensen", "Eriksen", "Banerjee", "Adeyemi", "Castillo", "Varga",
  "Jensen", "Khalil", "Ibrahim", "Moretti", "Quinn",
];

const COUNTRIES: [string, number][] = [
  ["US", 42], ["IN", 8], ["GB", 7], ["DE", 6], ["CA", 6], ["BR", 4], ["FR", 3], ["NL", 3], ["JP", 3], ["NG", 2],
  ["KE", 2], ["AU", 2], ["ES", 2], ["PL", 2], ["SE", 2], ["MX", 2], ["KR", 2], ["SG", 2],
];
/** Unlisted in our ROR list, so these get a workplace name and no ROR ID. */
const UNIVERSITIES: Record<string, string> = {
  IN: "Indian Institute of Science", BR: "Universidade de São Paulo", FR: "Sorbonne Université", NL: "TU Delft",
  JP: "University of Tokyo", NG: "University of Lagos", KE: "University of Nairobi", AU: "University of Melbourne",
  ES: "Universidad Politécnica de Madrid", PL: "Warsaw University of Technology", SE: "KTH Royal Institute of Technology",
  MX: "UNAM", KR: "KAIST", SG: "National University of Singapore",
};
const COMPANIES = [
  "Honeycomb", "Docker", "HashiCorp", "Fastly", "Cloudflare", "Shopify", "Spotify", "Intel", "IBM", "SUSE",
  "Canonical", "DigitalOcean", "Akamai", "Elastic", "MongoDB", "Confluent", "Snowflake", "Databricks", "Stripe",
  "GitLab", "JetBrains", "Zalando", "Booking.com", "Mercado Libre", "Rakuten", "Infosys", "Amazon Web Services",
  "NVIDIA", "Salesforce", "Adobe", "Uber", "Airbnb", "Independent consultant",
];
/** Grafana Labs and Netflix stay unique to their fixture experts, whom two sample asks target. */
const LISTED = ror.filter((org) => !["Grafana Labs", "Netflix"].includes(org.name));
const LISTED_UNIVERSITY = /University|Institute|Polytechnic/;

export interface Planned {
  person: Person;
  role: string;
  focus: string;
}

/** mulberry32: a tiny seeded generator, so the plan never changes between runs. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0; // keep 32 bits, as the algorithm requires
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function plan(seed = 20261109): Planned[] {
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const weighted = <T>(items: readonly [T, number][]): T => {
    let left = random() * items.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [item, weight] of items) {
      left -= weight;
      if (left < 0) return item;
    }
    return items.at(-1)![0]; // rounding can leave a sliver past the last weight
  };
  const chance = (p: number) => random() < p;

  // Every first and last name pair, shuffled; the first COUNT are the attendees.
  const names = FIRST.flatMap((first) => LAST.map((last) => [first, last] as const));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  return names.slice(0, COUNT).map(([first, last], i) => {
    const topic = TOPICS[i % TOPICS.length];
    const role = weighted(ROLES);
    const country = weighted(COUNTRIES);
    const academic = ACADEMIC.has(role);
    const listed = LISTED.filter((org) => org.country === country && LISTED_UNIVERSITY.test(org.name) === academic);
    // Academics in a country with a listed university always get one, with its ROR ID; UNIVERSITIES covers the rest.
    const org = listed.length && (academic || chance(0.3)) ? pick(listed) : undefined;
    const unlisted = academic ? UNIVERSITIES[country] : pick(COMPANIES);
    const workplace = org?.name ?? unlisted;
    const login = `demo-${first}-${last}`.normalize("NFD").replace(/[^\w-]/g, "").toLowerCase();
    const person: Person = {
      id: `s_${String(i + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      githubLogin: login, // "demo-" so a synthetic card can never link to a real GitHub account
      bio: "", // written by generate.ts
      languages: topic.languages,
      organisations: topic.orgs,
      filters: { country, rorId: org?.id ?? null, hiring: chance(HIRING_ROLES.has(role) ? 0.7 : 0.08) },
      workplaceName: workplace,
      badgeColour: pick(BadgeColour.options),
      visibility: { country: !chance(0.08), workplace: !chance(0.08), hiring: !chance(0.06) },
      synthetic: true,
      freeTimes: freeTimes(random),
    };
    return { person, role, focus: topic.area };
  });
}

/** One to three free blocks on the conference day, 30 to 90 minutes each, between 09:00 and 17:30. */
function freeTimes(random: () => number): Person["freeTimes"] {
  const dayEnd = 17; // 17:30, in half hours after 09:00
  const taken: [number, number][] = [];
  const wanted = 1 + Math.floor(random() * 3);
  for (let tries = 0; taken.length < wanted && tries < 20; tries++) {
    const start = Math.floor(random() * dayEnd);
    const end = Math.min(start + 1 + Math.floor(random() * 3), dayEnd);
    if (taken.every(([s, e]) => end <= s || start >= e)) taken.push([start, end]);
  }
  const clock = (halfHour: number) => `${String(9 + Math.floor(halfHour / 2)).padStart(2, "0")}:${halfHour % 2 ? "30" : "00"}`;
  return taken.toSorted(([a], [b]) => a - b).map(([start, end]) => block(clock(start), clock(end)));
}
