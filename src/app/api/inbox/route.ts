import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("inbox", real.inbox);
