import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-start gap-3 p-8">
      <h1 className="text-lg font-medium">找不到这个页面</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        回到首页继续创作。
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        回首页
      </Link>
    </main>
  );
}
