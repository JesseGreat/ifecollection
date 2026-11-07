import { Page, PageHeader } from "@/components/PageHeader";
import { createClient, getSessionStatus } from "@/lib/supabase/server";
import { NewStaffForm, StaffRow } from "./StaffUi";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const status = await getSessionStatus();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id,username,full_name,role,active,created_at").order("role").order("full_name");

  return (
    <Page>
      <PageHeader title="Staff" back="/admin/more" />
      <div className="space-y-4 pb-8">
        <ul className="divide-y divide-line rounded-2xl bg-white">
          {(data ?? []).map((p) => (
            <StaffRow key={p.id} person={p} isSelf={p.id === status.user_id} />
          ))}
        </ul>
        <NewStaffForm />
        <p className="text-sm text-muted">
          Staff can log in only between {status.open_time} and {status.close_time} (Lagos time). Change the hours in Settings.
        </p>
      </div>
    </Page>
  );
}
