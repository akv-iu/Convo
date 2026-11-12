/**
 * Everything code decides about the synthetic attendees (B1, Phase 3): who they are, which field
 * and focus they work in, where they work, what they can be found by and when they are free.
 * OpenAI only writes their bios and evidence (generate.ts), to the evidence mix planned here.
 * Deterministic: the same seed always plans the same people.
 *
 * Fewer people, deeper profiles: two attendees per focus, each with a secondary interest (from the
 * same field or a neighbouring one) and six to nine evidence items, across cloud native, wider
 * software engineering, and health and life-sciences research.
 */
import { countryName } from "@/components/ui/countries";
import { block, ror } from "@/contracts/fixtures";
import { BadgeColour, type EvidenceDoc, type Person } from "@/contracts/types";

/** Niches the fixture experts own. Nobody generated claims them, so each sample ask keeps one clear best person. */
export const TAKEN = [
  "Kubernetes scheduler preemption", "Grafana Loki or Tempo", "etcd or Raft internals", "the OpenTelemetry Collector",
  "hiring at Netflix", "Argo CD", "gang scheduling for ML training", "Cilium or kube-proxy replacement", "Sigstore or cosign",
];

interface Topic {
  area: string;
  languages: string[];
  /** GitHub organisations they work in. */
  orgs: string[];
  /** Person.expertise labels: what the person finder and search can find them by. */
  expertise: string[];
}

interface Field {
  key: string;
  label: string;
  medical: boolean;
  /** Roles in this field and how common each is. */
  roles: [string, number][];
  /** Workplaces for people who aren't academic or clinical. Never a product name of the field, so evidence can't name it by accident. */
  companies: string[];
  /** Where people in this field publish and speak, for the model. */
  venues: string;
  /** Focuses in other fields that combine naturally with this one, by the start of their area: a secondary interest can come from these. */
  bridges: string[];
  topics: Topic[];
}

