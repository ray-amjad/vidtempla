import DocsArticle from "@/components/docs/DocsArticle";

export default function OrganizationsPage() {
  return (
    <DocsArticle
      path="/docs/workspace/organizations"
      title="Organizations and members"
      description="Manage workspace membership, roles, invitations, and organization settings."
    >
      <p>
        Use the organization switcher to move between workspaces or create a new
        organization. Organization settings let you rename the active
        organization.
      </p>
      <h2>Members and invitations</h2>
      <p>
        Administrators can invite members as members or admins, change eligible
        member roles, remove members, and cancel pending invitations. The owner
        role is shown separately and is not managed through the member role
        menu.
      </p>
      <h2>Delete an organization carefully</h2>
      <p>
        Only the owner can delete an organization, and VidTempla disables that
        action for a paid organization or your only organization. Deletion is
        permanent: channels, templates, containers, and API keys are removed.
      </p>
    </DocsArticle>
  );
}
