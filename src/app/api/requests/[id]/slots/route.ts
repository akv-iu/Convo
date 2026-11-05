import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("slots", real.slots);
