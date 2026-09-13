import { redirect } from "next/navigation";

// The "When Was..." page moved to the site root. This redirect exists
// only so a previously-bookmarked /when link doesn't dead-end.
export default function WhenRedirect() {
  redirect("/");
}
