import { api } from "@/server/api";
import { real } from "@/server/real";

export const GET = api("findPeople", real.findPeople);
