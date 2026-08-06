
import { ErrorReporter } from "@/app/web/_components/ErrorReporter";

export default function WebLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {/* Mounted at the layout so it covers every screen a worker can reach,
          including any that fail before their own component renders. */}
      <ErrorReporter />
      {children}
    </>
  );
}
