import { createServerClient } from "../../lib/supabase";

export default async function Page() {
  const supabase = createServerClient();

  // TODO: Replace with actual table once migration exists, or remove this page
  const { data: profiles } = await supabase.from("profiles").select("id, display_name");

  return (
    <ul>
      {profiles?.map((profile: { id: string; display_name: string | null }) => (
        <li key={profile.id}>{profile.display_name ?? profile.id}</li>
      ))}
    </ul>
  );
}
