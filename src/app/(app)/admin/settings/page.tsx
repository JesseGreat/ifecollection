import { Page, PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { CategoriesEditor, SettingsForm } from "./SettingsUi";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: categories }] = await Promise.all([
    supabase.from("settings").select("staff_open_time,staff_close_time,warn_minutes,store_phone,store_address,receipt_footer").single(),
    supabase.from("categories").select("id,name,sort_order,active").order("sort_order").order("name"),
  ]);
  return (
    <Page>
      <PageHeader title="Settings" back="/admin/more" />
      <div className="space-y-4 pb-8">
        {settings && <SettingsForm initial={settings} />}
        <CategoriesEditor initial={categories ?? []} />
      </div>
    </Page>
  );
}
