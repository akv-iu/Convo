import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("getContact", real.getContact);
export const PUT = api("putContact", real.putContact);