const FIELDS: Field[] = [
  {
    key: "cloud", label: "Cloud native and platform engineering", medical: false,
    roles: [["maintainer", 10], ["contributor", 10], ["SRE", 10], ["platform engineer", 14], ["staff engineer", 8], ["engineering manager", 6],
      ["developer advocate", 5], ["researcher", 4], ["PhD student", 4], ["founder", 2], ["consultant", 3]],
    companies: ["Honeycomb", "Docker", "HashiCorp", "Fastly", "Cloudflare", "Shopify", "Spotify", "SUSE", "Canonical", "DigitalOcean",
      "Akamai", "GitLab", "Zalando", "Booking.com", "Amazon Web Services", "Red Hat", "Microsoft", "Datadog", "Independent consultant"],
    venues: "KubeCon + CloudNativeCon, SREcon, Open Source Summit, USENIX ATC, FOSDEM",
    bridges: ["Software supply chain", "Identity and access", "Detection engineering", "Stream processing", "Workflow orchestration", "LLM serving", "MLOps", "Rust async", "Linux kernel", "Go runtime"],
    topics: [
      { area: "Kubernetes cluster autoscaling and Karpenter node provisioning", languages: ["Go"], orgs: ["kubernetes-sigs", "aws"], expertise: ["Kubernetes autoscaling", "Karpenter", "Capacity planning"] },
      { area: "Service mesh traffic management and mTLS with Istio and Envoy", languages: ["Go", "C++"], orgs: ["istio", "envoyproxy"], expertise: ["Service mesh", "Istio", "Envoy proxy", "mTLS"] },
      { area: "Prometheus storage, PromQL performance and Thanos long-term metrics", languages: ["Go"], orgs: ["prometheus", "thanos-io"], expertise: ["Prometheus", "Thanos", "Metrics storage"] },
      { area: "Infrastructure as code with OpenTofu, Terraform providers and Crossplane", languages: ["Go", "HCL"], orgs: ["opentofu", "crossplane"], expertise: ["Infrastructure as code", "Terraform", "Crossplane"] },
      { area: "GitOps delivery with Flux CD and Helm controllers", languages: ["Go"], orgs: ["fluxcd", "helm"], expertise: ["GitOps", "Flux CD", "Helm"] },
      { area: "Policy as code with Open Policy Agent, Gatekeeper and Kyverno", languages: ["Go", "Rego"], orgs: ["open-policy-agent", "kyverno"], expertise: ["Policy as code", "Open Policy Agent", "Kyverno"] },
      { area: "containerd, runc and OCI container runtimes", languages: ["Go"], orgs: ["containerd", "opencontainers"], expertise: ["Container runtimes", "containerd", "OCI"] },
      { area: "Internal developer platforms and Backstage developer portals", languages: ["TypeScript", "Go"], orgs: ["backstage"], expertise: ["Platform engineering", "Backstage", "Developer experience"] },
      { area: "Postgres on Kubernetes with CloudNativePG operators", languages: ["Go", "SQL"], orgs: ["cloudnative-pg"], expertise: ["Kubernetes operators", "PostgreSQL operations", "Backup and recovery"] },
      { area: "Event-driven autoscaling and serverless with KEDA and Knative", languages: ["Go"], orgs: ["kedacore", "knative"], expertise: ["Serverless", "KEDA", "Knative"] },
      { area: "Continuous profiling and kernel tracing with eBPF (Parca, Pyroscope)", languages: ["Go", "C"], orgs: ["parca-dev"], expertise: ["eBPF", "Continuous profiling", "Performance engineering"] },
      { area: "SRE incident response, SLOs and on-call tooling", languages: ["Go", "Python"], orgs: ["openslo"], expertise: ["Site reliability engineering", "Incident response", "SLOs"] },
      { area: "FinOps and Kubernetes cost visibility with OpenCost", languages: ["Go"], orgs: ["opencost"], expertise: ["FinOps", "Cloud cost optimisation"] },
      { area: "Server-side WebAssembly with wasmtime, WASI and Spin", languages: ["Rust"], orgs: ["bytecodealliance", "fermyon"], expertise: ["WebAssembly", "WASI", "Rust"] },
      { area: "Kafka and NATS event streaming on Kubernetes (Strimzi, JetStream)", languages: ["Java", "Go"], orgs: ["strimzi", "nats-io"], expertise: ["Event streaming", "Apache Kafka", "NATS"] },
    ],
  },
  {
    key: "data", label: "Databases and data engineering", medical: false,
    roles: [["data engineer", 14], ["staff engineer", 6], ["maintainer", 6], ["contributor", 6], ["analytics engineer", 5], ["researcher", 4],
      ["PhD student", 4], ["engineering manager", 4], ["founder", 2]],
    companies: ["Stripe", "Shopify", "Spotify", "Zalando", "Booking.com", "Uber", "Airbnb", "Mercado Libre", "Rakuten", "Monzo", "Wise", "Klarna", "Independent consultant"],
    venues: "VLDB, SIGMOD, CIDR, PGConf, Data Council, Current, Flink Forward",
    bridges: ["Postgres on Kubernetes", "Kafka and NATS", "MLOps", "Retrieval-augmented", "EHR data pipelines", "Privacy engineering", "Real-time fraud"],
    topics: [
      { area: "PostgreSQL internals: autovacuum, MVCC and query planning", languages: ["C", "SQL"], orgs: ["postgres"], expertise: ["PostgreSQL internals", "Autovacuum tuning", "Query planning"] },
      { area: "Embedded analytics and vectorised query execution with DuckDB", languages: ["C++", "Python"], orgs: ["duckdb"], expertise: ["DuckDB", "Query engines", "Columnar storage"] },
      { area: "MySQL sharding and distributed SQL with Vitess", languages: ["Go"], orgs: ["vitessio"], expertise: ["Database sharding", "Vitess", "MySQL"] },
      { area: "Batch data engineering and performance tuning with Apache Spark", languages: ["Scala", "Python"], orgs: ["apache"], expertise: ["Apache Spark", "Data engineering", "Spark tuning"] },
      { area: "Lakehouse table formats with Apache Iceberg and data catalogs", languages: ["Java", "Python"], orgs: ["apache"], expertise: ["Apache Iceberg", "Lakehouse architecture", "Data catalogs"] },
      { area: "Stream processing with Apache Flink and exactly-once pipelines", languages: ["Java"], orgs: ["apache"], expertise: ["Apache Flink", "Stream processing"] },
      { area: "Workflow orchestration with Apache Airflow and Dagster", languages: ["Python"], orgs: ["apache", "dagster-io"], expertise: ["Data orchestration", "Apache Airflow", "Dagster"] },
      { area: "Analytics engineering with dbt and data quality testing", languages: ["SQL", "Python"], orgs: ["dbt-labs", "great-expectations"], expertise: ["dbt", "Data modelling", "Data quality"] },
      { area: "CRDTs, local-first software and sync engines", languages: ["TypeScript", "Rust"], orgs: ["automerge", "yjs"], expertise: ["CRDTs", "Local-first software", "Sync engines"] },
    ],
  },
  {
    key: "ml", label: "Machine learning and AI engineering", medical: false,
    roles: [["ML engineer", 14], ["research scientist", 8], ["researcher", 6], ["PhD student", 8], ["staff engineer", 4], ["engineering manager", 4],
      ["founder", 3], ["developer advocate", 2]],
    companies: ["Spotify", "Uber", "Shopify", "Zalando", "Booking.com", "Adobe", "Salesforce", "Airbnb", "Duolingo", "Grammarly", "Canva", "Microsoft", "Independent consultant"],
    venues: "NeurIPS, ICML, ICLR, ACL, EMNLP, Interspeech, MLSys, PyData, AI Engineer Summit",
    bridges: ["Batch data engineering", "Lakehouse", "Event-driven autoscaling", "Privacy engineering", "Deep learning segmentation", "Large language models for clinical", "Fairness and bias"],
    topics: [
      { area: "Evaluating LLM outputs in production: test sets, LLM-as-judge and regression tracking", languages: ["Python"], orgs: ["EleutherAI"], expertise: ["LLM evaluation", "Model monitoring", "Prompt regression testing"] },
      { area: "Retrieval-augmented generation (RAG), embeddings and vector search", languages: ["Python", "Rust"], orgs: ["qdrant", "run-llama"], expertise: ["Retrieval-augmented generation", "Vector search", "Embeddings"] },
      { area: "LLM serving and inference optimisation with vLLM and KServe", languages: ["Python", "CUDA"], orgs: ["vllm-project", "kserve"], expertise: ["LLM inference", "vLLM", "GPU serving"] },
      { area: "Fine-tuning and aligning language models with LoRA and preference optimisation", languages: ["Python"], orgs: ["huggingface"], expertise: ["Fine-tuning", "LoRA", "Preference optimisation"] },
      { area: "MLOps: feature stores, model registries and training pipelines", languages: ["Python", "Go"], orgs: ["feast-dev", "mlflow"], expertise: ["MLOps", "Feature stores", "MLflow"] },
      { area: "Recommender systems, retrieval and learning to rank", languages: ["Python", "Scala"], orgs: ["pytorch"], expertise: ["Recommender systems", "Learning to rank"] },
      { area: "Speech recognition and streaming audio models", languages: ["Python", "C++"], orgs: ["k2-fsa", "espnet"], expertise: ["Speech recognition", "Audio ML"] },
      { area: "ML compilers and GPU kernels with Triton and Apache TVM", languages: ["Python", "C++"], orgs: ["triton-lang", "apache"], expertise: ["ML compilers", "GPU kernels", "Triton"] },
      { area: "Computer vision and model quantisation for edge devices", languages: ["Python", "C++"], orgs: ["openvinotoolkit"], expertise: ["Computer vision", "Model quantisation", "Edge inference"] },
      { area: "Responsible AI: fairness, interpretability and model audits", languages: ["Python"], orgs: ["fairlearn", "interpretml"], expertise: ["AI fairness", "Interpretability", "Model audits"] },
      { area: "Teaching practical deep learning and helping software engineers move into machine learning engineering", languages: ["Python", "TypeScript"], orgs: ["fastai", "tensorflow"], expertise: ["Machine learning engineering", "ML education", "TensorFlow.js"] },
    ],
  },
  {
    key: "systems", label: "Systems programming and languages", medical: false,
    roles: [["systems engineer", 10], ["maintainer", 10], ["contributor", 8], ["staff engineer", 6], ["researcher", 4], ["PhD student", 5], ["engineering manager", 2]],
    companies: ["Cloudflare", "Fastly", "Discord", "Dropbox", "Canonical", "SUSE", "Red Hat", "Microsoft", "Akamai", "Independent consultant"],
    venues: "RustConf, EuroRust, LLVM Developers' Meeting, Linux Plumbers Conference, OSDI, GopherCon, Embedded World, PyCon",
    bridges: ["Server-side WebAssembly", "containerd", "Continuous profiling", "Fuzzing", "Applied cryptography", "Real-time rendering", "JavaScript build tooling", "HPC and MPI"],
    topics: [
      { area: "Rust async runtimes and Tokio internals", languages: ["Rust"], orgs: ["tokio-rs"], expertise: ["Rust", "Async runtimes", "Tokio"] },
      { area: "Compilers and LLVM optimisation passes", languages: ["C++"], orgs: ["llvm"], expertise: ["LLVM", "Compiler optimisation", "Code generation"] },
      { area: "Linux kernel storage I/O and io_uring", languages: ["C"], orgs: ["kernelci"], expertise: ["Linux kernel", "io_uring", "Storage performance"] },
      { area: "Embedded firmware with Zephyr RTOS and embedded Rust", languages: ["C", "Rust"], orgs: ["zephyrproject-rtos", "rust-embedded"], expertise: ["Embedded systems", "Zephyr RTOS", "Embedded Rust"] },
      { area: "Go runtime garbage collection and scheduler performance", languages: ["Go"], orgs: ["golang"], expertise: ["Go runtime", "Garbage collection", "Performance profiling"] },
      { area: "Type systems and language tooling: Python typing and type checkers", languages: ["Python", "OCaml"], orgs: ["python"], expertise: ["Type systems", "Python typing", "Language tooling"] },
    ],
  },
  {
    key: "web", label: "Web, mobile and product design", medical: false,
    roles: [["frontend engineer", 12], ["mobile engineer", 6], ["product designer", 8], ["design engineer", 4], ["staff engineer", 4],
      ["developer advocate", 4], ["engineering manager", 4], ["maintainer", 4], ["founder", 2]],
    companies: ["Shopify", "Spotify", "Airbnb", "Canva", "Atlassian", "Booking.com", "Zalando", "Monzo", "Duolingo", "Adobe", "Independent consultant"],
    venues: "React Summit, JSConf, CSS Day, Config, axe-con, Droidcon, Smashing Conference, ViteConf",
    bridges: ["Evaluating LLM outputs", "Teaching practical deep learning", "CRDTs", "Identity and access", "Server-side WebAssembly"],
    topics: [
      { area: "Accessibility in React apps: ARIA, focus management and screen readers", languages: ["TypeScript"], orgs: ["dequelabs", "w3c"], expertise: ["Web accessibility", "WCAG", "React"] },
      { area: "Design systems: design tokens, component libraries and Figma workflows", languages: ["TypeScript", "CSS"], orgs: ["storybookjs", "radix-ui"], expertise: ["Design systems", "Design tokens", "Product design"] },
      { area: "Web performance and Core Web Vitals", languages: ["JavaScript", "TypeScript"], orgs: ["GoogleChrome"], expertise: ["Web performance", "Core Web Vitals"] },
      { area: "JavaScript build tooling and bundlers: Vite, esbuild and Rspack", languages: ["TypeScript", "Rust"], orgs: ["vitejs", "web-infra-dev"], expertise: ["Build tooling", "Vite", "JavaScript bundlers"] },
      { area: "Native mobile with Kotlin Multiplatform and SwiftUI", languages: ["Kotlin", "Swift"], orgs: ["Kotlin"], expertise: ["Mobile development", "Kotlin Multiplatform", "SwiftUI"] },
      { area: "Offline-first React Native apps and mobile data sync", languages: ["TypeScript"], orgs: ["react-native-community"], expertise: ["React Native", "Offline-first apps"] },
    ],
  },
  {
    key: "security", label: "Security and privacy", medical: false,
    roles: [["security engineer", 12], ["security researcher", 8], ["appsec engineer", 6], ["PhD student", 4], ["researcher", 4], ["maintainer", 4],
      ["engineering manager", 3], ["consultant", 3]],
    companies: ["Cloudflare", "1Password", "Tailscale", "Wiz", "CrowdStrike", "Trail of Bits", "Microsoft", "Independent consultant"],
    venues: "Black Hat, DEF CON, USENIX Security, IEEE S&P, OWASP Global AppSec, Real World Crypto, PETS",
    bridges: ["Policy as code", "containerd", "Health data privacy", "Federated learning", "Responsible AI", "Compilers and LLVM", "Linux kernel"],
    topics: [
      { area: "Fuzzing and application security testing for memory safety bugs", languages: ["C", "Rust", "Python"], orgs: ["AFLplusplus", "rust-fuzz"], expertise: ["Fuzzing", "Application security", "Memory safety"] },
      { area: "Applied cryptography and post-quantum TLS", languages: ["Rust", "C"], orgs: ["rustls", "open-quantum-safe"], expertise: ["Cryptography", "Post-quantum TLS", "Key management"] },
      { area: "Identity and access management with OAuth 2.0 and OpenID Connect", languages: ["Go", "TypeScript"], orgs: ["ory", "keycloak"], expertise: ["Identity and access management", "OAuth 2.0", "OpenID Connect"] },
      { area: "Detection engineering, threat hunting and SIEM rules", languages: ["Python", "Go"], orgs: ["SigmaHQ", "Yara-Rules"], expertise: ["Detection engineering", "Threat hunting", "SIEM"] },
      { area: "Privacy engineering and differential privacy", languages: ["Python"], orgs: ["opendp", "OpenMined"], expertise: ["Differential privacy", "Privacy engineering", "Data anonymisation"] },
      { area: "Software supply chain security: SBOMs, SLSA provenance and dependency scanning", languages: ["Go"], orgs: ["anchore", "slsa-framework"], expertise: ["Supply chain security", "SBOM", "SLSA"] },
    ],
  },
  {
    key: "science", label: "Scientific computing, climate and robotics", medical: false,
    roles: [["research software engineer", 10], ["researcher", 10], ["PhD student", 8], ["postdoc", 6], ["maintainer", 4], ["staff engineer", 2]],
    companies: ["United States Department of Energy", "Planet Labs", "Boston Dynamics", "Microsoft", "Independent consultant"],
    venues: "SC (Supercomputing), AGU Fall Meeting, EGU General Assembly, SciPy, JuliaCon, ICRA, IROS, ROSCon, IEEE Quantum Week",
    bridges: ["Computer vision", "ML compilers", "Batch data engineering", "Workflow orchestration", "Germline and somatic", "Embedded firmware", "Infectious disease"],
    topics: [
      { area: "Climate modelling and Earth system model output with xarray and Pangeo", languages: ["Python", "Fortran"], orgs: ["pangeo-data", "pydata"], expertise: ["Climate modelling", "Earth system models", "xarray"] },
      { area: "HPC and MPI performance on GPU supercomputers", languages: ["C++", "Fortran"], orgs: ["open-mpi", "kokkos"], expertise: ["High-performance computing", "MPI", "GPU computing"] },
      { area: "Geospatial data and satellite imagery pipelines", languages: ["Python"], orgs: ["OSGeo", "opendatacube"], expertise: ["Geospatial analysis", "Remote sensing", "GDAL"] },
      { area: "Scientific machine learning and differential equations in Julia", languages: ["Julia"], orgs: ["SciML"], expertise: ["Julia", "Differential equations", "Scientific machine learning"] },
      { area: "Robotics software with ROS 2 and motion planning", languages: ["C++", "Python"], orgs: ["ros2", "moveit"], expertise: ["Robotics", "ROS 2", "Motion planning"] },
      { area: "Quantum computing software and circuit compilation", languages: ["Python"], orgs: ["Qiskit", "quantumlib"], expertise: ["Quantum computing", "Qiskit", "Circuit compilation"] },
    ],
  },
  {
    key: "games", label: "Games and graphics", medical: false,
    roles: [["game developer", 10], ["graphics engineer", 8], ["engine programmer", 6], ["technical artist", 3], ["maintainer", 4], ["founder", 3], ["engineering manager", 4]],
    companies: ["Ubisoft", "Supercell", "CD PROJEKT RED", "Mojang Studios", "Rovio", "Remedy Entertainment", "Independent consultant"],
    venues: "GDC, SIGGRAPH, Vulkanised, GodotCon, Reboot Develop, Digital Dragons",
    bridges: ["Compilers and LLVM", "Rust async", "Web performance", "Computer vision", "Speech recognition"],
    topics: [
      { area: "Game engine development with Godot and entity component systems", languages: ["C++", "C#"], orgs: ["godotengine"], expertise: ["Game development", "Godot", "Entity component systems"] },
      { area: "Real-time rendering with Vulkan and GPU-driven pipelines", languages: ["C++"], orgs: ["KhronosGroup"], expertise: ["Real-time rendering", "Vulkan", "GPU programming"] },
      { area: "Multiplayer netcode and game server backends", languages: ["C#", "Go"], orgs: ["googleforgames"], expertise: ["Multiplayer netcode", "Game servers", "Game development"] },
    ],
  },
  {
    key: "fintech", label: "Payments and fintech", medical: false,
    roles: [["backend engineer", 10], ["staff engineer", 6], ["data scientist", 4], ["engineering manager", 5], ["ML engineer", 3], ["founder", 2]],
    companies: ["Stripe", "Monzo", "Wise", "Klarna", "Adyen", "Revolut", "Nubank", "Mercado Libre"],
    venues: "QCon, Money20/20, KDD, P99 CONF, GOTO",
    bridges: ["Stream processing", "PostgreSQL internals", "Detection engineering", "Identity and access", "Recommender systems", "Responsible AI"],
    topics: [
      { area: "Payment ledgers, idempotency and double-entry accounting systems", languages: ["Go", "Java"], orgs: ["tigerbeetle", "formance-hq"], expertise: ["Payments", "Ledgers", "Idempotency"] },
      { area: "Real-time fraud detection with streaming features and graph models", languages: ["Python", "Scala"], orgs: ["dmlc"], expertise: ["Fraud detection", "Streaming ML", "Risk modelling"] },
    ],
  },
  {
    key: "informatics", label: "Clinical informatics", medical: true,
    roles: [["clinical informatician", 8], ["clinician-scientist", 4], ["health data engineer", 10], ["software engineer", 6], ["researcher", 6],
      ["PhD student", 4], ["engineering manager", 4], ["founder", 2]],
    companies: ["Flatiron Health", "Komodo Health", "Philips", "Oracle Health", "Doctolib", "Microsoft", "Independent consultant"],
    venues: "AMIA Annual Symposium, MedInfo, HL7 FHIR DevDays, OHDSI Symposium, HIMSS, JAMIA, npj Digital Medicine, JMIR Medical Informatics",
    bridges: ["Analytics engineering", "Workflow orchestration", "Lakehouse", "Privacy engineering", "Identity and access", "Clinical prediction", "Large language models for clinical", "Federated learning"],
    topics: [
      { area: "FHIR interoperability, HL7 v2 and healthcare integration engines", languages: ["Java", "TypeScript"], orgs: ["hapifhir", "HL7"], expertise: ["FHIR", "HL7 interoperability", "Health APIs"] },
      { area: "EHR data pipelines and the OMOP common data model", languages: ["SQL", "R", "Python"], orgs: ["OHDSI"], expertise: ["OMOP CDM", "EHR data", "Real-world data"] },
      { area: "Clinical decision support, CDS Hooks and alert fatigue", languages: ["TypeScript", "Python"], orgs: ["cds-hooks"], expertise: ["Clinical decision support", "CDS Hooks", "Alert fatigue"] },
      { area: "Clinical NLP on free-text notes and coding to SNOMED CT and ICD-10", languages: ["Python"], orgs: ["medspacy"], expertise: ["Clinical NLP", "SNOMED CT", "Information extraction"] },
      { area: "Health data privacy: de-identification, synthetic patient data and trusted research environments", languages: ["Python", "R"], orgs: ["synthetichealth"], expertise: ["Health data privacy", "De-identification", "Synthetic data"] },
    ],
  },
  {
    key: "bio", label: "Bioinformatics and genomics", medical: true,
    roles: [["bioinformatician", 12], ["computational biologist", 8], ["research software engineer", 6], ["PhD student", 8], ["postdoc", 6],
      ["researcher", 6], ["principal investigator", 3], ["ML engineer", 3]],
    companies: ["Benchling", "Roche", "AstraZeneca", "Novartis", "Isomorphic Labs", "Recursion", "Independent consultant"],
    venues: "ISMB, RECOMB, ASHG Annual Meeting, Bioinformatics, Genome Biology, Nature Methods, Nextflow Summit",
    bridges: ["HPC and MPI", "Workflow orchestration", "Scientific machine learning", "Fine-tuning", "Genomic epidemiology", "Lakehouse"],
    topics: [
      { area: "Germline and somatic variant calling pipelines with GATK and Nextflow", languages: ["Python", "Groovy"], orgs: ["nf-core", "broadinstitute"], expertise: ["Variant calling", "Nextflow", "Genomics pipelines"] },
      { area: "Single-cell RNA-seq analysis with Scanpy and Seurat", languages: ["Python", "R"], orgs: ["scverse", "satijalab"], expertise: ["Single-cell RNA-seq", "Scanpy", "Cell type annotation"] },
      { area: "Protein structure prediction and computational protein design", languages: ["Python"], orgs: ["RosettaCommons", "aqlaboratory"], expertise: ["Protein structure prediction", "Protein design", "Structural biology"] },
      { area: "Metagenomics and microbiome profiling", languages: ["Python", "R"], orgs: ["biobakery", "bioconda"], expertise: ["Metagenomics", "Microbiome", "Taxonomic profiling"] },
      { area: "Long-read sequencing, genome assembly and structural variants", languages: ["C++", "Rust"], orgs: ["nanoporetech", "marbl"], expertise: ["Genome assembly", "Long-read sequencing", "Structural variants"] },
      { area: "Statistical genetics: GWAS and polygenic risk scores", languages: ["R", "Python"], orgs: ["hail-is"], expertise: ["GWAS", "Polygenic risk scores", "Statistical genetics"] },
    ],
  },
  {
    key: "imaging", label: "Medical imaging", medical: true,
    roles: [["research scientist", 8], ["ML engineer", 8], ["PhD student", 8], ["postdoc", 4], ["clinician-scientist", 5], ["medical physicist", 3],
      ["software engineer", 4], ["engineering manager", 3]],
    companies: ["Siemens Healthineers", "GE HealthCare", "Philips", "PathAI", "Lunit", "Kheiron Medical Technologies", "Aidoc", "Independent consultant"],
    venues: "MICCAI, RSNA Annual Meeting, ISBI, SPIE Medical Imaging, ISMRM, Medical Image Analysis, Radiology: Artificial Intelligence",
    bridges: ["Computer vision", "ML compilers", "MLOps", "Federated learning", "Fairness and bias", "Medical device software", "FHIR"],
    topics: [
      { area: "Deep learning segmentation of CT and MRI with MONAI and nnU-Net", languages: ["Python"], orgs: ["Project-MONAI", "MIC-DKFZ"], expertise: ["Medical image segmentation", "MONAI", "nnU-Net"] },
      { area: "Computational pathology on whole-slide images", languages: ["Python"], orgs: ["openslide", "qupath"], expertise: ["Digital pathology", "Whole-slide imaging", "Multiple instance learning"] },
      { area: "MRI reconstruction and accelerated imaging", languages: ["Python", "C++"], orgs: ["mrirecon", "gadgetron"], expertise: ["MRI reconstruction", "Compressed sensing", "Deep learning reconstruction"] },
      { area: "DICOM, PACS and medical imaging infrastructure with OHIF and Orthanc", languages: ["TypeScript", "Python"], orgs: ["OHIF", "pydicom"], expertise: ["DICOM", "PACS", "Imaging infrastructure"] },
      { area: "AI for screening: mammography and chest X-ray triage and clinical validation", languages: ["Python"], orgs: ["mlmed"], expertise: ["Breast cancer screening", "Chest X-ray AI", "Clinical validation"] },
    ],
  },
  {
    key: "epi", label: "Epidemiology and public health", medical: true,
    roles: [["epidemiologist", 10], ["biostatistician", 8], ["PhD student", 6], ["postdoc", 4], ["researcher", 6], ["public health data scientist", 6],
      ["clinician-scientist", 2], ["principal investigator", 2]],
    companies: ["World Health Organization", "IQVIA", "Roche", "AstraZeneca", "Novartis", "Independent consultant"],
    venues: "Society for Epidemiologic Research meeting, Epidemics conference, ICPE, American Journal of Epidemiology, The Lancet Infectious Diseases, Pharmacoepidemiology and Drug Safety",
    bridges: ["Batch data engineering", "Analytics engineering", "Scientific machine learning", "Geospatial data", "EHR data pipelines", "Clinical prediction", "Fairness and bias", "Privacy engineering"],
    topics: [
      { area: "Infectious disease transmission modelling, reproduction number (Rt) estimation and outbreak forecasting", languages: ["R", "Python"], orgs: ["epiforecasts", "mrc-ide"], expertise: ["Infectious disease modelling", "Rt estimation", "Outbreak forecasting", "Epidemiology"] },
      { area: "Pharmacoepidemiology and real-world evidence on drug safety", languages: ["R", "SAS"], orgs: ["pharmaverse"], expertise: ["Pharmacoepidemiology", "Real-world evidence", "Drug safety"] },
      { area: "Genomic epidemiology and pathogen surveillance with Nextstrain", languages: ["Python"], orgs: ["nextstrain"], expertise: ["Genomic surveillance", "Phylodynamics", "Nextstrain"] },
      { area: "Causal inference for observational health data and target trial emulation", languages: ["R"], orgs: ["tlverse"], expertise: ["Causal inference", "Target trial emulation", "Biostatistics"] },
    ],
  },
  {
    key: "mlhealth", label: "Machine learning for health and digital health", medical: true,
    roles: [["ML engineer", 8], ["research scientist", 8], ["PhD student", 6], ["data scientist", 6], ["clinician-scientist", 4], ["engineering manager", 4],
      ["founder", 3], ["medical device software engineer", 3]],
    companies: ["Verily", "Tempus", "Owkin", "Flatiron Health", "Huma", "Philips", "Microsoft", "Independent consultant"],
    venues: "ML4H, CHIL, NeurIPS, MLHC, npj Digital Medicine, The Lancet Digital Health, JAMA Network Open",
    bridges: ["Evaluating LLM outputs", "Retrieval-augmented", "MLOps", "Responsible AI", "FHIR", "EHR data pipelines", "Clinical NLP", "Deep learning segmentation", "Privacy engineering", "Causal inference"],
    topics: [
      { area: "Clinical prediction models and early warning scores for sepsis and deterioration", languages: ["Python", "R"], orgs: ["MIT-LCP"], expertise: ["Clinical prediction models", "Sepsis early warning", "MIMIC-IV"] },
      { area: "Wearables and digital biomarkers from sensor data", languages: ["Python", "Kotlin"], orgs: ["ResearchKit", "Sage-Bionetworks"], expertise: ["Wearables", "Digital biomarkers", "Signal processing"] },
      { area: "Federated learning across hospitals", languages: ["Python"], orgs: ["flwrlabs", "securefederatedai"], expertise: ["Federated learning", "Privacy-preserving ML", "Multi-site studies"] },
      { area: "Fairness and bias in clinical algorithms", languages: ["Python", "R"], orgs: ["fairlearn"], expertise: ["Algorithmic fairness", "Health equity", "Model auditing"] },
      { area: "Medical device software and regulated ML: SaMD, IEC 62304 and FDA submissions", languages: ["Python", "C++"], orgs: ["openregulatory"], expertise: ["Software as a medical device", "IEC 62304", "ML model validation"] },
      { area: "Large language models for clinical text and medical question answering", languages: ["Python"], orgs: ["huggingface", "bigbio"], expertise: ["Medical LLMs", "Clinical summarisation", "LLM evaluation"] },
    ],
  },
];

