import Link from "next/link";
import { Button } from "@/components/ui/button";
import { config } from "@/server/config";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">Convo</h1>
      <p className="text-lg text-muted">
        Bring a specific question or goal. See the few people in the room with evidence they can help, and book a short,
        focused conversation.
      </p>
      <div className="flex flex-wrap gap-3">
        {config.fakeApi ? (
          <Button href="/dev/routes">Browse the fake API</Button>
        ) : (
          <Button href="/api/auth/signin">Sign in with GitHub</Button>
        )}
        <Link href="/dev/routes" className="self-center text-sm underline underline-offset-4">
          API contract
        </Link>
      </div>
      {config.fakeApi && (
        <p className="text-sm text-muted">
          Running with <code>FAKE_API=1</code>: every route answers from memory as demo user A. Send the header{" "}
          <code>x-demo-user: u_demo_b</code> to act as demo user B.
        </p>
      )}
    </main>
  );
}
