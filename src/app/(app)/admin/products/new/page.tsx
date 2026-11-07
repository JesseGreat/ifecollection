import { Page, PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../ProductForm";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("id,name").eq("active", true).order("sort_order").order("name");
  return (
    <Page>
      <PageHeader title="New product" back="/admin/products" />
      <ProductForm categories={data ?? []} />
    </Page>
  );
}
