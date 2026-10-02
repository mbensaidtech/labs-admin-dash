import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <h1 className="text-xl font-semibold">404</h1>
      <Link href="/" className="text-accent underline-offset-2 hover:underline">
        ← Overview
      </Link>
    </main>
  );
}
