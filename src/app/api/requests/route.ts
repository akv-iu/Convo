import { api } from "@/server/api";
import { real } from "@/server/real";

export const POST = api("sendRequest", real.sendRequest);