/** Two attendees per focus. */
const PER_TOPIC = 2;
export const COUNT = FIELDS.reduce((sum, field) => sum + field.topics.length * PER_TOPIC, 0);

type Group = "academic" | "clinical" | "research" | "lead" | "engineer";
/** Where a role works and what evidence it leaves: academics publish, engineers ship code, leads speak. Unlisted roles are engineers. */
const GROUP: Record<string, Group> = {
  researcher: "academic", "PhD student": "academic", postdoc: "academic", "principal investigator": "academic",
  "clinical informatician": "clinical", "clinician-scientist": "clinical", "medical physicist": "clinical",
  "research scientist": "research", bioinformatician: "research", "computational biologist": "research", epidemiologist: "research",
  biostatistician: "research", "public health data scientist": "research", "research software engineer": "research", "data scientist": "research",
  "engineering manager": "lead", founder: "lead", "developer advocate": "lead", consultant: "lead",
};
const HIRING_ROLES = new Set(["engineering manager", "founder", "principal investigator"]);

type Kind = EvidenceDoc["kind"];
/** How many items of each kind a group leaves: [fewest, most]. Totals are then held to MIN_ITEMS..MAX_ITEMS. */
const MIX: Record<Group, Partial<Record<Kind, [number, number]>>> = {
  academic: { paper: [3, 4], abstract: [1, 2], talk: [0, 1], repo: [1, 2], profile_page: [0, 1], commit_area: [0, 1] },
  clinical: { paper: [2, 3], abstract: [1, 2], talk: [1, 1], repo: [0, 1], profile_page: [1, 1] },
  research: { paper: [2, 3], repo: [1, 2], commit_area: [0, 1], talk: [1, 1], abstract: [1, 1] },
  lead: { talk: [2, 2], abstract: [1, 2], repo: [1, 2], commit_area: [0, 1], paper: [0, 1], profile_page: [0, 1] },
  engineer: { repo: [2, 3], commit_area: [1, 2], talk: [1, 2], abstract: [0, 1], paper: [0, 1] },
};
/** What a group gains first when its mix comes out short. */
const MAIN: Record<Group, Kind> = { academic: "paper", clinical: "paper", research: "paper", lead: "talk", engineer: "repo" };
export const MIN_ITEMS = 6;
export const MAX_ITEMS = 9;

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
  ["US", 36], ["GB", 10], ["IN", 8], ["DE", 7], ["CA", 6], ["BR", 4], ["FR", 3], ["NL", 3], ["JP", 3], ["NG", 2],
  ["KE", 2], ["AU", 2], ["ES", 2], ["PL", 2], ["SE", 2], ["MX", 2], ["KR", 2], ["SG", 2],
];
/** Unlisted in our ROR list, so these get a workplace name and no ROR ID. */
const UNIVERSITIES: Record<string, string> = {
  IN: "Indian Institute of Science", BR: "Universidade de São Paulo", FR: "Sorbonne Université", NL: "TU Delft",
  JP: "University of Tokyo", NG: "University of Lagos", KE: "University of Nairobi", AU: "University of Melbourne",
  ES: "Universidad Politécnica de Madrid", PL: "Warsaw University of Technology", SE: "KTH Royal Institute of Technology",
  MX: "UNAM", KR: "KAIST", SG: "National University of Singapore",
};
/** Medical academics where the general university is a technical one. */
const MEDICAL_UNIVERSITIES: Record<string, string> = {
  NL: "Erasmus University Rotterdam", SE: "Karolinska Institutet", PL: "Medical University of Warsaw", ES: "Universitat de Barcelona",
  KR: "Seoul National University", IN: "All India Institute of Medical Sciences",
};
/** Teaching hospitals for clinical roles, by country. Unlisted, so no ROR ID. */
const HOSPITALS: Record<string, string[]> = {
  US: ["Mayo Clinic", "Massachusetts General Hospital", "Cleveland Clinic", "Johns Hopkins Hospital"],
  GB: ["Guy's and St Thomas' NHS Foundation Trust", "Oxford University Hospitals NHS Foundation Trust", "Great Ormond Street Hospital"],
  IN: ["Christian Medical College Vellore"], DE: ["Charité – Universitätsmedizin Berlin"], CA: ["University Health Network", "The Hospital for Sick Children"],
  BR: ["Hospital Israelita Albert Einstein"], FR: ["Assistance Publique – Hôpitaux de Paris"], NL: ["Erasmus MC"], JP: ["Keio University Hospital"],
  NG: ["Lagos University Teaching Hospital"], KE: ["Kenyatta National Hospital"], AU: ["Royal Melbourne Hospital"], ES: ["Hospital Clínic de Barcelona"],
  PL: ["University Clinical Centre in Gdańsk"], SE: ["Karolinska University Hospital"], MX: ["Hospital General de México"],
  KR: ["Seoul National University Hospital"], SG: ["Singapore General Hospital"],
};
/** Grafana Labs and Netflix stay unique to their fixture experts, whom two sample asks target. */
const LISTED = ror.filter((org) => !["Grafana Labs", "Netflix"].includes(org.name));
const LISTED_UNIVERSITY = /University|Institute|Polytechnic/;

