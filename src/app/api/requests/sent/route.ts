import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("sentRequests", real.sentRequests);
