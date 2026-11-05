import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("getAvailability", real.getAvailability);
export const PUT = api("putAvailability", real.putAvailability);
