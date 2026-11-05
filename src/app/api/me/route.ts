import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("getMe", real.getMe);
export const PUT = api("putMe", real.putMe);
