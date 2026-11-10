import { notFound } from "next/navigation";
import { CountScreen } from "./CountScreen";

export const metadata = { title: "Stock count" };

export default async function CountPage({ params }: PageProps<"/count/[kind]">) {
  const { kind } = await params;
  if (kind !== "opening" && kind !== "closing") notFound();
  return <CountScreen kind={kind} />;
}