export interface Planned {
  person: Person;
  role: string;
  field: string;
  /** Main focus: most of their evidence. */
  focus: string;
  /** Secondary interest, from their field or a neighbouring one: one or two evidence items. */
  also: string;
  /** How many evidence items of each kind generate.ts writes. */
  mix: Partial<Record<Kind, number>>;
  /** Where people in their field publish and speak. */
  venues: string;
}

/** Fields by label, medical or not, for the coverage summary and tests. */
export const FIELD_LABELS = FIELDS.map(({ label, medical }) => ({ label, medical }));

/** Words that would claim a fixture expert's niche (TAKEN). Whole words, so "temporal" isn't "Tempo". */
const NICHES = [/\bloki\b/, /\btempo\b/, /opentelemetry collector/, /\bargo ?cd\b/, /gang schedul/, /\bcilium\b/, /kube-proxy/,
  /\bsigstore\b/, /\bcosign\b/, /\bnetflix\b/, /\bgrafana\b/, /preemption/];
/** Health systems and datasets that give away a country. */
const REVEALING = /\bNHS\b|\bMedicare\b|\bMedicaid\b|Veterans Affairs|\bUK Biobank\b/i;

/** He, she and the like: nobody's gender is known, so profiles say "they" (as the why-them lines must). */
const GENDERED = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
/** First person ("I build", "my lab"), but not "Phase I" or "type I error". */
const FIRST_PERSON = /\bI(?:'m|'ve|'d)\b|\b[Mm]y\b|(?:^|[.;:!?,]\s+|\band\s+)I\s/;

/**
 * Why a person's written text (bio and evidence) can't be published, or undefined when it can: it
 * must never reveal their workplace or country (the card shows those, and some people hide them),
 * link anywhere or claim a fixture expert's niche, and it speaks of them in the third person as
 * "they". generate.ts rewrites anyone it rejects.
 */
export function unusable(person: Person, text: string): string | undefined {
  const lower = text.toLowerCase();
  if (person.workplaceName && lower.includes(person.workplaceName.toLowerCase())) return "names the workplace";
  if (lower.includes(countryName(person.filters.country).toLowerCase())) return "names the country";
  if (REVEALING.test(text)) return "names a health system that gives away a country";
  if (/https?:|www\.|\S@\S+\.\w/.test(text)) return "has a link or email address";
  const niche = NICHES.find((pattern) => pattern.test(lower));
  if (niche) return `claims a fixture niche (${niche.source})`;
  if (GENDERED.test(text)) return "uses a gendered pronoun";
  if (FIRST_PERSON.test(text)) return "is written in the first person";
  return undefined;
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

interface Random {
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly [T, number][]): T;
  between(range: [number, number]): number;
  chance(p: number): boolean;
}

function randomFrom(seed: number): Random & { next: () => number } {
  const next = seeded(seed);
  return {
    next,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      let left = next() * items.reduce((sum, [, weight]) => sum + weight, 0);
      for (const [item, weight] of items) {
        left -= weight;
        if (left < 0) return item;
      }
      return items.at(-1)![0]; // rounding can leave a sliver past the last weight
    },
    between: ([low, high]) => low + Math.floor(next() * (high - low + 1)),
    chance: (p) => next() < p,
  };
}

