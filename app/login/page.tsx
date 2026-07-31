export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-[15vh] w-full max-w-sm px-6">
      <h1 className="text-xl font-semibold">Office Hours Hub</h1>
      <p className="mt-1 text-sm text-neutral-500">Enter the password to continue.</p>
      <form method="POST" action="/api/hub/login" className="mt-6 space-y-3">
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
        />
        {error ? <p className="text-sm text-red-600">Incorrect password.</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
