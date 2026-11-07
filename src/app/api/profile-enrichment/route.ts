import { enrichmentApi } from "./_adapter";

export const POST = enrichmentApi("startEnrichment");
export const GET = enrichmentApi("enrichmentState");
export const PUT = enrichmentApi("saveEnrichmentIdentity");