const ALL_TOPICS = FIELDS.flatMap((field) => field.topics);
/** Each field's bridges, as topics. A bridge that names no topic is a typo: fail at once. */
const BRIDGES = new Map(FIELDS.map((field) => [field, field.bridges.map((start) => {
  const topic = ALL_TOPICS.find((t) => t.area.startsWith(start) && !field.topics.includes(t));
  if (!topic) throw new Error(`${field.key} bridges to "${start}", which is no other field's focus`);
  return topic;
})]));
/** Every person's field and focus, in order: the two people sharing a focus sit next to each other. */
const SLOTS = FIELDS.flatMap((field) => field.topics.flatMap((topic) => Array.from({ length: PER_TOPIC }, () => ({ field, topic }))));
const groupOf = (role: string): Group => GROUP[role] ?? "engineer";
/** The first n distinct values, in order. */
const firstDistinct = (values: string[], n: number) => [...new Set(values)].slice(0, n);

export function plan(seed = 20261109): Planned[] {
  const random = randomFrom(seed);

  // Every first and last name pair, shuffled; the first COUNT are the attendees.
  const names = FIRST.flatMap((first) => LAST.map((last) => [first, last] as const));
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const planned: Planned[] = [];
  for (const [i, { field, topic }] of SLOTS.entries()) {
    const [first, last] = names[i];
    // The two people on one focus never share a role, so they come at it from different angles.
    const partner = i % PER_TOPIC ? planned[i - 1] : undefined;
    let role = random.weighted(field.roles);
    for (let tries = 0; partner && role === partner.role && tries < 6; tries++) role = random.weighted(field.roles);

    // Secondary interest: usually another focus in the same field, sometimes a bridging focus from another field.
    const also = random.chance(0.4) ? random.pick(BRIDGES.get(field)!) : random.pick(field.topics.filter((other) => other !== topic));

    const { country, workplace, rorId } = workplaceFor(field, groupOf(role), random);
    const login = `demo-${first}-${last}`.normalize("NFD").replace(/[^\w-]/g, "").toLowerCase();
    const person: Person = {
      id: `s_${String(i + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      githubLogin: login, // "demo-" so a synthetic card can never link to a real GitHub account
      bio: "", // written by generate.ts
      languages: firstDistinct([...topic.languages, ...(random.chance(0.5) ? also.languages.slice(0, 1) : [])], 3),
      expertise: firstDistinct([...topic.expertise, also.expertise[0]], 8),
      organisations: firstDistinct([...topic.orgs, ...(random.chance(0.4) ? also.orgs.slice(0, 1) : [])], 3),
      filters: { country, rorId, hiring: random.chance(HIRING_ROLES.has(role) ? 0.7 : 0.08) },
      workplaceName: workplace,
      badgeColour: random.pick(BadgeColour.options),
      visibility: { country: !random.chance(0.08), workplace: !random.chance(0.08), hiring: !random.chance(0.06) },
      synthetic: true,
      freeTimes: freeTimes(random.next),
    };
    planned.push({
      person, role, field: field.label, focus: topic.area, also: also.area, mix: evidenceMix(groupOf(role), random), venues: field.venues,
    });
  }
  return planned;
}

/**
 * Academics work at a university (a listed one, with its ROR ID, where the country has one),
 * clinical roles at a teaching hospital, research roles at either a university or a company of
 * their field, everyone else at a company. A listed company (Microsoft, Red Hat...) brings its ROR ID and country.
 */
function workplaceFor(field: Field, group: Group, random: Random): { country: string; workplace: string; rorId: string | null } {
  const university = group === "academic" || (group === "research" && random.chance(0.5));
  if (!university && group !== "clinical") {
    const company = random.pick(field.companies);
    const listed = LISTED.find((org) => org.name === company);
    if (listed) return { country: listed.country, workplace: listed.name, rorId: listed.id };
    return { country: random.weighted(COUNTRIES), workplace: company, rorId: null };
  }
  const country = random.weighted(COUNTRIES);
  if (group === "clinical") return { country, workplace: random.pick(HOSPITALS[country]), rorId: null };
  const listed = LISTED.filter((org) => org.country === country && LISTED_UNIVERSITY.test(org.name));
  if (listed.length) {
    const org = random.pick(listed);
    return { country, workplace: org.name, rorId: org.id };
  }
  return { country, workplace: (field.medical && MEDICAL_UNIVERSITIES[country]) || UNIVERSITIES[country], rorId: null };
}

/** How many items of each kind, held to MIN_ITEMS..MAX_ITEMS: a short mix gains its main kind, a long one loses from its largest. */
function evidenceMix(group: Group, random: Random): Partial<Record<Kind, number>> {
  const mix: Partial<Record<Kind, number>> = {};
  for (const [kind, range] of Object.entries(MIX[group]) as [Kind, [number, number]][]) {
    const n = random.between(range);
    if (n) mix[kind] = n;
  }
  const total = () => Object.values(mix).reduce((sum, n) => sum + n, 0);
  while (total() < MIN_ITEMS) mix[MAIN[group]] = (mix[MAIN[group]] ?? 0) + 1;
  while (total() > MAX_ITEMS) {
    const [largest] = (Object.entries(mix) as [Kind, number][]).toSorted(([, a], [, b]) => b - a)[0];
    mix[largest]! -= 1;
  }
  return mix;
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
